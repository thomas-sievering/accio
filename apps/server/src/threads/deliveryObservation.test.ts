import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { JsonFile } from '@accio/persistence';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';
import { DeliveryGit, DeliveryUnavailable, type DeliveryObservation } from './delivery.js';
import { git } from '../git.js';
import type { ThreadView } from '@accio/protocol';

vi.setConfig({ testTimeout: 25_000 });
let app: Awaited<ReturnType<typeof startTestApp>>;
afterEach(async () => { vi.restoreAllMocks(); await app?.stop(); });
const wait = (client: TestClient, id: string, check = (t: ThreadView) => t.status === 'idle') =>
  client.waitFor('threads.changed', ts => ts.some(t => t.id === id && check(t)), 15_000);
const view = async (client: TestClient, id: string) => (await client.call('threads.list', {})).find(t => t.id === id)!;

async function project(harness: FakeHarness) {
  app = await startTestApp({ harness });
  const client = await app.connect();
  await client.signedIn('Personal');
  const source = join(app.home, 'source');
  const origin = join(app.home, 'origin.git');
  await mkdir(source);
  await git(source, 'init', '--quiet', '-b', 'main');
  await git(source, 'config', 'user.name', 'Accio Test');
  await git(source, 'config', 'user.email', 'accio@example.test');
  await writeFile(join(source, 'seed'), 'base\n');
  await git(source, 'add', '.');
  await git(source, 'commit', '--quiet', '-m', 'base');
  await git(app.home, 'init', '--quiet', '--bare', '-b', 'main', origin);
  await git(source, 'remote', 'add', 'origin', origin);
  await git(source, 'push', '--quiet', '-u', 'origin', 'main');
  await git(source, 'remote', 'set-head', 'origin', '-a');
  const checkout = await client.call('checkouts.add', { path: source, profileId: 'personal' });
  return { client, source, origin, checkout };
}

async function reviewProject(checks = 'SUCCESS') {
  let head = '';
  const harness = new FakeHarness(async function* (run) {
    if (run.prompt.startsWith('Deliver the current task')) {
      await writeFile(join(run.cwd, 'feature'), 'reviewed change\n');
      await git(run.cwd, 'add', '.');
      if (await git(run.cwd, 'status', '--porcelain')) await git(run.cwd, 'commit', '--quiet', '-m', 'feature');
      await git(run.cwd, 'push', '--quiet', 'origin', 'HEAD');
      head = await git(run.cwd, 'rev-parse', 'HEAD');
    }
    yield* replyWith('done');
  });
  const p = await project(harness);
  await git(p.source, 'config', `url.${p.origin.replaceAll('\\', '/')}.insteadOf`, 'https://github.com/test/fixture.git');
  await git(p.source, 'remote', 'set-url', 'origin', 'https://github.com/test/fixture.git');
  const host = { state: 'OPEN', mergeRevision: '', checks, base: 'main', unavailable: false, head: '' };
  const reads: string[][] = [];
  const hosting = async (_cwd: string, args: string[]) => {
    reads.push(args);
    if (host.unavailable) throw new DeliveryUnavailable('GitHub is temporarily unavailable');
    if (args[0] === 'pr') {
      const pr = { number: 123, url: 'https://github.com/test/fixture/pull/123', state: host.state,
        headRefOid: host.head || head, baseRefName: host.base, isDraft: false, reviewDecision: '',
        statusCheckRollup: [{ conclusion: 'SUCCESS' }],
        mergeCommit: host.mergeRevision ? { oid: host.mergeRevision } : null,
        mergedAt: host.state === 'MERGED' ? new Date().toISOString() : null };
      return args[1] === 'view' ? pr : [pr];
    }
    if (args[1]!.includes('check-runs')) return { total_count: 1, check_runs: [{ conclusion: host.checks === 'PENDING' ? null : host.checks }] };
    return { total_count: 0, statuses: [] };
  };
  const manager = new DeliveryGit(app.home, hosting);
  const original = DeliveryGit.prototype.verify;
  const verifier = vi.spyOn(DeliveryGit.prototype, 'verify').mockImplementation((workspace, delivery, observed) => original.call(manager, workspace, delivery, observed));
  const thread = await p.client.call('threads.start', { checkoutId: p.checkout.id, text: 'build feature' });
  await wait(p.client, thread.id);
  p.client.events.length = 0;
  await p.client.call('threads.deliver', { threadId: thread.id, mode: 'review' });
  await wait(p.client, thread.id, t => t.status === 'idle' && t.delivery?.status === (checks === 'SUCCESS' ? 'ready' : 'waiting'));
  const merge = async () => {
    await git(p.source, 'merge', '--squash', thread.workspace!.branch);
    await git(p.source, 'commit', '--quiet', '-m', 'squashed feature');
    await git(p.source, 'push', '--quiet', 'origin', 'main');
    host.mergeRevision = await git(p.source, 'rev-parse', 'HEAD');
    host.state = 'MERGED';
    await git(p.source, 'push', '--quiet', 'origin', '--delete', thread.workspace!.branch);
  };
  return { ...p, host, reads, verifier, thread, harness, merge };
}

it('settles verified direct publication once, retains the workspace, and respects Reopen through restart', async () => {
  const harness = new FakeHarness(async function* (run) {
    if (run.prompt.startsWith('Deliver the current task')) {
      await writeFile(join(run.cwd, 'feature'), 'published change\n');
      await git(run.cwd, 'add', '.');
      await git(run.cwd, 'commit', '--quiet', '-m', 'feature');
      await git(run.cwd, 'push', '--quiet', 'origin', 'HEAD:main');
    }
    yield* replyWith('done');
  });
  const { client, checkout } = await project(harness);
  const thread = await client.call('threads.start', { checkoutId: checkout.id, text: 'work' });
  await wait(client, thread.id); client.events.length = 0;
  await client.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(client, thread.id, t => t.status === 'idle' && !!t.settledAt);
  const delivered = await view(client, thread.id);
  expect(delivered.delivery).toMatchObject({ status: 'delivered', completedAt: expect.any(String), id: expect.any(String) });
  expect(delivered.workspace!.releasedAt).toBeNull();
  expect(await stat(delivered.workspace!.path)).toBeDefined();
  await client.call('threads.reopen', { threadId: thread.id });
  await client.call('threads.checkDelivery', { threadId: thread.id });
  expect((await view(client, thread.id)).settledAt).toBeNull();
  const home = app.home;
  await app.stop({ keepHome: true });
  // Older versions wrote a transcript receipt; delivery state alone now carries the outcome.
  const path = join(home, 'transcripts', `${thread.id}.json`);
  const items = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify(items.filter((item: any) => !item.id.startsWith('delivery:'))));
  app = await startTestApp({ harness: new FakeHarness() }, home);
  const next = await app.connect();
  expect((await view(next, thread.id)).settledAt).toBeNull();
  await next.call('threads.checkDelivery', { threadId: thread.id });
  expect((await next.call('threads.transcript', { threadId: thread.id })).filter(item => item.kind === 'notice' && item.id.startsWith('delivery:'))).toHaveLength(0);
  expect((await view(next, thread.id)).delivery).toMatchObject({ status: 'delivered', completedAt: expect.any(String) });
});

it('keeps review-only tracking past its agent budget and restart, then settles an external squash merge after target checks', async () => {
  const { client, thread, host, merge, reads, harness } = await reviewProject();
  expect(harness.runs[1]!.prompt).toContain('NEVER merge');
  expect((await view(client, thread.id)).delivery!.pullRequest).toMatchObject({ number: 123, state: 'open', headRevision: expect.any(String) });
  const home = app.home;
  await app.stop({ keepHome: true });
  const stored = JSON.parse(await readFile(join(home, 'threads.json'), 'utf8'));
  stored[0].delivery.requestedAt = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
  stored[0].delivery.continuationAttempts = 3;
  await writeFile(join(home, 'threads.json'), JSON.stringify(stored));
  const restarted = new FakeHarness();
  app = await startTestApp({ harness: restarted }, home);
  const next = await app.connect();
  await next.call('threads.checkDelivery', { threadId: thread.id });
  expect((await view(next, thread.id)).delivery!.status).toBe('ready');
  await merge(); host.checks = 'PENDING';
  await next.call('threads.checkDelivery', { threadId: thread.id });
  expect(await view(next, thread.id)).toMatchObject({ settledAt: null, delivery: { status: 'waiting', waitingOn: 'checks', pullRequest: { state: 'merged' }, integratedAt: expect.any(String) } });
  host.checks = 'SUCCESS';
  await next.call('threads.checkDelivery', { threadId: thread.id });
  expect(await view(next, thread.id)).toMatchObject({ settledAt: expect.any(String), delivery: { status: 'delivered', publishedRevision: host.mergeRevision }, workspace: { releasedAt: null } });
  expect(reads.filter(args => args[0] === 'pr' && args[1] === 'list')).toHaveLength(1);
  expect(restarted.runs).toHaveLength(0);
  await next.call('threads.checkDelivery', { threadId: thread.id });
  const receipts = (await next.call('threads.transcript', { threadId: thread.id })).filter(item => item.kind === 'notice' && item.id.endsWith(':completed'));
  expect(receipts).toHaveLength(0);
});

it('saves the PR before preparation checks finish and resumes preparation without another model turn', async () => {
  const { client, thread, host, harness } = await reviewProject('PENDING');
  expect((await view(client, thread.id)).delivery).toMatchObject({ status: 'waiting', waitingOn: 'checks', pullRequest: { number: 123, state: 'open' } });
  host.checks = 'SUCCESS';
  await client.call('threads.checkDelivery', { threadId: thread.id });
  expect((await view(client, thread.id)).delivery!.status).toBe('ready');
  expect(harness.runs).toHaveLength(2);
});

it('keeps a snoozed delivery parked, then settles it when the snooze expires without re-publishing', async () => {
  const { client, thread, merge, harness } = await reviewProject();
  await client.call('threads.snooze', { threadId: thread.id, until: new Date(Date.now() + 60_000).toISOString() });
  await merge();
  await client.call('threads.checkDelivery', { threadId: thread.id });
  expect(await view(client, thread.id)).toMatchObject({ settledAt: null, delivery: { status: 'delivered' } });
  await client.call('threads.snooze', { threadId: thread.id, until: new Date(Date.now() - 1000).toISOString() });
  await client.call('threads.checkDelivery', { threadId: thread.id });
  expect((await view(client, thread.id)).settledAt).not.toBeNull();
  expect(harness.runs).toHaveLength(2);
});

it('records a confirmed merge even when the owned worktree is missing, while refusing final delivery proof', async () => {
  const { client, thread, merge } = await reviewProject();
  await merge();
  await git(thread.workspace!.sourcePath, 'worktree', 'remove', '--', thread.workspace!.path);
  await client.call('threads.checkDelivery', { threadId: thread.id });
  expect(await view(client, thread.id)).toMatchObject({ settledAt: null, delivery: { status: 'blocked', pullRequest: { state: 'merged' }, detail: expect.stringContaining('worktree is unavailable') } });
});

it('retains the PR when automatic follow-ups stop, retries provider failures, and never reauthorizes the agent', async () => {
  const { client, thread, host, merge, harness } = await reviewProject();
  await client.call('threads.cancelDelivery', { threadId: thread.id });
  expect((await view(client, thread.id)).delivery).toMatchObject({ followUpsStoppedAt: expect.any(String), keepOpen: true, pullRequest: { number: 123 } });
  host.unavailable = true;
  await client.call('threads.checkDelivery', { threadId: thread.id });
  expect((await view(client, thread.id)).delivery).toMatchObject({ observationError: expect.stringContaining('unavailable'), pullRequest: { state: 'open' } });
  host.unavailable = false;
  await client.call('threads.checkDelivery', { threadId: thread.id });
  expect((await view(client, thread.id)).delivery).toMatchObject({ status: 'ready', observationFailures: 0 });
  expect((await view(client, thread.id)).delivery!.observationError).toBeUndefined();
  host.checks = 'FAILURE';
  await client.call('threads.checkDelivery', { threadId: thread.id });
  expect((await view(client, thread.id)).delivery!.status).toBe('blocked');
  expect(harness.runs).toHaveLength(2);
  await merge(); host.checks = 'SUCCESS';
  await client.call('threads.checkDelivery', { threadId: thread.id });
  expect(await view(client, thread.id)).toMatchObject({ settledAt: null, delivery: { status: 'delivered', followUpsStoppedAt: expect.any(String) } });
  expect(harness.runs).toHaveLength(2);
});

it.each(['closed', 'retargeted', 'changed head'] as const)('never treats a %s PR as delivered', async condition => {
  const { client, thread, host } = await reviewProject();
  if (condition === 'closed') host.state = 'CLOSED';
  if (condition === 'retargeted') host.base = 'other';
  if (condition === 'changed head') host.head = 'f'.repeat(40);
  await client.call('threads.checkDelivery', { threadId: thread.id });
  expect(await view(client, thread.id)).toMatchObject({ settledAt: null, delivery: { status: 'blocked' } });
  expect(await stat(thread.workspace!.path)).toBeDefined();
  if (condition === 'closed') {
    host.state = 'OPEN';
    await client.call('threads.checkDelivery', { threadId: thread.id });
    expect((await view(client, thread.id)).delivery!.status).toBe('ready');
  }
});

it('does not broadcast or retain automatic settlement when saving completion fails', async () => {
  const { client, thread, merge } = await reviewProject();
  await merge();
  const write = JsonFile.prototype.write;
  let failed = false;
  vi.spyOn(JsonFile.prototype, 'write').mockImplementation(function(value: any) {
    if (!failed && this.path === join(app.home, 'threads.json') && value.some((t: any) => t.delivery?.status === 'delivered')) {
      failed = true;
      return Promise.reject(new Error('disk full'));
    }
    return write.call(this, value);
  });
  client.events.length = 0;
  await expect(client.call('threads.checkDelivery', { threadId: thread.id })).rejects.toThrow('disk full');
  expect((await view(client, thread.id)).settledAt).toBeNull();
  expect(client.events.some(event => event.event === 'threads.changed' && (event.data as ThreadView[]).some(t => !!t.settledAt))).toBe(false);
  await client.call('threads.checkDelivery', { threadId: thread.id });
  expect((await view(client, thread.id)).settledAt).not.toBeNull();
});

it.each(['reopen', 'new work', 'stop follow-ups'] as const)('discards an in-flight completion after %s', async action => {
  const { client, thread, verifier, merge } = await reviewProject();
  await merge();
  const started = gate(); const release = gate();
  const implementation = verifier.getMockImplementation()!;
  verifier.mockImplementationOnce(async (workspace, delivery, observed?: DeliveryObservation) => {
    const result = await implementation(workspace, delivery, observed);
    started.release(); await release.opened;
    return result;
  });
  const check = client.call('threads.checkDelivery', { threadId: thread.id });
  try {
    await started.opened;
    if (action === 'reopen') await client.call('threads.reopen', { threadId: thread.id });
    if (action === 'new work') await client.call('threads.send', { threadId: thread.id, text: 'follow-up task' });
    if (action === 'stop follow-ups') await client.call('threads.cancelDelivery', { threadId: thread.id });
  } finally { release.release(); }
  await check;
  const current = await view(client, thread.id);
  expect(current.settledAt).toBeNull();
  expect(current.delivery!.status).not.toBe('delivered');
  if (action === 'new work') expect(current.workVersion).toBeGreaterThan(current.delivery!.workVersion!);
});
