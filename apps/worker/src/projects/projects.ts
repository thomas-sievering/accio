import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HubProject, ProjectsState } from '@accio/protocol';
import type { Profiles } from '../profiles/profiles.js';
import type { Machines } from '../machine/machine.js';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { JsonFile } from '@accio/persistence';
import { cloneInto, inspectFolder, remoteUrlOf } from './git.js';
import { samePath } from '../paths.js';
import {
  addCheckout,
  checkoutHere,
  findProjectFor,
  projectNameFor,
  removeCheckout,
  suggestProfile,
  type Checkout,
  type Project,
  type ProjectsData,
} from './project.js';

/** Threads veto removing a checkout they live in, or moving a project they belong to. */
export type CheckoutInUse = (checkoutId: string) => string | undefined;
export type ProjectInUse = (projectId: string) => string | undefined;

/** GLOSSARY: Project. The hub's projects, and whether other machines still have checkouts of them. */
export type ProjectsHub = {
  /** Undefined from a hub that keeps no projects yet: each project's profile is then this machine's own. */
  list: () => HubProject[] | undefined;
  register: (projects: HubProject[]) => Promise<unknown>;
  setProfile: (project: HubProject) => Promise<void>;
  forget: (repoKey: string) => Promise<void>;
  onChanged: (listener: () => void) => void;
  /** Whether another machine has a checkout of the repository, by its last list even while offline. */
  checkoutElsewhere: (repoKey: string) => boolean;
};

/** How long a project the hub didn't take, such as while it was offline, waits before it is registered again. */
const REGISTER_RETRY_MS = 60_000;

/**
 * Projects and this machine's checkouts of them. A project with a remote is also kept on the hub,
 * which decides its profile for every machine (GLOSSARY: Shared settings).
 */
export class Projects {
  private file: JsonFile<ProjectsData>;
  private data: ProjectsData = { projects: [], checkouts: [] };
  private inUseChecks: CheckoutInUse[] = [];
  private checkoutUsers = new Map<string, number>();
  private removing = new Set<string>();
  private removeThreads?: (id: string) => Promise<void>;
  private projectInUseChecks: ProjectInUse[] = [];
  /** Clones in progress by repository, so two threads starting at once share one. */
  private cloning = new Map<string, Promise<Checkout>>();
  /** Repositories registered with the hub and not yet in its list. */
  private registering = new Set<string>();
  private syncing?: Promise<void>;
  private syncAgain = false;
  private shownElsewhere = '[]';
  private closed = false;

  constructor(
    home: string,
    private profiles: Profiles,
    private machines: Machines,
    private broadcast: Broadcast,
    private hub: ProjectsHub,
  ) {
    this.file = new JsonFile(join(home, 'projects.json'), () => ({ projects: [], checkouts: [] }));
    profiles.onCheckInUse((profileId) => {
      const names = this.data.projects.filter((p) => p.profileId === profileId).map((p) => p.name);
      return names.length ? `project${names.length > 1 ? 's' : ''} ${names.join(', ')}` : undefined;
    });
    hub.onChanged(() => this.sync());
  }

  async load() {
    this.data = await this.file.read();
    this.sync();
  }

  /** This machine's projects and checkouts. */
  state(): ProjectsData {
    return this.data;
  }

  /** What clients see: this machine's projects, and the hub's that it has no checkout of. */
  view(): ProjectsState {
    return { ...this.data, elsewhere: this.elsewhere() };
  }

  private elsewhere(): HubProject[] {
    const here = new Set(this.data.projects.map((p) => p.repoKey));
    return (this.hub.list() ?? []).filter((p) => !here.has(p.repoKey));
  }

  /** GLOSSARY: Project. The profile the hub keeps for a repository, else this machine's project's. */
  profileOf(repoKey: string): string | undefined {
    return this.hub.list()?.find((p) => p.repoKey === repoKey)?.profileId ?? this.data.projects.find((p) => p.repoKey === repoKey)?.profileId;
  }

  /** The hub's project for a repository, if it keeps one. */
  hubProject(repoKey: string): HubProject | undefined {
    return this.hub.list()?.find((p) => p.repoKey === repoKey);
  }

  /** Brings this machine in line with the hub, one pass at a time. */
  private sync() {
    if (this.closed) return;
    if (this.syncing) { this.syncAgain = true; return; }
    this.syncing = this.reconcile().catch((error) => console.error('[projects] hub sync failed', error)).finally(() => {
      this.syncing = undefined;
      if (this.syncAgain) { this.syncAgain = false; this.sync(); }
    });
  }

  /**
   * GLOSSARY: Project. Takes the hub's profile for each repository, then registers the ones the hub
   * doesn't have. The first machine to register a repository decides its profile; threads keep theirs.
   */
  private async reconcile() {
    const hub = this.hub.list();
    if (!hub) return;
    const kept = new Map(hub.map((p) => [p.repoKey, p]));
    for (const key of this.registering) if (kept.has(key)) this.registering.delete(key);
    const adopted = this.data.projects.map((p) => {
      const shared = p.repoKey ? kept.get(p.repoKey) : undefined;
      return shared && shared.profileId !== p.profileId ? { ...p, profileId: shared.profileId } : p;
    });
    if (adopted.some((p, i) => p !== this.data.projects[i])) await this.commit({ ...this.data, projects: adopted });
    else if (JSON.stringify(this.elsewhere()) !== this.shownElsewhere) this.announce();
    const missing = this.data.projects.filter((p): p is Project & { repoKey: string } => !!p.repoKey && !kept.has(p.repoKey) && !this.registering.has(p.repoKey));
    if (!missing.length) return;
    const keys = missing.map((p) => p.repoKey);
    for (const key of keys) this.registering.add(key);
    // One the hub refused, or couldn't take while offline, is tried again later rather than on every change.
    const retry = () => { const timer = setTimeout(() => { for (const key of keys) this.registering.delete(key); this.sync(); }, REGISTER_RETRY_MS); timer.unref?.(); };
    await this.hub.register(missing.map(({ repoKey, name, profileId }) => ({ repoKey, name, profileId }))).then(retry, retry);
  }

  checkout(id: string): Checkout {
    const c = this.data.checkouts.find((x) => x.id === id);
    if (!c) throw new UserError('No such checkout');
    return c;
  }

  projectOf(checkout: Checkout): Project {
    const p = this.data.projects.find((x) => x.id === checkout.projectId);
    if (!p) throw new UserError('No such project');
    return p;
  }

  onCheckInUse(check: CheckoutInUse) {
    this.inUseChecks.push(check);
  }

  onCheckProjectInUse(check: ProjectInUse) {
    this.projectInUseChecks.push(check);
  }

  /** Reserve a checkout during turn preparation, before its thread is visible. */
  useCheckout(id: string): () => void {
    this.checkout(id);
    if (this.removing.has(id)) throw new UserError('This checkout is being removed');
    this.checkoutUsers.set(id, (this.checkoutUsers.get(id) ?? 0) + 1);
    return () => {
      const count = (this.checkoutUsers.get(id) ?? 1) - 1;
      if (count) this.checkoutUsers.set(id, count);
      else this.checkoutUsers.delete(id);
    };
  }

  onRemoveThreads(remove: (id: string) => Promise<void>) {
    this.removeThreads = remove;
  }

  /**
   * GLOSSARY: Checkout. This machine's checkout of a repository, cloned from `url` under the profile's
   * folder here (else home) when none is on disk. Calls for the same repository at once share one clone.
   */
  clone(repoKey: string, url: string, profileId: string): Promise<Checkout> {
    // GLOSSARY: Shared settings. The hub's profile for the repository wins over the one asked for.
    profileId = this.hubProject(repoKey)?.profileId ?? profileId;
    const pending = this.cloning.get(repoKey) ?? this.cloneOnce(repoKey, url, profileId).finally(() => this.cloning.delete(repoKey));
    this.cloning.set(repoKey, pending);
    return pending;
  }

  private async cloneOnce(repoKey: string, url: string, profileId: string): Promise<Checkout> {
    const have = () => checkoutHere(this.data, this.data.projects.find((p) => p.repoKey === repoKey));
    const existing = await have();
    if (existing) return existing;
    await this.profiles.syncReferences();
    const release = this.profiles.useProfile(profileId);
    try {
      const base = this.machines.profileFoldersHere().find((p) => p.id === profileId)?.folders[0] ?? homedir();
      const facts = await cloneInto(base, repoKey, url);
      const added = await have();
      if (added) return added;
      if (this.data.checkouts.some((c) => samePath(c.path, facts.root))) throw new UserError(`${facts.root} is already added to another project`);
      const { data, checkout } = addCheckout(this.data, facts, profileId);
      await this.commit(data);
      return checkout;
    } finally {
      release();
    }
  }

  /** Adds a folder on this machine: a known repository joins its project, anything else starts one in the profile. */
  async addFolder(path: string, profileId?: string): Promise<Checkout> {
    const release = profileId ? this.profiles.useProfile(profileId) : () => {};
    try {
      await this.profiles.syncReferences();
      const facts = await inspectFolder(path);
      const { data, checkout } = addCheckout(this.data, facts, (facts.repoKey && this.hubProject(facts.repoKey)?.profileId) || profileId);
      await this.commit(data);
      return checkout;
    } finally {
      release();
    }
  }

  register(router: Router) {
    router
      .on('projects.get', () => this.view())
      .on('projects.setDelivery', async ({ projectId, deliveryPolicy, previewCommand, testCommand }) => {
        const project = this.data.projects.find((p) => p.id === projectId);
        if (!project) throw new UserError('No such project');
        const updated = { ...project, deliveryPolicy, previewCommand, testCommand: testCommand ?? project.testCommand };
        await this.commit({ ...this.data, projects: this.data.projects.map((p) => p.id === projectId ? updated : p) });
        return updated;
      })
      .on('checkouts.inspect', async ({ path }) => {
        const facts = await inspectFolder(path);
        return {
          path: facts.root,
          name: projectNameFor(facts),
          repoKey: facts.repoKey,
          existingProject: findProjectFor(this.data, facts) ?? this.onlyOnHub(facts.repoKey),
          alreadyAdded: this.data.checkouts.some((c) => samePath(c.path, facts.root)),
          suggestedProfileId: suggestProfile(this.machines.profileFoldersHere(), facts.root),
        };
      })
      .on('checkouts.add', ({ path, profileId }) => this.addFolder(path, profileId))
      .on('checkouts.clone', ({ repoKey, url, profileId }) => this.clone(repoKey, url, profileId))
      .on('checkouts.cloneUrl', async ({ repoKey }) => {
        const checkout = await checkoutHere(this.data, this.data.projects.find((p) => p.repoKey === repoKey));
        if (!checkout) throw new UserError(`This machine has no checkout of ${repoKey}.`);
        return { url: await remoteUrlOf(checkout.path, repoKey) };
      })
      .on('checkouts.remove', async ({ id, deleteThreads }) => {
        this.checkout(id);
        if (this.removing.has(id) || this.checkoutUsers.has(id)) throw new UserError('This checkout is busy. Wait for its turns to finish.');
        this.removing.add(id);
        try {
          if (deleteThreads) {
            if (!this.removeThreads) throw new UserError('Thread removal is unavailable');
            await this.removeThreads(id);
          }
          for (const check of this.inUseChecks) {
            const reason = check(id);
            if (reason) throw new UserError(`This checkout still has ${reason}`);
          }
          const project = this.projectOf(this.checkout(id));
          await this.commit(removeCheckout(this.data, id));
          // GLOSSARY: Project. The hub forgets it once no machine has a checkout of it, not even one offline.
          const gone = !this.data.projects.some((p) => p.id === project.id);
          if (gone && project.repoKey && this.hubProject(project.repoKey) && !this.hub.checkoutElsewhere(project.repoKey)) {
            await this.hub.forget(project.repoKey).catch((error) => console.error('[projects] could not forget the project on the hub', error));
          }
          return null;
        } finally {
          this.removing.delete(id);
        }
      })
      .on('projects.setProfile', async ({ projectId, profileId }) => {
        const release = this.profiles.useProfile(profileId);
        try {
          const project = this.data.projects.find((p) => p.id === projectId);
          if (!project) throw new UserError('No such project');
          // GLOSSARY: a project's profile can change only while it has no threads,
          // since each thread keeps the profile it started with.
          if (project.profileId !== profileId) {
            if (this.data.checkouts.some((c) => c.projectId === projectId && (this.checkoutUsers.has(c.id) || this.removing.has(c.id)))) {
              throw new UserError('This project is busy. Wait for its turns to start or finish.');
            }
            for (const check of this.projectInUseChecks) {
              const reason = check(projectId);
              if (reason) throw new UserError(`This project still has ${reason}. Delete them before moving it to another profile.`);
            }
          }
          // GLOSSARY: Shared settings. The hub keeps it for every machine, and they adopt it.
          if (project.repoKey && project.profileId !== profileId && this.hub.list()) {
            await this.hub.setProfile({ repoKey: project.repoKey, name: project.name, profileId }).catch((error: Error) => { throw new UserError(error.message); });
          }
          const updated = { ...project, profileId };
          await this.commit({ ...this.data, projects: this.data.projects.map((p) => (p.id === projectId ? updated : p)) });
          return updated;
        } finally {
          release();
        }
      });
  }

  async close() {
    this.closed = true;
    await this.syncing;
    await this.file.idle();
  }

  /** A hub project this machine has no checkout of, as the project a folder of that repository joins. */
  private onlyOnHub(repoKey: string | null): Project | null {
    const shared = repoKey ? this.hubProject(repoKey) : undefined;
    return shared ? { id: '', name: shared.name, profileId: shared.profileId, repoKey: shared.repoKey } : null;
  }

  private announce() {
    const view = this.view();
    this.shownElsewhere = JSON.stringify(view.elsewhere);
    this.broadcast('projects.changed', view);
  }

  private async commit(next: ProjectsData) {
    this.data = next;
    this.announce();
    await this.file.write(next);
    // A new project goes to the hub.
    this.sync();
  }
}
