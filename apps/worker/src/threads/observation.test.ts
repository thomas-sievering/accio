import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';

let stop: (() => Promise<void>) | undefined;
afterEach(() => stop?.());

it('captures streamed items with their event cursor and persists interrupted partial text as a plain array', async () => {
  const nextDelta = gate();
  const harness = new FakeHarness(async function* (run) {
    // Stream only: deliberately never yield the final assistant replacement.
    for (const message of replyWith('partial')) {
      if (message.type === 'assistant' || message.type === 'result') break;
      yield message;
    }
    await nextDelta.opened;
    yield {
      type: 'stream_event', parent_tool_use_id: null, session_id: 'session-abc',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' reply' } },
    };
    if (!run.signal.aborted) await new Promise<void>((resolve) => run.signal.addEventListener('abort', () => resolve(), { once: true }));
  });
  const t = await startTestApp({ harness });
  stop = t.stop;
  const c = await t.connect();
  await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'hello' });
  try {
    const firstDelta = await c.waitFor('thread.delta', (event) => event.threadId === thread.id);
    const first = await c.call('threads.observe', { threadId: thread.id });
    expect(first.cursor).toBe(firstDelta.cursor);
    expect(first.items.find((item) => item.kind === 'assistant')).toMatchObject({ text: 'partial' });
    const user = await c.waitFor('thread.item', (event) => event.threadId === thread.id && event.item.kind === 'user');
    const assistant = await c.waitFor('thread.item', (event) => event.threadId === thread.id && event.item.kind === 'assistant');
    expect([user.cursor, assistant.cursor, firstDelta.cursor]).toEqual([1, 2, 3]);

    nextDelta.release();
    const secondDelta = await c.waitFor('thread.delta', (event) => event.threadId === thread.id && event.text === ' reply');
    expect(secondDelta.cursor).toBe(first.cursor + 1);
    const second = await c.call('threads.observe', { threadId: thread.id });
    expect(second).toMatchObject({ cursor: secondDelta.cursor });
    expect(second.items.find((item) => item.kind === 'assistant')).toMatchObject({ text: 'partial reply' });
    expect(first.items.find((item) => item.kind === 'assistant')).toMatchObject({ text: 'partial' });

    await c.call('threads.stop', { threadId: thread.id });
    await c.waitFor('threads.changed', (list) => list.some((item) => item.id === thread.id && item.status === 'interrupted'));
    const interrupted = await c.call('threads.observe', { threadId: thread.id });
    expect(interrupted.cursor).toBe(second.cursor + 1);
    expect(interrupted.items.at(-1)).toMatchObject({ kind: 'notice', text: 'Stopped.' });
    expect(interrupted.items.find((item) => item.kind === 'assistant')).toMatchObject({ text: 'partial reply' });
    expect(await c.call('threads.transcript', { threadId: thread.id })).toEqual(interrupted.items);
    await t.app.threads.close();
    const stored = JSON.parse(await readFile(join(t.home, 'transcripts', `${thread.id}.json`), 'utf8'));
    expect(stored).toEqual(interrupted.items);
    expect(Array.isArray(stored)).toBe(true);
  } finally {
    nextDelta.release();
    // Release a waiting harness even if an assertion above failed.
    if ((await c.call('threads.list', {})).some((item) => item.id === thread.id && item.status === 'running')) {
      await c.call('threads.stop', { threadId: thread.id });
    }
  }
});
