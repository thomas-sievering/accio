import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { DeliveryCI, DeliveryPullRequest, DeliverySummary, ThreadDelivery, ThreadWorkspace } from '@accio/protocol';
import { UserError } from '../rpc/router.js';
import { now } from '../time.js';
import { git, maybeGit } from '../git.js';
import { DELIVERY_STEP_INSTRUCTIONS } from './deliveryStep.js';

const exec = promisify(execFile);
/** Waiting uses machine-side checks; a model is woken only when it has more work. */
export class DeliveryPending extends UserError {
  constructor(message: string, readonly continueAgent = false, readonly waitingOn: 'checks' | 'review' | 'merge' = 'checks', readonly ci?: DeliveryCI) { super(message); }
}
/** Failed observations are retried without granting the agent more publication authority. */
export class DeliveryUnavailable extends UserError {}
export type DeliveryObservation = (patch: Partial<ThreadDelivery>) => Promise<void>;
export type DeliveryHosting = (cwd: string, args: string[]) => Promise<any>;
const PR_FIELDS = 'number,url,state,headRefOid,baseRefName,isDraft,mergeCommit,mergedAt,statusCheckRollup,reviewDecision,autoMergeRequest,mergeStateStatus,mergeable';

/** Git owns worktree removal; we never recursively delete a project or force a dirty checkout away. */
export class DeliveryGit {
  private reads = new Map<string, Promise<any>>();
  private bases = new Map<string, Promise<string>>();
  constructor(private home: string, private hostingJson: DeliveryHosting = ghJson) {}

  /** Concurrent observers of one project's PR share host reads, including failures. */
  private hosting = (cwd: string, args: string[]): Promise<any> => {
    const key = JSON.stringify([resolve(cwd), args]);
    const existing = this.reads.get(key);
    if (existing) return existing;
    const read = Promise.resolve().then(() => this.hostingJson(cwd, args)).finally(() => this.reads.delete(key));
    this.reads.set(key, read);
    return read;
  };

  /** Fetch once for concurrent starts; leave the source checkout's branch and files alone. */
  private async freshBase(sourcePath: string, localRevision: string): Promise<string> {
    if (!await maybeGit(sourcePath, 'remote', 'get-url', 'origin')) return localRevision;
    const key = resolve(sourcePath, await git(sourcePath, 'rev-parse', '--git-common-dir'));
    const existing = this.bases.get(key);
    if (existing) return existing;
    const read = (async () => {
      try {
        const remote = await git(sourcePath, 'ls-remote', '--symref', 'origin', 'HEAD');
        const branch = remote.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1];
        if (!branch) throw new Error('Origin has no default branch');
        const ref = `refs/remotes/origin/${branch}`;
        await git(sourcePath, 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin', `+refs/heads/${branch}:${ref}`);
        const revision = await git(sourcePath, 'rev-parse', '--verify', `${ref}^{commit}`);
        await git(sourcePath, 'symbolic-ref', 'refs/remotes/origin/HEAD', ref);
        return revision;
      } catch {
        throw new UserError('Could not fetch origin’s latest default branch. Check access to origin and retry. No thread was started.');
      }
    })().finally(() => this.bases.delete(key));
    this.bases.set(key, read);
    return read;
  }

  async allocate(threadId: string, sourcePath: string, revision?: string): Promise<ThreadWorkspace | undefined> {
    if (!await maybeGit(sourcePath, 'rev-parse', '--show-toplevel')) return undefined;
    let startRevision = await maybeGit(sourcePath, 'rev-parse', '--verify', `${revision ?? 'HEAD'}^{commit}`);
    // Empty repositories still support ordinary conversations; shipping needs a commit.
    if (!startRevision) return undefined;
    // Explicit revisions restore archived work; only a new thread chooses a fresh remote base.
    if (revision === undefined) startRevision = await this.freshBase(sourcePath, startRevision);
    const path = join(this.home, 'workspaces', threadId);
    const branch = `accio/${threadId}`;
    await mkdir(join(this.home, 'workspaces'), { recursive: true });
    try { await git(sourcePath, 'worktree', 'add', '--quiet', '-b', branch, '--', path, startRevision); }
    catch { throw new UserError('Could not create this thread’s worktree. Its existing files and branch have been preserved.'); }
    return { path, sourcePath, branch, startRevision, releasedAt: null };
  }

  async target(workspace: ThreadWorkspace): Promise<string> {
    if (!await maybeGit(workspace.path, 'remote', 'get-url', 'origin')) throw new UserError('Add an origin remote before shipping.');
    const ref = await maybeGit(workspace.path, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD');
    if (ref?.startsWith('refs/remotes/origin/')) return ref.slice('refs/remotes/origin/'.length);
    const remote = await maybeGit(workspace.path, 'ls-remote', '--symref', 'origin', 'HEAD');
    const branch = remote?.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1];
    if (!branch) throw new UserError('Could not determine origin’s default branch. Check access to origin.');
    return branch;
  }

  async summary(workspace?: ThreadWorkspace): Promise<DeliverySummary> {
    const empty = { available: false, added: 0, removed: 0, files: 0, previewAvailable: false };
    if (!workspace) return { ...empty, reason: 'Shipping needs an owned Git worktree. Start a new thread in a committed Git project.' };
    if (workspace.releasedAt) return empty;
    // After integrating the target, the start revision would count everyone else's merged work too.
    const target = await maybeGit(workspace.path, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD');
    const base = (target && await maybeGit(workspace.path, 'merge-base', 'HEAD', target)) || workspace.startRevision;
    const diff = await maybeGit(workspace.path, 'diff', '--numstat', base, '--');
    if (diff === null) return { ...empty, reason: 'The thread’s worktree is unavailable.' };
    const result = { ...empty };
    for (const line of diff.split('\n').filter(Boolean)) {
      const [add, del] = line.split('\t');
      result.added += Number(add) || 0;
      result.removed += Number(del) || 0;
      result.files++;
    }
    const untracked = await git(workspace.path, 'ls-files', '--others', '--exclude-standard', '-z');
    for (const name of untracked.split('\0').filter(Boolean)) {
      result.files++;
      const info = await lstat(join(workspace.path, name)).catch(() => null);
      if (!info?.isFile() || info.size >= 2_000_000) continue;
      const data = await readFile(join(workspace.path, name)).catch(() => null);
      if (data && data.length < 2_000_000 && !data.includes(0)) result.added += data.toString('utf8').split('\n').length - (data.at(-1) === 10 ? 1 : 0);
    }
    // No network requests while rendering a toolbar.
    const ref = await maybeGit(workspace.path, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD');
    const baseBranch = ref?.replace(/^refs\/remotes\/origin\//, '');
    const origin = await maybeGit(workspace.path, 'remote', 'get-url', 'origin');
    return { ...result, available: !!origin, baseBranch, ...(!origin ? { reason: 'Add an origin remote before shipping.' } : {}) };
  }

  async verify(workspace: ThreadWorkspace, delivery: ThreadDelivery, observed?: DeliveryObservation): Promise<ThreadDelivery> {
    let result = { ...delivery };
    const record = async (patch: Partial<ThreadDelivery>) => {
      result = { ...result, ...patch };
      await observed?.(patch);
    };
    const checkedAt = now();
    const origin = await maybeGit(workspace.sourcePath, 'config', '--get', 'remote.origin.url');
    const slug = origin ? githubRepo(origin) : undefined;
    const localRevision = await maybeGit(workspace.path, 'rev-parse', 'HEAD');
    const revision = delivery.status === 'running' ? localRevision : delivery.revision ?? localRevision;
    let pr: any;
    // Read a known PR even if its source branch/worktree disappeared. Host facts survive local errors.
    if (delivery.mode === 'review' || delivery.policy === 'pull-request') {
      if (!slug) throw new UserError('PR verification currently requires a GitHub origin and authenticated gh CLI.');
      const linked = delivery.pullRequest ?? pullRequestIdentity(delivery.pullRequestUrl);
      if (linked && linked.repository.toLowerCase() !== slug.toLowerCase()) throw new UserError('The PR repository no longer matches origin. Request Ship again.');
      if (linked) pr = await this.hosting(workspace.sourcePath, ['pr', 'view', String(linked.number), '--repo', slug, '--json', PR_FIELDS]);
      else {
        const prs = await this.hosting(workspace.sourcePath, ['pr', 'list', '--repo', slug, '--head', workspace.branch, '--state', 'all', '--json', PR_FIELDS]);
        pr = prs.find((p: any) => p.headRefOid === revision && p.baseRefName === delivery.baseBranch);
      }
      if (!pr) throw new UserError('No PR for this revision was found. The workspace has been kept.');
      const identity = pullRequestIdentity(pr.url);
      const state = String(pr.state).toLowerCase() as DeliveryPullRequest['state'];
      if (!identity || identity.repository.toLowerCase() !== slug.toLowerCase() || (linked && identity.number !== linked.number) || !['open', 'closed', 'merged'].includes(state)) throw new UserError('Could not verify the linked PR identity.');
      const pullRequest: DeliveryPullRequest = { ...identity, state, headRevision: pr.headRefOid, baseBranch: pr.baseRefName,
        ...(pr.mergeCommit?.oid ? { mergeRevision: pr.mergeCommit.oid } : {}), ...(pr.mergedAt ? { mergedAt: pr.mergedAt } : {}) };
      // Persist the link before readiness checks, including pending/failing check results.
      await record({ pullRequest, pullRequestUrl: pr.url, checkedAt, ...(revision ? { revision } : {}),
        ...(state === 'merged' ? { publishedRevision: pr.mergeCommit?.oid, integratedAt: pr.mergedAt ?? result.integratedAt ?? checkedAt } : {}) });
      if (pr.baseRefName !== delivery.baseBranch) throw new UserError('The PR targets a different branch. Request Ship again with the intended target.');
      if (state === 'closed') throw new UserError('The PR was closed without merging. The workspace has been kept.');
      if (!revision || pr.headRefOid !== revision) throw new UserError('The PR head changed after this revision was verified. Request Ship again to verify the new work.');
    }
    if (!localRevision) throw new UserError('The owned worktree is unavailable. Its delivery cannot be verified locally.');
    if (localRevision !== revision) throw new UserError('New commits need to be shipped before delivery can complete.');
    if (await git(workspace.path, 'branch', '--show-current') !== workspace.branch) throw new UserError('The worktree’s branch changed. Restore its owned branch before delivery.');
    if (await git(workspace.path, 'status', '--porcelain', '--untracked-files=all')) throw new UserError('Uncommitted work remains. The workspace has been kept.');
    if (delivery.mode === 'ship' && revision === workspace.startRevision) throw new UserError('Nothing to ship: this thread has no new commits. The workspace has been kept.');
    await record({ revision, checkedAt });
    let publishedRevision = revision;
    if (pr) {
      if (pr.state === 'OPEN') {
        if (pr.isDraft || pr.reviewDecision === 'CHANGES_REQUESTED') throw new DeliveryPending('The PR needs review changes. Continuing in the owning thread.', true, 'review');
        if (pr.mergeable === 'CONFLICTING') throw new DeliveryPending('The PR has conflicts. Continuing in the owning thread.', true, 'merge');
        await assertChecksWithProgress(workspace.sourcePath, slug!, revision, pr.statusCheckRollup ?? [], this.hosting);
        await verifyGitHubChecks(workspace.sourcePath, slug!, revision!, delivery.requestedAt, this.hosting);
        if (pr.reviewDecision === 'REVIEW_REQUIRED') throw new DeliveryPending('Waiting for the required PR review.', false, 'review');
        if (delivery.mode === 'review') return { ...result, ci: undefined, status: 'ready', waitingOn: 'merge', detail: undefined, observationError: undefined, observationFailures: 0 };
        if (pr.autoMergeRequest || pr.mergeStateStatus === 'QUEUED') throw new DeliveryPending('Waiting for the PR to merge.', false, 'merge');
        throw new DeliveryPending('The PR is ready. Continuing the authorized merge in the owning thread.', true, 'merge');
      }
      publishedRevision = pr.mergeCommit?.oid;
      if (!publishedRevision) throw new UserError('Could not verify the merged commit.');
    }
    try { await git(workspace.path, 'fetch', '--quiet', 'origin', `refs/heads/${delivery.baseBranch}:refs/remotes/origin/${delivery.baseBranch}`); }
    catch { throw new DeliveryUnavailable('Could not read the latest target branch on origin. Retrying without publishing again.'); }
    if (await maybeGit(workspace.path, 'merge-base', '--is-ancestor', publishedRevision, `refs/remotes/origin/${delivery.baseBranch}`) === null) throw new UserError('This revision has not reached the target branch. The workspace has been kept.');
    await record({ publishedRevision, integratedAt: result.integratedAt ?? checkedAt });
    if (slug) await verifyGitHubChecks(workspace.sourcePath, slug, publishedRevision, result.integratedAt ?? delivery.requestedAt, this.hosting);
    // Host reads can take time. Files or commits added meanwhile still belong to this thread.
    if (await git(workspace.path, 'rev-parse', 'HEAD') !== revision || await git(workspace.path, 'branch', '--show-current') !== workspace.branch
      || await git(workspace.path, 'status', '--porcelain', '--untracked-files=all')) throw new UserError('The worktree changed during delivery verification. Its new work has been kept.');
    return { ...result, ci: undefined, status: 'delivered', revision, publishedRevision, completedAt: result.completedAt ?? checkedAt, waitingOn: undefined, detail: undefined, observationError: undefined, observationFailures: 0 };
  }

  async release(threadId: string, workspace: ThreadWorkspace, revision: string) {
    const expected = resolve(this.home, 'workspaces', threadId);
    if (resolve(workspace.path) !== expected || workspace.branch !== `accio/${threadId}`) throw new UserError('This workspace is not owned by the thread.');
    const entries = (await git(workspace.sourcePath, 'worktree', 'list', '--porcelain', '-z')).split('\0\0').filter(Boolean).map(entry => {
      const fields = entry.split('\0');
      return { path: fields.find(f => f.startsWith('worktree '))?.slice(9), branch: fields.find(f => f.startsWith('branch '))?.slice(7) };
    });
    if (entries.some(e => e.branch === `refs/heads/${workspace.branch}` && e.path && resolve(e.path) !== expected)) throw new UserError('The owned branch is now checked out elsewhere. Its files have been preserved.');
    const exists = !!await lstat(workspace.path).catch(() => null);
    if (exists) {
      if (await git(workspace.path, 'rev-parse', 'HEAD') !== revision) throw new UserError('New commits need to be shipped before archiving.');
      if (await git(workspace.path, 'status', '--porcelain', '--untracked-files=all')) throw new UserError('Uncommitted work needs to be shipped before archiving.');
    }
    // Git refuses dirty/untracked work and locked worktrees. Never pass --force.
    try { if (exists || entries.some(e => e.path && resolve(e.path) === expected)) await git(workspace.sourcePath, 'worktree', 'remove', '--', workspace.path); }
    catch { throw new UserError('The worktree could not be released. Its files have been preserved.'); }
    // Compare-and-delete only the exact owned branch, never another writer's newer revision.
    if (await maybeGit(workspace.sourcePath, 'show-ref', '--verify', `refs/heads/${workspace.branch}`)) await git(workspace.sourcePath, 'update-ref', '-d', `refs/heads/${workspace.branch}`, revision);
  }
}

function githubRepo(origin: string) {
  return origin.match(/(?:github\.com[/:])([^/]+\/[^/]+?)(?:\.git)?\/?$/i)?.[1];
}
function pullRequestIdentity(url?: string): Pick<DeliveryPullRequest, 'host' | 'repository' | 'number' | 'url'> | undefined {
  const match = url?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9]\d*)\/?$/i);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return undefined;
  return { host: 'github.com', repository: match[1]!, number: Number(match[2]), url: url! };
}
async function ghJson(cwd: string, args: string[]): Promise<any> {
  try {
    const { stdout } = await exec('gh', args, { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch { throw new DeliveryUnavailable('Could not read GitHub delivery or checks. Check gh sign-in on this machine; observation will retry.'); }
}
function assertChecks(checks: any[]) {
  const conclusions = checks.map(c => String(c.conclusion ?? c.state).toLowerCase());
  if (conclusions.some(c => ['failure', 'error', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(c))) throw new DeliveryPending('Checks are failing. Continuing fixes in the owning thread.', true);
  if (conclusions.some(c => !['success', 'neutral', 'skipped'].includes(c))) throw new DeliveryPending('Waiting for checks to finish.');
}
async function verifyGitHubChecks(cwd: string, slug: string, revision: string, requestedAt: string, hostingJson: typeof ghJson) {
  const checks = await hostingJson(cwd, ['api', `repos/${slug}/commits/${revision}/check-runs?per_page=100`]);
  const statuses = await hostingJson(cwd, ['api', `repos/${slug}/commits/${revision}/status?per_page=100`]);
  if (checks.total_count > 100 || statuses.total_count > 100) throw new UserError('Too many checks to verify automatically. The workspace has been kept.');
  await assertChecksWithProgress(cwd, slug, revision, [...(checks.check_runs ?? []), ...(statuses.statuses ?? [])], hostingJson);
  if (!(checks.check_runs?.length || statuses.statuses?.length)) {
    const workflows = await hostingJson(cwd, ['api', `repos/${slug}/actions/workflows?per_page=100`]);
    if (workflows.workflows?.some((w: any) => w.state === 'active')) {
      // Active workflows may exclude this branch or its changed paths. Allow
      // registration time, but never infer that missing checks passed.
      if (Date.now() - Date.parse(requestedAt) < 2 * 60_000) throw new DeliveryPending('Waiting for GitHub to report checks for this revision.');
      throw new UserError('GitHub reported no checks for this revision within two minutes of the delivery request. Workflows may exclude its branch or changed paths. Run the applicable verification, then request delivery again. The workspace has been kept.');
    }
  }
}

/** Progress is optional evidence: a missing Actions permission must never change delivery decisions. */
async function assertChecksWithProgress(cwd: string, slug: string, revision: string, checks: any[], hostingJson: typeof ghJson) {
  try { assertChecks(checks); }
  catch (error) {
    if (!(error instanceof DeliveryPending) || error.continueAgent) throw error;
    const progress: DeliveryCI = { revision, updatedAt: now(), checks: [] };
    progress.checks = await Promise.all(checks.map(async check => {
      const status = String(check.conclusion || check.status || check.state || 'pending').toLowerCase();
      const url = check.html_url ?? check.detailsUrl ?? check.target_url ?? check.targetUrl;
      const entry: DeliveryCI['checks'][number] = { name: check.name ?? check.context ?? 'CI check', status, url };
      // Only fetch active Actions jobs, and only on this repository's GitHub URL.
      const job = typeof url === 'string' && url.startsWith(`https://github.com/${slug}/actions/runs/`)
        ? url.match(/\/job\/(\d+)(?:[/?#]|$)/)?.[1] : undefined;
      if (job && ['in_progress', 'queued', 'pending', 'waiting', 'requested'].includes(status)) {
        try {
          const data = await hostingJson(cwd, ['api', `repos/${slug}/actions/jobs/${job}`]);
          const steps = data.steps ?? [];
          const active = steps.findIndex((s: any) => s.status === 'in_progress');
          if (active >= 0) entry.step = { name: steps[active].name, current: active + 1, total: steps.length };
          if (data.status && !data.conclusion) entry.status = data.status;
        } catch { /* Keep the check-level state when Actions details are unavailable. */ }
      }
      return entry;
    }));
    throw new DeliveryPending(error.message, false, 'checks', progress);
  }
}

export function deliveryPrompt(workspace: ThreadWorkspace, delivery: ThreadDelivery) {
  const action = delivery.mode === 'review'
    ? 'Push the owned feature branch and open or update a pull request to the target branch. Prepare it for review, address automated feedback and checks, but NEVER merge, enable auto-merge or enter a merge queue.'
    : delivery.policy === 'pull-request'
      ? 'Push the owned feature branch, open or update a pull request, address feedback and required checks, then merge it when ready. Publication is authorized by this Ship request.'
      : 'Push the verified result directly to the target branch using a normal, non-force push. Publication is authorized by this Ship request.';
  return `Deliver the current task from this same thread. Work only in the owned worktree ${workspace.path}, branch ${workspace.branch}. Target: origin/${delivery.baseBranch}.\n\n` +
    (delivery.detail ? `Latest delivery update: ${delivery.detail}\n\n` : '') +
    'Finish any remaining implementation. Commit all intended changes, including uncommitted work; preserve unrelated or unpublished work. Fetch origin and integrate the latest target branch. Resolve mechanical conflicts; ask the user before resolving substantive conflicts. Never force push. If a shallow clone floods unrelated add/add conflicts, abort the rebase, unshallow origin, then retry.\n\n' +
    DELIVERY_STEP_INSTRUCTIONS + '\n\n' +
    'Run the full project test suite and any behavior checks needed for this change before publishing. Reuse evidence only while the code and dependencies tested are unchanged. After integration or conflict resolution changes them, verify again. Ignore a failing check only after proving the same failure on the current target branch without these changes. If the target advances, integrate, verify and retry, at most three times.\n\n' + action + '\n\n' +
    'Report the published revision, tests and remaining blockers in this conversation. Do not archive the thread, delete the worktree, delete branches, or clean up another thread’s processes. Accio independently verifies delivery and owns cleanup. If blocked or awaiting a user decision, explain it and stop safely.';
}
