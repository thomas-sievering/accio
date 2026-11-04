import { execFile, fork, spawn, type ChildProcess } from 'node:child_process';
import { appendFile, mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { CommitView, ProjectAppView, ProjectChangelog } from '@accio/protocol';
import { JsonFile } from '@accio/persistence';
import { git, maybeGit } from '../git.js';
import { samePath } from '../paths.js';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { cleanExecutionEnv } from '../threads/harnessEnv.js';
import { now } from '../time.js';
import { COMMIT_FORMAT, newRecord, parseCommits, readableLog, shouldAutoUpdate, startTarget, type AppRecord } from './projectApp.js';
import type { Projects } from './projects.js';

type Mode = 'start' | 'restart' | 'update' | 'auto';
type Runtime = {
  status: ProjectAppView['status'];
  error: string | null;
  child?: ChildProcess;
  setup?: ChildProcess;
  abort?: AbortController;
  startedAt: string | null;
  url: string | null;
  branch: string | null;
  available: CommitView | null;
  checkedAt: string | null;
  queue: Promise<void>;
  pending?: NodeJS.Timeout;
};
export type ProjectAppTiming = { pollMs: number; graceMs: number; debounceMs: number; setupTimeoutMs: number };
/** Fixture servers shorten these before starting the app. */
export const PROJECT_APP_TIMING: ProjectAppTiming = { pollMs: 60_000, graceMs: 20_000, debounceMs: 15_000, setupTimeoutMs: 30 * 60_000 };
const LOG_LIMIT = 1024 * 1024;

class Aborted extends Error {}

/**
 * GLOSSARY: Project app. Runs each project's app on this machine from its default branch,
 * in a detached worktree of its own under project-apps/, apart from every thread.
 * Only processes started here are stopped; nothing is stopped by name or port.
 */
export class ProjectApps {
  private file: JsonFile<Record<string, AppRecord>>;
  private records: Record<string, AppRecord> = {};
  private runtimes = new Map<string, Runtime>();
  private stopping = new WeakSet<ChildProcess>();
  private timer?: NodeJS.Timeout;
  private closing = false;
  private dir: string;

  constructor(home: string, private projects: Projects, private broadcast: Broadcast, private timing: ProjectAppTiming = { ...PROJECT_APP_TIMING }) {
    this.dir = join(home, 'project-apps');
    this.file = new JsonFile(join(home, 'project-apps.json'), () => ({}));
  }

  async load() {
    this.records = await this.file.read();
    // A restarted worker brings back what was running, updating first if it follows the branch.
    for (const [id, record] of Object.entries(this.records)) if (record.wanted) this.enqueue(id, () => this.bringUp(id, 'start'));
    this.timer = setInterval(() => this.poll(), this.timing.pollMs);
    this.timer.unref();
  }

  register(router: Router) {
    router
      .on('projectApps.get', () => this.views())
      .on('projectApps.start', ({ projectId }) => this.request(projectId, 'start'))
      .on('projectApps.restart', ({ projectId }) => this.request(projectId, 'restart'))
      .on('projectApps.update', ({ projectId }) => this.request(projectId, 'update'))
      .on('projectApps.stop', ({ projectId }) => this.stop(projectId))
      .on('projectApps.setAutoUpdate', async ({ projectId, on }) => {
        this.project(projectId);
        const record = this.record(projectId);
        record.autoUpdate = on;
        await this.save();
        if (on) this.scheduleAuto(projectId);
        else clearTimeout(this.runtime(projectId).pending);
        return this.emit(projectId);
      })
      .on('projectApps.logs', async ({ projectId }) => ({ text: await this.logs(projectId) }))
      .on('projects.changelog', ({ projectId }) => this.changelog(projectId));
  }

  views(): ProjectAppView[] {
    const ids = new Set([...Object.keys(this.records), ...this.runtimes.keys()]);
    return [...ids].filter((id) => this.projects.state().projects.some((p) => p.id === id)).map((id) => this.view(id));
  }

  async close() {
    this.closing = true;
    clearInterval(this.timer);
    for (const rt of this.runtimes.values()) {
      clearTimeout(rt.pending);
      rt.abort?.abort();
      if (rt.setup) killTree(rt.setup);
    }
    // Records keep `wanted`, so the next worker starts these apps again.
    await Promise.allSettled([...this.runtimes.keys()].map((id) => this.halt(id)));
    await this.file.idle();
  }

  private async request(projectId: string, mode: Mode): Promise<ProjectAppView> {
    const project = this.project(projectId);
    if (!project.startCommand) throw new UserError('Set a start command in project settings first.');
    this.source(projectId);
    const rt = this.runtime(projectId);
    if (rt.status === 'starting' || rt.status === 'updating' || rt.status === 'stopping') throw new UserError('The app is busy. Wait for it to finish.');
    const record = this.record(projectId);
    record.wanted = true;
    await this.save();
    rt.status = mode === 'update' ? 'updating' : 'starting';
    rt.error = null;
    this.enqueue(projectId, () => this.bringUp(projectId, mode));
    return this.emit(projectId);
  }

  private async stop(projectId: string): Promise<ProjectAppView> {
    this.project(projectId);
    const record = this.record(projectId);
    const rt = this.runtime(projectId);
    record.wanted = false;
    await this.save();
    clearTimeout(rt.pending);
    rt.abort?.abort();
    if (rt.setup) killTree(rt.setup);
    if (rt.status !== 'stopped') rt.status = 'stopping';
    this.enqueue(projectId, async () => {
      await this.halt(projectId);
      Object.assign(rt, { status: 'stopped', error: null, url: null, startedAt: null });
    });
    return this.emit(projectId);
  }

  /** Operations on one app run one at a time; failures land in its status, not in the caller. */
  private enqueue(projectId: string, work: () => Promise<void>) {
    const rt = this.runtime(projectId);
    rt.queue = rt.queue.then(work).catch((error) => console.error('[project app]', error)).finally(() => { if (!this.closing) this.emit(projectId); });
  }

  private async bringUp(projectId: string, mode: Mode) {
    if (this.closing) return;
    const rt = this.runtime(projectId);
    const record = this.record(projectId);
    if (!record.wanted) return;
    const abort = new AbortController();
    rt.abort = abort;
    const check = () => { if (abort.signal.aborted || this.closing) throw new Aborted(); };
    rt.status = mode === 'update' || mode === 'auto' ? 'updating' : 'starting';
    rt.error = null;
    this.emit(projectId);
    try {
      const project = this.project(projectId);
      if (!project.startCommand) throw new UserError('Set a start command in project settings first.');
      const path = await this.ensureCheckout(projectId);
      check();
      rt.branch ??= await defaultBranch(path);
      let tip: string | null = null;
      let target = record.commit?.sha ?? null;
      if (mode !== 'restart' || !target) {
        // Offline, Start still runs the commit it has.
        tip = await fetchTip(path, rt.branch).catch((error) => { if (mode === 'start' && target) return null; throw error; });
        target = mode === 'start' ? startTarget(record, tip) : tip;
      }
      check();
      if (!target) throw new UserError('Could not find a commit to run.');
      const previous = record.commit && record.commit.sha !== target ? record.commit : undefined;
      await this.log(projectId, `${previous ? 'Updating to' : 'Starting'} ${target.slice(0, 7)}`);
      await this.halt(projectId);
      try {
        await this.run(projectId, path, target, abort.signal);
        if (tip === target) delete record.failedUpdate;
      } catch (error) {
        if (error instanceof Aborted || !previous) throw error;
        const commit = await commitOf(path, target);
        record.failedUpdate = { commit, message: messageOf(error), at: now() };
        await this.log(projectId, `Update failed: ${messageOf(error)} Restoring ${previous.sha.slice(0, 7)}`);
        await this.halt(projectId);
        check();
        await this.run(projectId, path, previous.sha, abort.signal);
      }
      rt.available = tip && tip !== record.commit?.sha ? await commitOf(path, tip) : null;
      rt.checkedAt = tip ? now() : rt.checkedAt;
    } catch (error) {
      if (error instanceof Aborted) return;
      rt.status = 'failed';
      rt.error = messageOf(error);
      await this.log(projectId, `Failed: ${rt.error}`);
      await this.halt(projectId).catch(() => {});
    } finally {
      if (rt.abort === abort) rt.abort = undefined;
      await this.save();
    }
  }

  /** Check out a commit, set it up if needed and start it; resolves once it has kept running. */
  private async run(projectId: string, path: string, sha: string, signal: AbortSignal) {
    const rt = this.runtime(projectId);
    const record = this.record(projectId);
    const project = this.project(projectId);
    await git(path, 'checkout', '--quiet', '--force', '--detach', sha);
    record.commit = await commitOf(path, sha);
    this.emit(projectId);
    const setupKey = `${sha}\n${project.setupCommand ?? ''}`;
    if (project.setupCommand && record.setupKey !== setupKey) {
      delete record.setupKey;
      await this.setup(projectId, path, project.setupCommand, signal);
    }
    record.setupKey = setupKey;
    if (signal.aborted) throw new Aborted();
    rt.status = 'starting';
    this.emit(projectId);
    await this.launch(projectId, path, project.startCommand!, signal);
  }

  private async setup(projectId: string, path: string, command: string, signal: AbortSignal) {
    const rt = this.runtime(projectId);
    await this.log(projectId, `$ ${command}`);
    const log = await open(this.logPath(projectId), 'a');
    try {
      const child = spawn(command, { cwd: path, shell: true, windowsHide: true, detached: process.platform !== 'win32', env: appEnv(), stdio: ['ignore', log.fd, log.fd] });
      rt.setup = child;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { killTree(child); reject(new UserError('The setup command timed out.')); }, this.timing.setupTimeoutMs);
        const onAbort = () => killTree(child);
        signal.addEventListener('abort', onAbort, { once: true });
        child.once('error', () => reject(new UserError('Could not run the setup command.')));
        child.once('exit', (code) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) reject(new Aborted());
          else if (code === 0) resolve();
          else reject(new UserError(`The setup command exited with code ${code}.`));
        });
      });
    } finally {
      rt.setup = undefined;
      await log.close();
    }
  }

  private async launch(projectId: string, path: string, command: string, signal: AbortSignal) {
    const rt = this.runtime(projectId);
    const record = this.record(projectId);
    await this.log(projectId, `$ ${command}`);
    const port = record.port && await portFree(record.port) ? record.port : await freePort();
    record.port = port;
    const runner = new URL(import.meta.url.endsWith('.ts') ? '../threads/previewRunner.ts' : '../threads/previewRunner.js', import.meta.url);
    const child = fork(fileURLToPath(runner), [path, command, String(port), this.logPath(projectId)], {
      windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: runner.pathname.endsWith('.ts') ? ['--import', 'tsx'] : [],
      env: { ...appEnv(), PORT: String(port) },
    });
    let exit: string | number | null | undefined;
    let failure = '';
    child.on('message', (m: any) => { if (m && 'exited' in m) exit = m.exited; if (m?.error) failure = m.error; });
    child.on('error', () => { failure = 'Could not start the start command.'; });
    child.on('exit', () => {
      if (rt.child === child) rt.child = undefined;
      if (this.stopping.has(child) || this.closing || rt.status !== 'running') return;
      rt.status = 'exited';
      rt.url = null;
      rt.error = `The app exited${exit !== undefined && exit !== null ? ` with code ${exit}` : ''}.`;
      void this.log(projectId, rt.error);
      this.emit(projectId);
    });
    rt.child = child;
    rt.startedAt = now();
    rt.url = null;
    const url = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + this.timing.graceMs;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Aborted();
      if (failure || child.exitCode !== null || child.signalCode !== null) {
        await new Promise<void>((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', () => resolve())));
        throw new UserError(failure || `The start command exited${exit !== undefined && exit !== null ? ` with code ${exit}` : ''} before it was up.`);
      }
      if (await listening(port)) { rt.url = url; break; }
      await delay(250);
    }
    rt.status = 'running';
    rt.error = null;
    this.emit(projectId);
    // Slow apps get their Open button once they listen.
    if (!rt.url) void this.watchUrl(projectId, child, port);
  }

  private async watchUrl(projectId: string, child: ChildProcess, port: number) {
    const rt = this.runtime(projectId);
    for (let i = 0; i < 90 && rt.child === child && !this.closing; i++) {
      if (await listening(port)) { rt.url = `http://127.0.0.1:${port}`; this.emit(projectId); return; }
      await delay(2000);
    }
  }

  /** Stop the running process tree started here, if any. */
  private async halt(projectId: string) {
    const rt = this.runtime(projectId);
    const child = rt.child;
    rt.url = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) { rt.child = undefined; return; }
    this.stopping.add(child);
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    if (child.connected) child.send({ type: 'stop' });
    await Promise.race([exited, delay(10_000)]);
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await Promise.race([exited, delay(2000)]); }
    if (rt.child === child) rt.child = undefined;
  }

  /** Each poll fetches the branch; following it, a new tip updates the app shortly after. */
  private poll() {
    if (this.closing) return;
    for (const [id, record] of Object.entries(this.records)) {
      if (!record.wanted) continue;
      const rt = this.runtime(id);
      if (rt.status !== 'running' && rt.status !== 'exited') continue;
      this.enqueue(id, async () => {
        if (!record.wanted || !rt.branch) return;
        const path = join(this.dir, id);
        const tip = await fetchTip(path, rt.branch).catch(() => null);
        if (!tip) return;
        rt.checkedAt = now();
        rt.available = tip !== record.commit?.sha ? await commitOf(path, tip) : null;
        if (record.port && rt.child && !rt.url && await listening(record.port)) rt.url = `http://127.0.0.1:${record.port}`;
        this.scheduleAuto(id);
      });
    }
  }

  /** Wait a little before updating, so merges that land together restart the app once. */
  private scheduleAuto(projectId: string) {
    const rt = this.runtime(projectId);
    const record = this.record(projectId);
    if (rt.pending || !shouldAutoUpdate(record, rt.available?.sha ?? null)) return;
    rt.pending = setTimeout(() => {
      rt.pending = undefined;
      if (this.closing || rt.status === 'stopping' || rt.status === 'stopped') return;
      this.enqueue(projectId, () => this.bringUp(projectId, 'auto'));
    }, this.timing.debounceMs);
    rt.pending.unref();
  }

  /** The app's own detached worktree, created from this machine's checkout of the project. */
  private async ensureCheckout(projectId: string): Promise<string> {
    const path = join(this.dir, projectId);
    const top = await maybeGit(path, 'rev-parse', '--show-toplevel');
    if (top && samePath(top, path)) return path;
    const source = this.source(projectId).path;
    if (!await maybeGit(source, 'remote', 'get-url', 'origin')) throw new UserError('The project app follows origin’s default branch. Add an origin remote first.');
    const branch = await defaultBranch(source);
    const tip = await fetchTip(source, branch);
    await mkdir(this.dir, { recursive: true });
    await maybeGit(source, 'worktree', 'prune');
    try { await git(source, 'worktree', 'add', '--quiet', '--detach', '--', path, tip); }
    catch { throw new UserError(`Could not create the app’s checkout at ${path}. Remove that folder if it is left over, then try again.`); }
    return path;
  }

  private async changelog(projectId: string): Promise<ProjectChangelog> {
    this.project(projectId);
    const app = join(this.dir, projectId);
    const appTop = await maybeGit(app, 'rev-parse', '--show-toplevel');
    const cwd = appTop && samePath(appTop, app) ? app : this.source(projectId).path;
    const branch = await defaultBranch(cwd).catch(() => null);
    if (!branch) return { branch: null, commits: [] };
    const rt = this.runtimes.get(projectId);
    // A running app's poll keeps the branch fresh; otherwise read it now.
    if (!rt?.checkedAt || Date.now() - Date.parse(rt.checkedAt) > this.timing.pollMs * 2) await fetchTip(cwd, branch).catch(() => null);
    const log = await maybeGit(cwd, 'log', '--first-parent', '-n', '50', `--format=${COMMIT_FORMAT}`, `refs/remotes/origin/${branch}`);
    return { branch, commits: log ? parseCommits(log) : [] };
  }

  private async logs(projectId: string): Promise<string> {
    this.project(projectId);
    const file = await open(this.logPath(projectId), 'r').catch(() => null);
    if (!file) return '';
    try {
      const { size } = await file.stat();
      const length = Math.min(size, 64 * 1024);
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, size - length);
      return readableLog(buffer.toString('utf8'));
    } finally { await file.close(); }
  }

  private async log(projectId: string, line: string) {
    const path = this.logPath(projectId);
    await mkdir(this.dir, { recursive: true });
    const size = await stat(path).then((s) => s.size, () => 0);
    // Keep the newest part of a long log.
    if (size > LOG_LIMIT) await writeFile(path, (await readFile(path)).subarray(-LOG_LIMIT / 4));
    await appendFile(path, `\n── ${new Date().toLocaleString()} · ${line}\n`);
  }

  private view(projectId: string): ProjectAppView {
    const record = this.records[projectId] ?? newRecord();
    const rt = this.runtimes.get(projectId);
    return {
      projectId,
      status: rt?.status ?? (record.wanted ? 'starting' : 'stopped'),
      autoUpdate: record.autoUpdate,
      branch: rt?.branch ?? null,
      commit: record.commit ?? null,
      available: rt?.available ?? null,
      failedUpdate: record.failedUpdate ?? null,
      error: rt?.error ?? null,
      url: rt?.url ?? null,
      startedAt: rt?.startedAt ?? null,
      checkedAt: rt?.checkedAt ?? null,
    };
  }

  private emit(projectId: string): ProjectAppView {
    this.broadcast('projectApps.changed', this.views());
    return this.view(projectId);
  }

  private save() { return this.file.write(this.records); }
  private logPath(projectId: string) { return join(this.dir, `${projectId}.log`); }

  private record(projectId: string): AppRecord {
    return (this.records[projectId] ??= newRecord());
  }

  private runtime(projectId: string): Runtime {
    let rt = this.runtimes.get(projectId);
    if (!rt) {
      rt = { status: 'stopped', error: null, startedAt: null, url: null, branch: null, available: null, checkedAt: null, queue: Promise.resolve() };
      this.runtimes.set(projectId, rt);
    }
    return rt;
  }

  private project(projectId: string) {
    const project = this.projects.state().projects.find((p) => p.id === projectId);
    if (!project) throw new UserError('No such project');
    return project;
  }

  private source(projectId: string) {
    const checkout = this.projects.state().checkouts.find((c) => c.projectId === projectId);
    if (!checkout) throw new UserError('Add a checkout of this project on this machine first.');
    return checkout;
  }
}

async function defaultBranch(cwd: string): Promise<string> {
  const ref = await maybeGit(cwd, 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD');
  if (ref?.startsWith('refs/remotes/origin/')) return ref.slice('refs/remotes/origin/'.length);
  const remote = await maybeGit(cwd, 'ls-remote', '--symref', 'origin', 'HEAD');
  const branch = remote?.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1];
  if (!branch) throw new UserError('Could not find origin’s default branch.');
  await maybeGit(cwd, 'symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`);
  return branch;
}

async function fetchTip(cwd: string, branch: string): Promise<string> {
  const ref = `refs/remotes/origin/${branch}`;
  try { await git(cwd, 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin', `+refs/heads/${branch}:${ref}`); }
  catch { throw new UserError(`Could not fetch origin/${branch}. Check access to origin and try again.`); }
  return git(cwd, 'rev-parse', '--verify', `${ref}^{commit}`);
}

async function commitOf(cwd: string, sha: string): Promise<CommitView> {
  return parseCommits(await git(cwd, 'log', '-1', `--format=${COMMIT_FORMAT}`, sha))[0]!;
}

/** Like a terminal's environment: coding-account credentials and this worker's own settings stay out. */
function appEnv(): Record<string, string> {
  const env = cleanExecutionEnv(process.env);
  for (const key of Object.keys(env)) if (/^ACCIO_/i.test(key)) delete env[key];
  return env;
}

function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error); }

function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {});
  else try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (connected: boolean) => { socket.destroy(); resolve(connected); };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(300, () => finish(false));
  });
}

async function portFree(port: number): Promise<boolean> {
  const server = createServer();
  const ok = await new Promise<boolean>((resolve) => { server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => resolve(true)); });
  if (ok) await new Promise<void>((resolve) => server.close(() => resolve()));
  return ok;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
