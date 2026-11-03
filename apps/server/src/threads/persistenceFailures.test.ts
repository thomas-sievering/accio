import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { JsonFile } from '@accio/persistence';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';

let t: Awaited<ReturnType<typeof startTestApp>>;
let requestId = 0;
const rpc = (method: string, params: unknown) => t.app.router.handle({ id: ++requestId, method, params });
afterEach(async () => { vi.restoreAllMocks(); await t?.stop(); });

it('releases a completed turn after its final transcript write fails and permits recovery', async () => {
  const finish = gate();
  const harness = new FakeHarness(async function* () {
    for (const message of replyWith('finished')) {
      if (message.type === 'result') await finish.opened;
      yield message;
    }
  });
  t = await startTestApp({ harness });
  const c = await t.connect();
  await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'hello' });
  const path = join(t.home, 'transcripts', `${thread.id}.json`);
  try {
    await c.waitFor('thread.item', (event) => event.threadId === thread.id && event.item.kind === 'assistant' && event.item.text === 'finished');
    const write = JsonFile.prototype.write;
    let failed = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const storage = vi.spyOn(JsonFile.prototype, 'write').mockImplementation(function (value) {
      if (!failed && this.path === path) {
        failed = true;
        return Promise.reject(new Error('disk temporarily full'));
      }
      return write.call(this, value);
    });
    finish.release();
    await c.waitFor('threads.changed', (threads) => threads.some((item) => item.id === thread.id && item.status === 'failed'));
    expect(failed).toBe(true);
    expect(await c.call('threads.transcript', { threadId: thread.id })).toContainEqual(expect.objectContaining({ kind: 'notice', text: 'Could not save this turn: disk temporarily full' }));
    storage.mockRestore();
    c.events.length = 0;
    await c.call('threads.send', { threadId: thread.id, text: 'after recovery' });
    await c.waitFor('threads.changed', (threads) => threads.some((item) => item.id === thread.id && item.status === 'idle'));
    expect(harness.runs).toHaveLength(2);
    expect(JSON.parse(await readFile(path, 'utf8'))).toContainEqual(expect.objectContaining({ kind: 'user', text: 'after recovery' }));
    await c.call('threads.delete', { threadId: thread.id });
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { finish.release(); }
});

it('discards shared cold reads when a thread is deleted and never flushes them back to disk', async () => {
  t = await startTestApp({ harness: new FakeHarness() });
  const c = await t.connect();
  await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'hello' });
  await c.waitFor('threads.changed', (threads) => threads.some((item) => item.id === thread.id && item.status === 'idle'));
  const home = t.home;
  await t.stop({ keepHome: true });
  t = await startTestApp({ harness: new FakeHarness() }, home);
  const path = join(home, 'transcripts', `${thread.id}.json`);
  const entered = gate();
  const held = gate();
  const read = JsonFile.prototype.read;
  let reads = 0;
  vi.spyOn(JsonFile.prototype, 'read').mockImplementation(async function () {
    const value = await read.call(this);
    if (this.path === path) {
      ++reads;
      entered.release();
      await held.opened;
    }
    return value;
  });
  const observation = rpc('threads.observe', { threadId: thread.id });
  const legacyRead = rpc('threads.transcript', { threadId: thread.id });
  await entered.opened;
  const deleting = rpc('threads.delete', { threadId: thread.id });
  try {
    expect(await rpc('threads.list', {})).toMatchObject({ ok: true, result: [] });
  } finally { held.release(); }
  expect(await observation).toMatchObject({ ok: false, error: 'No such thread' });
  expect(await legacyRead).toMatchObject({ ok: false, error: 'No such thread' });
  expect(await deleting).toMatchObject({ ok: true });
  expect(reads).toBe(1);
  await t.app.close();
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(JSON.parse(await readFile(join(home, 'threads.json'), 'utf8'))).toEqual([]);
});
