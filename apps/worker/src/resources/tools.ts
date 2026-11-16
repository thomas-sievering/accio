import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { delimiter, join, resolve } from 'node:path';
import type { ResourceAccess } from '@accio/hub';
import type { ToolDefinition, ToolStatus } from '@accio/protocol';
import { pnpmCli, runCommand, type CommandRunner, type PnpmCommand } from './process.js';
import { inside } from '../paths.js';
import { now } from '../time.js';

/** What decides the installed files and the check; levels, name and description don't. */
export const installIdentity = (tool: ToolDefinition) => JSON.stringify([tool.id, tool.package, tool.version, tool.executable, tool.checkArgs]);

export class ManagedTools {
  /** The identity each CLI was last checked with here, so a hub change rechecks only what changed. */
  private seen = new Map<string, string>();
  private running = new Map<string, Promise<ToolStatus>>();
  private fingerprints = new Map<string, string>();
  private repairs = new Map<string, Promise<string>>();
  private closed = false;
  private jobs = new Set<Promise<unknown>>();
  constructor(private home: string, private machineId: string, private store: ResourceAccess, private announce: () => void,
    private repair: (tool: ToolDefinition, detail: string) => Promise<string>, private run: CommandRunner = runCommand, private pnpm: () => Promise<PnpmCommand> = () => pnpmCli()) {}
  folder(tool: ToolDefinition) { return join(this.home, 'tools', tool.id, `${tool.version}-${createHash('sha256').update(tool.package).digest('hex').slice(0, 12)}`); }
  bin(tool: ToolDefinition) { return join(this.folder(tool), 'node_modules', '.bin'); }
  env(tools: ToolDefinition[], base: Record<string, string>) {
    const env = { ...base };
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
    const original = Object.entries(base).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
    env.PATH = [...tools.map(t => this.bin(t)), original].join(delimiter); return env;
  }
  private async status(status: ToolStatus) { await this.store.setToolStatus(status); this.announce(); return status; }
  check(tool: ToolDefinition, install = true): Promise<ToolStatus> {
    if (this.closed) return Promise.reject(new Error('This machine is shutting down'));
    const fingerprint = installIdentity(tool);
    this.seen.set(tool.id, fingerprint);
    const existing = this.running.get(tool.id);
    if (existing) return this.fingerprints.get(tool.id) === fingerprint ? existing : existing.then(() => this.check(tool, install));
    const job = this.perform(tool, install).finally(() => { this.running.delete(tool.id); this.fingerprints.delete(tool.id); });
    this.fingerprints.set(tool.id, fingerprint);
    this.running.set(tool.id, job); this.jobs.add(job); void job.finally(() => this.jobs.delete(job)).catch(() => {}); return job;
  }
  private repairOnce(tool: ToolDefinition, detail: string) {
    const existing = this.repairs.get(tool.id); if (existing) return existing;
    const job = this.repair(tool, detail).finally(() => this.repairs.delete(tool.id));
    this.repairs.set(tool.id, job); return job;
  }
  private current(tool: ToolDefinition) { return this.store.state().tools.some(t => installIdentity(t) === installIdentity(tool)); }
  /**
   * Installs and checks every CLI that is new or changed since this machine last checked it, so
   * a CLI added on another machine is ready here before a thread needs it. Every CLI, whatever its
   * levels: a thread can move or hand off to this machine.
   */
  sync(tools: ToolDefinition[] = this.store.state().tools) {
    if (this.closed) return;
    for (const id of this.seen.keys()) if (!tools.some(t => t.id === id)) this.seen.delete(id);
    for (const tool of tools) if (this.seen.get(tool.id) !== installIdentity(tool)) void this.check(tool).catch(error => console.error('[tools] check failed', error));
  }
  /** Waits up to `ms` for running checks of these CLIs to finish. */
  async settled(ids: string[], ms: number) {
    const running = ids.flatMap(id => this.running.get(id) ?? []);
    if (!running.length) return;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.allSettled(running), new Promise(done => { timer = setTimeout(done, ms); timer.unref?.(); })]);
    clearTimeout(timer);
  }
  private async executable(tool: ToolDefinition): Promise<{ script: string; description?: string }> {
    const pkgFolder = join(this.folder(tool), 'node_modules', tool.package);
    const pkg = JSON.parse(await readFile(join(pkgFolder, 'package.json'), 'utf8'));
    if (pkg.version !== tool.version) throw new Error(`Installed version ${pkg.version ?? 'unknown'} does not match ${tool.version}`);
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[tool.executable];
    if (typeof bin !== 'string') throw new Error(`Package does not provide ${tool.executable}`);
    const script = resolve(pkgFolder, bin);
    if (!inside(pkgFolder, script)) throw new Error('Tool executable is outside its package');
    return { script, description: typeof pkg.description === 'string' ? pkg.description.slice(0, 1000) : undefined };
  }
  private async perform(tool: ToolDefinition, install: boolean): Promise<ToolStatus> {
    const base = { toolId: tool.id, machineId: this.machineId };
    const previous = this.store.state().toolStatuses.find(s => s.toolId === tool.id && s.machineId === this.machineId);
    await this.status({ ...base, status: 'installing', detail: install ? 'Installing and checking tool' : 'Checking tool' });
    try {
      let found: { script: string; description?: string };
      try { found = await this.executable(tool); } catch (error) {
        if (!install) throw error;
        await mkdir(this.folder(tool), { recursive: true });
        // One folder per machine and version, shared by every worktree. You chose the package, so its
        // install scripts run (pnpm skips them by default), as they would for a global install.
        const pnpm = await this.pnpm();
        await this.run(pnpm.command, [...pnpm.args, 'add', '--dir', this.folder(tool), '--ignore-workspace', '--config.dangerously-allow-all-builds=true', `${tool.package}@${tool.version}`], { env: pnpm.env, timeout: 300_000 });
        found = await this.executable(tool);
      }
      const { script, description } = found;
      const output = await this.run(process.execPath, [script, ...tool.checkArgs], { cwd: this.folder(tool), timeout: 30_000 });
      // A definition removed during installation must not reappear as ready.
      if (!this.current(tool)) return { ...base, status: 'pending' };
      return await this.status({ ...base, status: 'ready', version: tool.version, detail: output.slice(-4000), checkedAt: now(), ...(description ? { description } : {}) });
    } catch (error) {
      if (!this.current(tool)) return { ...base, status: 'pending' };
      const detail = error instanceof Error ? error.message : String(error);
      let status: ToolStatus = { ...base, status: 'error', detail, checkedAt: now(), repairThreadId: previous?.repairThreadId, repairError: previous?.repairError };
      if (!this.closed && !status.repairThreadId) {
        try { status.repairThreadId = await this.repairOnce(tool, detail); delete status.repairError; }
        catch (error) { status.repairError = error instanceof Error ? error.message : String(error); }
      }
      return this.status(status);
    }
  }
  async requestRepair(tool: ToolDefinition) {
    const previous = this.store.state().toolStatuses.find(s => s.toolId === tool.id && s.machineId === this.machineId);
    if (previous?.repairThreadId) return previous;
    const status: ToolStatus = previous ?? { toolId: tool.id, machineId: this.machineId, status: 'error', detail: 'Repair requested' };
    try { status.repairThreadId = await this.repairOnce(tool, status.detail ?? 'Repair requested'); delete status.repairError; }
    catch (error) { status.repairError = error instanceof Error ? error.message : String(error); }
    return this.status(status);
  }
  afterRepair(id: string) {
    const pending = this.running.get(id) ?? Promise.resolve();
    const job = pending.catch(() => {}).then(async () => {
      const tool = this.store.state().tools.find(t => t.id === id);
      if (!this.closed && tool) await this.check(tool, false);
    });
    this.jobs.add(job); void job.finally(() => this.jobs.delete(job)).catch(() => {});
  }
  async close() { this.closed = true; await Promise.allSettled([...this.jobs]); }
}
