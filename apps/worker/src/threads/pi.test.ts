import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { HarnessMessage, HarnessTurn } from './harness.js';
import { piHarness, piMcpConfig, piTools, type PiFactory, type PiProcess } from './pi.js';
import { BUILTIN_TOOLS } from '../harnesses/builtinTools.js';
import { harnessHomeEnv, turnEnv } from './harnessEnv.js';
import { piModels } from '../harnesses/catalog.js';
import { startTestApp } from '../testing/testApp.js';

type Record_ = { type: string; [key: string]: unknown };

/** A scripted `pi --mode rpc`: answers commands and plays each prompt's events. */
class FakePi implements PiProcess {
  requests: Record_[] = [];
  started?: { args: string[]; cwd: string; env: Record<string, string>; mcp: unknown; bridge: boolean };
  closed = false;
  /** Events a prompt plays; left unsettled to hold the turn. */
  script: Record_[] = [];
  private listeners = new Set<(event: Record_) => void>();
  private exits = new Set<(error?: Error) => void>();
  factory: PiFactory = async (input) => {
    const dir = input.env.PI_CODING_AGENT_DIR!;
    this.started = { ...input, mcp: JSON.parse(await readFile(join(dir, 'mcp.json'), 'utf8')), bridge: (await lstat(join(dir, 'claude-bridge'))).isSymbolicLink() };
    return this;
  };
  emit(event: Record_) { for (const listener of this.listeners) listener(event); }
  exit(error: Error) { for (const listener of this.exits) listener(error); }
  async request(command: Record_) {
    this.requests.push(command);
    if (command.type === 'get_state') return { sessionId: 'pi-session', model: { contextWindow: 1000 } };
    if (command.type === 'prompt') { setTimeout(() => { for (const event of this.script) this.emit(event); }); return { disposition: 'started' }; }
    if (command.type === 'abort') { setTimeout(() => this.emit({ type: 'agent_settled', aborted: true })); return undefined; }
    return { disposition: 'queued' };
  }
  onEvent(listener: (event: Record_) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onExit(listener: (error?: Error) => void) { this.exits.add(listener); return () => this.exits.delete(listener); }
  async close() { this.closed = true; }
}

let home: string | undefined;
afterEach(async () => { if (home) await rm(home, { recursive: true, force: true }); home = undefined; });

async function turn(overrides: Partial<HarnessTurn> = {}): Promise<HarnessTurn> {
  home = await mkdtemp(join(tmpdir(), 'accio-pi-'));
  return { cwd: home, prompt: 'hello', sessionId: null, model: 'claude-opus-5-5', modelName: 'Claude Opus 5.5', signal: new AbortController().signal,
    env: turnEnv(home, 'personal', 'pi', { baseUrl: 'https://hat.test', accessKey: 'hat-key' }), ...overrides };
}
const events = (messages: HarnessMessage[]) => messages.flatMap((m) => m.type === 'harness_event' ? [m.event] : []);
async function drain(iterable: AsyncIterable<HarnessMessage>) { const out: HarnessMessage[] = []; for await (const m of iterable) out.push(m); return out; }

const assistant = (content: unknown[], extra: Record<string, unknown> = {}) => ({ role: 'assistant', content, usage: { input: 2, cacheRead: 400, cacheWrite: 50, output: 8 }, ...extra });
const SCRIPT: Record_[] = [
  { type: 'agent_start' },
  { type: 'message_start', message: { role: 'user', content: [] } },
  { type: 'message_start', message: assistant([]) },
  { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Look' } },
  { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 1, delta: 'hidden' } },
  { type: 'message_end', message: assistant([{ type: 'text', text: 'Looking.' }, { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'a.txt' } }], { stopReason: 'toolUse' }) },
  { type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: { path: 'a.txt' } },
  { type: 'tool_execution_end', toolCallId: 't1', toolName: 'read', result: { content: [{ type: 'text', text: 'apple' }] }, isError: false },
  { type: 'tool_execution_start', toolCallId: 't2', toolName: 'bash', args: { command: 'false' } },
  { type: 'tool_execution_end', toolCallId: 't2', toolName: 'bash', result: { content: [{ type: 'text', text: 'exit 1' }] }, isError: true },
  { type: 'message_start', message: assistant([]) },
  { type: 'message_end', message: assistant([{ type: 'text', text: 'It says apple.' }], { stopReason: 'stop' }) },
  { type: 'agent_end' },
  { type: 'agent_settled', aborted: false },
];

it('starts the bundled Pi with only the bridge, the turn’s tools and a per-turn agent folder, and removes it afterwards', async () => {
  const pi = new FakePi(); pi.script = SCRIPT;
  const run = await turn({ effort: 'high', sessionId: 'earlier', resourceInstructions: 'RESOURCES', mcps: { docs: { type: 'stdio', command: 'docs-mcp', args: ['--x'] } },
    tools: { url: 'http://127.0.0.1:9/mcp', authorization: 'Bearer tool' } as HarnessTurn['tools'], secretPurposes: [] });
  await drain(piHarness(pi.factory).run(run));
  const { args, env, mcp, bridge } = pi.started!;
  const flag = (name: string) => args[args.indexOf(name) + 1];
  expect(args.slice(0, 3)).toEqual(['--mode', 'rpc', '--no-extensions']);
  expect(args.filter((_, i) => args[i - 1] === '-e')).toEqual([expect.stringMatching(/pi-claude-bridge$/), 'builtin:mcp']);
  expect(args).toContain('--no-skills');
  expect(flag('--session')).toBe('earlier');
  expect(flag('--session-dir')).toBe(join(home!, 'profiles', 'personal', 'pi', 'sessions'));
  expect(flag('--model')).toBe('claude-bridge/claude-opus-5-5');
  expect(flag('--thinking')).toBe('high');
  expect(flag('--tools')).toBe('bash,read,edit,write');
  expect(flag('--append-system-prompt')).toMatch(/through the Pi harness, as Claude Opus 5\.5 \(model id: claude-opus-5-5\)[\s\S]*RESOURCES/);
  // The Sorting Hat reaches Claude Code through the environment; its own config has no settings that could outrank it.
  expect(env).toMatchObject({ ANTHROPIC_BASE_URL: 'https://hat.test', ANTHROPIC_AUTH_TOKEN: 'hat-key', CLAUDE_CONFIG_DIR: join(home!, 'profiles', 'personal', 'pi', 'claude'), PI_OFFLINE: '1' });
  expect(env).not.toHaveProperty('ACCIO_PI_HOME');
  expect(await readFile(join(env.CLAUDE_CONFIG_DIR!, 'settings.json'), 'utf8')).toBe('{}\n');
  expect(mcp).toEqual({ autoEnableCodemode: false, mcpServers: {
    docs: { command: 'docs-mcp', args: ['--x'], exposure: 'direct' },
    accio: { url: 'http://127.0.0.1:9/mcp', headers: { Authorization: 'Bearer tool' }, exposure: 'direct', timeout: expect.any(Number) },
  } });
  expect(bridge).toBe(true);
  expect(pi.closed).toBe(true);
  expect(await readdir(join(home!, 'profiles', 'personal', 'pi', 'turns'))).toEqual([]);
});

it('reports the session, streamed and final text, tool rows, context and the end of the turn', async () => {
  const pi = new FakePi(); pi.script = SCRIPT;
  const out = events(await drain(piHarness(pi.factory).run(await turn())));
  const first = out.find((e) => e.kind === 'text')!;
  expect(out[0]).toEqual({ kind: 'session', id: 'pi-session' });
  const text = out.filter((e) => e.kind === 'text').map((e) => e.kind === 'text' && [e.text, !!e.append]);
  expect(text).toEqual([['Look', true], ['Looking.', false], ['It says apple.', false]]);
  // A streamed delta and the message's final text are one transcript item.
  expect(first.kind === 'text' && out.filter((e) => e.kind === 'text' && e.id === first.id)).toHaveLength(2);
  expect(out.filter((e) => e.kind === 'tool')).toEqual([
    { kind: 'tool', id: 't1', name: 'Read', input: { file_path: 'a.txt' }, summary: 'a.txt', status: 'running' },
    { kind: 'tool', id: 't1', name: 'Read', input: { file_path: 'a.txt' }, summary: 'a.txt', status: 'done', output: 'apple' },
    { kind: 'tool', id: 't2', name: 'Bash', input: { command: 'false' }, summary: 'false', status: 'running' },
    { kind: 'tool', id: 't2', name: 'Bash', input: { command: 'false' }, summary: 'false', status: 'error', output: 'exit 1' },
  ]);
  expect(out.filter((e) => e.kind === 'context')).toEqual([{ kind: 'context', usedTokens: 460, windowTokens: 1000 }, { kind: 'context', usedTokens: 460, windowTokens: 1000 }]);
  expect(out.at(-1)).toEqual({ kind: 'end' });
});

it('ends with Pi’s error when the last reply failed', async () => {
  const pi = new FakePi();
  pi.script = [{ type: 'message_start', message: assistant([]) }, { type: 'message_end', message: assistant([], { stopReason: 'error', errorMessage: 'Claude Code API error: 529' }) }, { type: 'agent_settled', aborted: false }];
  expect(events(await drain(piHarness(pi.factory).run(await turn()))).at(-1)).toEqual({ kind: 'end', error: 'Claude Code API error: 529' });
});

it('steers the running turn and stops taking steers when it settles', async () => {
  const pi = new FakePi();
  let send: ((text: string) => Promise<void>) | undefined;
  const iterator = piHarness(pi.factory).run({ ...await turn(), registerSteer: (value) => { send = value; } })[Symbol.asyncIterator]();
  await iterator.next();
  const rest = drain({ [Symbol.asyncIterator]: () => iterator });
  await expect.poll(() => !!send).toBe(true);
  await send!('also this');
  expect(pi.requests.find((r) => r.type === 'steer')).toMatchObject({ message: 'also this' });
  pi.emit({ type: 'agent_settled', aborted: false });
  await rest;
  expect(send).toBeUndefined();
});

it('aborts through Pi and ends without a result when the turn is stopped', async () => {
  const pi = new FakePi();
  const controller = new AbortController();
  const run = piHarness(pi.factory).run({ ...await turn(), signal: controller.signal });
  const iterator = run[Symbol.asyncIterator]();
  await iterator.next();
  const rest = drain({ [Symbol.asyncIterator]: () => iterator });
  await expect.poll(() => pi.requests.some((r) => r.type === 'prompt')).toBe(true);
  controller.abort();
  expect(events(await rest)).toEqual([]);
  expect(pi.requests.at(-1)).toMatchObject({ type: 'abort' });
  expect(pi.closed).toBe(true);
});

it('fails the turn when Pi stops unexpectedly', async () => {
  const pi = new FakePi();
  const iterator = piHarness(pi.factory).run(await turn())[Symbol.asyncIterator]();
  await iterator.next();
  const rest = drain({ [Symbol.asyncIterator]: () => iterator });
  await expect.poll(() => pi.requests.some((r) => r.type === 'prompt')).toBe(true);
  pi.exit(new Error('Pi stopped unexpectedly (exit 1)'));
  await expect(rest).rejects.toThrow('Pi stopped unexpectedly');
});

it('names only Pi’s own tools that are switched on', () => {
  const search = BUILTIN_TOOLS.pi!.find((t) => t.id === 'search')!;
  expect(piTools()).toEqual(['bash', 'read', 'edit', 'write']);
  expect(piTools([])).toEqual(['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls']);
  expect(piTools([search])).toEqual(['bash', 'read', 'edit', 'write']);
  expect(piMcpConfig()).toEqual({ mcpServers: {}, autoEnableCodemode: false });
});

it('keeps another Pi’s folders and session out of a profile’s Pi', () => {
  const before = { ...process.env };
  Object.assign(process.env, { PI_CODING_AGENT_DIR: '/elsewhere', PI_CODING_AGENT: 'true', PI_SESSION_ID: 'outer', ACCIO_PI_HOME: '/other' });
  try {
    const env = harnessHomeEnv('/home', 'work', 'pi');
    expect(env).toMatchObject({ ACCIO_PI_HOME: join('/home', 'profiles', 'work', 'pi'), CLAUDE_CONFIG_DIR: join('/home', 'profiles', 'work', 'pi', 'claude') });
    for (const key of ['PI_CODING_AGENT_DIR', 'PI_CODING_AGENT', 'PI_SESSION_ID']) expect(env).not.toHaveProperty(key);
  } finally { process.env = before; }
});

it('offers the Claude account’s versioned models under the bridge’s ids', () => {
  const model = (name: string, id = name) => ({ id, name, providerId: 'anthropic' as const, description: '', efforts: [] });
  expect(piModels([model('Claude Opus 5.5', 'opus'), model('Claude Fable 5', 'claude-fable-5[1m]'), model('Claude Opus'), model('Claude Opus 5.5', 'opus[1m]')]).map((m) => m.id))
    .toEqual(['claude-opus-5-5', 'claude-fable-5']);
});

it('runs a thread on a Pi model and keeps its session, reply and tool rows in the transcript', async () => {
  const pi = new FakePi(); pi.script = SCRIPT;
  const t = await startTestApp({ piFactory: pi.factory, claudeModels: async () => [
    { value: 'opus', displayName: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
  ] });
  try {
    const c = await t.connect(); await c.signedIn('Personal');
    await expect.poll(async () => (await c.call('models.list', { profileId: 'personal' })).models.some((m) => m.harnessId === 'pi')).toBe(true);
    const thread = await c.call('threads.start', { profileId: 'personal', text: 'read a.txt', model: { harnessId: 'pi', modelId: 'claude-opus-5-5', effort: 'high' } });
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'idle'));
    const flag = (name: string) => pi.started!.args[pi.started!.args.indexOf(name) + 1];
    expect([flag('--model'), flag('--thinking')]).toEqual(['claude-bridge/claude-opus-5-5', 'high']);
    // The turn's own hat key for the profile's house, not anything the worker inherited.
    expect(pi.started!.env.ANTHROPIC_AUTH_TOKEN).toMatch(/^hat-/);
    const items = await c.call('threads.transcript', { threadId: thread.id });
    expect(items.filter((i) => i.kind === 'assistant').map((i) => i.kind === 'assistant' && i.text)).toEqual(['Looking.', 'It says apple.']);
    expect(items.filter((i) => i.kind === 'tool').map((i) => i.kind === 'tool' && [i.name, i.status])).toEqual([['Read', 'done'], ['Bash', 'error']]);
    pi.requests = [];
    await c.call('threads.send', { threadId: thread.id, text: 'again' });
    await expect.poll(() => pi.requests.some((r) => r.type === 'prompt' && r.message === 'again')).toBe(true);
    await expect.poll(async () => (await c.call('threads.list', {})).find((x) => x.id === thread.id)?.status).toBe('idle');
    expect(flag('--session')).toBe('pi-session');
  } finally { await t.stop(); }
});
