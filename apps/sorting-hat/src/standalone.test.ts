import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startStandalone } from './standalone.js';
import { FakeCodex, fakeAnthropicApi, fakeAnthropicAuth, fakeChatGPT } from './testing/fakeProviders.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'sorting-hat-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  return dir;
}

/** The standalone Sorting Hat, in this process, with every provider faked. */
async function start() {
  const dir = await tempDir();
  const auth = fakeAnthropicAuth();
  const anthropic = await fakeAnthropicApi();
  const chatgpt = fakeChatGPT();
  const codex = new FakeCodex();
  const hat = await startStandalone({ dir, claudeFetch: auth.fetch, anthropicUrl: anthropic.url, codexFactory: codex.factory, openaiFetch: chatgpt.fetch, openaiUrl: 'https://chatgpt.test/backend-api/codex' });
  cleanup.push(anthropic.close, hat.close);
  const admin = async (method: string, path: string, body?: unknown, token = hat.adminToken) => {
    const res = await fetch(`${hat.url}/api/${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  /** Admin calls expected to succeed. */
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await admin(method, path, body);
    if (res.status >= 300) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  };
  /** A model request as Claude Code sends it, with a hat key. */
  const claude = (key: string, header: 'authorization' | 'x-api-key' = 'authorization') => fetch(`${hat.url}/v1/messages?beta=true`, {
    method: 'POST',
    headers: { [header]: header === 'authorization' ? `Bearer ${key}` : key, 'content-type': 'application/json', 'anthropic-beta': 'claude-code-20250219' },
    body: '{"model":"claude-test","messages":[]}',
  });
  /** A model request as Codex sends it to the ChatGPT route, with a hat key. */
  const responses = (key: string) => fetch(`${hat.url}/openai/responses`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{"model":"gpt-test","input":[]}' });
  /** Creates a Claude account and signs it in with the paste-code flow. */
  const claudeAccount = async (name: string) => {
    const account = await api('POST', 'accounts', { name, providerId: 'anthropic' });
    const signIn = await api('POST', `accounts/${account.id}/sign-in`);
    expect(signIn).toMatchObject({ providerId: 'anthropic', url: expect.stringContaining('claude.ai/oauth/authorize') });
    const state = new URL(signIn.url).searchParams.get('state');
    expect(await api('POST', `sign-ins/${signIn.signInId}/complete`, { code: `pasted#${state}` })).toMatchObject({ status: 'complete', account: { id: account.id, signedIn: true } });
    return account;
  };
  return { dir, hat, auth, anthropic, chatgpt, codex, admin, api, claude, responses, claudeAccount };
}

describe('the standalone Sorting Hat', () => {
  it('creates its admin token on first start and keeps it', async () => {
    const dir = await tempDir();
    const first = await startStandalone({ dir });
    await first.close();
    expect(first.createdAdminToken).toBe(true);
    expect((await readFile(join(dir, 'admin-token'), 'utf8')).trim()).toBe(first.adminToken);
    const second = await startStandalone({ dir });
    cleanup.push(second.close);
    expect([second.createdAdminToken, second.adminToken]).toEqual([false, first.adminToken]);
    expect((await fetch(`${second.url}/healthz`)).status).toBe(200);
  });

  it('refuses the management API without the admin token', async () => {
    const { admin, hat } = await start();
    expect((await admin('GET', 'houses', undefined, 'wrong')).status).toBe(401);
    expect((await fetch(`${hat.url}/api/houses`)).status).toBe(401);
    const hatKeyAsAdmin = await admin('POST', 'houses', { name: 'Personal' }, 'hat-something');
    expect(hatKeyAsAdmin).toMatchObject({ status: 401, body: { error: { type: 'authentication_error' } } });
    expect((await admin('GET', 'nothing-here')).status).toBe(404);
    expect((await admin('DELETE', 'accounts')).status).toBe(405);
    expect(await admin('POST', 'houses', { name: '' })).toMatchObject({ status: 400, body: { error: { message: expect.stringMatching(/name/) } } });
    expect((await admin('GET', 'houses/missing')).status).toBe(404);
  });

  it('sets up accounts, a house and a hat key, and forwards with the real credential', async () => {
    const { api, claude, responses, anthropic, chatgpt, codex, claudeAccount } = await start();
    const mine = await claudeAccount('Mine');
    const gpt = await api('POST', 'accounts', { name: 'My ChatGPT', providerId: 'openai' });
    const device = await api('POST', `accounts/${gpt.id}/sign-in`, { flow: 'device' });
    expect(device).toMatchObject({ providerId: 'openai', url: 'https://auth.openai.com/codex/device', userCode: 'TEST-1234' });
    expect(await api('GET', `sign-ins/${device.signInId}`)).toEqual({ status: 'pending' });
    await codex.latest.complete('chatgpt-personal');
    expect(await api('GET', `sign-ins/${device.signInId}`)).toMatchObject({ status: 'complete', account: { id: gpt.id, signedIn: true, email: 'chatgpt-personal@example.com' } });
    // A late poll still sees the completed sign-in.
    expect(await api('GET', `sign-ins/${device.signInId}`)).toMatchObject({ status: 'complete' });

    const house = await api('POST', 'houses', { name: 'Personal', accounts: { anthropic: [mine.id], openai: [gpt.id] } });
    expect(house).toEqual({ id: 'personal', name: 'Personal', accounts: { anthropic: [mine.id], openai: [gpt.id] }, inUse: { anthropic: mine.id, openai: gpt.id } });
    const key = await api('POST', 'hat-keys', { houseId: house.id, name: 'Claude Code on laptop' });
    expect(key).toMatchObject({ houseId: 'personal', name: 'Claude Code on laptop', revokedAt: null, secret: expect.stringMatching(/^hat-/) });
    expect(await api('GET', 'hat-keys')).toEqual([{ id: key.id, houseId: 'personal', name: 'Claude Code on laptop', createdAt: key.createdAt, revokedAt: null }]);

    const res = await claude(key.secret);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Hello from the fake provider.');
    expect((await claude(key.secret, 'x-api-key')).status).toBe(200);
    for (const seen of anthropic.seen) {
      expect(seen.headers.authorization).toBe('Bearer token-1');
      expect(seen.headers['x-api-key']).toBeUndefined();
      expect(seen.headers['anthropic-beta']).toBe('claude-code-20250219,oauth-2025-04-20');
      expect(JSON.stringify(seen.headers)).not.toContain(key.secret);
    }

    const codexRes = await responses(key.secret);
    expect(codexRes.status).toBe(200);
    expect(await codexRes.text()).toContain('response.completed');
    expect(chatgpt.seen).toHaveLength(1);
    expect(chatgpt.seen[0]!.url).toBe('https://chatgpt.test/backend-api/codex/responses');
    expect(chatgpt.seen[0]!.headers.get('chatgpt-account-id')).toBe('chatgpt-personal');
    expect(chatgpt.seen[0]!.headers.get('authorization')).toMatch(/^Bearer header\./);
  });

  it('lets a hat key reach only its own house, and refuses unknown and revoked keys', async () => {
    const { api, claude, responses, anthropic, chatgpt, claudeAccount } = await start();
    const mine = await claudeAccount('Mine');
    const work = await claudeAccount('Work');
    const personal = await api('POST', 'houses', { name: 'Personal', accounts: { anthropic: [mine.id] } });
    const hrc = await api('POST', 'houses', { name: 'HRC', id: 'hrc', accounts: { anthropic: [work.id] } });
    const personalKey = await api('POST', 'hat-keys', { houseId: personal.id, name: 'pi' });
    const hrcKey = await api('POST', 'hat-keys', { houseId: hrc.id, name: 'pi at work' });

    expect((await claude(personalKey.secret)).status).toBe(200);
    expect((await claude(hrcKey.secret)).status).toBe(200);
    expect(anthropic.seen.map((s) => s.headers.authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);

    for (const key of ['', 'hat-unknown', hrcKey.id]) {
      const res = await claude(key);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { type: 'authentication_error', message: 'Unknown or revoked hat key' } });
    }
    expect(await api('POST', `hat-keys/${personalKey.id}/revoke`)).toMatchObject({ revokedAt: expect.any(String) });
    expect((await claude(personalKey.secret)).status).toBe(401);
    expect((await responses(personalKey.secret)).status).toBe(401);
    // A house without a ChatGPT account cannot use the ChatGPT route.
    expect((await responses(hrcKey.secret)).status).toBe(401);
    expect(await api('DELETE', `houses/${hrc.id}`)).toBeUndefined();
    expect((await claude(hrcKey.secret)).status).toBe(401);
    expect(anthropic.seen).toHaveLength(2);
    expect(chatgpt.seen).toHaveLength(0);
    expect(await api('GET', 'hat-keys')).toEqual([expect.objectContaining({ id: personalKey.id, revokedAt: expect.any(String) })]);
  });

  it('switches a house to its next account when the provider answers 429, leaving other houses alone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    cleanup.push(async () => vi.useRealTimers());
    const { api, claude, anthropic, auth, claudeAccount } = await start();
    const first = await claudeAccount('First');
    const second = await claudeAccount('Second');
    const both = await api('POST', 'houses', { name: 'Both', accounts: { anthropic: [first.id, second.id] } });
    const only = await api('POST', 'houses', { name: 'Only first', accounts: { anthropic: [first.id] } });
    const bothKey = await api('POST', 'hat-keys', { houseId: both.id, name: 'pi' });
    const onlyKey = await api('POST', 'hat-keys', { houseId: only.id, name: 'pi' });
    const usage = (used: number) => ({ five_hour: { utilization: used, resets_at: new Date(Date.now() + 3_600_000).toISOString() } });
    auth.usage['token-1'] = usage(10);
    auth.usage['token-2'] = usage(10);
    expect((await claude(bothKey.secret)).status).toBe(200);

    // First runs out: Anthropic refuses it, and its limits now show 3% left in the 5-hour window.
    anthropic.limited.add('token-1');
    auth.usage['token-1'] = usage(97);
    // Past the cooldown between two reads of one account's limits.
    vi.setSystemTime(Date.now() + 10_000);
    const res = await claude(bothKey.secret);
    expect(res.status).toBe(200);
    expect(anthropic.seen.map((s) => s.headers.authorization)).toEqual(['Bearer token-1', 'Bearer token-1', 'Bearer token-2']);
    expect((await api('GET', `houses/${both.id}`)).inUse.anthropic).toBe(second.id);

    // A house with only First has nowhere to go: the provider's 429 reaches the app.
    expect((await claude(onlyKey.secret)).status).toBe(429);
    expect((await api('GET', `houses/${only.id}`)).inUse.anthropic).toBe(first.id);
  });

  it('lists each house’s models in Anthropic’s and OpenAI’s shapes, cached per account', async () => {
    const { hat, api, auth, codex, claudeAccount } = await start();
    const mine = await claudeAccount('Mine');
    const work = await claudeAccount('Work');
    const gpt = await api('POST', 'accounts', { name: 'ChatGPT', providerId: 'openai' });
    const device = await api('POST', `accounts/${gpt.id}/sign-in`, { flow: 'device' });
    await codex.latest.complete('chatgpt-personal');
    await api('GET', `sign-ins/${device.signInId}`);
    const personal = await api('POST', 'houses', { name: 'Personal', accounts: { anthropic: [mine.id], openai: [gpt.id] } });
    const hrc = await api('POST', 'houses', { name: 'HRC', accounts: { anthropic: [work.id] } });
    const personalKey = (await api('POST', 'hat-keys', { houseId: personal.id, name: 'pi' })).secret;
    const hrcKey = (await api('POST', 'hat-keys', { houseId: hrc.id, name: 'pi' })).secret;
    auth.models['token-1'] = [{ id: 'claude-mine-1', display_name: 'Claude Mine 1' }];
    auth.models['token-2'] = 403;
    const list = async (path: string, key: string, init: RequestInit = {}) => {
      const res = await fetch(`${hat.url}${path}`, { ...init, headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
      return { status: res.status, body: await res.json() };
    };

    expect(await list('/v1/models', personalKey)).toEqual({ status: 200, body: {
      data: [{ type: 'model', id: 'claude-mine-1', display_name: 'Claude Mine 1', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-mine-1', last_id: 'claude-mine-1' } });
    expect(auth.modelRequests.map((h) => [h.get('authorization'), h.get('anthropic-beta'), h.get('anthropic-version')])).toEqual([['Bearer token-1', 'oauth-2025-04-20', '2023-06-01']]);
    // Anthropic refuses the other house's account: Claude Code's aliases stand in.
    expect((await list('/v1/models', hrcKey)).body.data.map((m: { id: string }) => m.id)).toEqual(['opus', 'sonnet', 'haiku']);
    expect(await list('/v1/models/claude-mine-1', personalKey)).toMatchObject({ status: 200, body: { id: 'claude-mine-1' } });
    expect(await list('/v1/models/opus', personalKey)).toMatchObject({ status: 404, body: { type: 'error', error: { type: 'not_found_error' } } });
    expect((await list('/v1/models', personalKey, { method: 'POST' })).status).toBe(405);
    // Asked once per account.
    await list('/v1/models', personalKey);
    expect(auth.modelRequests).toHaveLength(2);

    const openai = { object: 'list', data: [{ id: 'gpt-test', object: 'model', created: 0, owned_by: 'openai' }] };
    expect(await list('/openai/models', personalKey)).toEqual({ status: 200, body: openai });
    expect(await list('/openai/v1/models', personalKey)).toEqual({ status: 200, body: openai });
    expect(await list('/openai/v1/models/gpt-test', personalKey)).toEqual({ status: 200, body: openai.data[0] });
    expect(await list('/openai/models/gpt-nope', personalKey)).toMatchObject({ status: 404, body: { error: { code: 'model_not_found' } } });
    expect(await list('/openai/models', hrcKey)).toEqual({ status: 200, body: { object: 'list', data: [] } });
    expect((await list('/v1/models', 'hat-unknown')).status).toBe(401);

    // The account in use changes: the house lists the other account's models.
    await api('PUT', `houses/${personal.id}/accounts`, { anthropic: [work.id, mine.id] });
    expect((await list('/v1/models', personalKey)).body.data.map((m: { id: string }) => m.id)).toEqual(['opus', 'sonnet', 'haiku']);
    await api('PUT', `houses/${personal.id}/accounts`, { anthropic: [mine.id] });
    // Its sign-in changes: the list is read again with the new token.
    auth.models['token-3'] = [{ id: 'claude-mine-2', display_name: 'Claude Mine 2' }];
    const signIn = await api('POST', `accounts/${mine.id}/sign-in`);
    await api('POST', `sign-ins/${signIn.signInId}/complete`, { code: `pasted#${new URL(signIn.url).searchParams.get('state')}` });
    expect((await list('/v1/models', personalKey)).body.data.map((m: { id: string }) => m.id)).toEqual(['claude-mine-2']);
    // Signed out, the house has no Claude account to list for.
    await api('POST', `accounts/${mine.id}/sign-out`);
    expect((await list('/v1/models', personalKey)).body.data).toEqual([]);
  });

  it('manages accounts, houses and hat keys: rename, order, revoke and delete', async () => {
    const { api, admin, claudeAccount } = await start();
    const a = await claudeAccount('A');
    const b = await api('POST', 'accounts', { name: 'B', providerId: 'anthropic' });
    expect(await api('PATCH', `accounts/${b.id}`, { name: 'B renamed' })).toMatchObject({ name: 'B renamed', signedIn: false });
    const house = await api('POST', 'houses', { name: 'Personal' });
    expect(await api('PUT', `houses/${house.id}/accounts`, { anthropic: [b.id, a.id] })).toMatchObject({ accounts: { anthropic: [b.id, a.id] }, inUse: { anthropic: a.id } });
    expect(await admin('PUT', `houses/${house.id}/accounts`, { openai: [a.id] })).toMatchObject({ status: 400 });
    expect(await api('PATCH', `houses/${house.id}`, { name: 'Home' })).toMatchObject({ id: 'personal', name: 'Home' });
    expect(await admin('DELETE', `accounts/${a.id}`)).toMatchObject({ status: 409, body: { error: { message: expect.stringMatching(/houses/) } } });
    expect(await api('POST', `accounts/${a.id}/sign-out`)).toMatchObject({ signedIn: false });
    const key = await api('POST', 'hat-keys', { houseId: house.id, name: 'Old name' });
    expect(await api('PATCH', `hat-keys/${key.id}`, { name: 'New name' })).toMatchObject({ name: 'New name' });
    expect(await api('GET', `houses/${house.id}/hat-keys`)).toEqual([expect.objectContaining({ id: key.id, name: 'New name' })]);
    expect(await api('DELETE', `hat-keys/${key.id}`)).toBeUndefined();
    expect(await api('GET', `hat-keys?house=${house.id}`)).toEqual([]);
    expect(await api('GET', 'limits')).toEqual(expect.arrayContaining([expect.objectContaining({ accountId: a.id })]));
    expect(await api('PUT', `houses/${house.id}/accounts`, { anthropic: [] })).toMatchObject({ accounts: { anthropic: [] } });
    expect(await api('DELETE', `accounts/${a.id}`)).toBeUndefined();
    expect((await api('GET', 'accounts')).map((x: { id: string }) => x.id)).toEqual([b.id]);
  });
});

it('starts from its own entry point, without the hub', async () => {
  const dir = await tempDir();
  const root = fileURLToPath(new URL('..', import.meta.url));
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const child = spawn(process.execPath, [tsx, join(root, 'src', 'main.ts'), '--port', '0'], { env: { ...process.env, SORTING_HAT_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  cleanup.push(() => new Promise<void>((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', () => resolve()); child.kill(); }));
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const output: string[] = [];
  const ready = await new Promise<{ url: string }>((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`exited ${code}: ${stderr}`)));
    createInterface({ input: child.stdout }).on('line', (line) => {
      output.push(line);
      if (line.startsWith('SORTING_HAT_READY ')) resolve(JSON.parse(line.slice('SORTING_HAT_READY '.length)));
    });
  });
  const token = (await readFile(join(dir, 'admin-token'), 'utf8')).trim();
  expect(output.join('\n')).toContain(token);
  const call = (path: string, init: RequestInit = {}) => fetch(`${ready.url}${path}`, init);
  expect(await (await call('/healthz')).json()).toEqual({ ok: true });
  const admin = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const house = await (await call('/api/houses', { method: 'POST', headers: admin, body: '{"name":"Personal"}' })).json();
  const key = await (await call('/api/hat-keys', { method: 'POST', headers: admin, body: JSON.stringify({ houseId: house.id, name: 'smoke' }) })).json();
  const model = (secret: string) => call('/v1/messages', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: '{}' });
  // Known key, but the house has no signed-in account yet; nothing reaches a provider.
  expect(await (await model(key.secret)).json()).toMatchObject({ error: { message: 'House personal has no signed-in Claude account' } });
  expect((await model('hat-unknown')).status).toBe(401);
}, 30_000);
