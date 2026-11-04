import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { maybeGit } from '../git.js';
import { UserError } from '../rpc/router.js';
import type { FolderFacts } from './project.js';
import { parseRemotes, repoKeyOf } from './repoIdentity.js';

/** Reads a folder's repository root and identity from git. */
export async function inspectFolder(path: string): Promise<FolderFacts> {
  const folder = resolve(path);
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw new UserError(`${folder} is not a folder`);
  const top = await maybeGit(folder, 'rev-parse', '--show-toplevel');
  if (!top) return { root: folder, repoKey: null };
  const root = resolve(top);
  const remotes = await maybeGit(root, 'remote', '-v');
  return { root, repoKey: remotes ? repoKeyOf(parseRemotes(remotes)) : null };
}
