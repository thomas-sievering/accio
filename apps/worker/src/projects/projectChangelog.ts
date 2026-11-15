import type { CommitView, ProjectChangelog } from '@accio/protocol';
import { git, maybeGit } from '../git.js';
import type { Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import type { Projects } from './projects.js';

/** git log format for parseCommits: commits split by record separators, fields by unit separators. */
export const COMMIT_FORMAT = '%H%x1f%s%x1f%an%x1f%aI%x1f%b%x1e';

/**
 * A GitHub merge commit reads as its pull request: the title GitHub puts in the body
 * replaces "Merge pull request #N from owner/branch".
 */
export function parseCommits(output: string): CommitView[] {
  return output.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
    const [sha = '', subject = '', author = '', at = '', body = ''] = record.split('\x1f');
    const merge = subject.match(/^Merge pull request #(\d+) from /);
    const title = body.trim().split('\n')[0]?.trim();
    return merge ? { sha, subject: title || subject, author, at, pullRequest: Number(merge[1]) } : { sha, subject, author, at };
  });
}

/** The project dashboard's Recently shipped: origin's default branch, fetched fresh from this machine's checkout. */
export function registerProjectChangelog(router: Router, projects: Projects) {
  router.on('projects.changelog', async ({ projectId }): Promise<ProjectChangelog> => {
    const state = projects.state();
    if (!state.projects.some((p) => p.id === projectId)) throw new UserError('No such project');
    const checkout = state.checkouts.find((c) => c.projectId === projectId);
    if (!checkout) throw new UserError('Add a checkout of this project on this machine first.');
    const cwd = checkout.path;
    const branch = await defaultBranch(cwd);
    if (!branch) return { branch: null, commits: [] };
    const ref = `refs/remotes/origin/${branch}`;
    await git(cwd, 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin', `+refs/heads/${branch}:${ref}`).catch(() => null);
    const log = await maybeGit(cwd, 'log', '--first-parent', '-n', '30', `--format=${COMMIT_FORMAT}`, ref);
    return { branch, commits: log ? parseCommits(log) : [] };
  });
}

async function defaultBranch(cwd: string): Promise<string | null> {
  const ref = await maybeGit(cwd, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD');
  if (ref?.startsWith('refs/remotes/origin/')) return ref.slice('refs/remotes/origin/'.length);
  const remote = await maybeGit(cwd, 'ls-remote', '--symref', 'origin', 'HEAD');
  const branch = remote?.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1];
  if (!branch) return null;
  await maybeGit(cwd, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`);
  return branch;
}
