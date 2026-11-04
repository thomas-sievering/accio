import { execFile, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { DeliveryStepName, ShippedNote, ThreadWorkspace } from '@accio/protocol';
import { UserError } from '../rpc/router.js';

const exec = promisify(execFile);

/**
 * GLOSSARY: Scripted ship. Ship's mechanical steps, run by accio without a model turn:
 * commit, integrate the target branch, run the project's test command, push. The first
 * step that needs judgment hands over to the delivery turn with what happened.
 */
export type ScriptedShip = {
  workspace: ThreadWorkspace;
  baseBranch: string;
  testCommand: string;
  /** For the test command: the worker's clean environment with its own accio state. */
  env: Record<string, string>;
  signal: AbortSignal;
  report: (step: DeliveryStepName, note?: string) => Promise<void>;
  /** A commit message and shipped note from a lightweight model; undefined falls back to `fallbackMessage`. */
  describe: (files: string) => Promise<{ message: string; note?: ShippedNote } | undefined>;
  fallbackMessage: string;
  note: (note: ShippedNote) => Promise<void>;
};

export type ScriptedShipResult = { kind: 'published' } | { kind: 'handover'; detail: string };

export const PUSH_ATTEMPTS = 3;
const TEST_TIMEOUT = 30 * 60_000;
const OUTPUT_TAIL = 3000;

export async function scriptedShip(run: ScriptedShip): Promise<ScriptedShipResult> {
  const { path } = run.workspace;
  // An interrupted rebase may hold someone's conflict resolution; leave it to the agent.
  if (await rebasing(path)) return { kind: 'handover', detail: 'A rebase is in progress in the worktree. Finish or abort it before shipping.' };
  try { return await steps(run); }
  catch (error) {
    // Stop mid-rebase leaves the worktree on the thread's commit, as a conflict does.
    if (run.signal.aborted && await rebasing(path)) await gitIn(path, new AbortController().signal, 'rebase', '--abort').catch(() => {});
    throw error;
  }
}

async function rebasing(path: string): Promise<boolean> {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const dir = await gitIn(path, new AbortController().signal, 'rev-parse', '--path-format=absolute', '--git-path', name).catch(() => '');
    if (dir && await stat(dir).then(() => true, () => false)) return true;
  }
  return false;
}

async function steps(run: ScriptedShip): Promise<ScriptedShipResult> {
  const { workspace: { path }, baseBranch, signal } = run;
  const target = `refs/remotes/origin/${baseBranch}`;
  const git = (...args: string[]) => gitIn(path, signal, ...args);

  await run.report('commit', 'Committing the thread’s work');
  await git('add', '-A');
  const base = await git('merge-base', 'HEAD', target).catch(() => run.workspace.startRevision);
  const files = await git('diff', '--cached', '--stat', base);
  const staged = await git('diff', '--cached', '--quiet').then(() => false, () => true);
  const described = files ? await run.describe(files).catch(() => undefined) : undefined;
  if (described?.note) await run.note(described.note);
  if (staged) {
    try { await git('commit', '--quiet', '-m', described?.message || run.fallbackMessage); }
    catch (error) { return { kind: 'handover', detail: `Committing failed: ${tail(errorText(error))}` }; }
  }
  if (await git('rev-parse', 'HEAD') === run.workspace.startRevision) throw new UserError('Nothing to ship: this thread has no new commits. The workspace has been kept.');

  let tested: string | undefined;
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    await run.report('integrate', `Rebasing onto the latest ${baseBranch}`);
    try { await git('fetch', '--quiet', 'origin', `refs/heads/${baseBranch}:${target}`); }
    catch (error) { throw new UserError(`Could not fetch ${baseBranch} from origin: ${tail(errorText(error), 500)}`); }
    try { await git('rebase', '--quiet', target); }
    catch (error) {
      signal.throwIfAborted();
      const conflicts = (await git('diff', '--name-only', '--diff-filter=U').catch(() => '')).split('\n').filter(Boolean);
      await git('rebase', '--abort').catch(() => {});
      return { kind: 'handover', detail: conflicts.length
        ? `Rebasing onto ${baseBranch} conflicted in ${conflicts.join(', ')}. The rebase was aborted; the worktree is clean on the thread’s commit.`
        : `Rebasing onto ${baseBranch} failed: ${tail(errorText(error), 500)}` };
    }

    const revision = await git('rev-parse', 'HEAD');
    if (revision !== tested) {
      await run.report('verify', `Running ${run.testCommand}`);
      let result = await runCommand(run.testCommand, path, run.env, signal);
      if (!result.ok) {
        await run.report('verify', `Rerunning ${run.testCommand} once`);
        result = await runCommand(run.testCommand, path, run.env, signal);
      }
      if (!result.ok) return { kind: 'handover', detail: `\`${run.testCommand}\` failed twice on the rebased revision ${revision.slice(0, 7)}. Output tail:\n${tail(result.output)}` };
      tested = revision;
    }

    signal.throwIfAborted();
    await run.report('publish', `Pushing to ${baseBranch}`);
    try {
      // Never cut a push short: it may already have reached origin. Cancel is refused from here on.
      await gitIn(path, new AbortController().signal, 'push', '--quiet', 'origin', `HEAD:refs/heads/${baseBranch}`);
      return { kind: 'published' };
    } catch (error) {
      const text = errorText(error);
      if (!/\[rejected\]|non-fast-forward|fetch first/i.test(text)) throw new UserError(`Pushing to ${baseBranch} failed: ${tail(text, 500)}`);
    }
  }
  return { kind: 'handover', detail: `${baseBranch} moved during each of ${PUSH_ATTEMPTS} push attempts. The worktree holds the last tested commit.` };
}

async function gitIn(cwd: string, signal: AbortSignal, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], { windowsHide: true, timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024, signal });
  return stdout.trim();
}

/** Runs the project's command in a shell; Stop or a timeout kills its whole process tree. */
export function runCommand(command: string, cwd: string, env: Record<string, string>, signal: AbortSignal, timeout = TEST_TIMEOUT): Promise<{ ok: boolean; output: string }> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, env, shell: true, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    const keep = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-4 * OUTPUT_TAIL); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const kill = () => {
      if (!child.pid || child.exitCode !== null) return;
      if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
      else try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already gone. */ }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    signal.addEventListener('abort', kill, { once: true });
    child.on('error', error => { output += `\n${error.message}`; });
    child.on('close', code => {
      clearTimeout(timer);
      signal.removeEventListener('abort', kill);
      if (signal.aborted) reject(signal.reason);
      else resolve({ ok: code === 0 && !timedOut, output: timedOut ? `${output}\nTimed out after ${Math.round(timeout / 60_000)} minutes.` : output });
    });
  });
}

function errorText(error: unknown): string {
  const e = error as { stderr?: string; stdout?: string; message?: string };
  return [e.stderr, e.stdout].filter(Boolean).join('\n').trim() || e.message || String(error);
}

function tail(text: string, max = OUTPUT_TAIL): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `…${trimmed.slice(-max)}`;
}
