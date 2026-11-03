import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { DeliverySummary, ThreadDelivery, ThreadWorkspace } from '@accio/protocol';
import { UserError } from '../rpc/router.js';

const exec = promisify(execFile);
/** Waiting uses machine-side checks; a model is woken only when it has more work. */
export class DeliveryPending extends UserError {
  constructor(message: string, readonly continueAgent = false, readonly waitingOn: 'checks' | 'review' = 'checks') { super(message); }
}
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}
async function maybeGit(cwd: string, ...args: string[]) {
  return git(cwd, ...args).catch(() => null);
}

/** Git owns worktree removal; we never recursively delete a project or force a dirty checkout away. */
export class DeliveryGit {
  constructor(private home: string, private hostingJson = ghJson) {}

  async allocate(threadId: string, sourcePath: string, revision = 'HEAD'): Promise<ThreadWorkspace | undefined> {
    if (!await maybeGit(sourcePath, 'rev-parse', '--show-toplevel')) return undefined;
    const startRevision = await maybeGit(sourcePath, 'rev-parse', '--verify', `${revision}^{commit}`);
    // Empty repositories still support ordinary conversations; shipping needs a commit.
    if (!startRevision) return undefined;
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
    const diff = await maybeGit(workspace.path, 'diff', '--numstat', workspace.startRevision, '--');
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

  async verify(workspace: ThreadWorkspace, delivery: ThreadDelivery): Promise<ThreadDelivery> {
    if (await git(workspace.path, 'branch', '--show-current') !== workspace.branch) throw new UserError('The worktree’s branch changed. Restore its owned branch before delivery.');
    if (await git(workspace.path, 'status', '--porcelain', '--untracked-files=all')) throw new UserError('Uncommitted work remains. The workspace has been kept.');
    const revision = await git(workspace.path, 'rev-parse', 'HEAD');
    try { await git(workspace.path, 'fetch', '--quiet', 'origin', `refs/heads/${delivery.baseBranch}:refs/remotes/origin/${delivery.baseBranch}`); }
    catch { throw new UserError('Could not verify the latest target branch on origin. The workspace has been kept.'); }
    // An unchanged starting commit is not a publication by this thread, even
    // when it is already an ancestor of the target. Its old CI may never run.
    if (delivery.mode === 'ship' && revision === workspace.startRevision) throw new UserError('Nothing to ship: this thread has no new commits. The workspace has been kept.');
    const origin = await git(workspace.path, 'config', '--get', 'remote.origin.url');
    const slug = githubRepo(origin);
    let publishedRevision = revision;
    let pullRequestUrl = delivery.pullRequestUrl;
    if (delivery.mode === 'review' || delivery.policy === 'pull-request') {
      if (!slug) throw new UserError('PR verification currently requires a GitHub origin and authenticated gh CLI.');
      const prs = await this.hostingJson(workspace.path, ['pr', 'list', '--repo', slug, '--head', workspace.branch, '--state', 'all', '--json', 'url,state,headRefOid,baseRefName,isDraft,mergeCommit,statusCheckRollup,reviewDecision']);
      const pr = prs.find((p: any) => p.headRefOid === revision && p.baseRefName === delivery.baseBranch && (p.state === 'OPEN' || p.state === 'MERGED'));
      if (!pr) throw new UserError(delivery.mode === 'review' ? 'No PR for this revision is ready. The workspace has been kept.' : 'The PR has not merged this revision. The workspace has been kept.');
      if (pr.isDraft || pr.reviewDecision === 'CHANGES_REQUESTED') throw new DeliveryPending('The PR needs review changes. Continuing in the owning thread.', true);
      assertChecks(pr.statusCheckRollup ?? []);
      pullRequestUrl = pr.url;
      if (pr.state === 'OPEN') {
        await verifyGitHubChecks(workspace.path, slug, revision, delivery.requestedAt, this.hostingJson);
        if (delivery.mode === 'review') return { ...delivery, status: 'ready', revision, pullRequestUrl, detail: 'Ready for review. Workspace retained.' };
        if (pr.reviewDecision === 'REVIEW_REQUIRED') throw new DeliveryPending('Waiting for the required PR review.', false, 'review');
        throw new DeliveryPending('The PR is ready. Continuing the authorized merge in the owning thread.', true);
      }
      publishedRevision = pr.mergeCommit?.oid;
      if (!publishedRevision) throw new UserError('Could not verify the merged commit.');
    }
    if (await maybeGit(workspace.path, 'merge-base', '--is-ancestor', publishedRevision, `refs/remotes/origin/${delivery.baseBranch}`) === null) throw new UserError('This revision has not reached the target branch. The workspace has been kept.');
    if (slug) await verifyGitHubChecks(workspace.path, slug, publishedRevision, delivery.requestedAt, this.hostingJson);
    return { ...delivery, status: 'delivered', revision, publishedRevision, pullRequestUrl, detail: undefined };
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
async function ghJson(cwd: string, args: string[]): Promise<any> {
  try {
    const { stdout } = await exec('gh', args, { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch { throw new UserError('Could not verify GitHub delivery or checks. Sign in to gh on this machine and try Ship again.'); }
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
  assertChecks(checks.check_runs ?? []);
  assertChecks(statuses.statuses ?? []);
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

export function deliveryPrompt(workspace: ThreadWorkspace, delivery: ThreadDelivery) {
  const action = delivery.mode === 'review'
    ? 'Push the owned feature branch and open or update a pull request to the target branch. Prepare it for review, address automated feedback and checks, but NEVER merge, enable auto-merge or enter a merge queue.'
    : delivery.policy === 'pull-request'
      ? 'Push the owned feature branch, open or update a pull request, address feedback and required checks, then merge it when ready. Publication is authorized by this Ship request.'
      : 'Push the verified result directly to the target branch using a normal, non-force push. Publication is authorized by this Ship request.';
  return `Deliver the current task from this same thread. Work only in the owned worktree ${workspace.path}, branch ${workspace.branch}. Target: origin/${delivery.baseBranch}.\n\n` +
    (delivery.detail ? `Latest delivery update: ${delivery.detail}\n\n` : '') +
    'Finish any remaining implementation. Commit all intended changes, including uncommitted work; preserve unrelated or unpublished work. Fetch origin and integrate the latest target branch. Resolve mechanical conflicts; ask the user before resolving substantive conflicts. Never force push. If a shallow clone floods unrelated add/add conflicts, abort the rebase, unshallow origin, then retry.\n\n' +
    'Run the full project test suite and any behavior checks needed for this change before publishing. Reuse evidence only while the code and dependencies tested are unchanged. After integration or conflict resolution changes them, verify again. Ignore a failing check only after proving the same failure on the current target branch without these changes. If the target advances, integrate, verify and retry, at most three times.\n\n' + action + '\n\n' +
    'Report the published revision, tests and remaining blockers in this conversation. Do not archive the thread, delete the worktree, delete branches, or clean up another thread’s processes. Accio independently verifies delivery and owns cleanup. If blocked or awaiting a user decision, explain it and stop safely.';
}
