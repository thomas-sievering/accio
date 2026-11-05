import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';
import { RelaySocket, type RelayRequest } from '@accio/hub';
import { RELAY_MACHINE_METHODS, RELAY_THREAD_METHODS, type CheckoutView, type Events, type MachineView, type ParamsOf, type ProjectsState, type ResultOf, type RelaySnapshot, type ThreadView } from '@accio/protocol';
import { UserError, type Router } from '../rpc/router.js';
import { CLONE_TIMEOUT_MS, remoteUrlOf } from '../projects/git.js';
import type { RemoteMediaKey, ThreadAssets } from '../threads/assets.js';

const RELAY_METHODS = new Set<string>(RELAY_THREAD_METHODS);
const MACHINE_METHODS = new Set<string>(RELAY_MACHINE_METHODS);
/** Transcripts another machine streams from here at once; the oldest stops when it opens another. */
const OBSERVED_PER_PEER = 16;
/** Long enough to send the largest media through the hub. */
const MEDIA_TIMEOUT_MS = 5 * 60_000;
/** What a machine answers for a method it doesn't serve to others. Older machines answer exactly this. */
const NOT_RELAYED = 'Not available from another machine.';
const OLDER = (name: string) => `${name} runs an older Accio. Update it by hand once: git pull, then pnpm start.`;

export type RelayDeps = {
  here: string;
  threads: () => ThreadView[];
  projects: () => ProjectsState;
  /** The hub's machines, as `machines.list` returns them before the relay adds to them. */
  machines: () => MachineView[];
  /** This machine's router, which serves requests from the others. */
  router: () => Router;
  /** The hub's name for a paired machine; undefined once it is unpaired. */
  machineName: (id: string) => string | undefined;
  /** Connected to the hub, though maybe not to the relay. */
  machineConnected?: (id: string) => boolean;
  /** Caches other machines' media here and serves it to this machine's clients. */
  assets?: () => Pick<ThreadAssets, 'cachedRemote' | 'storeRemote'> | undefined;
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

  /** The hub's machines, each other machine on the relay marked with the repositories it can start threads in. */
  machines(views: MachineView[] = this.deps.machines()): MachineView[] {
    return views.map(({ relay: _, ...machine }) => {
      if (machine.thisMachine || machine.id === this.deps.here || !this.online.has(machine.id)) return machine;
      const snapshot = this.remote.get(machine.id);
      if (!snapshot?.checkouts) return machine;
      const repos = new Set(snapshot.checkouts.map((c) => snapshot.projects.find((p) => p.id === c.projectId)?.repoKey).filter((key): key is string => !!key));
      return { ...machine, relay: { repos: [...repos].sort() } };
    });
  }

  /** Sends a call about another machine's thread to that machine. Undefined: the thread is this machine's. */
  forward(method: string, params: unknown): Promise<unknown> | undefined {
    if (method === 'threads.start') return this.startThere(params as ParamsOf<'threads.start'>);
    if (MACHINE_METHODS.has(method)) return this.forwardToMachine(method, params);
    const threadId = (params as { threadId?: unknown } | undefined)?.threadId;
    if (typeof threadId !== 'string') return undefined;
    const machineId = this.owners.get(threadId);
    if (!machineId) return undefined;
    const name = this.deps.machineName(machineId) ?? 'The other machine';
    if (method === 'threads.assetUrl' || method === 'threads.fileUrl') return this.media(machineId, name, method, params);
    if (!RELAY_METHODS.has(method)) return Promise.reject(new UserError(`Open this on ${name} for now.`));
    if (method === 'threads.send' && (params as ParamsOf<'threads.send'>).images?.length) return Promise.reject(new UserError(`Images can't be sent to threads on ${name} yet.`));
    if (!this.online.has(machineId) || !this.socket) return Promise.reject(new UserError(`${name} is offline.`));
    if (method === 'threads.observe') this.observed.set(threadId, machineId);
    return this.socket.call(machineId, method, params).then(
      (result) => isThreadView(result) ? this.decorate(machineId, result) : result,
      (error: Error) => { throw new UserError(error.message); });
  }

  /**
   * Starts a thread on the machine it names, in that machine's checkout of the same repository.
   * Undefined: it starts here.
   */
  private startThere(input: ParamsOf<'threads.start'>): Promise<unknown> | undefined {
    const { machineId } = input;
    if (!machineId || machineId === this.deps.here) return undefined;
    const name = this.deps.machineName(machineId);
    const snapshot = this.remote.get(machineId);
    // Not on the relay: threads.start says whether it is unknown, offline or on an earlier build.
    if (!name || !this.online.has(machineId) || !this.socket || !snapshot) return undefined;
    if (!snapshot.checkouts) return Promise.reject(new UserError(OLDER(name)));
    if (input.images?.length) return Promise.reject(new UserError(`Images can't be sent to threads on ${name} yet.`));
    return this.startOn(machineId, name, input);
  }

  /** Starts it in that machine's checkout of the same repository, cloning one there first if it has none. */
  private async startOn(machineId: string, name: string, input: ParamsOf<'threads.start'>): Promise<unknown> {
    const { text, model } = input;
    const socket = this.socket!;
    let params: ParamsOf<'threads.start'>;
    if ('checkoutId' in input) {
      const { projects, checkouts } = this.deps.projects();
      const here = checkouts.find((c) => c.id === input.checkoutId);
      const project = projects.find((p) => p.id === here?.projectId);
      if (!here || !project) throw new UserError('No such checkout');
      if (!project.repoKey) throw new UserError(`${project.name} has no remote, so ${name} cannot clone it.`);
      const snapshot = this.remote.get(machineId)!;
      const there = snapshot.projects.find((p) => p.repoKey === project.repoKey);
      let checkoutId = there && snapshot.checkouts?.find((c) => c.projectId === there.id)?.id;
      if (!checkoutId) {
        const url = await remoteUrlOf(here.path, project.repoKey);
        const cloned = await socket.call(machineId, 'checkouts.clone', { machineId, repoKey: project.repoKey, url, profileId: project.profileId }, CLONE_TIMEOUT_MS + 30_000)
          .catch((error: Error) => { throw new UserError(error.message === NOT_RELAYED ? OLDER(name) : error.message); }) as CheckoutView;
        checkoutId = cloned.id;
      }
      params = { checkoutId, text, ...(model ? { model } : {}) };
    } else params = { profileId: input.profileId, text, ...(model ? { model } : {}) };
    return socket.call(machineId, 'threads.start', params).then((result) => {
      if (!isThreadView(result)) return result;
      // List it before the owner's next snapshot arrives, so the client can open it straight away.
      const current = this.remote.get(machineId);
      if (current && !current.threads.some((t) => t.id === result.id)) {
        this.remote.set(machineId, { ...current, threads: [result, ...current.threads] });
        this.index();
        this.announce();
      }
      return this.decorate(machineId, result);
    }, (error: Error) => { throw new UserError(error.message); });
  }

  /**
   * Another machine's asset or linked file, fetched through the relay and served from here,
   * since the browser cannot reach the machine that owns it. Assets never change, so each is
   * fetched once; a linked file is fetched again each time.
   */
  private async media(machineId: string, name: string, method: 'threads.assetUrl' | 'threads.fileUrl', params: unknown): Promise<unknown> {
    const assets = this.deps.assets?.();
    if (!assets) throw new UserError(`Open this on ${name} for now.`);
    if (method === 'threads.assetUrl') {
      const { threadId, assetId, download } = params as ParamsOf<'threads.assetUrl'>;
      const key = { machineId, threadId, assetId };
      const cached = await assets.cachedRemote(key, download);
      if (cached) return cached;
      return assets.storeRemote(key, await this.fetchMedia(machineId, name, { threadId, assetId }), download);
    }
    const { threadId, path } = params as ParamsOf<'threads.fileUrl'>;
    const key: RemoteMediaKey = { machineId, threadId, path };
    return assets.storeRemote(key, await this.fetchMedia(machineId, name, { threadId, path }), true);
  }

  private async fetchMedia(machineId: string, name: string, params: ParamsOf<'threads.media'>): Promise<ResultOf<'threads.media'>> {
    if (!this.online.has(machineId) || !this.socket) throw new UserError(`${name} is offline.`);
    return await this.socket.call(machineId, 'threads.media', params, MEDIA_TIMEOUT_MS).catch((error: Error) => {
      // A machine from before relayed media answers that it does not serve this.
      throw new UserError(error.message === NOT_RELAYED ? OLDER(name) : error.message);
    }) as ResultOf<'threads.media'>;
  }

  /** Tells every other machine about a change to this machine itself, such as its update. */
  emit(event: 'update.changed', data: Events['update.changed']) { this.socket?.emit('*', event, data); }

  /** A call about a machine, by `machineId`: undefined when it is this one. */
  private forwardToMachine(method: string, params: unknown): Promise<unknown> | undefined {
    const machineId = (params as { machineId?: unknown } | undefined)?.machineId;
    if (typeof machineId !== 'string' || machineId === this.deps.here) return undefined;
    const name = this.deps.machineName(machineId);
    if (!name) return Promise.reject(new UserError('No such machine.'));
    if (!this.online.has(machineId) || !this.socket) {
      // Connected to the hub but not to the relay: an Accio from before the relay.
      return Promise.reject(new UserError(this.deps.machineConnected?.(machineId) ? OLDER(name) : `${name} is offline.`));
    }
    return this.socket.call(machineId, method, params).catch((error: Error) => {
      // A machine from before updates knew only thread methods.
      throw new UserError(error.message === NOT_RELAYED ? OLDER(name) : error.message);
    });
  }

  private snapshot(): RelaySnapshot {
    const { projects, checkouts } = this.deps.projects();
    return { threads: this.deps.threads(), projects, checkouts, version: { boot: this.boot, seq: ++this.seq } };
  }

  private async serve({ from, method, params }: RelayRequest): Promise<unknown> {
    if (!this.deps.machineName(from)) throw new Error('This machine is not paired with the hub.');
    if (method === 'relay.snapshot') return this.snapshot();
    if (MACHINE_METHODS.has(method)) {
      if ((params as { machineId?: unknown } | undefined)?.machineId !== this.deps.here) throw new Error('This call is about another machine.');
    } else if (!RELAY_METHODS.has(method)) throw new Error(NOT_RELAYED);
    const threadId = (params as { threadId?: unknown } | undefined)?.threadId;
    if (method === 'threads.observe' && typeof threadId === 'string' && this.deps.threads().some((t) => t.id === threadId)) {
      // Subscribe before the snapshot is read, as a local client does; the viewer drops changes through its cursor.
      const threads = (this.observers.get(from) ?? []).filter((id) => id !== threadId);
      threads.push(threadId);
      this.observers.set(from, threads.slice(-OBSERVED_PER_PEER));
    }
    if (method === 'threads.start' && params && typeof params === 'object') {
      const { machineId: _, ...own } = params as Record<string, unknown>;
      params = own;
    }
    const response = await this.deps.router().handle({ id: 0, method, params }, { local: true });
    if (!response) throw new Error('Invalid request');
    if (!response.ok) throw new Error(response.error);
    return response.result;
  }

  private receive(from: string, event: string, data: unknown) {
    if (from === this.deps.here || !this.deps.machineName(from)) return;
    if (event === 'relay.snapshot') { this.store(from, data as RelaySnapshot); return; }
    if (event === 'update.changed') {
      if ((data as Events['update.changed'] | undefined)?.machineId === from) this.deps.send(event, data as Events['update.changed']);
      return;
    }
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
    this.announceMachines();
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
    this.announceMachines();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.file.write({ machines: Object.fromEntries(this.remote) }).catch(() => {}); }, 500);
    this.saveTimer.unref?.();
  }

  private index() {
    this.owners.clear();
    for (const [machineId, snapshot] of this.remote) for (const thread of snapshot.threads) this.owners.set(thread.id, machineId);
    for (const thread of this.deps.threads()) this.owners.delete(thread.id);
  }

  private machinesShown = '';
  /** Tells clients when another machine joins or leaves the relay, or changes the repositories it has. */
  private announceMachines() {
    const machines = this.machines();
    const shown = JSON.stringify(machines.map((m) => [m.id, m.relay]));
    if (shown === this.machinesShown) return;
    this.machinesShown = shown;
    this.deps.send('machines.changed', machines);
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
