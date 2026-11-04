import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Runs git in `cwd` without a shell and returns its trimmed output. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}

/** Like `git`, but null when git fails, for questions whose failure is an answer. */
export function maybeGit(cwd: string, ...args: string[]): Promise<string | null> {
  return git(cwd, ...args).catch(() => null);
}
