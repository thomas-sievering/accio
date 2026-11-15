import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { git } from '../git.js';

export type GitAuthor = { name: string; email: string };

/** Who commits in worker tests' disposable repositories. */
export const TEST_AUTHOR: GitAuthor = { name: 'Accio Test', email: 'accio@example.test' };
/** Who commits in the browser fixtures' disposable repositories. */
export const BROWSER_AUTHOR: GitAuthor = { name: 'Accio Browser Test', email: 'browser@example.test' };

export type RepoOptions = { author?: GitAuthor; message?: string };

async function setAuthor(folder: string, author: GitAuthor) {
  await git(folder, 'config', 'user.name', author.name);
  await git(folder, 'config', 'user.email', author.email);
}

/**
 * A disposable repository at `folder` (which must not exist yet) on `main`, whose one
 * commit holds `files`. Paths may name subfolders. Line endings are kept as written.
 */
export async function initRepo(folder: string, files: Record<string, string>, { author = TEST_AUTHOR, message = 'base' }: RepoOptions = {}) {
  await mkdir(folder);
  await git(folder, 'init', '--quiet', '-b', 'main');
  await setAuthor(folder, author);
  await git(folder, 'config', 'core.autocrlf', 'false');
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), content);
  }
  await git(folder, 'add', '.');
  await git(folder, 'commit', '--quiet', '-m', message);
}

/** Like `initRepo`, with `main` pushed to a new bare `origin` and tracked as its default branch. */
export async function initRepoWithOrigin(folder: string, origin: string, files: Record<string, string>, options: RepoOptions = {}) {
  await initRepo(folder, files, options);
  await git(dirname(origin), 'init', '--quiet', '--bare', '-b', 'main', origin);
  await git(folder, 'remote', 'add', 'origin', origin);
  await git(folder, 'push', '--quiet', '-u', 'origin', 'main');
  await git(folder, 'remote', 'set-head', 'origin', '-a');
}

/** A clone of `origin` at `folder` that can commit, as another machine pushing to it would. */
export async function cloneRepo(origin: string, folder: string, author: GitAuthor = TEST_AUTHOR) {
  await git(dirname(folder), 'clone', '--quiet', origin, folder);
  await setAuthor(folder, author);
}
