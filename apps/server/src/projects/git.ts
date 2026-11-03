import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { UserError } from '../rpc/router.js';
import type { FolderFacts } from './project.js';
import { parseRemotes, repoKeyOf } from './repoIdentity.js';

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], { windowsHide: true, timeout: 10_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Reads a folder's repository root and identity from git. */
export async function inspectFolder(path: string): Promise<FolderFacts> {
  const folder = resolve(path);
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw new UserError(`${folder} is not a folder`);
  const top = await git(folder, ['rev-parse', '--show-toplevel']);
  if (!top) return { root: folder, repoKey: null };
  const root = resolve(top);
  const remotes = await git(root, ['remote', '-v']);
  return { root, repoKey: remotes ? repoKeyOf(parseRemotes(remotes)) : null };
}
