import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '@accio/protocol';
import { ObservationClient } from '../testing/observationClient';
import { observeTranscript, type TranscriptState } from './observeTranscript';

const assistant = (text: string): TranscriptItem => ({ kind: 'assistant', id: 'a', turnId: 'turn', text });
const delta = (cursor: number, text: string, threadId = 'one') => ({ threadId, cursor, itemId: 'a', text });

function setup(client = new ObservationClient(), threadId = 'one') {
  let state: TranscriptState = {};
  const stop = observeTranscript(client, threadId, (next) => { state = next; });
  return { client, stop, state: () => state };
}

describe('transcript observation', () => {
  it('skips overlapping deltas included in the snapshot and keeps subsequent buffered/live events', async () => {
    const t = setup();
    expect(t.client.requests[0]).toMatchObject({ method: 'threads.observe', params: { threadId: 'one' } });
    // This delta reached the server before it captured the requested snapshot.
    t.client.emit('thread.delta', delta(2, 'partial'));
    // These events happened after capture, but before the response arrived.
    t.client.emit('thread.delta', delta(3, ' after'));
    const tool: TranscriptItem = { kind: 'tool', id: 'tool', turnId: 'turn', name: 'Read', summary: 'file', status: 'running' };
    t.client.emit('thread.item', { threadId: 'one', cursor: 4, item: tool });
    t.client.requests[0]!.result.resolve({ items: [assistant('partial')], cursor: 2 });
    await Promise.resolve();
    expect(t.state().items).toEqual([assistant('partial after'), tool]);
    t.client.emit('thread.delta', delta(5, ' live'));
    t.client.emit('thread.item', { threadId: 'one', cursor: 6, item: { ...tool, status: 'done' } });
    t.client.emit('thread.delta', delta(5, ' live')); // Already observed.
    t.client.emit('thread.delta', delta(7, 'other thread', 'two'));
    expect(t.state().items).toEqual([assistant('partial after live'), { ...tool, status: 'done' }]);
    t.stop();
    expect(t.client.listenerCount).toBe(0);
  });

  it('retains streamed partial text when interruption supplies no final assistant replacement', async () => {
    const t = setup();
    t.client.emit('thread.delta', delta(2, 'unfinished'));
    t.client.requests[0]!.result.resolve({ items: [assistant('unfinished')], cursor: 2 });
    await Promise.resolve();
    t.client.emit('thread.delta', delta(3, ' sentence'));
    const stopped: TranscriptItem = { kind: 'notice', id: 'stop', turnId: 'turn', tone: 'info', text: 'Stopped.' };
    t.client.emit('thread.item', { threadId: 'one', cursor: 4, item: stopped });
    expect(t.state().items).toEqual([assistant('unfinished sentence'), stopped]);
    t.stop();
  });

  it('discards disconnected completions and buffered events, then reloads with a fresh cursor', async () => {
    const t = setup();
    t.client.emit('thread.delta', delta(99, 'old connection'));
    t.client.setStatus('closed');
    expect(t.state()).toEqual({});
    t.client.setStatus('open');
    t.client.requests[1]!.result.resolve({ items: [assistant('after restart')], cursor: 0 });
    // An old connection may complete after the new connection is already open.
    t.client.requests[0]!.result.resolve({ items: [assistant('stale')], cursor: 98 });
    await Promise.resolve();
    t.client.emit('thread.delta', delta(1, ' fresh'));
    expect(t.state().items).toEqual([assistant('after restart fresh')]);
    t.stop();
  });

  it('does not let the previous selection publish a late success or error', async () => {
    const client = new ObservationClient();
    const old = setup(client);
    old.stop();
    const selected = setup(client, 'two');
    client.requests[1]!.result.resolve({ items: [assistant('selected')], cursor: 5 });
    client.requests[0]!.result.resolve({ items: [assistant('previous')], cursor: 7 });
    await Promise.resolve();
    client.emit('thread.delta', delta(8, 'wrong thread'));
    expect(old.state()).toEqual({});
    expect(selected.state().items).toEqual([assistant('selected')]);
    selected.stop();
    const pending = setup(client);
    pending.stop();
    client.requests[2]!.result.reject(new Error('old request'));
    await Promise.resolve();
    expect(pending.state()).toEqual({});
    expect(client.listenerCount).toBe(0);
  });

  it('reports snapshot failures and can retry with a new observation', async () => {
    const t = setup();
    t.client.requests[0]!.result.reject(new Error('No such thread'));
    await Promise.resolve();
    expect(t.state()).toEqual({ error: 'No such thread' });
    t.stop();
    const retry = setup(t.client);
    t.client.requests[1]!.result.resolve({ items: [], cursor: 0 });
    await Promise.resolve();
    expect(retry.state()).toEqual({ items: [] });
    retry.stop();
  });
});
