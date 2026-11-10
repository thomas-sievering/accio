import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';
import { startStandalone } from './standalone.js';
import { FakeCodex, fakeAnthropicApi, fakeAnthropicAuth, fakeChatGPT } from './testing/fakeProviders.js';

/**
 * The real Claude Code (if installed) and Codex (the version this package
 * pins) complete a turn through the standalone Sorting Hat with a hat key.
 * Providers are faked, so no account is used; the CLIs run with their own
 * empty config folders.
 */
const run = promisify(execFile);
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

async function installed(command: string) {
  try { await run(command, ['--version'], { timeout: 20_000 }); return true; } catch { return false; }
}
const codexCli = createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');

/** The CLIs' environment: nothing of the developer's own provider settings. */
function cleanEnv(extra: Record<string, string>) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ANTHROPIC_|CLAUDE_|CLAUDECODE$|OPENAI_|CODEX_)/i.test(k)));
  return { ...env, ...extra } as NodeJS.ProcessEnv;
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'sorting-hat-cli-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const auth = fakeAnthropicAuth();
  const anthropic = await fakeAnthropicApi();
  const chatgpt = fakeChatGPT();
  const codex = new FakeCodex();
  const hat = await startStandalone({ dir: join(dir, 'state'), claudeFetch: auth.fetch, anthropicUrl: anthropic.url, codexFactory: codex.factory, openaiFetch: chatgpt.fetch, openaiUrl: 'https://chatgpt.test/backend-api/codex' });
  cleanup.push(anthropic.close, hat.close);
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${hat.url}/api/${path}`, { method, headers: { authorization: `Bearer ${hat.adminToken}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return res.status === 204 ? undefined : res.json();
  };
  const claudeAccount = await api('POST', 'accounts', { name: 'Claude', providerId: 'anthropic' });
  const signIn = await api('POST', `accounts/${claudeAccount.id}/sign-in`);
  await api('POST', `sign-ins/${signIn.signInId}/complete`, { code: `code#${new URL(signIn.url).searchParams.get('state')}` });
  const gpt = await api('POST', 'accounts', { name: 'ChatGPT', providerId: 'openai' });
  const device = await api('POST', `accounts/${gpt.id}/sign-in`, { flow: 'device' });
  await codex.latest.complete('chatgpt-cli');
  await api('GET', `sign-ins/${device.signInId}`);
  const house = await api('POST', 'houses', { name: 'CLI', accounts: { anthropic: [claudeAccount.id], openai: [gpt.id] } });
  const key = await api('POST', 'hat-keys', { houseId: house.id, name: 'cli' });
  return { dir, hat, anthropic, chatgpt, key: key.secret as string };
}

it.skipIf(!await installed('claude'))('runs a real Claude Code turn with a hat key', async () => {
  const { dir, hat, anthropic, key } = await setup();
  const { stdout } = await run('claude', ['-p', 'Say hello', '--output-format', 'json'], {
    cwd: dir, timeout: 90_000,
    env: cleanEnv({ ANTHROPIC_BASE_URL: hat.url, ANTHROPIC_AUTH_TOKEN: key, CLAUDE_CONFIG_DIR: join(dir, 'claude'),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1' }),
  });
  expect(JSON.parse(stdout)).toMatchObject({ is_error: false, result: 'Hello from the fake provider.' });
  const turns = anthropic.seen.filter((s) => s.url.startsWith('/v1/messages'));
  expect(turns.length).toBeGreaterThan(0);
  expect(turns.every((s) => s.headers.authorization === 'Bearer token-1' && !JSON.stringify(s.headers).includes(key))).toBe(true);
  // Claude Code's streamed turns were counted from their message events.
  await vi.waitFor(() => expect(hat.hat.usageReport({ where: { provider: 'anthropic' } }).totals).toMatchObject({ requests: turns.filter((s) => !s.url.includes('count_tokens')).length, outputTokens: 8 * turns.filter((s) => !s.url.includes('count_tokens')).length }));
}, 120_000);

it('runs a real Codex turn through the ChatGPT route with a hat key', async () => {
  const { dir, hat, chatgpt, key } = await setup();
  await mkdir(join(dir, 'codex'));
  const codex = run(process.execPath, [codexCli, 'exec', '--skip-git-repo-check', '--json',
    '-c', 'model_provider="hat"', '-c', 'model_providers.hat.name="Sorting Hat"',
    '-c', `model_providers.hat.base_url="${hat.url}/openai"`, '-c', 'model_providers.hat.env_key="SORTING_HAT_KEY"',
    '-c', 'model_providers.hat.wire_api="responses"', '-c', 'model_providers.hat.supports_websockets=false', '-m', 'gpt-test', 'Say hello'], {
    cwd: dir, timeout: 90_000,
    env: cleanEnv({ CODEX_HOME: join(dir, 'codex'), SORTING_HAT_KEY: key }),
  });
  // Codex reads more of the prompt from stdin until it closes.
  codex.child.stdin?.end();
  const { stdout } = await codex;
  expect(stdout).toContain('Hello from the fake ChatGPT.');
  expect(chatgpt.seen.length).toBeGreaterThan(0);
  expect(chatgpt.seen.every((s) => s.headers.get('chatgpt-account-id') === 'chatgpt-cli' && s.headers.get('authorization') !== `Bearer ${key}`)).toBe(true);
  // Codex's streamed turn was counted from its response.completed event.
  await vi.waitFor(() => expect(hat.hat.usageReport({ where: { provider: 'openai' } }).totals).toMatchObject({ requests: chatgpt.seen.length, inputTokens: 6 * chatgpt.seen.length, outputTokens: 8 * chatgpt.seen.length }));
}, 120_000);
