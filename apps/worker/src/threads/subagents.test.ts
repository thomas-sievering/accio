import { afterEach, describe, expect, it } from 'vitest';
import type { TranscriptItem } from '@accio/protocol';
import { FakeHarness, SESSION, gate, replyWith } from '../testing/fakeHarness.js';
import { FakeCodex } from '../testing/fakeCodex.js';
import { claudeAccount, startTestApp, type TestClient } from '../testing/testApp.js';
import { codexEvents } from './codex.js';
import type { HarnessMessage, HarnessTurn } from './harness.js';

type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>;

/** One streamed Claude tool call, as the SDK reports it before the result. */
function* toolCall(id: string, name: string, input: unknown): Iterable<HarnessMessage> {
  const base = { parent_tool_use_id: null, session_id: SESSION } as const;
  yield { type: 'stream_event', ...base, event: { type: 'message_start', message: { id: `m-${id}` } } };
  yield { type: 'stream_event', ...base, event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } } };
  yield { type: 'stream_event', ...base, event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } } };
  yield { type: 'stream_event', ...base, event: { type: 'content_block_stop', index: 0 } };
  yield { type: 'assistant', ...base, message: { id: `m-${id}`, content: [{ type: 'tool_use', id, name, input }] } };
}

function* toolResult(id: string, text: string, isError = false): Iterable<HarnessMessage> {
  yield { type: 'user', parent_tool_use_id: null, session_id: SESSION, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: isError }] } };
}

/** Calls accio's MCP server the way Claude Code does: asking for progress, which may arrive as server-sent events. */
async function callAgent(run: HarnessTurn, args: unknown) {
  const response = await fetch(run.tools!.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: run.tools!.authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'agent', arguments: args, _meta: { progressToken: 1 } } }),
  });
  const body = await response.text();
  const messages = response.headers.get('content-type')?.startsWith('text/event-stream')
    ? body.split('\n\n').filter(Boolean).map((e) => JSON.parse(e.split('\n').find((l) => l.startsWith('data: '))!.slice(6)))
    : [JSON.parse(body)];
  const { result } = messages.at(-1) as { result: { content: { text: string }[]; isError?: boolean } };
  const progress = messages.slice(0, -1).map((m) => (m as { params: { message: string } }).params.message);
  return { text: result.content[0]!.text, isError: !!result.isError, progress };
}

const task = { description: 'Count the files', prompt: 'Count the files in this folder and report the number.' };
const settled = (c: TestClient, threadId: string) => c.waitFor('threads.changed', (list) => list.some((x) => x.id === threadId && x.status === 'idle'));
const agentRow = async (c: TestClient, threadId: string) => (await c.call('threads.transcript', { threadId })).find((i): i is ToolItem => i.kind === 'tool' && i.name === 'Agent');

let stop: (() => Promise<void>) | undefined;
afterEach(() => stop?.());

it('runs a sub-agent from the agent tool, shows its latest step on the row, and returns only its reply', async () => {
  const working = gate();
  const stepShown = gate();
  let progress: string[] = [];
  const harness = new FakeHarness(async function* (run) {
    if (!run.tools) {
      // The sub-agent: one shell call, then its reply.
      expect(run.env.CLAUDE_CODE_PROMPT_CACHE_TTL).toBe('5m');
      yield { type: 'system', subtype: 'init', session_id: 'sub' };
      yield* toolCall('sub-ls', 'Bash', { command: 'ls' });
      stepShown.release();
      await working.opened;
      yield* toolResult('sub-ls', 'a\nb\nc');
      yield* replyWith('There are 3 files.', 'sub');
      return;
    }
    yield { type: 'system', subtype: 'init', session_id: SESSION };
    yield* toolCall('call-1', 'mcp__accio__agent', task);
    const result = await callAgent(run, task);
    progress = result.progress;
    yield* toolResult('call-1', result.text, result.isError);
    yield* replyWith('The sub-agent counted 3 files.');
  });
  const t = await startTestApp({ harness });
  stop = t.stop;
  const c = await t.connect();
  await c.signedIn('HRC');
  const thread = await c.call('threads.start', { profileId: 'hrc', text: 'How many files?' });

  await stepShown.opened;
  await expect.poll(() => agentRow(c, thread.id)).toMatchObject({ status: 'running', summary: 'Count the files', step: { name: 'Bash', summary: 'ls' } });
  working.release();
  await settled(c, thread.id);
  // Each step also reached the parent's harness as progress, which keeps its idle timeout from firing.
  expect(progress).toContain('Bash: ls');

  const row = await agentRow(c, thread.id);
  expect(row).toMatchObject({ status: 'done', output: 'There are 3 files.' });
  expect(row?.step).toBeUndefined();
  const [parent, sub] = harness.runs;
  expect(sub).toMatchObject({ prompt: task.prompt, sessionId: null, cwd: parent!.cwd, model: parent!.model });
  expect(sub!.tools).toBeUndefined();
  expect(sub!.requestSecret).toBeUndefined();
});

it('fails the call when the sub-agent fails, and leaves the thread working', async () => {
  const harness = new FakeHarness(async function* (run) {
    if (!run.tools) {
      yield { type: 'system', subtype: 'init', session_id: 'sub' };
      yield { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'sub', errors: ['Model overloaded'] };
      return;
    }
    yield { type: 'system', subtype: 'init', session_id: SESSION };
    yield* toolCall('call-1', 'mcp__accio__agent', task);
    const result = await callAgent(run, task);
    yield* toolResult('call-1', result.text, result.isError);
    yield* replyWith('I will count them myself.');
  });
  const t = await startTestApp({ harness });
  stop = t.stop;
  const c = await t.connect();
  await c.signedIn('HRC');
  const thread = await c.call('threads.start', { profileId: 'hrc', text: 'How many files?' });
  await settled(c, thread.id);
  const items = await c.call('threads.transcript', { threadId: thread.id });
  expect(items.find((i) => i.kind === 'tool')).toMatchObject({ name: 'Agent', status: 'error', output: expect.stringContaining('Model overloaded') });
  expect(items.find((i) => i.kind === 'finished')).toBeTruthy();
});

it('finds the row of a Codex call, whose MCP items carry the task as arguments', async () => {
  const stepShown = gate();
  const working = gate();
  const codexCall = (status: 'inProgress' | 'completed', result?: string): HarnessMessage[] => codexEvents({ method: status === 'inProgress' ? 'item/started' : 'item/completed', params: {
    item: { type: 'mcpToolCall', id: 'mcp-1', server: 'accio', tool: 'agent', arguments: task, status, ...(result ? { result: { content: [{ type: 'text', text: result }] } } : {}) },
  } }).map((event) => ({ type: 'harness_event', event }));
  const harness = new FakeHarness(async function* (run) {
    if (!run.tools) {
      yield { type: 'harness_event', event: { kind: 'session', id: 'sub' } };
      yield { type: 'harness_event', event: { kind: 'tool', id: 'sub-ls', name: 'Shell', summary: 'ls', status: 'running', input: { command: 'ls' } } };
      stepShown.release();
      await working.opened;
      yield { type: 'harness_event', event: { kind: 'text', id: 'sub-reply', text: 'There are 3 files.' } };
      yield { type: 'harness_event', event: { kind: 'end' } };
      return;
    }
    yield { type: 'harness_event', event: { kind: 'session', id: SESSION } };
    yield* codexCall('inProgress');
    const result = await callAgent(run, task);
    yield* codexCall('completed', result.text);
    yield { type: 'harness_event', event: { kind: 'end' } };
  });
  const t = await startTestApp({ harness });
  stop = t.stop;
  const c = await t.connect();
  await c.signedIn('HRC');
  const thread = await c.call('threads.start', { profileId: 'hrc', text: 'How many files?' });
  await stepShown.opened;
  await expect.poll(() => agentRow(c, thread.id)).toMatchObject({ status: 'running', summary: 'Count the files', step: { name: 'Shell', summary: 'ls' } });
  working.release();
  await settled(c, thread.id);
  expect(await agentRow(c, thread.id)).toMatchObject({ status: 'done' });
});

describe('a sub-agent on a model the user mentioned', () => {
  /** A Claude thread whose parent turn starts one sub-agent with `model`, and replies with what the call returned. */
  async function mention(model: string) {
    const claude = new FakeHarness(async function* (run) {
      if (!run.tools) { yield* replyWith('claude sub-agent', 'sub'); return; }
      yield { type: 'system', subtype: 'init', session_id: SESSION };
      yield* toolCall('call-1', 'mcp__accio__agent', { ...task, model });
      const result = await callAgent(run, { ...task, model });
      yield* toolResult('call-1', result.text, result.isError);
      yield* replyWith('done');
    });
    const codex = new FakeHarness(() => replyWith('codex sub-agent', 'codex-sub'));
    const fake = new FakeCodex();
    const t = await startTestApp({ harness: claude, codexHarness: codex, codexFactory: fake.factory });
    stop = t.stop;
    const c = await t.connect();
    const profile = await c.signedIn('Personal');
    const account = await c.call('accounts.save', { name: 'Personal ChatGPT', providerId: 'openai' });
    const login = await c.call('accounts.beginSignIn', { id: account.id });
    await fake.latest.complete('Personal');
    await c.call('accounts.signInStatus', { signInId: login.signInId });
    await c.call('profiles.save', { id: profile.id, name: 'Personal', accountId: claudeAccount(profile)!.id, openaiAccountId: account.id });
    const thread = await c.call('threads.start', { profileId: profile.id, model: { harnessId: 'claudeCode', modelId: 'opus', effort: 'high' }, text: 'Count them' });
    await settled(c, thread.id);
    return { claude, codex, row: await agentRow(c, thread.id) };
  }

  it('runs on another model of the same harness, keeping an effort it accepts', async () => {
    const { claude, row } = await mention('@sonnet');
    expect(row).toMatchObject({ status: 'done', output: 'claude sub-agent' });
    expect(claude.runs[1]).toMatchObject({ model: 'sonnet', effort: 'high', sessionId: null });
  });

  it('runs on the other harness with its own account and settings', async () => {
    const { claude, codex, row } = await mention('test-codex');
    expect(row).toMatchObject({ status: 'done', output: 'codex sub-agent' });
    expect(claude.runs).toHaveLength(1);
    const sub = codex.runs[0]!;
    expect(sub).toMatchObject({ model: 'test-codex', effort: 'high', prompt: task.prompt, cwd: claude.runs[0]!.cwd });
    expect(sub.env.CODEX_HOME).toBeTruthy();
    expect(sub.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(sub.tools).toBeUndefined();
  });

  it('refuses a handle no model has, naming the ones it can use', async () => {
    const { row } = await mention('@deepseek');
    expect(row).toMatchObject({ status: 'error', output: expect.stringMatching(/No model is called @deepseek\. Mention one of: .*@opus.*@test-codex/) });
  });
});
