import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';
import { RelaySocket, type RelayRequest } from '@accio/hub';
import { RELAY_THREAD_METHODS, type Events, type ProjectsState, type RelaySnapshot, type ThreadView } from '@accio/protocol';
import { UserError, type Router } from '../rpc/router.js';

const RELAY_METHODS = new Set<string>(RELAY_THREAD_METHODS);
/** Transcripts another machine streams from here at once; the oldest stops when it opens another. */
const OBSERVED_PER_PEER = 16;

export type RelayDeps = {
  here: string;
  threads: () => ThreadView[];
  projects: () => ProjectsState;
  /** This machine's router, which serves requests from the others. */
  router: () => Router;
  /** The hub's name for a paired machine; undefined once it is unpaired. */
  machineName: (id: string) => string | undefined;
  /** To this hub's clients on this machine. */
  send: <E extends keyof Events>(event: E, data: Events[E]) => void;
};

type Cache = { machines: Record<string, RelaySnapshot> };

/**
 * GLOSSARY: Relay. Shows other machines' threads beside this machine's and sends
 * actions on them to the machine that owns them, through the hub. Their threads
 * are never copied: only the last thread list of each machine is cached, so its
 * threads stay listed, read-only, while it is offline.
 */
export class Relay {
  private socket?: RelaySocket;
  private online = new Set<string>();
  private remote = new Map<string, RelaySnapshot>();
  private owners = new Map<string, string>();
  /** Peer → threads it streams from here, oldest first. */
  private observers = new Map<string, string[]>();
  /** Remote threads clients here observe, so they observe again after their machine reconnects. */
  private observed = new Map<string, string>();
  private file: JsonFile<Cache>;
  private boot = randomUUID();
  private seq = 0;
  private pushTimer?: ReturnType<typeof setTimeout>;
  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor(home: string, private deps: RelayDeps) {
    this.file = new JsonFile(join(home, 'relay-cache.json'), () => ({ machines: {} }));
  }

  async load() {
    const cache = await this.file.read().catch(() => ({ machines: {} }) as Cache);
    for (const [id, snapshot] of Object.entries(cache.machines ?? {})) if (id !== this.deps.here) this.remote.set(id, snapshot);
    this.index();
  }

  start(url: string, token: string) {
    this.socket = new RelaySocket(url, token, {
      request: (request) => this.serve(request),
      event: (from, event, data) => this.receive(from, event, data),
      peers: (machines) => this.peers(machines),
      disconnected: () => this.peers([]),
    });
    this.socket.start();
  }

  /** This machine's threads with the other machines' threads, each tagged with its machine. */
  merged(local: ThreadView[] = this.deps.threads()): ThreadView[] {
    const remote: ThreadView[] = [];
    for (const [machineId, snapshot] of this.remote) {
      const name = this.deps.machineName(machineId);
      if (!name) continue;
      for (const thread of snapshot.threads) remote.push(this.decorate(machineId, thread));
    }
    return [...local, ...remote];
  }

  /** Called with every local change to threads or projects: tells the other machines and this machine's clients. */
  localChanged() {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.socket?.emit('*', 'relay.snapshot', this.snapshot()), 50);
    this.pushTimer.unref?.();
  }

  /** Streams a local transcript change to the machines observing that thread. */
  transcriptEvent(event: 'thread.item' | 'thread.delta', data: { threadId: string }) {
    for (const [peer, threads] of this.observers) if (threads.includes(data.threadId)) this.socket?.emit(peer, event, data);
  }

  /** Sends a call about another machine's thread to that machine. Undefined: the thread is this machine's. */
  forward(method: string, params: unknown): Promise<unknown> | undefined {
    const threadId = (params as { threadId?: unknown } | undefined)?.threadId;
    if (typeof threadId !== 'string') return undefined;
    const machineId = this.owners.get(threadId);
    if (!machineId) return undefined;
    const name = this.deps.machineName(machineId) ?? 'The other machine';
    if (!RELAY_METHODS.has(method)) return Promise.reject(new UserError(`Open this on ${name} for now.`));
    if (!this.online.has(machineId) || !this.socket) return Promise.reject(new UserError(`${name} is offline.`));
    if (method === 'threads.observe') this.observed.set(threadId, machineId);
    return this.socket.call(machineId, method, params).then(
      (result) => isThreadView(result) ? this.decorate(machineId, result) : result,
      (error: Error) => { throw new UserError(error.message); });
  }

  private snapshot(): RelaySnapshot {
    return { threads: this.deps.threads(), projects: this.deps.projects().projects, version: { boot: this.boot, seq: ++this.seq } };
  }

  private async serve({ from, method, params }: RelayRequest): Promise<unknown> {
    if (!this.deps.machineName(from)) throw new Error('This machine is not paired with the hub.');
    if (method === 'relay.snapshot') return this.snapshot();
    if (!RELAY_METHODS.has(method)) throw new Error('Not available from another machine.');
    const threadId = (params as { threadId?: unknown } | undefined)?.threadId;
    if (method === 'threads.observe' && typeof threadId === 'string' && this.deps.threads().some((t) => t.id === threadId)) {
      // Subscribe before the snapshot is read, as a local client does; the viewer drops changes through its cursor.
      const threads = (this.observers.get(from) ?? []).filter((id) => id !== threadId);
      threads.push(threadId);
      this.observers.set(from, threads.slice(-OBSERVED_PER_PEER));
    }
    const response = await this.deps.router().handle({ id: 0, method, params }, { local: true });
    if (!response) throw new Error('Invalid request');
    if (!response.ok) throw new Error(response.error);
    return response.result;
  }

  private receive(from: string, event: string, data: unknown) {
    if (from === this.deps.here || !this.deps.machineName(from)) return;
    if (event === 'relay.snapshot') { this.store(from, data as RelaySnapshot); return; }
    if (event === 'thread.item' || event === 'thread.delta') {
      const change = data as Events['thread.item'] | Events['thread.delta'];
      if (typeof change?.threadId === 'string' && this.owners.get(change.threadId) === from) this.deps.send(event, change as never);
    }
  }

  private peers(machines: string[]) {
    const next = new Set(machines.filter((id) => id !== this.deps.here));
    const joined = [...next].filter((id) => !this.online.has(id));
    for (const id of this.online) if (!next.has(id)) this.observers.delete(id);
    this.online = next;
    this.announce();
    for (const id of joined) {
      void this.socket?.call(id, 'relay.snapshot', {}).then((snapshot) => {
        this.store(id, snapshot as RelaySnapshot);
        for (const [threadId, owner] of this.observed) if (owner === id) this.deps.send('thread.resync', { threadId });
      }, () => {});
    }
    // A machine that joined after this one changed has not seen its latest threads.
    if (joined.length) this.localChanged();
  }

  private store(machineId: string, snapshot: RelaySnapshot) {
    if (!snapshot || !Array.isArray(snapshot.threads) || !Array.isArray(snapshot.projects) || !snapshot.version) return;
    const current = this.remote.get(machineId);
    if (current && current.version.boot === snapshot.version.boot && current.version.seq >= snapshot.version.seq) return;
    this.remote.set(machineId, snapshot);
    this.index();
    this.announce();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.file.write({ machines: Object.fromEntries(this.remote) }).catch(() => {}); }, 500);
    this.saveTimer.unref?.();
  }

  private index() {
    this.owners.clear();
    for (const [machineId, snapshot] of this.remote) for (const thread of snapshot.threads) this.owners.set(thread.id, machineId);
    for (const thread of this.deps.threads()) this.owners.delete(thread.id);
  }

  private shown = '';
  /** Tells clients again when another machine's threads look different, such as after it was renamed in Settings → Machines. */
  announce() {
    if (!this.remote.size) return;
    const merged = this.merged();
    const shown = JSON.stringify(merged.filter((t) => t.machine));
    if (shown === this.shown) return;
    this.shown = shown;
    this.deps.send('threads.changed', merged);
  }

  /** Shows a remote thread under this machine's project for the same repository, when it has one. */
  private decorate(machineId: string, thread: ThreadView): ThreadView {
    const { machine: _, projectName: __, ...view } = thread;
    const project = this.remote.get(machineId)?.projects.find((p) => p.id === thread.projectId);
    const here = project?.repoKey ? this.deps.projects().projects.find((p) => p.repoKey === project.repoKey) : undefined;
    return {
      ...view,
      projectId: here?.id ?? thread.projectId,
      ...(project && !here ? { projectName: project.name } : {}),
      machine: { id: machineId, name: this.deps.machineName(machineId) ?? 'Other machine', online: this.online.has(machineId) },
    };
  }

  async close() {
    clearTimeout(this.pushTimer);
    this.socket?.close();
    if (this.saveTimer) { clearTimeout(this.saveTimer); await this.file.write({ machines: Object.fromEntries(this.remote) }).catch(() => {}); }
    await this.file.idle();
  }
}

function isThreadView(value: unknown): value is ThreadView {
  return !!value && typeof value === 'object' && typeof (value as ThreadView).id === 'string' && typeof (value as ThreadView).status === 'string' && 'profileId' in value;
}
