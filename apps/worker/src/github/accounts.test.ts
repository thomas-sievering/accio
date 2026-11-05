import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { git } from '../git.js';
import { GitHubAccounts, type GhRunner } from './accounts.js';

let dir: string | undefined;
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = undefined; });

const status = JSON.stringify({ hosts: { 'github.com': [
  { login: 'personal', active: true }, { login: 'work_hrc', active: false }, { login: 'personal', active: false },
] } });
/** gh as it answers on a machine signed in to both accounts. */
function fakeGh(): GhRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const run = vi.fn(async (args: string[]) => {
    calls.push(args);
    if (args[1] === 'status') return status;
    if (args[1] === 'token') return `token-of-${args.at(-1)}\n`;
    throw new Error(`unexpected gh ${args.join(' ')}`);
  });
  return Object.assign(run, { calls });
}
async function repo(origin: string) {
  dir = await mkdtemp(join(tmpdir(), 'accio-gh-'));
  await git(dir, 'init', '--quiet');
  await git(dir, 'remote', 'add', 'origin', origin);
  return dir;
}

it('lists gh’s signed-in logins once each, and none when gh is unavailable', async () => {
  expect(await new GitHubAccounts(() => undefined, fakeGh()).logins()).toEqual(['personal', 'work_hrc']);
  expect(await new GitHubAccounts(() => undefined, async () => { throw new Error('not installed'); }).logins()).toEqual([]);
  expect(await new GitHubAccounts(() => undefined, async () => 'not json').logins()).toEqual([]);
});

it('gives gh the token of the login chosen for the profile, without asking git', async () => {
  const gh = fakeGh();
  const gitUser = vi.fn();
  const accounts = new GitHubAccounts((id) => (id === 'work' ? 'work_hrc' : undefined), gh, gitUser);
  expect(await accounts.env('work', await repo('https://github.com/HRC-Campus-Apps/creaite.git'))).toEqual({ GH_TOKEN: 'token-of-work_hrc' });
  expect(gh.calls).toContainEqual(['auth', 'token', '--hostname', 'github.com', '--user', 'work_hrc']);
  expect(gitUser).not.toHaveBeenCalled();
});

it('otherwise uses the account git sends for the repository, when gh is signed in to it', async () => {
  const cwd = await repo('https://github.com/HRC-Campus-Apps/creaite.git');
  const gitUser = vi.fn(async () => 'work_hrc');
  expect(await new GitHubAccounts(() => undefined, fakeGh(), gitUser).env('personal', cwd)).toEqual({ GH_TOKEN: 'token-of-work_hrc' });
  expect(gitUser).toHaveBeenCalledWith(cwd, 'https://github.com/HRC-Campus-Apps/creaite.git');
  // A git user gh does not know leaves gh's active account.
  expect(await new GitHubAccounts(() => undefined, fakeGh(), async () => 'someone-else').env('personal', cwd)).toEqual({});
});

it('leaves gh alone for repositories outside GitHub over HTTPS, and when gh has no token', async () => {
  const gitUser = vi.fn(async () => 'work_hrc');
  expect(await new GitHubAccounts(() => undefined, fakeGh(), gitUser).env('personal', await repo('git@github.com:HRC-Campus-Apps/creaite.git'))).toEqual({});
  expect(gitUser).not.toHaveBeenCalled();
  expect(await new GitHubAccounts(() => undefined, fakeGh(), gitUser).env('personal')).toEqual({});
  const noToken = new GitHubAccounts(() => 'work_hrc', async (args) => { if (args[1] === 'token') throw new Error('no token'); return status; });
  expect(await noToken.env('work')).toEqual({});
});
