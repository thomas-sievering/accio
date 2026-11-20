import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';
import { RelaySocket, type RelayRequest } from '@accio/hub';
import { RELAY_MACHINE_METHODS, RELAY_THREAD_METHODS, type CheckoutView, type Events, type MachineView, type MethodName, type ParamsOf, type ProjectsState, type ResultOf, type RelaySnapshot, type ThreadView } from '@accio/protocol';
import { UserError, type Router } from '../rpc/router.js';
import { CLONE_TIMEOUT_MS, httpsUrlOf, remoteUrlOf } from '../projects/git.js';
import type { RemoteMediaKey, ThreadAssets } from '../threads/assets.js';

const RELAY_METHODS = new Set<string>(RELAY_THREAD_METHODS);
const MACHINE_METHODS = new Set<string>(RELAY_MACHINE_METHODS);
/** Transcripts another machine streams from here at once; the oldest stops when it opens another. */
const OBSERVED_PER_PEER = 16;
/** Long enough to send the largest media through the hub. */
const MEDIA_TIMEOUT_MS = 5 * 60_000;
/** What a machine answers for a method it doesn't serve to others. */
const NOT_RELAYED = 'Not available from another machine.';
/**
 * How long a machine that left the relay still counts as holding its projects, so a brief drop doesn't
 * hide them; as long as its threads wait before moving to the Offline shelf (web OFFLINE_GRACE_MS).
 */
const HOLDING_GRACE_MS = 10_000;

/** GLOSSARY: Relay. Another machine's projects and checkouts, while it is on the relay or only just left it. */
export type Holding = { machineId: string; projects: ProjectsState['projects']; checkouts: ProjectsState['checkouts'] };

export type RelayDeps = {
  here: string;
  threads: () => ThreadView[];
  projects: () => ProjectsState;
  /** The hub's machines, as `machines.list` returns them before the relay adds to them. */
  machines: () => MachineView[];
  /** This machine's router, which serves requests from the others. */
  router: Router;
  /** The hub's name for a paired machine; undefined once it is unpaired. */
  machineName: (id: string) => string | undefined;
  /** Caches other machines' media here and serves it to this machine's clients. */
  assets: Pick<ThreadAssets, 'cachedRemote' | 'storeRemote'>;
  /** To this hub's clients on this machine. */
  send: <E extends keyof Events>(event: E, data: Events[E]) => void;
  /** GLOSSARY: Shared settings. The hub's profile for a repository, else this machine's project's. */
  profileOf: (repoKey: string) => string | undefined;
  /** Called when `holdings()` may have changed. */
  holdingsChanged?: () => void;
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
  /** Machines that left the relay recently, by when they left. */
  private left = new Map<string, number>();
  private leftTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(home: string, private deps: RelayDeps) {
    this.file = new JsonFile(join(home, 'relay-cache.json'), () => ({ machines: {} }));
  }

  async load() {
    const cache = await this.file.read().catch(() => ({ machines: {} }) as Cache);
    for (const [id, snapshot] of Object.entries(cache.machines ?? {})) if (id !== this.deps.here && isSnapshot(snapshot)) this.remote.set(id, snapshot);
    this.index();
  }

  start(url: string, token: string) {
    this.socket = new RelaySocket(url, token, {
      request: (request) => this.serve(request),
      event: (from, event, data) => this.receive(from, event, data),
      peers: (machines) => this.peers(machines),
      disconnected: () => this.peers([]),
    });
    if (this.asleep) this.socket.setAsleep(true);
    this.socket.start();
  }

  /** GLOSSARY: Offline thread. Off the relay while the system sleeps. */
  setAsleep(asleep: boolean) { this.asleep = asleep; this.socket?.setAsleep(asleep); }
  private asleep = false;

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
      if (!snapshot) return machine;
      const repos = new Set(snapshot.checkouts.map((c) => snapshot.projects.find((p) => p.id === c.projectId)?.repoKey).filter((key): key is string => !!key));
      return { ...machine, relay: { repos: [...repos].sort() } };
    });
  }

  /** Another machine's projects and checkouts, as it last reported them; undefined when it is not on the relay. */
  projectsOn(machineId: string): ProjectsState | undefined {
    const snapshot = this.remote.get(machineId);
    if (machineId === this.deps.here || !this.online.has(machineId) || !snapshot) return undefined;
    return { projects: snapshot.projects, checkouts: snapshot.checkouts };
  }

  /**
   * Other paired machines' projects and checkouts, while each is on the relay or left it less than
   * HOLDING_GRACE_MS ago, so a project only on one of them stays listed through a brief drop.
   */
  holdings(): Holding[] {
    return [...this.remote].flatMap(([machineId, snapshot]) => machineId !== this.deps.here && this.deps.machineName(machineId)
      && (this.online.has(machineId) || this.left.has(machineId))
      ? [{ machineId, projects: snapshot.projects, checkouts: snapshot.checkouts }] : []);
  }

  /**
   * GLOSSARY: Checkout. How this machine can clone a repository another machine on the relay has:
   * that machine's profile for the project, preferring one with a checkout, and the URL that checkout
   * fetches from. Without one to ask, the URL is an https address from the key. Undefined when no
   * machine on the relay has the repository: an offline one's last list can't say its profile now.
   */
  cloneSource(repoKey: string): { profileId: string; url: () => Promise<string> } | undefined {
    const holders = [...this.remote].flatMap(([machineId, snapshot]) => {
      const project = this.online.has(machineId) && this.deps.machineName(machineId) && snapshot.projects.find((p) => p.repoKey === repoKey);
      if (!project) return [];
      return [{ machineId, project, asked: snapshot.checkouts.some((c) => c.projectId === project.id) }];
    });
    const asked = holders.filter((h) => h.asked);
    const first = asked[0] ?? holders[0];
    if (!first) return undefined;
    return {
      profileId: first.project.profileId,
      url: async () => {
        for (const { machineId } of asked) {
          // Any failure moves on to the next machine.
          const answer = await this.socket?.call(machineId, 'checkouts.cloneUrl', { machineId, repoKey }).catch(() => undefined) as ResultOf<'checkouts.cloneUrl'> | undefined;
          if (answer?.url) return answer.url;
        }
        return httpsUrlOf(repoKey);
      },
    };
  }

  /** Whether another paired machine has a checkout of the repository, by its last list even while it is offline. */
  checkoutElsewhere(repoKey: string): boolean {
    return [...this.remote].some(([machineId, snapshot]) => !!this.deps.machineName(machineId)
      && snapshot.checkouts.some((c) => snapshot.projects.find((p) => p.id === c.projectId)?.repoKey === repoKey));
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
    // Not on the relay: threads.start says whether it is unknown or offline.
    if (!name || !this.online.has(machineId) || !this.socket || !snapshot) return undefined;
    if (input.images?.length) return Promise.reject(new UserError(`Images can't be sent to threads on ${name} yet.`));
    return this.startOn(machineId, name, input);
  }

  /**
   * Starts it in that machine's checkout of the same repository, cloning one there first if it has none.
   * A checkout of that machine's own, such as a sibling's for start_thread, is used as it is.
   */
  private async startOn(machineId: string, name: string, input: ParamsOf<'threads.start'>): Promise<unknown> {
    const { text, model, startedBy } = input;
    const socket = this.socket!;
    let params: ParamsOf<'threads.start'>;
    if ('checkoutId' in input && this.remote.get(machineId)?.checkouts.some((c) => c.id === input.checkoutId)) {
      params = { checkoutId: input.checkoutId, text, ...(model ? { model } : {}) };
    } else if ('checkoutId' in input) {
      const { projects, checkouts } = this.deps.projects();
      const here = checkouts.find((c) => c.id === input.checkoutId);
      const project = projects.find((p) => p.id === here?.projectId);
      if (!here || !project) throw new UserError('No such checkout');
      if (!project.repoKey) throw new UserError(`${project.name} has no remote, so ${name} cannot clone it.`);
      const repoKey = project.repoKey;
      const checkoutId = await this.checkoutThere(machineId, repoKey, this.deps.profileOf(repoKey) ?? project.profileId, () => remoteUrlOf(here.path, repoKey));
      params = { checkoutId, text, ...(model ? { model } : {}), ...(startedBy ? { startedBy } : {}) };
    } else if ('repoKey' in input) {
      // GLOSSARY: Project. A hub project this machine has no checkout of: cloned there from a machine's URL for it.
      const { repoKey } = input;
      const profileId = this.deps.profileOf(repoKey) ?? this.cloneSource(repoKey)?.profileId;
      if (!profileId) throw new UserError(`${repoKey} isn't a project on this hub.`);
      const { projects, checkouts } = this.deps.projects();
      const mine = projects.find((p) => p.repoKey === repoKey);
      const here = mine && checkouts.find((c) => c.projectId === mine.id);
      const checkoutId = await this.checkoutThere(machineId, repoKey, profileId,
        () => here ? remoteUrlOf(here.path, repoKey) : this.cloneSource(repoKey)?.url() ?? Promise.resolve(httpsUrlOf(repoKey)));
      params = { checkoutId, text, ...(model ? { model } : {}), ...(startedBy ? { startedBy } : {}) };
    } else params = { profileId: input.profileId, text, ...(model ? { model } : {}), ...(startedBy ? { startedBy } : {}) };
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

  /** That machine's checkout of the repository, cloned there from `url` under the profile's folder when it has none. */
  private async checkoutThere(machineId: string, repoKey: string, profileId: string, url: () => Promise<string>): Promise<string> {
    const snapshot = this.remote.get(machineId)!;
    const there = snapshot.projects.find((p) => p.repoKey === repoKey);
    const checkoutId = there && snapshot.checkouts.find((c) => c.projectId === there.id)?.id;
    if (checkoutId) return checkoutId;
    const cloned = await this.socket!.call(machineId, 'checkouts.clone', { machineId, repoKey, url: await url(), profileId }, CLONE_TIMEOUT_MS + 30_000)
      .catch((error: Error) => { throw new UserError(error.message); }) as CheckoutView;
    return cloned.id;
  }

  /**
   * Another machine's asset or linked file, fetched through the relay and served from here,
   * since the browser cannot reach the machine that owns it. Assets never change, so each is
   * fetched once; a linked file is fetched again each time.
   */
  private async media(machineId: string, name: string, method: 'threads.assetUrl' | 'threads.fileUrl', params: unknown): Promise<unknown> {
    const { assets } = this.deps;
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
    return await this.socket.call(machineId, 'threads.media', params, MEDIA_TIMEOUT_MS).catch((error: Error) => { throw new UserError(error.message); }) as ResultOf<'threads.media'>;
  }

  /** Tells every other machine about a change to this machine itself, such as its update. */
  emit(event: 'update.changed', data: Events['update.changed']) { this.socket?.emit('*', event, data); }

  /** A call about a machine, by `machineId`: undefined when it is this one. */
  private forwardToMachine(method: string, params: unknown): Promise<unknown> | undefined {
    const machineId = (params as { machineId?: unknown } | undefined)?.machineId;
    if (typeof machineId !== 'string' || machineId === this.deps.here) return undefined;
    const name = this.deps.machineName(machineId);
    if (!name) return Promise.reject(new UserError('No such machine.'));
    if (!this.online.has(machineId) || !this.socket) return Promise.reject(new UserError(`${name} is offline.`));
    return this.socket.call(machineId, method, params).catch((error: Error) => { throw new UserError(error.message); });
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
    return this.deps.router.call(method as MethodName, params as never, { local: true });
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
    for (const id of this.online) if (!next.has(id)) { this.observers.delete(id); this.leave(id); }
    for (const id of joined) this.arrive(id);
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
    this.deps.holdingsChanged?.();
  }

  /** A machine that left keeps its projects listed a little longer, in case it is back at once. */
  private leave(id: string) {
    this.left.set(id, Date.now());
    clearTimeout(this.leftTimers.get(id));
    const timer = setTimeout(() => { this.left.delete(id); this.leftTimers.delete(id); this.deps.holdingsChanged?.(); }, HOLDING_GRACE_MS);
    timer.unref?.();
    this.leftTimers.set(id, timer);
  }

  private arrive(id: string) {
    this.left.delete(id);
    clearTimeout(this.leftTimers.get(id));
    this.leftTimers.delete(id);
  }

  private store(machineId: string, snapshot: RelaySnapshot) {
    if (!isSnapshot(snapshot)) return;
    const current = this.remote.get(machineId);
    if (current && current.version.boot === snapshot.version.boot && current.version.seq >= snapshot.version.seq) return;
    this.remote.set(machineId, snapshot);
    this.index();
    this.announce();
    this.announceMachines();
    this.deps.holdingsChanged?.();
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
    const online = this.online.has(machineId);
    return {
      ...view,
      // GLOSSARY: Project. Without one here, a repository's threads on every machine share its key, the id it is listed under.
      projectId: here?.id ?? project?.repoKey ?? thread.projectId,
      ...(project && !here ? { projectName: project.name } : {}),
      machine: { id: machineId, name: this.deps.machineName(machineId) ?? 'Other machine', online },
    };
  }

  async close() {
    clearTimeout(this.pushTimer);
    for (const timer of this.leftTimers.values()) clearTimeout(timer);
    this.socket?.close();
    if (this.saveTimer) { clearTimeout(this.saveTimer); await this.file.write({ machines: Object.fromEntries(this.remote) }).catch(() => {}); }
    await this.file.idle();
  }
}

function isSnapshot(value: RelaySnapshot | undefined): value is RelaySnapshot {
  return !!value && Array.isArray(value.threads) && Array.isArray(value.projects) && Array.isArray(value.checkouts) && !!value.version;
}

function isThreadView(value: unknown): value is ThreadView {
  return !!value && typeof value === 'object' && typeof (value as ThreadView).id === 'string' && typeof (value as ThreadView).status === 'string' && 'profileId' in value;
}
