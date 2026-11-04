import WebSocket from 'ws';
import { DEFAULT_THREAD_NAMING } from '@accio/protocol';
import type { MachineHello, SharedSettings } from './sharedSettings.js';
import type { HubSnapshot } from './service.js';
import { HUB_PROTOCOL } from './service.js';

export function hubAddress(text: string): string {
  const url = new URL(text);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) throw new Error('Use an HTTPS hub address, or HTTP on localhost for development.');
  return url.origin;
}

/** Machine-side connection. Its credential never goes to a renderer or harness. */
export class HubClient {
  snapshot!: HubSnapshot;
  status: 'connected' | 'connecting' | 'offline' = 'connecting';
  error?: string;
  private ws?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private listeners = new Set<() => void>();
  private refreshPending?: Promise<void>;
  private sequence = 0;
  private appliedSequence = 0;
  private refreshAgain = false;
  constructor(readonly url: string, readonly id: string, private token: string, private hello: MachineHello) {}
  onChanged(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  private apply(snapshot: HubSnapshot, sequence: number) {
    if (this.stopped) return;
    if (snapshot.hubId !== this.id || snapshot.protocol !== HUB_PROTOCOL) throw new Error('The hub identity or protocol has changed. Check this saved connection before pairing again.');
    if (this.snapshot?.epoch === snapshot.epoch && snapshot.revision < this.snapshot.revision || this.snapshot?.epoch !== snapshot.epoch && sequence < this.appliedSequence) return;
    this.appliedSequence = Math.max(this.appliedSequence, sequence);
    this.snapshot = snapshot; this.status = 'connected'; this.error = undefined; this.changed();
  }
  async start() {
    try {
      const health = await this.http('/healthz', undefined, false);
      if (health.hubId !== this.id || health.protocol !== HUB_PROTOCOL) throw new Error('This address belongs to a different or incompatible hub.');
      await this.refresh(); await this.call('machine.hello', this.hello); this.events();
    } catch (error) { this.offline(error); this.schedule(); }
  }
  async call<T = any>(method: string, params: unknown = {}): Promise<T> {
    if (this.stopped) throw new Error('This hub connection is closed');
    try {
      const sequence = ++this.sequence;
      const reply = await this.http('/rpc', { method, params });
      this.apply(reply.snapshot, sequence); return reply.result as T;
    } catch (error) { if ((error as any).network || (error as any).status === 401) this.offline(error); throw error; }
  }
  async refresh(force = false): Promise<void> {
    if (force && this.refreshPending) await this.refreshPending.catch(() => {});
    if (this.refreshPending) { this.refreshAgain = true; return this.refreshPending; }
    const sequence = ++this.sequence;
    return this.refreshPending = this.http('/state').then((state) => this.apply(state, sequence)).finally(() => {
      this.refreshPending = undefined;
      if (this.refreshAgain && !this.stopped) { this.refreshAgain = false; void this.refresh().catch((error) => this.offline(error)); }
    });
  }
  private async http(path: string, body?: unknown, authenticated = true) {
    let response: Response;
    try { response = await fetch(this.url + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { ...(authenticated ? { authorization: `Bearer ${this.token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch { throw Object.assign(new Error('Hub is unavailable. Check its address and connection.'), { network: true }); }
    const data = await response.json() as any;
    if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : `Hub request failed (${response.status})`), { status: response.status });
    return data;
  }
  private events() {
    if (this.stopped) return;
    const url = new URL('/events', this.url); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${this.token}` }, handshakeTimeout: 10_000, maxPayload: 16_384 });
    this.ws = ws;
    ws.on('open', () => { void this.call('machine.hello', this.hello).catch((error) => this.offline(error)); });
    ws.on('message', () => { void this.refresh().catch((error) => this.offline(error)); });
    ws.on('error', () => {});
    ws.on('close', () => { if (this.ws === ws && !this.stopped) { this.offline(new Error('Hub connection lost. Reconnecting…')); this.schedule(); } });
  }
  private offline(error: unknown) { this.status = 'offline'; this.error = error instanceof Error ? error.message : 'Hub is unavailable'; this.changed(); }
  private schedule() { if (this.stopped || this.retry) return; this.retry = setTimeout(() => { this.retry = undefined; void this.start(); }, 2500); this.retry.unref(); }
  async close() { this.stopped = true; clearTimeout(this.retry); this.ws?.terminate(); }
}

export type SettingsAccess = Pick<SharedSettings, 'threadNaming' | 'setThreadNaming' | 'profiles' | 'machines' | 'machine' | 'modelFavorites' | 'setModelFavorite' | 'harnessTools' | 'setHarnessTools' | 'onMachinesChanged' | 'machineConnected' | 'machineDisconnected' | 'renameMachine' | 'setProfileFolders'> & { refresh?: () => Promise<void> };

/** Synchronous read views with writes committed by the hub over the connection. */
export function remoteSettings(client: HubClient): SettingsAccess {
  return {
    threadNaming: () => structuredClone(client.snapshot?.threadNaming ?? DEFAULT_THREAD_NAMING),
    setThreadNaming: async (settings) => { await client.call('threadNaming.save', settings); },
    refresh: () => client.refresh(true),
    profiles: () => client.snapshot?.profiles.map(({ id, name }) => ({ id, name })) ?? [],
    machines: () => client.snapshot?.machines ?? [],
    machine: (id) => client.snapshot?.machines.find((m) => m.id === id),
    modelFavorites: (id) => client.snapshot?.favorites[id] ?? [],
    onMachinesChanged: (listener) => client.onChanged(listener),
    harnessTools: () => client.snapshot?.harnessTools ?? {},
    setHarnessTools: async (harnessId, tools) => { await client.call('harnesses.setTools', { harnessId, tools }); },
    setModelFavorite: async (profileId, model, favorite) => { await client.call('models.favorite', { profileId, model, favorite }); },
    machineConnected: async (hello) => { await client.call('machine.hello', hello); },
    machineDisconnected: async () => {},
    renameMachine: async (machineId, name) => { await client.call('machines.rename', { machineId, name }); },
    setProfileFolders: async (machineId, profileId, folders) => { await client.call('machines.setProfileFolders', { machineId, profileId, folders }); },
  };
}
