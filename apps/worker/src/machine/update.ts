import type { UpdateView } from '@accio/protocol';
import type { CommandRunner } from '../resources/process.js';
import { UserError } from '../rpc/router.js';
import type { AppScreenshot, DesktopHost } from './desktop.js';

export type UpdateDeps = {
  machineId: string;
  /** The checkout this machine's Accio runs from; undefined when it isn't one. */
  root?: string;
  host?: DesktopHost;
  run: CommandRunner;
  /** How to run pnpm here. */
  pnpm: { command: string; args: string[]; env?: NodeJS.ProcessEnv };
};

const FETCH_EVERY_MS = 30_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 15 * 60_000;
const LOG_TAIL = 2000;

/**
 * GLOSSARY: Update. Brings this machine's Accio to the latest `main`, in place in the
 * checkout it runs from, so starting it there by hand runs the same version. It only
 * fast-forwards a clean checkout of `main`; a failed install or build resets to the
 * previous commit and rebuilds it, and the app keeps running. A successful one restarts
 * the desktop app, whose interrupted turns continue by themselves.
 */
export class Updates {
  private current: UpdateView;
  private fetchedAt = 0;
  private busy = false;
  private failure?: string;
  private listeners = new Set<(view: UpdateView) => void>();

  constructor(private deps: UpdateDeps) {
    this.current = { machineId: deps.machineId, commit: null, state: 'unsupported', ...this.unsupported() };
  }

  onChange(listener: (view: UpdateView) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  view(): UpdateView { return this.current; }

  /** Checks origin/main again, at most every 30 seconds unless `fresh`. */
  async status({ fresh = false } = {}): Promise<UpdateView> {
    if (this.busy) return this.current;
    const { root } = this.deps;
    if (!root) return this.set({ commit: null, state: 'unsupported', ...this.unsupported() });
    const commit = await this.git('rev-parse', '--short', 'HEAD').catch(() => null);
    if (!this.deps.host) return this.set({ commit, state: 'unsupported', ...this.unsupported() });
    if (fresh || Date.now() - this.fetchedAt > FETCH_EVERY_MS) {
      try { await this.git('fetch', '--quiet', 'origin', 'main'); this.fetchedAt = Date.now(); }
      catch (error) { return this.set({ commit, state: 'blocked', detail: `Could not fetch origin/main: ${message(error)}` }); }
    }
    const branch = await this.git('rev-parse', '--abbrev-ref', 'HEAD');
    if (branch !== 'main') return this.set({ commit, state: 'blocked', detail: `Runs from branch ${branch}, not main.` });
    if (await this.git('status', '--porcelain', '--untracked-files=no')) return this.set({ commit, state: 'blocked', detail: 'The checkout has uncommitted changes.' });
    const ahead = Number(await this.git('rev-list', '--count', 'origin/main..HEAD'));
    if (ahead > 0) return this.set({ commit, state: 'blocked', detail: `The checkout has ${ahead} commit${ahead === 1 ? '' : 's'} that aren't on origin/main.` });
    const behind = Number(await this.git('rev-list', '--count', 'HEAD..origin/main'));
    if (this.failure) return this.set({ commit, state: 'failed', behind, detail: this.failure });
    return this.set(behind > 0 ? { commit, state: 'behind', behind } : { commit, state: 'current' });
  }

  /** Starts updating and answers at once; the update reports its progress through `onChange`. */
  async start(): Promise<UpdateView> {
    if (this.busy) return this.current;
    this.failure = undefined;
    const view = await this.status({ fresh: true });
    if (view.state === 'current') throw new UserError('Already on the latest main.');
    if (view.state !== 'behind') throw new UserError(view.detail ?? 'This machine can’t update itself.');
    this.busy = true;
    const started = this.set({ commit: view.commit, state: 'updating', detail: 'Pulling' });
    void this.apply(view.commit).catch((error) => console.error('[update] failed', error));
    return started;
  }

  /** A PNG of this machine's Accio window. */
  async screenshot(script?: string): Promise<AppScreenshot> {
    if (!this.deps.host) throw new UserError('Only the desktop app can take screenshots.');
    return this.deps.host.capture(script);
  }

  private async apply(commit: string | null) {
    const previous = await this.git('rev-parse', 'HEAD').catch((error) => { this.busy = false; throw error; });
    try {
      await this.git('merge', '--ff-only', 'origin/main');
      await this.build(await this.git('rev-parse', '--short', 'HEAD'));
    } catch (error) {
      this.failure = tail(message(error));
      this.set({ commit, state: 'updating', detail: 'Rolling back' });
      try {
        await this.git('reset', '--hard', previous);
        await this.build(commit);
      } catch (rollback) {
        this.failure = tail(`${this.failure}\n\nRolling back failed too: ${message(rollback)}`);
      }
      this.busy = false;
      await this.status().catch(() => this.set({ commit, state: 'failed', detail: this.failure }));
      return;
    }
    this.set({ commit: await this.git('rev-parse', '--short', 'HEAD'), state: 'restarting' });
    // Lets the change reach other machines before this one disconnects.
    await new Promise((resolve) => setTimeout(resolve, 500));
    this.deps.host!.relaunch();
  }

  private async build(commit: string | null) {
    this.set({ commit, state: 'updating', detail: 'Installing' });
    await this.pnpm(['install', '--frozen-lockfile'], INSTALL_TIMEOUT_MS);
    this.set({ commit, state: 'updating', detail: 'Building' });
    await this.pnpm(['build'], BUILD_TIMEOUT_MS);
  }

  private git(...args: string[]) { return this.deps.run('git', ['-C', this.deps.root!, ...args], { timeout: 60_000 }); }

  private pnpm(args: string[], timeout: number) {
    const { command, args: prefix, env } = this.deps.pnpm;
    return this.deps.run(command, [...prefix, ...args], { cwd: this.deps.root, env: env ?? process.env, timeout });
  }

  private unsupported() {
    return { detail: !this.deps.root ? 'Accio here doesn’t run from a git checkout.' : 'Only the desktop app can update itself.' };
  }

  private set(next: Omit<UpdateView, 'machineId'>): UpdateView {
    const view = { machineId: this.deps.machineId, ...next };
    const changed = JSON.stringify(view) !== JSON.stringify(this.current);
    this.current = view;
    if (changed) for (const listener of this.listeners) listener(view);
    return view;
  }
}

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
function tail(text: string) { return text.length > LOG_TAIL ? `…${text.slice(-LOG_TAIL)}` : text; }

/** pnpm as this process can start it without a shell: the script that started us, else the one on PATH. */
export function pnpmHere(env: NodeJS.ProcessEnv = process.env, platform = process.platform, execPath = process.execPath): UpdateDeps['pnpm'] {
  const script = env.npm_execpath;
  if (script && /pnpm/i.test(script) && /\.[cm]?js$/.test(script)) return { command: execPath, args: [script], env: { ...env, ELECTRON_RUN_AS_NODE: '1' } };
  return platform === 'win32' ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'pnpm'] } : { command: 'pnpm', args: [] };
}
