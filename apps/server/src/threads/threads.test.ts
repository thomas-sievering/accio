import { mkdir, readFile } from 'node:fs/promises';
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

  it('runs a turn under the thread’s profile, streams the reply and keeps the transcript', async () => {
    const harness = new FakeHarness();
    const { t, c, checkout, folder } = await setup(harness);
    stop = t.stop;

    const thread = await c.call('threads.create', { checkoutId: checkout.id });
    expect(thread).toMatchObject({ profileId: 'hrc', title: 'New thread', status: 'idle' });

    const done = await sendAndSettle(c, thread.id, 'Fix the login bug\nmore detail');
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
    const thread = await c.call('threads.create', { checkoutId: checkout.id });
    await c.signedIn('Personal');
    await expect(c.call('projects.setProfile', { projectId: thread.projectId, profileId: 'personal' })).rejects.toThrow(
      /still has 1 thread/,
    );
    await c.call('threads.delete', { threadId: thread.id });
    const moved = await c.call('projects.setProfile', { projectId: thread.projectId, profileId: 'personal' });
    expect(moved.profileId).toBe('personal');
    const next = await c.call('threads.create', { checkoutId: checkout.id });
    await sendAndSettle(c, next.id, 'hi');
    expect(harness.runs[0]!.env.ANTHROPIC_AUTH_TOKEN).toBe(await hubKeyOf(t.home, 'personal'));
  });

  it('marks the thread failed and shows the error when the harness fails', async () => {
    const harness = new FakeHarness(function* () {
      yield { type: 'system', subtype: 'init', session_id: SESSION };
      throw new Error('hub refused the key');
    });
    const { t, c, checkout } = await setup(harness);
    stop = t.stop;
    const thread = await c.call('threads.create', { checkoutId: checkout.id });
    await sendAndSettle(c, thread.id, 'hi', 'failed');
    const items = await c.call('threads.transcript', { threadId: thread.id });
    expect(items.at(-1)).toMatchObject({ kind: 'notice', tone: 'error', text: 'hub refused the key' });
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
    const thread = await c.call('threads.create', { checkoutId: checkout.id });
    await c.call('threads.send', { threadId: thread.id, text: 'one' });
    await expect(c.call('threads.send', { threadId: thread.id, text: 'two' })).rejects.toThrow(/already working/);
    release();
    await settled(c, thread.id);
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
      const thread = await c.call('threads.create', { checkoutId: checkout.id });
      await expect(c.call('threads.send', { threadId: thread.id, text: 'hi' })).rejects.toThrow(/Sign Personal in with Claude first/);
      expect(harness.runs).toHaveLength(0);
    } finally {
      await t.stop();
    }
  });
});
