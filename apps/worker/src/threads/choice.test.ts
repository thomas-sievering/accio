import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { TranscriptItem } from '@accio/protocol';
import { FakeHarness, SESSION, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';
import type { HarnessMessage } from './harness.js';

const PNG = readFile(join(import.meta.dirname, '../../../../tests/fixtures/chat.png'));
const TOOL = 'mcp__accio__offer_choice';

/** Claude streams the tool call, then the SDK reports the acknowledgement as its result. */
function* offer(input: unknown, id = 'choice-1'): Iterable<HarnessMessage> {
  yield { type: 'system', subtype: 'init', session_id: SESSION };
  yield { type: 'stream_event', parent_tool_use_id: null, session_id: SESSION, event: { type: 'message_start', message: { id: 'offer' } } };
  yield { type: 'stream_event', parent_tool_use_id: null, session_id: SESSION, event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name: TOOL, input: {} } } };
  yield { type: 'stream_event', parent_tool_use_id: null, session_id: SESSION, event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } } };
  yield { type: 'stream_event', parent_tool_use_id: null, session_id: SESSION, event: { type: 'content_block_stop', index: 0 } };
  yield { type: 'assistant', parent_tool_use_id: null, session_id: SESSION, message: { id: 'offer', content: [{ type: 'tool_use', id, name: TOOL, input }] } };
  yield { type: 'user', parent_tool_use_id: null, session_id: SESSION, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'shown' }] }] } };
  yield { type: 'result', subtype: 'success', is_error: false, session_id: SESSION };
}

const settled = (c: TestClient, threadId: string) =>
  c.waitFor('threads.changed', (list) => list.some((x) => x.id === threadId && x.status === 'idle'));

let stop: (() => Promise<void>) | undefined;
afterEach(() => stop?.());

async function offered(input: (cwd: string) => unknown) {
  const harness = new FakeHarness(async function* (run, n) {
    if (n === 1) {
      await writeFile(join(run.cwd, 'a.png'), await PNG);
      await writeFile(join(run.cwd, 'b c.png'), await PNG);
      yield* offer(input(run.cwd));
    } else yield* replyWith('Building B');
  });
  const t = await startTestApp({ harness });
  stop = t.stop;
  const c = await t.connect();
  await c.signedIn('HRC');
  const thread = await c.call('threads.start', { profileId: 'hrc', text: 'Try two empty states' });
  await settled(c, thread.id);
  const items = await c.call('threads.transcript', { threadId: thread.id });
  return { harness, c, thread, items };
}

it('shows a choice with saved screenshots instead of a tool row', async () => {
  const { items, thread, harness } = await offered((cwd) => ({
    question: 'Which empty state?',
    options: [{ path: 'a.png', label: 'Illustration' }, { path: join(cwd, 'b c.png'), label: 'Plain text' }],
  }));
  expect(items.filter((item) => item.kind === 'tool')).toEqual([]);
  const choice = items.find((item) => item.kind === 'choice') as Extract<TranscriptItem, { kind: 'choice' }>;
  expect(choice).toMatchObject({ id: 'choice-1', question: 'Which empty state?' });
  expect(choice.options.map((o) => [o.label, o.asset?.mimeType, o.error])).toEqual([['Illustration', 'image/png', undefined], ['Plain text', 'image/png', undefined]]);
  expect(harness.runs[0]!.cwd).toBeTruthy();
  expect(thread.title).toBe('Try two empty states');
});

it('marks options it cannot show, and only accepts images', async () => {
  const { items } = await offered(() => ({
    question: 'Which?',
    options: [{ path: 'missing.png', label: 'Gone' }, { path: 'notes.txt', label: 'Text' }],
  }));
  const choice = items.find((item) => item.kind === 'choice') as Extract<TranscriptItem, { kind: 'choice' }>;
  expect(choice.options[0]).toMatchObject({ label: 'Gone', error: expect.any(String) });
  expect(choice.options[1]).toMatchObject({ label: 'Text', error: 'Not a PNG, JPEG, GIF, WebP or AVIF image.' });
});

it('sends the pick and the feedback to the harness, and keeps the pick on the message', async () => {
  const { c, thread, harness } = await offered(() => ({
    question: 'Which empty state?',
    options: [{ path: 'a.png', label: 'Illustration' }, { path: 'b c.png', label: 'Plain text' }],
  }));
  c.events.length = 0;
  await c.call('threads.send', { threadId: thread.id, text: 'but shorter', pick: { choiceId: 'choice-1', option: 1 } });
  await settled(c, thread.id);
  expect(harness.runs[1]!.prompt).toBe('I pick B ("Plain text") for "Which empty state?".\n\nbut shorter');
  const items = await c.call('threads.transcript', { threadId: thread.id });
  expect(items.findLast((item) => item.kind === 'user')).toMatchObject({ text: 'but shorter', pick: { choiceId: 'choice-1', option: 1 } });

  // A pick alone is a complete message.
  c.events.length = 0;
  await c.call('threads.send', { threadId: thread.id, text: '', pick: { choiceId: 'choice-1', option: 0 } });
  await settled(c, thread.id);
  expect(harness.runs[2]!.prompt).toBe('I pick A ("Illustration") for "Which empty state?".');
});

it('refuses empty messages and options that do not exist', async () => {
  const { c, thread } = await offered(() => ({
    question: 'Which?',
    options: [{ path: 'a.png', label: 'One' }, { path: 'b c.png', label: 'Two' }],
  }));
  await expect(c.call('threads.send', { threadId: thread.id, text: '  ' })).rejects.toThrow();
  await expect(c.call('threads.send', { threadId: thread.id, text: '', pick: { choiceId: 'choice-1', option: 5 } })).rejects.toThrow('That option is no longer available');
  await expect(c.call('threads.send', { threadId: thread.id, text: 'x', pick: { choiceId: 'nope', option: 0 } })).rejects.toThrow('That option is no longer available');
});

it('shows a call with invalid arguments as a failed tool', async () => {
  const harness = new FakeHarness(function* () {
    const id = 'bad';
    yield { type: 'assistant', parent_tool_use_id: null, session_id: SESSION, message: { id: 'm', content: [{ type: 'tool_use', id, name: TOOL, input: { question: 'Which?', options: [] } }] } };
    yield { type: 'user', parent_tool_use_id: null, session_id: SESSION, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'options: too small' }] } };
    yield { type: 'result', subtype: 'success', is_error: false, session_id: SESSION };
  });
  const t = await startTestApp({ harness });
  stop = t.stop;
  const c = await t.connect();
  await c.signedIn('HRC');
  const thread = await c.call('threads.start', { profileId: 'hrc', text: 'Try' });
  await settled(c, thread.id);
  const items = await c.call('threads.transcript', { threadId: thread.id });
  expect(items.find((item) => item.kind === 'tool')).toMatchObject({ name: TOOL, status: 'error', output: 'options: too small' });
  expect(items.some((item) => item.kind === 'choice')).toBe(false);
});

it('gives each turn its own access to accio tools, which ends with the turn', async () => {
  const seen: { during?: number; access?: { url: string; authorization: string } } = {};
  const list = (access: { url: string; authorization: string }) => fetch(access.url, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: access.authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const harness = new FakeHarness(async function* (run) {
    seen.access = run.tools;
    const response = await list(run.tools!);
    seen.during = response.status;
    const { result } = await response.json() as { result: { tools: { name: string }[] } };
    yield* replyWith(result.tools.map((tool) => tool.name).join(','));
  });
  const t = await startTestApp({ harness });
  stop = t.stop;
  const c = await t.connect();
  await c.signedIn('HRC');
  const thread = await c.call('threads.start', { profileId: 'hrc', text: 'Which tools?' });
  await settled(c, thread.id);
  expect(seen.during).toBe(200);
  expect(seen.access!.url).toBe(`http://127.0.0.1:${t.app.port}/mcp`);
  const items = await c.call('threads.transcript', { threadId: thread.id });
  expect(items.find((item) => item.kind === 'assistant')).toMatchObject({ text: 'offer_choice,read_thread,app_screenshot,app_update,start_thread,agent' });
  await expect.poll(async () => (await list(seen.access!)).status).toBe(401);
});
