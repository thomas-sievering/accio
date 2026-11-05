import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeCodex } from '../testing/fakeCodex.js';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';
import { claudeAccount, startTestApp, type TestClient } from '../testing/testApp.js';
import type { HarnessImage } from './harness.js';
import { codexInput } from './codex.js';
import { userContent } from './claudeCode.js';
import { withImageFiles } from './turns.js';

/** The smallest PNG that passes the signature check: a 1x1 transparent pixel. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const png = PNG.toString('base64');

const idle = (c: TestClient, threadId: string) => c.waitFor('threads.changed', (ts) => ts.some((t) => t.id === threadId && t.status === 'idle'));

describe('image attachments', () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(() => stop?.());

  it('sends a pasted image to the harness as a typed file, keeps it in the message and retries with it', async () => {
    let fail = true;
    const harness = new FakeHarness(async function* (_run, n) {
      if (n === 2 && fail) { fail = false; throw new Error('boom'); }
      yield* replyWith(`reply ${n}`);
    });
    const t = await startTestApp({ harness });
    stop = t.stop;
    const c = await t.connect();
    await c.signedIn('Personal');
    const { uploadId } = await c.call('threads.upload', { name: 'shot.png', mimeType: 'image/png', data: png });
    const thread = await c.call('threads.start', { profileId: 'personal', text: '', images: [uploadId] });
    await idle(c, thread.id);

    const [run] = harness.runs;
    expect(run!.images).toHaveLength(1);
    const file = run!.images![0]!;
    expect(file).toMatchObject({ mimeType: 'image/png' });
    expect(file.path.endsWith('.png')).toBe(true);
    expect(await readFile(file.path)).toEqual(PNG);
    expect(run!.prompt).toBe(`[Image 1 is saved at: ${file.path}]`);
    const [user] = (await c.call('threads.transcript', { threadId: thread.id })).filter((i) => i.kind === 'user');
    expect(user).toMatchObject({ text: '', images: [{ name: 'shot.png', mimeType: 'image/png', sizeBytes: PNG.byteLength }] });
    // Sending forgets the upload: it now lives with the thread.
    expect(await readdir(join(t.home, 'uploads'))).toEqual([]);
    const { url } = await c.call('threads.assetUrl', { threadId: thread.id, assetId: user!.kind === 'user' ? user!.images![0]!.id : '' });
    expect(url).toMatch(/^\/thread-assets\//);

    const second = await c.call('threads.upload', { name: 'again.png', mimeType: 'image/png', data: png });
    c.events.length = 0;
    await c.call('threads.send', { threadId: thread.id, text: 'and this', images: [second.uploadId] });
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'failed'));
    await c.call('threads.retry', { threadId: thread.id });
    await idle(c, thread.id);
    expect(harness.runs[2]!.images).toHaveLength(1);
    expect(harness.runs[2]!.prompt).toMatch(/^and this\n\n\[Image 1 is saved at: .+\.png\]$/);
  });

  it('steers and queues with images', async () => {
    const finish = gate();
    const steers: { text: string; images?: HarnessImage[] }[] = [];
    const harness = new FakeHarness(async function* (run, n) {
      if (n === 1) {
        run.registerSteer?.(async (text, images) => { steers.push({ text, images }); });
        yield { type: 'system', subtype: 'init', session_id: 'held' };
        await finish.opened;
        run.registerSteer?.(undefined);
      }
      yield* replyWith(`reply ${n}`);
    });
    const t = await startTestApp({ harness });
    stop = t.stop;
    const c = await t.connect();
    await c.signedIn('Personal');
    const thread = await c.call('threads.start', { profileId: 'personal', text: 'work' });
    await expect.poll(() => harness.runs.length).toBe(1);
    const steer = await c.call('threads.upload', { name: 'a.png', mimeType: 'image/png', data: png });
    await c.call('threads.send', { threadId: thread.id, text: 'look', images: [steer.uploadId] });
    expect(steers[0]!.images).toHaveLength(1);
    expect(steers[0]!.text).toContain('look\n\n[Image 1 is saved at: ');
    const queued = await c.call('threads.upload', { name: 'b.png', mimeType: 'image/png', data: png });
    await c.call('threads.send', { threadId: thread.id, text: '', images: [queued.uploadId], mode: 'queue' });
    expect((await c.call('threads.list', {}))[0]!.queuedMessages![0]).toMatchObject({ text: '', images: [{ name: 'b.png' }] });
    finish.release();
    await expect.poll(() => harness.runs.length).toBe(2);
    expect(harness.runs[1]!.images).toHaveLength(1);
  });

  it('refuses images for a model that reads none, and keeps the upload for another try', async () => {
    const fake = new FakeCodex();
    const t = await startTestApp({ harness: new FakeHarness(), codexHarness: new FakeHarness(), codexFactory: fake.factory });
    stop = t.stop;
    const c = await t.connect();
    const profile = await c.signedIn('Personal');
    const account = await c.call('accounts.save', { name: 'Personal ChatGPT', providerId: 'openai' });
    const login = await c.call('accounts.beginSignIn', { id: account.id });
    await fake.latest.complete('Personal');
    await c.call('accounts.signInStatus', { signInId: login.signInId });
    await c.call('profiles.save', { id: profile.id, name: 'Personal', accountId: claudeAccount(profile)!.id, openaiAccountId: account.id });
    const models = (await c.call('models.list', { profileId: profile.id })).models;
    expect(models.find((m) => m.id === 'test-fast')!.imageTypes).toEqual([]);
    expect(models.find((m) => m.id === 'test-codex')!.imageTypes).toContain('image/png');
    expect(models.find((m) => m.id === 'opus')?.imageTypes ?? ['image/png']).toContain('image/png');

    const { uploadId } = await c.call('threads.upload', { name: 'shot.png', mimeType: 'image/png', data: png });
    await expect(c.call('threads.start', { profileId: profile.id, model: { harnessId: 'codex', modelId: 'test-fast' }, text: 'see', images: [uploadId] }))
      .rejects.toThrow("Test Fast can't read images.");
    const thread = await c.call('threads.start', { profileId: profile.id, model: { harnessId: 'codex', modelId: 'test-codex' }, text: 'see', images: [uploadId] });
    await idle(c, thread.id);
  });

  it('refuses an upload whose bytes are not the image type it claims', async () => {
    const t = await startTestApp({ harness: new FakeHarness() });
    stop = t.stop;
    const c = await t.connect();
    await expect(c.call('threads.upload', { name: 'x.gif', mimeType: 'image/gif', data: png })).rejects.toThrow('not the type it claims');
    await expect(c.call('threads.upload', { name: 'x.txt', mimeType: 'text/plain' as 'image/png', data: png })).rejects.toThrow();
  });
});

describe('harness image input', () => {
  const images = [{ path: '/t/a.png', mimeType: 'image/png' }];

  it('names each saved file after the text', () => {
    expect(withImageFiles('hi', [])).toBe('hi');
    expect(withImageFiles('', images)).toBe('[Image 1 is saved at: /t/a.png]');
    expect(withImageFiles('hi', [...images, { path: '/t/b.jpg', mimeType: 'image/jpeg' }])).toBe('hi\n\n[Image 1 is saved at: /t/a.png]\n[Image 2 is saved at: /t/b.jpg]');
  });

  it('gives Codex local images before the text', () => {
    expect(codexInput('hi', images)).toEqual([{ type: 'localImage', path: '/t/a.png' }, { type: 'text', text: 'hi' }]);
    expect(codexInput('hi')).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('gives Claude base64 image blocks before the text', async () => {
    const t = await startTestApp({ harness: new FakeHarness() });
    try {
      const path = join(t.home, 'a.png');
      await (await import('node:fs/promises')).writeFile(path, PNG);
      expect(await userContent('hi', [{ path, mimeType: 'image/png' }])).toEqual([
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
        { type: 'text', text: 'hi' },
      ]);
      expect(await userContent('hi')).toBe('hi');
    } finally { await t.stop(); }
  });
});
