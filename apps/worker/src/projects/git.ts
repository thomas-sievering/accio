import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { maybeGit } from '../git.js';
import { samePath } from '../paths.js';
import { UserError } from '../rpc/router.js';
import type { FolderFacts } from './project.js';
import { normalizeRemoteUrl, parseRemotes, repoKeyOf } from './repoIdentity.js';

const exec = promisify(execFile);
/** Cloning runs while the asking machine waits; a large repository can take minutes. */
export const CLONE_TIMEOUT_MS = 10 * 60_000;

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

/** The URL a checkout fetches its repository from, so another machine can clone it the same way. */
export async function remoteUrlOf(path: string, repoKey: string): Promise<string> {
  // As configured: `git remote -v` shows URLs after this machine's insteadOf rewrites.
  const urls = ((await maybeGit(path, 'config', '--get-regexp', '^remote\\..*\\.url$')) ?? '').split(/\r?\n/).map((line) => line.split(' ').slice(1).join(' '));
  return urls.find((url) => normalizeRemoteUrl(url) === repoKey) ?? `https://${repoKey}.git`;
}

/**
 * A folder holding a clone of the repository under `base`: an existing clone of it is reused,
 * otherwise it is cloned into the first free name. Never prompts for credentials.
 */
export async function cloneInto(base: string, repoKey: string, url: string): Promise<FolderFacts> {
  const name = repoKey.split('/').pop() || 'repository';
  for (let n = 1; n < 100; n++) {
    const path = join(base, n === 1 ? name : `${name}-${n}`);
    const existing = await stat(path).catch(() => null);
    if (existing) {
      const facts = existing.isDirectory() ? await inspectFolder(path).catch(() => null) : null;
      if (facts?.repoKey === repoKey && samePath(facts.root, path)) return facts;
      continue;
    }
    await mkdir(base, { recursive: true });
    try {
      await exec('git', ['clone', '--quiet', url, path], { windowsHide: true, timeout: CLONE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    } catch (error) {
      const lines = String((error as { stderr?: string }).stderr ?? '').trim().split(/\r?\n/);
      const detail = (lines.find((line) => line.startsWith('fatal:')) ?? lines.pop())?.replace(/^fatal:\s*/, '');
      throw new UserError(`Could not clone ${repoKey}${detail ? `: ${detail}` : '.'}`);
    }
    return { root: resolve(path), repoKey };
  }
  throw new UserError(`No free folder for ${name} in ${base}`);
}
