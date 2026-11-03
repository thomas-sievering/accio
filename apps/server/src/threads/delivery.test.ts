import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { JsonFile } from '@accio/persistence';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';
import { DeliveryGit, DeliveryPending, deliveryPrompt, git } from './delivery.js';
import type { ThreadDelivery, ThreadView } from '@accio/protocol';

// These tests spawn real Git processes; allow for Windows CI contention.
vi.setConfig({ testTimeout: 20_000 });

let t: Awaited<ReturnType<typeof startTestApp>>;
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await t?.stop(); });

async function setup(harness = new FakeHarness()) {
  t = await startTestApp({ harness });
  const c = await t.connect();
  await c.signedIn('Personal');
  const source = join(t.home, 'source');
  const origin = join(t.home, 'origin.git');
  await mkdir(source);
  await git(source, 'init', '--quiet', '-b', 'main');
  await git(source, 'config', 'user.name', 'Accio Test');
  await git(source, 'config', 'user.email', 'accio@example.test');
  await git(source, 'config', 'core.autocrlf', 'false');
  await writeFile(join(source, 'seed.txt'), 'base\n');
  await git(source, 'add', '.');
  await git(source, 'commit', '--quiet', '-m', 'base');
  await git(t.home, 'init', '--quiet', '--bare', '-b', 'main', origin);
  await git(source, 'remote', 'add', 'origin', origin);
  await git(source, 'push', '--quiet', '-u', 'origin', 'main');
  await git(source, 'remote', 'set-head', 'origin', '-a');
  const checkout = await c.call('checkouts.add', { path: source, profileId: 'personal' });
  return { c, source, origin, checkout };
}
const wait = (c: TestClient, id: string, predicate = (t: ThreadView) => t.status === 'idle') =>
  c.waitFor('threads.changed', ts => ts.some(t => t.id === id && predicate(t)), 15_000);
async function publish(cwd: string) {
  await git(cwd, 'add', '.');
  await git(cwd, 'commit', '--quiet', '--allow-empty', '-m', 'thread work');
  await git(cwd, 'fetch', '--quiet', 'origin');
  await git(cwd, 'rebase', 'origin/main');
  await git(cwd, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
}

it('isolates concurrent threads without copying dirty source changes or sharing a branch', async () => {
  const harness = new FakeHarness();
  const { c, checkout, source } = await setup(harness);
  await writeFile(join(source, 'private.txt'), 'source edits');
  const [a, b] = await Promise.all(['one', 'two'].map(text => c.call('threads.start', { checkoutId: checkout.id, text })));
  await wait(c, a.id); await wait(c, b.id);
  expect(a.workspace!.path).not.toBe(source);
  expect(a.workspace!.path).not.toBe(b.workspace!.path);
  expect(a.workspace!.branch).not.toBe(b.workspace!.branch);
  await writeFile(join(a.workspace!.path, 'seed.txt'), 'only a\n');
  expect(await readFile(join(b.workspace!.path, 'seed.txt'), 'utf8')).toBe('base\n');
  await expect(stat(join(a.workspace!.path, 'private.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(source, 'private.txt'), 'utf8')).toBe('source edits');
  await expect(c.call('threads.delete', { threadId: a.id })).rejects.toThrow(/Archive/);
  await expect(c.call('checkouts.remove', { id: checkout.id, deleteThreads: true })).rejects.toThrow(/Archive/);
});

it('cancels queued delivery durably without stopping or duplicating the work turn', async () => {
  const finish = gate();
  const harness = new FakeHarness(async function* (run) {
    await Promise.race([finish.opened, new Promise<void>(r => run.signal.addEventListener('abort', () => r(), { once: true }))]);
    yield* replyWith('finished work');
  });
  const { c, checkout } = await setup(harness);
  try {
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'work' });
    await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
    expect(JSON.parse(await readFile(join(t.home, 'threads.json'), 'utf8'))[0].delivery.status).toBe('queued');
    expect(harness.runs).toHaveLength(1);
    await c.call('threads.cancelDelivery', { threadId: thread.id });
    expect(harness.runs[0]!.signal.aborted).toBe(false);
    finish.release();
    await wait(c, thread.id);
    expect(harness.runs).toHaveLength(1);
    expect((await c.call('threads.list', {}))[0]!.delivery).toBeUndefined();
  } finally { finish.release(); }
});

it('delivers once after work, refuses dirty cleanup, releases only the owner and restores a fresh follow-up', async () => {
  const finish = gate();
  const harness = new FakeHarness(async function* (run, n) {
    if (n === 1) { await finish.opened; await writeFile(join(run.cwd, 'feature.txt'), 'feature\n'); }
    if (run.prompt.startsWith('Deliver the current task')) await publish(run.cwd);
    yield* replyWith('done');
  });
  const { c, checkout, source, origin } = await setup(harness);
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'build feature' });
  try {
    await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
    await expect(c.call('threads.deliver', { threadId: thread.id, mode: 'ship' })).rejects.toThrow(/already requested/);
    finish.release();
    await wait(c, thread.id, x => x.status === 'idle' && x.delivery?.status === 'delivered');
    expect(harness.runs).toHaveLength(2);
    expect(harness.runs[1]!.sessionId).not.toBeNull();
    expect(await git(origin, 'show', 'main:feature.txt')).toBe('feature');
    const items = await c.call('threads.transcript', { threadId: thread.id });
    expect(items).toContainEqual(expect.objectContaining({ kind: 'user', text: 'Ship to main when ready.', delivery: 'ship' }));
    expect(items.some(i => i.kind === 'user' && i.text.includes('unshallow'))).toBe(false);
    const neighbor = await c.call('threads.start', { checkoutId: checkout.id, text: 'neighbor' });
    await wait(c, neighbor.id);
    await writeFile(join(thread.workspace!.path, 'unsent.txt'), 'keep me');
    await expect(c.call('threads.archive', { threadId: thread.id })).rejects.toThrow(/Uncommitted/);
    expect(await readFile(join(thread.workspace!.path, 'unsent.txt'), 'utf8')).toBe('keep me');
    // Preserve the new work by publishing it, rather than deleting it to satisfy cleanup.
    c.events.length = 0;
    await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
    await wait(c, thread.id, x => x.status === 'idle' && x.delivery?.status === 'delivered');
    const archived = await c.call('threads.archive', { threadId: thread.id });
    expect(archived.workspace!.releasedAt).toEqual(expect.any(String));
    await expect(stat(thread.workspace!.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await stat(neighbor.workspace!.path)).toBeDefined();
    expect(await stat(source)).toBeDefined();
    expect(await git(source, 'branch', '--list', thread.workspace!.branch)).toBe('');
    expect(await c.call('threads.transcript', { threadId: thread.id })).toContainEqual(expect.objectContaining({ kind: 'user', text: 'build feature' }));
    c.events.length = 0;
    await c.call('threads.send', { threadId: thread.id, text: 'follow up' });
    await wait(c, thread.id);
    expect(harness.runs.at(-1)!.sessionId).toBeNull();
    expect(await readFile(join(thread.workspace!.path, 'unsent.txt'), 'utf8')).toBe('keep me');
  } finally { finish.release(); }
});

it('keeps work when the assistant claims success without publishing it', async () => {
  const harness = new FakeHarness(async function* (run) {
    await writeFile(join(run.cwd, 'feature.txt'), 'unpublished');
    await git(run.cwd, 'add', '.');
    if (await git(run.cwd, 'status', '--porcelain')) await git(run.cwd, 'commit', '--quiet', '-m', 'unpublished');
    yield* replyWith('Shipped successfully. All checks passed.');
  });
  const { c, checkout } = await setup(harness);
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'build' });
  await wait(c, thread.id);
  c.events.length = 0;
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(c, thread.id, x => x.status === 'idle' && x.delivery?.status === 'blocked');
  await expect(c.call('threads.archive', { threadId: thread.id })).rejects.toThrow(/Ship the change/);
  expect(await readFile(join(thread.workspace!.path, 'feature.txt'), 'utf8')).toBe('unpublished');
});

it.each([false, true])('stops a no-op ship behind main before querying GitHub checks (persisted wait: %s)', async (waiting) => {
  const harness = new FakeHarness();
  const { c, checkout, source, origin } = await setup(harness);
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'heyho' });
  await wait(c, thread.id);
  await writeFile(join(source, 'newer.txt'), 'main advanced\n');
  await git(source, 'add', '.');
  await git(source, 'commit', '--quiet', '-m', 'advance main');
  await git(source, 'push', '--quiet');
  await git(source, 'config', `url.${origin.replaceAll('\\', '/')}.insteadOf`, 'https://github.com/test/fixture.git');
  await git(source, 'remote', 'set-url', 'origin', 'https://github.com/test/fixture.git');
  const hosting = vi.fn(async () => { throw new Error('No checks should be queried'); });
  const manager = new DeliveryGit(t.home, hosting);
  const verify = manager.verify.bind(manager);
  const verifier = vi.spyOn(DeliveryGit.prototype, 'verify').mockImplementation(verify);
  if (waiting) verifier.mockRejectedValueOnce(new DeliveryPending('Waiting for GitHub to report checks for this revision.'));
  c.events.length = 0;
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  if (waiting) {
    await wait(c, thread.id, x => x.status === 'idle' && x.delivery?.status === 'waiting');
    await t.stop({ keepHome: true });
    t = await startTestApp({ harness }, t.home);
    const next = await t.connect();
    await next.call('threads.checkDelivery', { threadId: thread.id });
    expect((await next.call('threads.list', {}))[0]!.delivery).toMatchObject({ status: 'blocked', detail: expect.stringContaining('Nothing to ship') });
    expect(hosting).not.toHaveBeenCalled();
    expect(harness.runs).toHaveLength(2);
    return;
  }
  await wait(c, thread.id, x => x.status === 'idle' && x.delivery?.status === 'blocked');
  expect((await c.call('threads.list', {}))[0]!.delivery).toMatchObject({ status: 'blocked', detail: expect.stringContaining('Nothing to ship') });
  expect(hosting).not.toHaveBeenCalled();
  expect(harness.runs).toHaveLength(2);
  expect(await stat(thread.workspace!.path)).toBeDefined();
  await expect(c.call('threads.archive', { threadId: thread.id })).rejects.toThrow(/Ship the change/);
});

it('never runs delivery after persisting its authorization fails', async () => {
  const harness = new FakeHarness();
  const { c, checkout } = await setup(harness);
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'work' });
  await wait(c, thread.id);
  const write = JsonFile.prototype.write;
  vi.spyOn(JsonFile.prototype, 'write').mockImplementation(function(value: any) {
    if (this.path === join(t.home, 'threads.json') && value.some((v: any) => v.delivery?.status === 'queued')) return Promise.reject(new Error('disk full'));
    return write.call(this, value);
  });
  await expect(c.call('threads.deliver', { threadId: thread.id, mode: 'ship' })).rejects.toThrow(/disk full/);
  expect((await c.call('threads.list', {}))[0]!.delivery).toBeUndefined();
  expect(harness.runs).toHaveLength(1);
});

it('retains queued intent across restart and requires explicit resume before publishing', async () => {
  const started = gate();
  const harness = new FakeHarness(async function* (run) {
    started.release();
    await new Promise<void>(r => run.signal.addEventListener('abort', () => r(), { once: true }));
  });
  const { c, checkout } = await setup(harness);
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'work' });
  await started.opened;
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await t.stop({ keepHome: true });
  const resumed = new FakeHarness(async function* (run) {
    if (run.prompt.startsWith('Deliver the current task')) await publish(run.cwd);
    yield* replyWith('done');
  });
  t = await startTestApp({ harness: resumed }, t.home);
  const next = await t.connect();
  expect(resumed.runs).toHaveLength(0);
  expect((await next.call('threads.list', {}))[0]).toMatchObject({ status: 'interrupted', delivery: { status: 'queued' } });
  await next.call('threads.resume', { threadId: thread.id });
  await wait(next, thread.id, x => x.status === 'idle' && x.delivery?.status === 'delivered');
  expect(resumed.runs).toHaveLength(2);
});

it('enforces review-only instructions and verifies PR/check state rather than treating an open PR as delivered', async () => {
  const { c, checkout, source, origin } = await setup();
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'work' });
  await wait(c, thread.id);
  const workspace = thread.workspace!;
  await git(source, 'config', `url.${origin.replaceAll('\\', '/')}.insteadOf`, 'https://github.com/test/fixture.git');
  await git(source, 'remote', 'set-url', 'origin', 'https://github.com/test/fixture.git');
  const revision = await git(workspace.path, 'rev-parse', 'HEAD');
  let checks: any[] = [{ conclusion: 'SUCCESS' }];
  const hosting = vi.fn(async (_cwd: string, args: string[]) => args[0] === 'pr' ? [{ url: 'https://github.com/test/fixture/pull/1', state: 'OPEN', headRefOid: revision, baseRefName: 'main', statusCheckRollup: checks, isDraft: false }] : args[1]!.includes('check-runs') ? { total_count: checks.length, check_runs: checks } : { total_count: 0, statuses: [] });
  const manager = new DeliveryGit(t.home, hosting);
  const intent: ThreadDelivery = { mode: 'review', policy: 'direct', status: 'running', requestedAt: new Date().toISOString(), baseBranch: 'main' };
  expect(deliveryPrompt(workspace, intent)).toContain('NEVER merge');
  expect(await manager.verify(workspace, intent)).toMatchObject({ status: 'ready', revision });
  checks = [{ conclusion: null, status: 'IN_PROGRESS' }];
  await expect(manager.verify(workspace, intent)).rejects.toThrow(/Waiting for checks/);
  checks = [{ conclusion: 'FAILURE' }];
  await expect(manager.verify(workspace, intent)).rejects.toThrow(/Checks are failing/);
  expect(await stat(workspace.path)).toBeDefined();
});

it('runs previews with independent ports/state and stops only the archived thread’s owned process tree', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'another-profile-secret');
  const harness = new FakeHarness(async function* (run) {
    if (run.prompt.startsWith('Deliver the current task')) await publish(run.cwd);
    yield* replyWith('done');
  });
  const { c, checkout, source } = await setup(harness);
  await writeFile(join(source, 'preview.cjs'), `require('http').createServer((req,res)=>res.end(process.env.ACCIO_HOME + '|' + (process.env.OPENAI_API_KEY || 'no-inherited-key'))).listen(Number(process.env.PORT),'127.0.0.1');`);
  await git(source, 'add', '.'); await git(source, 'commit', '--quiet', '-m', 'preview'); await git(source, 'push', '--quiet');
  await c.call('projects.setDelivery', { projectId: checkout.projectId, deliveryPolicy: 'direct', previewCommand: 'node preview.cjs' });
  const a = await c.call('threads.start', { checkoutId: checkout.id, text: 'a' });
  const b = await c.call('threads.start', { checkoutId: checkout.id, text: 'b' });
  await wait(c, a.id); await wait(c, b.id);
  const first = await c.call('threads.openPreview', { threadId: a.id });
  const second = await c.call('threads.openPreview', { threadId: b.id });
  expect(first.url).not.toBe(second.url);
  expect(await (await fetch(first.url)).text()).toContain(a.id);
  expect(await (await fetch(first.url)).text()).toContain('no-inherited-key');
  expect(await (await fetch(second.url)).text()).toContain(b.id);
  c.events.length = 0;
  await c.call('threads.deliver', { threadId: a.id, mode: 'ship' });
  await wait(c, a.id, x => x.status === 'idle' && x.delivery?.status === 'delivered');
  await c.call('threads.archive', { threadId: a.id });
  await expect(fetch(first.url)).rejects.toThrow();
  expect(await (await fetch(second.url)).text()).toContain(b.id);
  await t.app.close();
  await expect(fetch(second.url)).rejects.toThrow();
}, 20_000);

it('refuses archive if the managed workspace was added as another checkout', async () => {
  const harness = new FakeHarness(async function* (run) { if (run.prompt.startsWith('Deliver the current task')) await publish(run.cwd); yield* replyWith('done'); });
  const { c, checkout } = await setup(harness);
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'work' });
  await wait(c, thread.id);
  c.events.length = 0;
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(c, thread.id, x => x.status === 'idle' && x.delivery?.status === 'delivered');
  await c.call('checkouts.add', { path: thread.workspace!.path, profileId: 'personal' });
  await expect(c.call('threads.archive', { threadId: thread.id })).rejects.toThrow(/Another checkout/);
  expect(await stat(thread.workspace!.path)).toBeDefined();
});

it('finishes a journaled release after a crash between worktree removal and saving Archive', async () => {
  const harness = new FakeHarness(async function* (run) { if (run.prompt.startsWith('Deliver the current task')) await publish(run.cwd); yield* replyWith('done'); });
  const { c, checkout } = await setup(harness);
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'work' });
  await wait(c, thread.id); c.events.length = 0;
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(c, thread.id, x => x.status === 'idle' && x.delivery?.status === 'delivered');
  const write = JsonFile.prototype.write;
  const storage = vi.spyOn(JsonFile.prototype, 'write').mockImplementation(function(value: any) {
    if (this.path === join(t.home, 'threads.json') && value.some((v: any) => v.workspace?.releasedAt)) return Promise.reject(new Error('disk full after cleanup'));
    return write.call(this, value);
  });
  await expect(c.call('threads.archive', { threadId: thread.id })).rejects.toThrow(/disk full/);
  storage.mockRestore();
  await t.stop({ keepHome: true });
  t = await startTestApp({ harness: new FakeHarness() }, t.home);
  const next = await t.connect();
  expect((await next.call('threads.list', {}))[0]).toMatchObject({ workspace: { releasedAt: expect.any(String) }, settledAt: expect.any(String) });
  expect(await next.call('threads.transcript', { threadId: thread.id })).toContainEqual(expect.objectContaining({ kind: 'user', text: 'work' }));
});

it('waits without running the agent again and verifies delivery when checks finish', async () => {
  const harness = new FakeHarness(async function* (run) { if (run.prompt.startsWith('Deliver the current task')) await publish(run.cwd); yield* replyWith('done'); });
  const { c, checkout } = await setup(harness);
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'work' });
  await wait(c, thread.id); c.events.length = 0;
  const verify = DeliveryGit.prototype.verify;
  let pending = true;
  vi.spyOn(DeliveryGit.prototype, 'verify').mockImplementation(function(workspace, delivery) {
    return pending ? Promise.reject(new DeliveryPending('Waiting for checks to finish.')) : verify.call(this, workspace, delivery);
  });
  await c.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(c, thread.id, x => x.status === 'idle' && x.delivery?.status === 'waiting');
  expect(harness.runs).toHaveLength(2);
  await expect(c.call('threads.archive', { threadId: thread.id })).rejects.toThrow(/Ship the change/);
  await t.stop({ keepHome: true });
  const restarted = new FakeHarness();
  t = await startTestApp({ harness: restarted }, t.home);
  const next = await t.connect();
  expect((await next.call('threads.list', {}))[0]!.delivery!.status).toBe('waiting');
  expect(restarted.runs).toHaveLength(0);
  pending = false;
  await next.call('threads.checkDelivery', { threadId: thread.id });
  expect((await next.call('threads.list', {}))[0]!.delivery!.status).toBe('delivered');
  expect(harness.runs).toHaveLength(2);
  expect(restarted.runs).toHaveLength(0);
});

it('wakes the same owning thread for actionable check failures with the original review-only grant', async () => {
  const harness = new FakeHarness();
  const { c, checkout } = await setup(harness);
  const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'work' });
  await wait(c, thread.id); c.events.length = 0;
  const verify = vi.spyOn(DeliveryGit.prototype, 'verify').mockRejectedValue(new DeliveryPending('Checks failed.', true));
  await c.call('threads.deliver', { threadId: thread.id, mode: 'review' });
  await wait(c, thread.id, x => x.status === 'idle' && x.delivery?.status === 'waiting');
  c.events.length = 0;
  verify.mockImplementation(async (_workspace, delivery) => delivery.continuationAttempts ? { ...delivery, status: 'ready', pullRequestUrl: 'https://github.com/test/repo/pull/1' } : Promise.reject(new DeliveryPending('Checks failed.', true)));
  await c.call('threads.checkDelivery', { threadId: thread.id });
  await wait(c, thread.id, x => x.status === 'idle' && x.delivery?.status === 'ready');
  expect(harness.runs).toHaveLength(3);
  expect(harness.runs[2]!.prompt).toContain('NEVER merge');
  expect(harness.runs[2]!.cwd).toBe(thread.workspace!.path);
});
