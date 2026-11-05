import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { JsonFile } from '@accio/persistence';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';
import { DeliveryGit, DeliveryUnavailable, type DeliveryObservation } from './delivery.js';
import { git } from '../git.js';
import type { GhRunner } from '../github/accounts.js';
import type { ThreadView } from '@accio/protocol';

vi.setConfig({ testTimeout: 25_000 });
let app: Awaited<ReturnType<typeof startTestApp>>;
afterEach(async () => { vi.restoreAllMocks(); await app?.stop(); });
// Ship requests read host routing; fixtures with a GitHub-shaped origin must not reach the real gh CLI.
beforeEach(() => { vi.spyOn(DeliveryGit.prototype, 'hostRoute').mockResolvedValue({}); });
const wait = (client: TestClient, id: string, check = (t: ThreadView) => t.status === 'idle') =>
  client.waitFor('threads.changed', ts => ts.some(t => t.id === id && check(t)), 15_000);
const view = async (client: TestClient, id: string) => (await client.call('threads.list', {})).find(t => t.id === id)!;

async function project(harness: FakeHarness, github?: GhRunner) {
  app = await startTestApp({ harness, ...(github ? { github } : {}) });
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

it.each(['direct', 'pull-request'] as const)('wakes the owning agent to fix failed target checks after %s publication', async policy => {
  let head = '';
  let publications = 0;
  let checks = 'PENDING';
  const harness = new FakeHarness(async function* (run) {
    if (run.prompt.startsWith('Deliver the current task')) {
      publications++;
      if (publications > 1) checks = 'SUCCESS';
      await writeFile(join(run.cwd, 'feature'), `published change ${publications}\n`);
      await git(run.cwd, 'add', '.');
      await git(run.cwd, 'commit', '--quiet', '-m', `publication ${publications}`);
      await git(run.cwd, 'push', '--quiet', 'origin', 'HEAD:main');
      head = await git(run.cwd, 'rev-parse', 'HEAD');
    }
    yield* replyWith('done');
  });
  const { client, checkout, source, origin } = await project(harness);
  await client.call('projects.setDelivery', { projectId: checkout.projectId, deliveryPolicy: policy, previewCommand: '' });
  await git(source, 'config', `url.${origin.replaceAll('\\', '/')}.insteadOf`, 'https://github.com/test/fixture.git');
  await git(source, 'remote', 'set-url', 'origin', 'https://github.com/test/fixture.git');
  const prReads: string[][] = [];
  const hosting = async (_cwd: string, args: string[]) => {
    if (args[0] === 'pr') {
      prReads.push(args);
      const pr = { url: `https://github.com/test/fixture/pull/${publications}`, state: 'MERGED', headRefOid: head,
        baseRefName: 'main', mergeCommit: { oid: head }, mergedAt: new Date().toISOString() };
      return args[1] === 'view' ? pr : [pr];
    }
    if (args[1]!.includes('check-runs')) return { total_count: 1, check_runs: [{ name: 'browser tests', status: checks === 'PENDING' ? 'in_progress' : 'completed',
      conclusion: checks === 'PENDING' ? null : checks, html_url: 'https://github.com/test/fixture/actions/runs/10' }] };
    return { total_count: 0, statuses: [] };
  };
  const manager = new DeliveryGit(app.home, hosting);
  const original = DeliveryGit.prototype.verify;
  vi.spyOn(DeliveryGit.prototype, 'verify').mockImplementation((workspace, delivery, observed) => original.call(manager, workspace, delivery, observed));
  const thread = await client.call('threads.start', { checkoutId: checkout.id, text: 'build feature' });
  await wait(client, thread.id);
  await client.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(client, thread.id, t => t.status === 'idle' && t.delivery?.status === 'waiting');
  const published = await view(client, thread.id);
  expect(published.delivery!.integratedAt).toEqual(expect.any(String));
  checks = 'FAILURE';
  await client.call('threads.checkDelivery', { threadId: thread.id });
  await wait(client, thread.id, t => t.status === 'idle' && t.delivery?.status === 'delivered');
  expect(publications).toBe(2);
  expect(harness.runs[2]!.cwd).toBe(thread.workspace!.path);
  expect(harness.runs[2]!.prompt).toContain(`Checks failed on published revision ${published.delivery!.publishedRevision}`);
  expect(harness.runs[2]!.prompt).toContain('browser tests (failure)');
  expect(harness.runs[2]!.prompt).toContain(policy === 'direct' ? 'normal, non-force push' : 'open a new PR');
  const repaired = await view(client, thread.id);
  expect(repaired.delivery).toMatchObject({ continuationAttempts: 1, publishedRevision: head, policy });
  expect(repaired.delivery!.publishedRevision).not.toBe(published.delivery!.publishedRevision);
  expect(await git(source, 'ls-remote', 'origin', 'refs/heads/main')).toContain(head);
  if (policy === 'pull-request') {
    expect(repaired.delivery!.pullRequest!.number).toBe(2);
    expect(prReads.map(args => args[1])).toEqual(['list', 'view', 'list']);
  }
});

it('explains failed target checks without escalating a merged review-only grant', async () => {
  const { client, thread, host, merge, harness } = await reviewProject();
  await merge();
  host.checks = 'FAILURE';
  await client.call('threads.checkDelivery', { threadId: thread.id });
  const blocked = await view(client, thread.id);
  expect(blocked.delivery).toMatchObject({ status: 'blocked', ci: { checks: [{ status: 'failure' }] } });
  expect(blocked.delivery!.detail).toContain('CI check (failure)');
  expect(blocked.delivery!.detail).toContain('review-only request does not authorize');
  expect(harness.runs).toHaveLength(2);
});

it('shows the shipped note in the thread and the Changelog, and settles the thread without waiting for it to be opened', async () => {
  const harness = new FakeHarness(async function* (run) {
    if (run.prompt.startsWith('Deliver the current task')) {
      await writeFile(join(run.cwd, 'feature'), 'published change\n');
      await git(run.cwd, 'add', '.');
      await git(run.cwd, 'commit', '--quiet', '-m', 'feature');
      const response = await fetch(run.tools!.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: run.tools!.authorization },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'shipped_note',
          arguments: { summary: 'Threads can be renamed in place', test: ['Double-click a title and type a new one'] } } }),
      });
      expect((await response.json() as { result: { isError?: boolean } }).result.isError).toBeFalsy();
      await git(run.cwd, 'push', '--quiet', 'origin', 'HEAD:main');
    }
    yield* replyWith('done');
  });
  const { client, checkout } = await project(harness);
  const thread = await client.call('threads.start', { checkoutId: checkout.id, text: 'work' });
  await wait(client, thread.id); client.events.length = 0;
  await client.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(client, thread.id, t => t.status === 'idle' && t.delivery?.status === 'delivered');
  const note = { summary: 'Threads can be renamed in place', test: ['Double-click a title and type a new one'] };
  const delivered = await view(client, thread.id);
  expect(delivered.settledAt).toEqual(expect.any(String));
  expect(delivered.delivery).toMatchObject({ note });
  const log = await client.call('changelog.list', {});
  expect(log).toEqual([expect.objectContaining({ threadId: thread.id, projectId: delivered.projectId, note, target: 'main', revision: expect.any(String) })]);
  const shipped = (await client.call('threads.transcript', { threadId: thread.id })).filter(item => item.kind === 'shipped');
  expect(shipped).toEqual([expect.objectContaining({ entry: log[0] })]);
  const home = app.home;
  await app.stop({ keepHome: true });
  app = await startTestApp({ harness: new FakeHarness() }, home);
  const next = await app.connect();
  expect(await next.call('changelog.list', {})).toEqual(log);
  expect((await next.call('threads.transcript', { threadId: thread.id })).filter(item => item.kind === 'shipped')).toHaveLength(1);
});

it('backfills the Changelog with deliveries verified before it existed, without adding to their threads', async () => {
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
  // Without a note, a delivery settles automatically as before.
  await wait(client, thread.id, t => t.status === 'idle' && !!t.settledAt);
  const home = app.home;
  await app.stop({ keepHome: true });
  const { rm } = await import('node:fs/promises');
  await rm(join(home, 'changelog.json'), { force: true });
  const path = join(home, 'transcripts', `${thread.id}.json`);
  await writeFile(path, JSON.stringify(JSON.parse(await readFile(path, 'utf8')).filter((item: any) => item.kind !== 'shipped')));
  app = await startTestApp({ harness: new FakeHarness() }, home);
  const next = await app.connect();
  expect(await next.call('changelog.list', {})).toEqual([expect.objectContaining({ threadId: thread.id, title: expect.any(String) })]);
  expect((await next.call('threads.transcript', { threadId: thread.id })).filter(item => item.kind === 'shipped')).toHaveLength(0);
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

const openPr = [{ number: 68, url: 'https://github.com/test/fixture/pull/68', state: 'OPEN', headRefOid: 'abc', baseRefName: 'main' }];
it.each([
  { name: 'an open PR opened outside Ship', prs: openPr, rules: [], classic: false, policy: 'pull-request', pr: 68 },
  { name: 'a merge-queue ruleset', prs: [], rules: [{ type: 'deletion' }, { type: 'merge_queue' }], classic: false, policy: 'pull-request' },
  { name: 'a required-checks ruleset', prs: [], rules: [{ type: 'required_status_checks' }], classic: false, policy: 'pull-request' },
  { name: 'classic branch protection', prs: [], rules: [], classic: true, policy: 'pull-request' },
  { name: 'an unprotected target', prs: [], rules: [{ type: 'non_fast_forward' }], classic: false, policy: 'direct' },
  { name: 'an unreadable host', prs: undefined, rules: undefined, classic: false, policy: 'direct' },
] as const)('routes a direct-policy Ship through a PR only for $name', async ({ prs, rules, classic, policy, ...expected }) => {
  const harness = new FakeHarness(async function* () { yield* replyWith('done'); });
  const { client, checkout, source, origin } = await project(harness);
  await client.call('projects.setDelivery', { projectId: checkout.projectId, deliveryPolicy: 'direct', previewCommand: '' });
  await git(source, 'config', `url.${origin.replaceAll('\\', '/')}.insteadOf`, 'https://github.com/test/fixture.git');
  await git(source, 'remote', 'set-url', 'origin', 'https://github.com/test/fixture.git');
  const reads: string[][] = [];
  const hosting = async (_cwd: string, args: string[]) => {
    reads.push(args);
    const answer = args[0] === 'pr' ? prs : args[1]!.includes('/rules/') ? rules : { protection: { enabled: classic } };
    if (answer === undefined) throw new DeliveryUnavailable('GitHub is unavailable');
    return answer;
  };
  const manager = new DeliveryGit(app.home, hosting);
  vi.mocked(DeliveryGit.prototype.hostRoute).mockRestore();
  const original = DeliveryGit.prototype.hostRoute;
  vi.spyOn(DeliveryGit.prototype, 'hostRoute').mockImplementation((workspace, base) => original.call(manager, workspace, base));
  vi.spyOn(DeliveryGit.prototype, 'verify').mockRejectedValue(new DeliveryUnavailable('Not observed in this test'));
  const thread = await client.call('threads.start', { checkoutId: checkout.id, text: 'build feature' });
  await wait(client, thread.id);
  await client.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(client, thread.id, t => t.status === 'idle' && t.delivery?.status !== 'queued' && !!t.delivery?.startedAt);
  const delivery = (await view(client, thread.id)).delivery!;
  expect(delivery.policy).toBe(policy);
  if ('pr' in expected) expect(delivery.pullRequest).toMatchObject({ number: expected.pr, state: 'open', repository: 'test/fixture', baseBranch: 'main' });
  else expect(delivery.pullRequest).toBeUndefined();
  expect(reads[0]).toEqual(expect.arrayContaining(['list', '--head', thread.workspace!.branch, '--state', 'open']));
  expect(harness.runs[1]!.prompt).toContain(policy === 'direct' ? 'Never rely on an admin or ruleset bypass' : 'open or update a pull request');
});

it('reads GitHub and runs the agent as the GitHub account chosen for the thread’s profile', async () => {
  const harness = new FakeHarness(async function* () { yield* replyWith('done'); });
  const gh: GhRunner = async (args) => {
    if (args[1] === 'status') return JSON.stringify({ hosts: { 'github.com': [{ login: 'me' }, { login: 'work_hrc' }] } });
    if (args[1] === 'token') return `token-of-${args.at(-1)}`;
    throw new Error('unexpected');
  };
  const { client, checkout, source, origin } = await project(harness, gh);
  await git(source, 'config', `url.${origin.replaceAll('\\', '/')}.insteadOf`, 'https://github.com/test/fixture.git');
  await git(source, 'remote', 'set-url', 'origin', 'https://github.com/test/fixture.git');
  const { id: machineId } = await client.call('machine.get', {});
  await client.call('machines.setProfileGitHub', { machineId, profileId: 'personal', login: 'work_hrc' });
  const envs: (Record<string, string> | undefined)[] = [];
  const manager = new DeliveryGit(app.home, async (_cwd, args, env) => { envs.push(env); return args[0] === 'pr' ? [] : []; });
  vi.mocked(DeliveryGit.prototype.hostRoute).mockRestore();
  const original = DeliveryGit.prototype.hostRoute;
  vi.spyOn(DeliveryGit.prototype, 'hostRoute').mockImplementation((workspace, base, env) => original.call(manager, workspace, base, env));
  vi.spyOn(DeliveryGit.prototype, 'verify').mockRejectedValue(new DeliveryUnavailable('Not observed in this test'));
  const thread = await client.call('threads.start', { checkoutId: checkout.id, text: 'build feature' });
  await wait(client, thread.id);
  expect(harness.runs[0]!.env.GH_TOKEN).toBe('token-of-work_hrc');
  await client.call('threads.deliver', { threadId: thread.id, mode: 'ship' });
  await wait(client, thread.id, t => t.status === 'idle' && !!t.delivery?.startedAt);
  expect(envs.length).toBeGreaterThan(0);
  expect(envs.every(env => env?.GH_TOKEN === 'token-of-work_hrc')).toBe(true);
  expect(harness.runs[1]!.env.GH_TOKEN).toBe('token-of-work_hrc');
});
