import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';

let app: Awaited<ReturnType<typeof startTestApp>>;
afterEach(async () => { vi.restoreAllMocks(); await app?.stop(); });

function heldHarness() {
  const finish = gate();
  const steers: string[] = [];
  const harness = new FakeHarness(async function* (run, n) {
    if (n === 1) {
      run.registerSteer?.(async text => { steers.push(text); });
      yield { type: 'system', subtype: 'init', session_id: 'held-session' };
      await Promise.race([finish.opened, new Promise<void>(resolve => run.signal.addEventListener('abort', () => resolve(), { once: true }))]);
      run.registerSteer?.(undefined);
    }
    if (!run.signal.aborted) yield* replyWith(`reply ${n}`);
  });
  return { harness, finish, steers };
}

it('steers the active turn, saves a FIFO queue, and holds an edit across turn completion', async () => {
  const { harness, finish, steers } = heldHarness();
  app = await startTestApp({ harness });
  const c = await app.connect(); await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'work' });
  await expect.poll(() => harness.runs.length).toBe(1);
  await c.call('threads.send', { threadId: thread.id, text: 'use the helper' });
  expect(steers).toEqual(['use the helper']);
  const items = await c.call('threads.transcript', { threadId: thread.id });
  const users = items.filter(i => i.kind === 'user');
  expect(users[1]).toMatchObject({ steered: true, turnId: users[0]!.turnId });
  for (const text of ['first', 'second', 'remove me']) await c.call('threads.send', { threadId: thread.id, text, mode: 'queue' });
  const saved = JSON.parse(await readFile(join(app.home, 'threads.json'), 'utf8'))[0];
  expect(saved.queuedMessages.map((m: { text: string }) => m.text)).toEqual(['first', 'second', 'remove me']);
  await c.call('threads.queued', { threadId: thread.id, messageId: saved.queuedMessages[2].id, action: 'remove' });
  await c.call('threads.queued', { threadId: thread.id, messageId: saved.queuedMessages[0].id, action: 'edit' });
  finish.release();
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.status).toBe('idle');
  expect(harness.runs).toHaveLength(1);
  await c.call('threads.queued', { threadId: thread.id, messageId: saved.queuedMessages[0].id, action: 'save', text: 'edited first' });
  await expect.poll(() => harness.runs.length).toBe(3);
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.status).toBe('idle');
  expect(harness.runs.map(r => r.prompt)).toEqual(['work', 'edited first', 'second']);
  expect((await c.call('threads.list', {}))[0]!.queuedMessages).toEqual([]);
});

it('promotes a queued message into the active turn without starting a second turn', async () => {
  const { harness, finish, steers } = heldHarness();
  app = await startTestApp({ harness });
  const c = await app.connect(); await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'work' });
  await expect.poll(() => harness.runs.length).toBe(1);
  await c.call('threads.send', { threadId: thread.id, text: 'correction', mode: 'queue' });
  const message = (await c.call('threads.list', {}))[0]!.queuedMessages![0]!;
  await c.call('threads.queued', { threadId: thread.id, messageId: message.id, action: 'steer' });
  expect(steers).toEqual(['correction']);
  expect(harness.runs).toHaveLength(1);
  expect((await c.call('threads.list', {}))[0]!.queuedMessages).toEqual([]);
  finish.release();
});

it('rejects an edit once a queued message has reserved its next turn', async () => {
  const { harness, finish } = heldHarness();
  app = await startTestApp({ harness });
  const c = await app.connect(); await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'work' });
  await expect.poll(() => harness.runs.length).toBe(1);
  await c.call('threads.send', { threadId: thread.id, text: 'next', mode: 'queue' });
  const message = (await c.call('threads.list', {}))[0]!.queuedMessages![0]!;
  const entered = gate(), access = gate();
  const original = app.app.profiles.hubAccess.bind(app.app.profiles);
  vi.spyOn(app.app.profiles, 'hubAccess').mockImplementation(async (...args) => {
    entered.release(); await access.opened; return original(...args);
  });
  try {
    finish.release(); await entered.opened;
    await expect(c.call('threads.queued', { threadId: thread.id, messageId: message.id, action: 'edit' })).rejects.toThrow('already starting');
  } finally { access.release(); }
  await expect.poll(() => harness.runs.length).toBe(2);
  expect(harness.runs[1]!.prompt).toBe('next');
});

it('keeps queued follow-ups paused after Stop and across a restart', async () => {
  const { harness } = heldHarness();
  app = await startTestApp({ harness });
  const c = await app.connect(); await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'work' });
  await expect.poll(() => harness.runs.length).toBe(1);
  await c.call('threads.send', { threadId: thread.id, text: 'later', mode: 'queue' });
  await c.call('threads.stop', { threadId: thread.id });
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.status).toBe('interrupted');
  expect(harness.runs).toHaveLength(1);
  const home = app.home;
  await app.stop({ keepHome: true });
  const resumed = new FakeHarness();
  app = await startTestApp({ harness: resumed }, home);
  const next = await app.connect();
  const queued = (await next.call('threads.list', {}))[0]!.queuedMessages![0]!;
  expect(queued.text).toBe('later');
  expect(resumed.runs).toHaveLength(0);
  await next.call('threads.queued', { threadId: thread.id, messageId: queued.id, action: 'steer' });
  await expect.poll(() => resumed.runs.length).toBe(1);
  expect(resumed.runs[0]!.prompt).toBe('later');
});
