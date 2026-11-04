import { afterEach, expect, it } from 'vitest';
import type { TranscriptItem } from '@accio/protocol';
import { FakeHarness, SESSION, gate, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';
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

/** Calls accio's MCP server the way a harness does. */
async function callAgent(run: HarnessTurn, args: unknown) {
  const response = await fetch(run.tools!.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: run.tools!.authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'agent', arguments: args } }),
  });
  const { result } = await response.json() as { result: { content: { text: string }[]; isError?: boolean } };
  return { text: result.content[0]!.text, isError: !!result.isError };
}

const task = { description: 'Count the files', prompt: 'Count the files in this folder and report the number.' };
const settled = (c: TestClient, threadId: string) => c.waitFor('threads.changed', (list) => list.some((x) => x.id === threadId && x.status === 'idle'));
const agentRow = async (c: TestClient, threadId: string) => (await c.call('threads.transcript', { threadId })).find((i): i is ToolItem => i.kind === 'tool' && i.name === 'Agent');

let stop: (() => Promise<void>) | undefined;
afterEach(() => stop?.());

it('runs a sub-agent from the agent tool, shows its latest step on the row, and returns only its reply', async () => {
  const working = gate();
  const stepShown = gate();
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
