import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL } from '@accio/protocol';
import { FakeHarness, gate, replyWith, SESSION } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';

let t: Awaited<ReturnType<typeof startTestApp>>;
afterEach(async () => { vi.restoreAllMocks(); await t?.stop(); });
let id = 0;
const rpc = (method: string, params: unknown) => t.app.router.handle({ id: ++id, method, params });

async function setup(harness = new FakeHarness()) {
  t = await startTestApp({ harness });
  const c = await t.connect();
  await c.signedIn('Personal');
  const path = join(t.home, 'repo');
  await mkdir(path);
  const checkout = await c.call('checkouts.add', { path, profileId: 'personal' });
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'first' });
  await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'idle'));
  return { c, checkout, thread };
}

function holdAccess() {
  const entered = gate();
  const held = gate();
  const original = t.app.profiles.hubAccess.bind(t.app.profiles);
  const spy = vi.spyOn(t.app.profiles, 'hubAccess').mockImplementation(async (...args) => {
    entered.release();
    await held.opened;
    return original(...args);
  });
  return { entered, held, spy };
}

it('reserves before hub access, rejects conflicting intents, and leaves independent threads free', async () => {
  const harness = new FakeHarness();
  const { c, thread } = await setup(harness);
  const other = await c.call('threads.start', { profileId: 'personal', text: 'other' });
  await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === other.id && x.status === 'idle'));
  const { entered, held, spy } = holdAccess();
  const first = rpc('threads.send', { threadId: thread.id, text: 'winner' });
  await entered.opened;
  for (const [method, params] of [
    ['threads.send', { threadId: thread.id, text: 'loser' }],
    ['threads.retry', { threadId: thread.id }],
    ['threads.resume', { threadId: thread.id }],
    ['threads.setModel', { threadId: thread.id, model: DEFAULT_MODEL }],
    ['threads.delete', { threadId: thread.id }],
  ] as const) expect(await rpc(method, params)).toMatchObject({ ok: false });
  spy.mockRestore();
  expect(await rpc('threads.send', { threadId: other.id, text: 'independent' })).toMatchObject({ ok: true });
  held.release();
  expect(await first).toMatchObject({ ok: true });
  await t.app.threads.close();
  expect(harness.runs.filter((r) => r.prompt === 'winner')).toHaveLength(1);
  expect(harness.runs.some((r) => r.prompt === 'loser')).toBe(false);
});

it('releases a failed preparation so the thread can be sent another message', async () => {
  const { thread } = await setup();
  const spy = vi.spyOn(t.app.profiles, 'hubAccess').mockRejectedValueOnce(new Error('offline'));
  expect(await rpc('threads.send', { threadId: thread.id, text: 'offline' })).toMatchObject({ ok: false });
  spy.mockRestore();
  expect(await rpc('threads.send', { threadId: thread.id, text: 'again' })).toMatchObject({ ok: true });
});

it('keeps refused resource preparation out of the transcript and preserves the saved turn state', async () => {
  const { c, thread } = await setup();
  const before = (await c.call('threads.list', {})).find(t => t.id === thread.id);
  const transcript = await c.call('threads.transcript', { threadId: thread.id });
  const spy = vi.spyOn(t.app.resources, 'prepare').mockRejectedValue(new Error('Broken tool is not ready. A repair thread was started.'));
  for (let i = 0; i < 3; i++) {
    expect(await rpc('threads.send', { threadId: thread.id, text: 'Not sent' })).toMatchObject({ ok: false });
    expect((await c.call('threads.list', {})).find(t => t.id === thread.id)).toEqual(before);
    expect(await c.call('threads.transcript', { threadId: thread.id })).toEqual(transcript);
  }
  spy.mockRestore();
  expect(await rpc('threads.send', { threadId: thread.id, text: 'after repair' })).toMatchObject({ ok: true });
});

it('checks every checkout member before deleting any, including a pending turn', async () => {
  const harness = new FakeHarness(async function* (run, n) {
    if (n < 3) { yield* replyWith('done'); return; }
    yield { type: 'system', subtype: 'init', session_id: SESSION };
    await new Promise<void>((resolve) => {
      if (run.signal.aborted) resolve();
      else run.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  });
  const { c, thread: a, checkout } = await setup(harness);
  const b = await c.call('threads.start', { checkoutId: checkout.id, text: 'second' });
  await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === b.id && x.status === 'idle'));
  const { entered, held } = holdAccess();
  const sending = rpc('threads.send', { threadId: b.id, text: 'busy' });
  await entered.opened;
  expect(await rpc('checkouts.remove', { id: checkout.id, deleteThreads: true })).toMatchObject({ ok: false });
  held.release();
  await sending;
  expect(await rpc('checkouts.remove', { id: checkout.id, deleteThreads: true })).toMatchObject({ ok: false });
  expect((await c.call('threads.list', {})).map((x) => x.id)).toEqual([a.id, b.id]);
  await c.call('threads.stop', { threadId: b.id });
  await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === b.id && x.status === 'interrupted'));
  expect(await rpc('checkouts.remove', { id: checkout.id })).toMatchObject({ ok: false });
  expect(await rpc('checkouts.remove', { id: checkout.id, deleteThreads: true })).toMatchObject({ ok: true });
  expect(await c.call('threads.list', {})).toEqual([]);
  expect((await c.call('projects.get', {})).checkouts).toEqual([]);
});

it('coordinates new thread creation with removal and rejects starts after removal', async () => {
  const { c, checkout } = await setup();
  const { entered, held } = holdAccess();
  const starting = rpc('threads.start', { checkoutId: checkout.id, text: 'new' });
  await entered.opened;
  expect(await rpc('checkouts.remove', { id: checkout.id, deleteThreads: true })).toMatchObject({ ok: false });
  held.release();
  const started = await starting;
  expect(started).toMatchObject({ ok: true });
  if (!started?.ok) throw new Error('start failed');
  const startedId = (started.result as { id: string }).id;
  await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === startedId && x.status === 'idle'));
  const removing = rpc('checkouts.remove', { id: checkout.id, deleteThreads: true });
  expect(await rpc('threads.start', { checkoutId: checkout.id, text: 'late' })).toMatchObject({ ok: false });
  expect(await removing).toMatchObject({ ok: true });
});

it('quitting aborts an active harness, flushes restart intent, and automatically resumes the same session', async () => {
  const harness = new FakeHarness(async function* (run) {
    yield { type: 'system', subtype: 'init', session_id: SESSION };
    await new Promise<void>((resolve) => {
      if (run.signal.aborted) resolve();
      else run.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  });
  t = await startTestApp({ harness });
  const c = await t.connect();
  await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'work' });
  await t.stop({ keepHome: true });
  expect(harness.runs[0]!.signal.aborted).toBe(true);
  expect(JSON.parse(await readFile(join(t.home, 'threads.json'), 'utf8'))[0].status).toBe('interrupted');
  const home = t.home;
  const resumed = new FakeHarness();
  t = await startTestApp({ harness: resumed }, home);
  await expect.poll(() => resumed.runs.length).toBe(1);
  expect(resumed.runs[0]).toMatchObject({ sessionId: SESSION });
  await t.app.threads.continueAfterRestart();
  expect(resumed.runs).toHaveLength(1);
});

it.each(['threads.retry', 'threads.resume'])('reserves %s against a simultaneous send and duplicate intent', async (method) => {
  const harness = new FakeHarness(function* (_run, n) {
    if (n === 1) throw new Error('failed');
    yield* replyWith('recovered');
  });
  t = await startTestApp({ harness });
  const c = await t.connect();
  await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'retry this' });
  await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'failed'));
  if (method === 'threads.resume') {
    // An explicitly interrupted thread remains available for manual Resume after restart.
    await t.stop({ keepHome: true });
    const path = join(t.home, 'threads.json');
    const threads = JSON.parse(await readFile(path, 'utf8'));
    threads[0].status = 'interrupted';
    await writeFile(path, JSON.stringify(threads));
    t = await startTestApp({ harness }, t.home);
  }
  const { entered, held } = holdAccess();
  const starting = rpc(method, { threadId: thread.id });
  await entered.opened;
  expect(await rpc('threads.send', { threadId: thread.id, text: 'competing' })).toMatchObject({ ok: false });
  expect(await rpc(method, { threadId: thread.id })).toMatchObject({ ok: false });
  held.release();
  expect(await starting).toMatchObject({ ok: true });
  await t.app.threads.close();
  expect(harness.runs).toHaveLength(2);
});

it('shutdown drains an in-flight start without creating a new harness turn', async () => {
  const harness = new FakeHarness();
  const { checkout } = await setup(harness);
  const { entered, held } = holdAccess();
  const starting = rpc('threads.start', { checkoutId: checkout.id, text: 'pending' });
  await entered.opened;
  const closing = t.app.close();
  let finished = false;
  void closing.then(() => { finished = true; });
  await Promise.resolve();
  expect(finished).toBe(false);
  held.release();
  expect(await starting).toMatchObject({ ok: false });
  await closing;
  expect(harness.runs).toHaveLength(1);
  expect(JSON.parse(await readFile(join(t.home, 'threads.json'), 'utf8'))).toHaveLength(1);
});
