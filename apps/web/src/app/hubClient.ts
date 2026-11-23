import { RELAY_CLIENT_READS, RELAY_CLIENT_THREAD_ACTIONS, type BrowserSharedState, type EventName, type Events, type MethodName, type ParamsOf, type ProjectView, type RelayFrame, type RelayHubFrame, type RelaySnapshot, type ResultOf } from '@accio/protocol';
import type { AppClient, ConnectionStatus } from './rpcClient';

const methods = new Set<string>([...RELAY_CLIENT_READS, ...RELAY_CLIENT_THREAD_ACTIONS]);
const cachePrefix = 'accio.browser-snapshot:';
type Pending = { machine: string; finish: (error?: string, result?: unknown) => void };

export async function loadBrowserState(signal: AbortSignal): Promise<BrowserSharedState> {
  const response = await fetch('/client/state', { cache: 'no-store', signal });
  if (!response.ok) throw new Error(response.status === 401 ? 'Pair this browser again.' : 'Could not load the hub.');
  return response.json();
}

function socket(path: string) {
  const url = new URL(path, location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(url);
}

function isSnapshot(value: unknown): value is RelaySnapshot {
  const snapshot = value as RelaySnapshot | undefined;
  return !!snapshot && Array.isArray(snapshot.threads) && Array.isArray(snapshot.projects) && Array.isArray(snapshot.checkouts)
    && typeof snapshot.version?.boot === 'string' && Number.isInteger(snapshot.version.seq);
}

/** The browser has no local machine. Only the list snapshot, not the transcript, is saved. */
export class HubClient implements AppClient {
  readonly browser = true;
  readonly hubId: string;
  status: ConnectionStatus = 'connecting';
  private relay = socket('/client/relay');
  private events = socket('/client/events');
  private lifetime = new AbortController();
  private refreshGeneration = 0;
  private online = new Set<string>();
  private snapshots = new Map<string, RelaySnapshot>();
  private pending = new Map<string, Pending>();
  private listeners = new Map<EventName, Set<(value: never) => void>>();
  private statuses = new Set<(status: ConnectionStatus) => void>();
  private chunks = new Map<string, { parts: string[]; size: number }>();

  constructor(private shared: BrowserSharedState) {
    this.hubId = shared.hubId;
    for (const { id } of shared.machines) {
      try {
        const value: unknown = JSON.parse(localStorage.getItem(this.cacheKey(id)) ?? 'null');
        if (isSnapshot(value)) this.snapshots.set(id, value);
      } catch { /* Storage is optional. */ }
    }
    this.relay.onmessage = ({ data }) => this.receive(String(data));
    this.relay.onclose = ({ code }) => {
      this.peers([]);
      if (code === 4001) {
        for (const id of this.snapshots.keys()) this.removeCache(id);
        this.snapshots.clear();
        this.publishLists();
        this.setStatus('unauthorized');
      } else this.setStatus('closed');
    };
    this.events.onmessage = () => void this.refresh();
  }

  private cacheKey(id: string) { return `${cachePrefix}${this.hubId}:${id}`; }
  private removeCache(id: string) {
    try { localStorage.removeItem(this.cacheKey(id)); } catch { /* Storage is optional. */ }
  }

  private async refresh() {
    const generation = ++this.refreshGeneration;
    const signal = this.lifetime.signal;
    const next = await loadBrowserState(signal).catch(() => undefined);
    if (!next || signal.aborted || generation !== this.refreshGeneration) return;
    this.shared = next;
    const paired = new Set(next.machines.map(({ id }) => id));
    for (const id of this.snapshots.keys()) if (!paired.has(id) && !this.online.has(id)) {
      this.snapshots.delete(id);
      this.removeCache(id);
    }
    this.emit('profiles.changed', next.profiles);
    this.emit('accounts.changed', next.accounts);
    this.emit('spaces.changed', next.spaces);
    this.emit('clients.changed', next.clients);
    this.emit('models.changed', null);
    this.publishLists();
  }

  private threads(): Events['threads.changed'] {
    return [...this.snapshots].flatMap(([id, snapshot]) => {
      const name = this.shared.machines.find((machine) => machine.id === id)?.name ?? 'Other machine';
      return snapshot.threads.map((thread) => {
        const project = snapshot.projects.find(({ id }) => id === thread.projectId);
        return { ...thread, projectId: project?.repoKey ?? thread.projectId, projectName: project?.name ?? thread.projectName,
          machine: { id, name, online: this.online.has(id) } };
      });
    });
  }

  private projects(): Events['projects.changed'] {
    const projects = new Map<string, ProjectView>();
    for (const snapshot of this.snapshots.values()) for (const project of snapshot.projects) {
      const id = project.repoKey ?? project.id;
      projects.set(id, { ...project, id });
    }
    for (const { repoKey, name, profileId } of this.shared.projects) projects.set(repoKey, { ...projects.get(repoKey), id: repoKey, repoKey, name, profileId });
    return { projects: [...projects.values()], checkouts: [] };
  }

  private machines(): Events['machines.changed'] {
    return this.shared.machines.map((machine) => {
      const snapshot = this.snapshots.get(machine.id);
      const connected = this.online.has(machine.id);
      const relay = connected && snapshot ? { repos: snapshot.projects.flatMap((project) =>
        project.repoKey && snapshot.checkouts.some((checkout) => checkout.projectId === project.id) ? [project.repoKey] : []) } : undefined;
      return { ...machine, thisMachine: false, profileFolders: {}, connected, relay };
    });
  }

  private publishLists() {
    this.emit('threads.changed', this.threads());
    this.emit('projects.changed', this.projects());
    this.emit('machines.changed', this.machines());
  }

  private store(machine: string, snapshot: unknown) {
    if (!this.online.has(machine) || !isSnapshot(snapshot)) return;
    const previous = this.snapshots.get(machine);
    if (previous?.version.boot === snapshot.version.boot && previous.version.seq >= snapshot.version.seq) return;
    this.snapshots.set(machine, snapshot);
    try { localStorage.setItem(this.cacheKey(machine), JSON.stringify(snapshot)); } catch { /* Quota or privacy settings. */ }
    this.publishLists();
  }

  private peers(machines: string[]) {
    const before = this.online;
    this.online = new Set(machines);
    for (const pending of this.pending.values()) if (!this.online.has(pending.machine)) pending.finish('This machine is offline.');
    this.publishLists();
    if (machines.some(machine => !before.has(machine))) this.emit('models.changed', null);
    for (const machine of machines) if (!before.has(machine)) {
      void this.request(machine, 'relay.snapshot', {}).then((snapshot) => this.store(machine, snapshot), () => {});
    }
  }

  private receive(text: string, stampedFrom?: string) {
    let frame: RelayFrame | RelayHubFrame;
    try { frame = JSON.parse(text); } catch { return; }
    if (!frame || typeof frame !== 'object') return;
    if (!stampedFrom && frame.from === 'hub') {
      if (frame.kind === 'peers') {
        this.peers(frame.machines);
        if (this.status === 'connecting') this.setStatus('open');
      }
      if (frame.kind === 'undeliverable') this.pending.get(frame.id)?.finish('This machine is offline.');
      return;
    }
    const from = stampedFrom ?? frame.from;
    if (!from || !this.online.has(from)) return;
    if (frame.kind === 'chunk' && !stampedFrom) {
      const key = `${from}:${frame.id}`;
      const entry = this.chunks.get(key) ?? { parts: [], size: 0 };
      if (frame.index !== entry.parts.length || frame.total > 256 || typeof frame.data !== 'string' || this.chunks.size >= 32 && !this.chunks.has(key)) return;
      entry.parts.push(frame.data);
      entry.size += frame.data.length;
      if (entry.size > 64 * 1024 * 1024) { this.chunks.delete(key); return; }
      if (entry.parts.length === frame.total) {
        this.chunks.delete(key);
        this.receive(entry.parts.join(''), from);
      } else this.chunks.set(key, entry);
    } else if (frame.kind === 'response') {
      const pending = this.pending.get(frame.id);
      if (pending?.machine === from) pending.finish(frame.ok ? undefined : frame.error, frame.ok ? frame.result : undefined);
    } else if (frame.kind === 'event') {
      if (frame.event === 'relay.snapshot') this.store(from, frame.data);
      if (frame.event === 'thread.item' || frame.event === 'thread.delta') {
        const value = frame.data as Events['thread.item'] | Events['thread.delta'];
        if (this.snapshots.get(from)?.threads.some(({ id }) => id === value?.threadId)) this.emit(frame.event, value);
      }
    }
  }

  private request(machine: string, method: string, params: unknown, timeout = 60_000): Promise<unknown> {
    if (!this.online.has(machine) || this.relay.readyState !== WebSocket.OPEN) return Promise.reject(new Error('This machine is offline.'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const finish = (error?: string, result?: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (error !== undefined) reject(new Error(error)); else resolve(result);
      };
      const timer = setTimeout(() => finish('The machine did not answer in time.'), timeout);
      this.pending.set(id, { machine, finish });
      this.relay.send(JSON.stringify({ kind: 'request', to: machine, id, method, params } satisfies RelayFrame));
    });
  }

  async call<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const local = {
      'threads.list': () => this.threads(), 'projects.get': () => this.projects(), 'machines.list': () => this.machines(),
      'profiles.list': () => this.shared.profiles, 'accounts.list': () => this.shared.accounts,
      'spaces.list': () => this.shared.spaces, 'clients.list': () => this.shared.clients,
      'accounts.limits': () => [], 'sortingHat.get': () => null,
      'resources.get': () => ({ tools: [], sources: [], skills: [], mcps: [], toolStatuses: [], skillVersions: [] } satisfies Events['resources.changed']),
    };
    if (Object.hasOwn(local, method)) return local[method as keyof typeof local]() as ResultOf<M>;
    if (method === 'clients.unpair') {
      const { clientId } = params as ParamsOf<'clients.unpair'>;
      const response = await fetch('/client/unpair', { method: 'POST', body: new URLSearchParams({ id: clientId }) });
      if (!response.ok) throw new Error('Could not unpair this browser.');
      return null as ResultOf<M>;
    }
    if (!methods.has(method)) throw new Error('This action is not available in the web app.');
    if (method === 'threads.start') {
      const { machineId, ...input } = params as ParamsOf<'threads.start'>;
      if (!machineId) throw new Error('Choose an online machine.');
      const thread = await this.request(machineId, method, input, 11 * 60_000) as ResultOf<'threads.start'>;
      const snapshot = this.snapshots.get(machineId) ?? { threads: [], projects: [], checkouts: [], version: { boot: '', seq: -1 } };
      if (!snapshot.threads.some(({ id }) => id === thread.id)) {
        const project = 'repoKey' in input ? this.shared.projects.find(({ repoKey }) => repoKey === input.repoKey) : undefined;
        const listed = project ? { ...thread, projectId: project.repoKey, projectName: project.name } : thread;
        this.snapshots.set(machineId, { ...snapshot, threads: [listed, ...snapshot.threads] });
        this.publishLists();
      }
      return thread as ResultOf<M>;
    }
    const { threadId } = params as { threadId?: string };
    const machine = threadId
      ? [...this.snapshots].find(([, snapshot]) => snapshot.threads.some(({ id }) => id === threadId))?.[0]
      : this.online.values().next().value;
    if (!machine) throw new Error('No machine is available.');
    return await this.request(machine, method, params) as ResultOf<M>;
  }

  httpUrl(path: string) { return new URL(path, location.href).href; }
  onEvent<E extends EventName>(event: E, listener: (data: Events[E]) => void) {
    const set = this.listeners.get(event) ?? new Set();
    this.listeners.set(event, set);
    set.add(listener);
    return () => { set.delete(listener); };
  }
  private emit<E extends EventName>(event: E, value: Events[E]) {
    for (const listener of this.listeners.get(event) ?? []) listener(value as never);
  }
  onStatus(listener: (status: ConnectionStatus) => void) {
    this.statuses.add(listener);
    return () => { this.statuses.delete(listener); };
  }
  private setStatus(status: ConnectionStatus) {
    this.status = status;
    for (const listener of this.statuses) listener(status);
  }
  close() {
    this.lifetime.abort();
    this.events.close();
    this.relay.close();
    this.chunks.clear();
    for (const pending of this.pending.values()) pending.finish('Connection closed.');
  }
}
