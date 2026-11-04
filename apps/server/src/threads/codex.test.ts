import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { codexEnv } from '@accio/codex';
import { FakeCodex } from '../testing/fakeCodex.js';
import { harnessEnv } from './harnessEnv.js';
import { codexEvents, codexHarness } from './codex.js';

let home: string | undefined;
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); if (home) await rm(home, { recursive: true, force: true }); home = undefined; });

it('names with a tool-free Responses request and handles fragmented streaming output', async () => {
  const encoder = new TextEncoder();
  const event = 'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: '{"title":"Login redirects"}' }) + '\n\n';
  const fetchMock = vi.fn(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(event.slice(0, 15)));
    controller.enqueue(encoder.encode(event.slice(15) + 'data: {"type":"response.completed"}\r\n\r\n'));
    controller.close();
  } })));
  vi.stubGlobal('fetch', fetchMock);
  const factory = vi.fn();
  const result = await codexHarness(factory).generateText!({ cwd: 'isolated', prompt: 'Name this', model: 'small-mini', effort: 'low', env: { ACCIO_OPENAI_URL: 'http://localhost/openai', ACCIO_OPENAI_KEY: 'profile-key' }, signal: new AbortController().signal });
  expect(result).toBe('{"title":"Login redirects"}');
  const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('http://localhost/openai/responses');
  expect(JSON.parse(String(options.body))).toMatchObject({ model: 'small-mini', tools: [], reasoning: { effort: 'low' }, store: false });
  expect(factory).not.toHaveBeenCalled();
});

it('steers the expected native Codex turn and unregisters when it completes', async () => {
  home = await mkdtemp(join(tmpdir(), 'accio-steer-codex-'));
  const fake = new FakeCodex(); fake.holdTurns = true;
  let send: ((text: string) => Promise<void>) | undefined;
  const iterator = codexHarness(fake.factory).run({ cwd: home, prompt: 'work', sessionId: null,
    env: { CODEX_HOME: home, ACCIO_OPENAI_URL: 'http://127.0.0.1:1234/openai', ACCIO_OPENAI_KEY: 'key' }, signal: new AbortController().signal,
    registerSteer: value => { send = value; } })[Symbol.asyncIterator]();
  await iterator.next();
  const output = iterator.next();
  await expect.poll(() => !!send).toBe(true);
  await send!('correction');
  expect(fake.latest.requests.find(r => r.method === 'turn/steer')?.params).toEqual({ threadId: 'codex-session', expectedTurnId: 'codex-turn', input: [{ type: 'text', text: 'correction' }] });
  fake.latest.reply();
  await output;
  while (!(await iterator.next()).done) { /* drain */ }
  expect(send).toBeUndefined();
});

it('removes inherited OpenAI and Codex credentials while keeping the profile proxy key', () => {
  const profile = harnessEnv({ OPENAI_API_KEY: 'other-key', OpenAI_Base_Url: 'https://other.test', CODEX_HOME: 'other-home',
    CODEX_ACCESS_TOKEN: 'other-token', CHATGPT_ACCOUNT_ID: 'other-account', ACCIO_OPENAI_KEY: 'other-profile-key', PATH: 'tools' },
  { baseUrl: 'http://127.0.0.1:1234', accessKey: 'profile-key' }, 'claude-home');
  expect(profile).not.toHaveProperty('OPENAI_API_KEY'); expect(profile).not.toHaveProperty('OpenAI_Base_Url');
  expect(profile).not.toHaveProperty('CODEX_ACCESS_TOKEN'); expect(profile).not.toHaveProperty('ACCIO_OPENAI_KEY');
  const env = codexEnv({ ...profile, ACCIO_OPENAI_KEY: 'profile-key', AWS_ACCESS_KEY_ID: 'other-aws-key' }, 'own-home');
  expect(env).toMatchObject({ CODEX_HOME: 'own-home', ACCIO_OPENAI_KEY: 'profile-key', PATH: 'tools' });
  expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN'); expect(env).not.toHaveProperty('AWS_ACCESS_KEY_ID');
});

it('bounds interruption even when Codex never acknowledges the interrupt request', async () => {
  home = await mkdtemp(join(tmpdir(), 'accio-stop-codex-'));
  const fake = new FakeCodex(); fake.holdTurns = true;
  const controller = new AbortController();
  const iterator = codexHarness(fake.factory).run({ cwd: home, prompt: 'wait', sessionId: null, env: {
    CODEX_HOME: home, ACCIO_OPENAI_URL: 'http://127.0.0.1:1234/openai', ACCIO_OPENAI_KEY: 'profile-key',
  }, signal: controller.signal })[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({ type: 'harness_event', event: { kind: 'session', id: 'codex-session' } });
  const request = fake.latest.request.bind(fake.latest);
  vi.spyOn(fake.latest, 'request').mockImplementation((method, params) => method === 'turn/interrupt' ? new Promise(() => {}) : request(method, params));
  const pending = iterator.next();
  await expect.poll(() => fake.latest.requests.some((r) => r.method === 'turn/start')).toBe(true);
  vi.useFakeTimers(); controller.abort();
  await vi.advanceTimersByTimeAsync(3000);
  expect((await pending).done).toBe(true);
  expect(fake.latest.closed).toBe(true);
  expect(fake.latest.notifications.size).toBe(0); expect(fake.latest.exits.size).toBe(0);
});

it('propagates a native process failure and closes the client', async () => {
  home = await mkdtemp(join(tmpdir(), 'accio-crash-codex-'));
  const fake = new FakeCodex(); fake.holdTurns = true;
  const iterator = codexHarness(fake.factory).run({ cwd: home, prompt: 'wait', sessionId: null, env: {
    CODEX_HOME: home, ACCIO_OPENAI_URL: 'http://127.0.0.1:1234/openai', ACCIO_OPENAI_KEY: 'profile-key',
  }, signal: new AbortController().signal })[Symbol.asyncIterator]();
  await iterator.next();
  const pending = iterator.next();
  const rejected = expect(pending).rejects.toThrow('native crash');
  for (const listener of fake.latest.exits) listener(new Error('native crash'));
  await rejected;
  expect(fake.latest.closed).toBe(true);
});

it('gives Codex accio tools on start and on resume, and keeps tool arguments structured', async () => {
  home = await mkdtemp(join(tmpdir(), 'accio-tools-codex-'));
  const tools = { url: 'http://127.0.0.1:1/mcp', authorization: 'Bearer t' };
  const env = { CODEX_HOME: home, ACCIO_OPENAI_URL: 'http://127.0.0.1:1234/openai', ACCIO_OPENAI_KEY: 'profile-key' };
  const expected = { 'mcp_servers.accio': { url: tools.url, http_headers: { Authorization: 'Bearer t' }, tool_timeout_sec: 7200 } };
  for (const sessionId of [null, 'codex-session']) {
    const fake = new FakeCodex();
    for await (const _ of codexHarness(fake.factory).run({ cwd: home, prompt: 'hi', sessionId, env, tools, signal: new AbortController().signal })) { /* drain */ }
    const opened = fake.latest.requests.find((r) => r.method === (sessionId ? 'thread/resume' : 'thread/start'));
    expect((opened?.params as { config?: unknown }).config).toEqual(expected);
  }
  const [call] = codexEvents({ method: 'item/started', params: { item: { type: 'mcpToolCall', id: 'c', server: 'accio', tool: 'offer_choice', arguments: { question: 'Q' }, status: 'inProgress' } } });
  expect(call).toMatchObject({ kind: 'tool', name: 'accio/offer_choice', input: { question: 'Q' } });
  const fake = new FakeCodex();
  for await (const _ of codexHarness(fake.factory).run({ cwd: home, prompt: 'hi', sessionId: 'codex-session', env, tools, mcps: { remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer remote' } } }, resourceInstructions: 'Enabled skill: browser', signal: new AbortController().signal })) { /* drain */ }
  expect(fake.latest.options.config).toContain('mcp_servers.remote.url="https://example.test/mcp"');
  expect(fake.latest.requests.find(r => r.method === 'thread/resume')?.params).toMatchObject({ config: expected, developerInstructions: expect.stringContaining('Enabled skill: browser') });
});

it('starts app-server with switched-off built-in tools removed', async () => {
  home = await mkdtemp(join(tmpdir(), 'accio-tools-codex-'));
  const fake = new FakeCodex();
  const iterator = codexHarness(fake.factory).run({ cwd: home, prompt: 'hi', sessionId: null, signal: new AbortController().signal,
    env: { CODEX_HOME: home, ACCIO_OPENAI_URL: 'http://127.0.0.1:1234/openai', ACCIO_OPENAI_KEY: 'key' },
    toolsOff: [{ id: 'goals', name: 'Goals', description: '', tools: ['get_goal'], default: 'off', config: ['features.goals=false'] }] })[Symbol.asyncIterator]();
  await iterator.next();
  expect(fake.latest.options.config).toContain('features.goals=false');
  while (!(await iterator.next()).done) { /* drain */ }
});
