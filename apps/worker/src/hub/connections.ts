import { join } from 'node:path';
import { access } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { JsonFile } from '@accio/persistence';
import { hubAddress } from '@accio/hub';
import type { HubConnectionView } from '@accio/protocol';
import { Router, UserError } from '../rpc/router.js';
import { openWorkspace, type HubWorkspace, type SavedHub, type WorkspaceDeps } from './workspace.js';

export type { HubWorkspace, SavedHub } from './workspace.js';

/** One local workspace per hub: identical profile IDs cannot alias local work or configuration. */
export class HubConnections {
  readonly workspaces = new Map<string, HubWorkspace>();
  readonly global = new Router();
  readonly file: JsonFile<SavedHub[]>;
  saved: SavedHub[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private cacheTimer?: ReturnType<typeof setTimeout>;
  private closing = false;
  private asleep = false;
  constructor(private deps: WorkspaceDeps) {
    this.file = new JsonFile(join(deps.home, 'hub-connections.json'), () => []);
    this.register();
  }
  /** GLOSSARY: Snooze. Keeps this machine away from every hub while the system sleeps. */
  setAsleep(asleep: boolean) {
    this.asleep = asleep;
    for (const workspace of this.workspaces.values()) { workspace.client.setAsleep(asleep); workspace.relay.setAsleep(asleep); }
  }
  /** Reads the saved hubs; false when this home has never saved any. */
  async load() { const found = await access(this.file.path).then(() => true, () => false); this.saved = await this.file.read(); return found; }
  get defaultId() { return this.saved[0]?.id; }
  views(): HubConnectionView[] { return this.saved.map((record) => { const workspace = this.workspaces.get(record.id); return { id: record.id, name: record.name, url: record.url, local: record.local, status: workspace?.client.status ?? 'connecting', error: workspace?.client.error, running: workspace?.threads.runningCount ?? 0, ...(workspace?.client.snapshot?.version ? { version: workspace.client.snapshot.version } : {}) }; }); }
  private async persist() { await this.file.write(this.saved.map((s) => ({ ...s, snapshot: this.workspaces.get(s.id)?.client.snapshot ?? s.snapshot }))); }
  private announce = () => { if (this.closing) return; this.deps.send('hubs.changed', this.views()); clearTimeout(this.cacheTimer); this.cacheTimer = setTimeout(() => { void this.persist().catch(() => {}); }, 250); this.cacheTimer.unref(); };
  async add(record: SavedHub) {
    if (this.saved.some((s) => s.id === record.id)) throw new UserError('This hub is already saved. Select its existing connection.');
    this.saved.push(record);
    try { await this.open(record); await this.persist(); this.announce(); } catch (error) { this.saved = this.saved.filter((s) => s !== record); throw error; }
  }
  async open(record: SavedHub) {
    const workspace = await openWorkspace(record, this.deps, {
      global: this.global, asleep: () => this.asleep, closing: () => this.closing, changed: this.announce,
      toolsOrigin: record.id === this.defaultId ? this.deps.origin : `${this.deps.origin}/hubs/${record.id}`,
    });
    this.workspaces.set(record.id, workspace);
    this.announce();
    return workspace;
  }
  private register() {
    this.global.on('hubs.list', () => this.views())
      .on('hubs.pair', (params) => this.change(async () => {
        const url = hubAddress(params.url);
        const health = await fetch(url + '/healthz', { redirect: 'error', signal: AbortSignal.timeout(10_000) }).then((response) => response.json()) as any;
        if (this.saved.some((s) => s.id === health.hubId)) throw new UserError('This hub is already saved. Select its existing connection.');
        const response = await fetch(url + '/pair', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: params.code, machineId: this.deps.here.id }) });
        const result = await response.json() as any;
        if (!response.ok) throw new UserError(result.error ?? 'Could not pair with this hub');
        if (typeof result.hubId !== 'string' || !/^[\da-f-]{36}$/i.test(result.hubId) || typeof result.token !== 'string') throw new UserError('The address did not return a valid hub pairing');
        await this.add({ id: result.hubId, name: params.name, url, token: result.token, local: ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), home: join(this.deps.home, 'hubs', result.hubId) });
        return this.views().find((v) => v.id === result.hubId)!;
      }))
      .on('hubs.rename', ({ id, name }) => this.change(async () => { const record = this.require(id); record.name = name; await this.persist(); this.announce(); return this.views().find((v) => v.id === id)!; }))
      .on('hubs.createPairingCode', ({ id }) => this.workspace(id).client.call('hub.pairingCode'))
      .on('hubs.revokeMachine', ({ id, machineId }) => this.workspace(id).client.call('hub.revokeMachine', { machineId }))
      .on('hubs.remove', ({ id }) => this.change(async () => {
        const workspace = this.workspace(id);
        if (workspace.threads.runningCount || workspace.profiles.signIns.busy) throw new UserError('Finish or cancel this hub’s running work and sign-in before removing it.');
        await workspace.close(); this.workspaces.delete(id); this.saved = this.saved.filter((s) => s.id !== id); await this.persist(); this.announce(); return null;
      }));
  }
  private require(id: string) { const record = this.saved.find((s) => s.id === id); if (!record) throw new UserError('No such saved hub'); return record; }
  workspace(id: string) { const workspace = this.workspaces.get(id); if (!workspace) throw new UserError('This hub connection is unavailable'); return workspace; }
  router(id: string | null) { return this.workspaces.get(id ?? this.defaultId ?? '')?.router ?? this.global; }
  /** This machine's HTTP routes for a hub: `/hubs/<id>/…` for any hub, the default hub's without the prefix. */
  async serve(req: IncomingMessage, res: ServerResponse) {
    const original = req.url;
    const match = /^\/hubs\/([\da-f-]{36})(\/mcp|\/thread-assets\/[^?]+)(\?.*)?$/.exec(original ?? '');
    const workspace = match ? this.workspaces.get(match[1]!) : this.defaultId ? this.workspace(this.defaultId) : undefined;
    if (match && !workspace) { res.writeHead(404).end(); return true; }
    if (!workspace) return false;
    if (match) req.url = match[2]! + (match[3] ?? '');
    try { return await workspace.serve(req, res); } finally { req.url = original; }
  }
  private change<T>(fn: () => Promise<T>) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
  stopAccepting() { for (const workspace of this.workspaces.values()) workspace.profiles.stopAccepting(); }
  async close() { this.closing = true; this.stopAccepting(); clearTimeout(this.cacheTimer); await this.queue; await this.persist(); await Promise.all([...this.workspaces.values()].map((workspace) => workspace.close())); }
}
