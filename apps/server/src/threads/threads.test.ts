import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeHarness, SESSION, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';

async function setup(harness: FakeHarness) {
  const t = await startTestApp({ harness });
  const c = await t.connect();
  const folder = join(t.home, 'repo');
  await mkdir(folder);
  await c.signedIn('HRC');
  const checkout = await c.call('checkouts.add', { path: folder, profileId: 'hrc' });
  return { t, c, checkout, folder };
}

/** Sends a message and waits until the thread reaches `status` afterwards. */
async function sendAndSettle(c: TestClient, threadId: string, text: string, status = 'idle') {
  c.events.length = 0;
  await c.call('threads.send', { threadId, text });
  return settled(c, threadId, status);
}

/** The hub key accio wrote into a profile's config folder. */
async function hubKeyOf(home: string, profileId: string): Promise<string> {
  const settings = JSON.parse(await readFile(join(home, 'profiles', profileId, 'claude', 'settings.json'), 'utf8'));
  return settings.env.ANTHROPIC_AUTH_TOKEN;
}

const settled = (c: TestClient, threadId: string, status = 'idle') =>
  c.waitFor('threads.changed', (list) => list.some((x) => x.id === threadId && x.status === status));

describe('threads slice', () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(() => stop?.());

  it('starts without a project in a dedicated workspace and continues there', async () => {
    const harness = new FakeHarness();
    const t = await startTestApp({ harness });
    stop = t.stop;
    const c = await t.connect();
    await c.signedIn('HRC');
    const thread = await c.call('threads.start', { profileId: 'hrc', text: 'Help me plan' });
    await settled(c, thread.id);
    expect(thread).toMatchObject({ checkoutId: '', projectId: '', profileId: 'hrc' });
    const cwd = join(t.home, 'workspaces', thread.id);
    expect(harness.runs[0]!.cwd).toBe(cwd);
    await writeFile(join(cwd, 'notes.txt'), 'Keep this');
    await sendAndSettle(c, thread.id, 'Continue');
    expect(harness.runs[1]).toMatchObject({ cwd, sessionId: SESSION });
    expect(await c.call('projects.get', {})).toMatchObject({ projects: [], checkouts: [] });
  });

  it('starts on the selected local machine and refuses unavailable targets before creating a thread', async () => {
    const harness = new FakeHarness();
    const { t, c, checkout, folder } = await setup(harness);
    stop = t.stop;
    const { id: machineId } = await c.call('machine.get', {});
    const remote = { id: 'remote', name: 'Remote', platform: 'linux', version: '0.1.0', harnesses: [] };
    await t.app.settings.machineConnected(remote);
    await expect(c.call('threads.start', { checkoutId: checkout.id, text: 'hello', machineId: remote.id })).rejects.toThrow(/another machine/);
    await t.app.settings.machineDisconnected(remote.id);
    await expect(c.call('threads.start', { checkoutId: checkout.id, text: 'hello', machineId: remote.id })).rejects.toThrow(/offline/);
    await expect(c.call('threads.start', { checkoutId: checkout.id, text: 'hello', machineId: 'unknown' })).rejects.toThrow(/No such machine/);
    expect(await c.call('threads.list', {})).toEqual([]);
    expect(harness.runs).toEqual([]);

    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'hello', machineId });
    await settled(c, thread.id);
    expect(harness.runs[0]).toMatchObject({ cwd: folder, prompt: 'hello' });
  });

  it('runs a turn under the thread’s profile, streams the reply and keeps the transcript', async () => {
    const harness = new FakeHarness();
    const { t, c, checkout, folder } = await setup(harness);
    stop = t.stop;

    c.events.length = 0;
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'Fix the login bug\nmore detail' });
    expect(thread).toMatchObject({ profileId: 'hrc', title: 'Fix the login bug', status: 'running' });

    const done = await settled(c, thread.id);
    expect(c.events).toContainEqual({ type: 'event', event: 'thread.delta', data: expect.objectContaining({ text: 'reply 1' }) });
    expect(done.find((x) => x.id === thread.id)?.title).toBe('Fix the login bug');

    const run = harness.runs[0]!;
    expect(run).toMatchObject({ cwd: folder, prompt: 'Fix the login bug\nmore detail', sessionId: null });
    expect(run.env).toMatchObject({
      ANTHROPIC_BASE_URL: t.app.hubUrl,
      ANTHROPIC_AUTH_TOKEN: await hubKeyOf(t.home, 'hrc'),
      CLAUDE_CONFIG_DIR: join(t.home, 'profiles', 'hrc', 'claude'),
    });

    const items = await c.call('threads.transcript', { threadId: thread.id });
    expect(items.map((i) => [i.kind, 'text' in i ? i.text : ''])).toEqual([
      ['user', 'Fix the login bug\nmore detail'],
      ['assistant', 'reply 1'],
    ]);

    // The next turn continues the same Claude session.
    await sendAndSettle(c, thread.id, 'and now?');
    expect(harness.runs[1]!.sessionId).toBe(SESSION);
  });

  it('moves a project to another profile only while it has no threads', async () => {
    const harness = new FakeHarness();
    const { t, c, checkout } = await setup(harness);
    stop = t.stop;
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'hi' });
    await settled(c, thread.id);
    await c.signedIn('Personal');
    await expect(c.call('projects.setProfile', { projectId: thread.projectId, profileId: 'personal' })).rejects.toThrow(
      /still has 1 thread/,
    );
    await c.call('threads.delete', { threadId: thread.id });
    const moved = await c.call('projects.setProfile', { projectId: thread.projectId, profileId: 'personal' });
    expect(moved.profileId).toBe('personal');
    const next = await c.call('threads.start', { checkoutId: checkout.id, text: 'hi' });
    await settled(c, next.id);
    expect(harness.runs.at(-1)!.env.ANTHROPIC_AUTH_TOKEN).toBe(await hubKeyOf(t.home, 'personal'));
  });

  it('marks the thread failed, shows the error, and retries the same message', async () => {
    const harness = new FakeHarness(function* (_run, n) {
      if (n > 1) return yield* replyWith('second time');
      yield { type: 'system', subtype: 'init', session_id: SESSION };
      throw new Error('hub refused the key');
    });
    const { t, c, checkout } = await setup(harness);
    stop = t.stop;
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'hi' });
    await settled(c, thread.id, 'failed');
    const items = await c.call('threads.transcript', { threadId: thread.id });
    expect(items.at(-1)).toMatchObject({ kind: 'notice', tone: 'error', text: 'hub refused the key' });

    c.events.length = 0;
    await c.call('threads.retry', { threadId: thread.id });
    await settled(c, thread.id);
    expect(harness.runs[1]).toMatchObject({ prompt: 'hi', sessionId: SESSION });
    await expect(c.call('threads.retry', { threadId: thread.id })).rejects.toThrow(/Only a failed/);
  });

  it('keeps snooze and settle on the server, and reopens a thread you write to', async () => {
    const { t, c, checkout } = await setup(new FakeHarness());
    stop = t.stop;
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'hi' });
    await settled(c, thread.id);
    const until = '2030-01-01T09:00:00.000Z';
    expect(await c.call('threads.snooze', { threadId: thread.id, until })).toMatchObject({ snoozedUntil: until });
    expect(await c.call('threads.settle', { threadId: thread.id })).toMatchObject({ snoozedUntil: null, settledAt: expect.any(String) });
    expect((await c.call('threads.list', {}))[0]?.settledAt).toEqual(expect.any(String));
    await sendAndSettle(c, thread.id, 'one more thing');
    expect((await c.call('threads.list', {}))[0]).toMatchObject({ settledAt: null, snoozedUntil: null });
  });

  it('refuses a second message while a turn is running', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const harness = new FakeHarness(async function* () {
      await held;
      yield* replyWith('late');
    });
    const { t, c, checkout } = await setup(harness);
    stop = async () => {
      release();
      await t.stop();
    };
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'one' });
    await expect(c.call('threads.send', { threadId: thread.id, text: 'two' })).rejects.toThrow(/already working/);
    release();
    await settled(c, thread.id);
  });

  it('keeps shelf state and conversations across restart while removing abandoned empty threads', async () => {
    const { t, c, checkout } = await setup(new FakeHarness());
    stop = t.stop;
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'hi' });
    await settled(c, thread.id);
    const shelved = await c.call('threads.settle', { threadId: thread.id });
    await t.stop({ keepHome: true });
    stop = undefined;

    const path = join(t.home, 'threads.json');
    const stored = JSON.parse(await readFile(path, 'utf8'));
    // Older threads can have a default title and no session despite having messages.
    stored[0].title = 'New thread';
    stored[0].sessionId = null;
    await writeFile(path, JSON.stringify([...stored, { ...stored[0], id: 'abandoned', settledAt: null }]));
    const restarted = await startTestApp({ harness: new FakeHarness() }, t.home);
    stop = restarted.stop;
    const next = await restarted.connect();
    expect(await next.call('threads.list', {})).toEqual([
      expect.objectContaining({ id: thread.id, settledAt: shelved.settledAt }),
    ]);
    expect(await next.call('threads.transcript', { threadId: thread.id })).toContainEqual(expect.objectContaining({ kind: 'user', text: 'hi' }));
  });
});

describe('threads need a signed-in profile', () => {
  it('refuses to start a turn until the profile is signed in with Claude', async () => {
    const harness = new FakeHarness();
    const t = await startTestApp({ harness });
    try {
      const c = await t.connect();
      const folder = join(t.home, 'repo');
      await mkdir(folder);
      await c.call('profiles.save', { name: 'Personal' });
      const checkout = await c.call('checkouts.add', { path: folder, profileId: 'personal' });
      await expect(c.call('threads.start', { checkoutId: checkout.id, text: 'hi' })).rejects.toThrow(/Select a signed-in Claude account for Personal/);
      expect(harness.runs).toHaveLength(0);
      // Nothing is stored for a thread that could not start.
      expect(await c.call('threads.list', {})).toEqual([]);
    } finally {
      await t.stop();
    }
  });
});
