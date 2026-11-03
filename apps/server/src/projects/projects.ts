import { join } from 'node:path';
import type { ProjectsState } from '@accio/protocol';
import type { Profiles } from '../profiles/profiles.js';
import type { Machines } from '../machine/machine.js';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { JsonFile } from '@accio/persistence';
import { inspectFolder } from './git.js';
import {
  addCheckout,
  findProjectFor,
  projectNameFor,
  removeCheckout,
  samePath,
  suggestProfile,
  type Checkout,
  type Project,
  type ProjectsData,
} from './project.js';

/** Threads veto removing a checkout they live in, or moving a project they belong to. */
export type CheckoutInUse = (checkoutId: string) => string | undefined;
export type ProjectInUse = (projectId: string) => string | undefined;

/** Projects and this machine's checkouts of them. */
export class Projects {
  private file: JsonFile<ProjectsData>;
  private data: ProjectsData = { projects: [], checkouts: [] };
  private inUseChecks: CheckoutInUse[] = [];
  private checkoutUsers = new Map<string, number>();
  private removing = new Set<string>();
  private removeThreads?: (id: string) => Promise<void>;
  private projectInUseChecks: ProjectInUse[] = [];

  constructor(
    home: string,
    private profiles: Profiles,
    private machines: Machines,
    private broadcast: Broadcast,
  ) {
    this.file = new JsonFile(join(home, 'projects.json'), () => ({ projects: [], checkouts: [] }));
    profiles.onCheckInUse((profileId) => {
      const names = this.data.projects.filter((p) => p.profileId === profileId).map((p) => p.name);
      return names.length ? `project${names.length > 1 ? 's' : ''} ${names.join(', ')}` : undefined;
    });
  }

  async load() {
    this.data = await this.file.read();
  }

  state(): ProjectsState {
    return this.data;
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

  register(router: Router) {
    router
      .on('projects.get', () => this.data)
      .on('projects.setDelivery', async ({ projectId, deliveryPolicy, previewCommand }) => {
        const project = this.data.projects.find((p) => p.id === projectId);
        if (!project) throw new UserError('No such project');
        const updated = { ...project, deliveryPolicy, previewCommand };
        await this.commit({ ...this.data, projects: this.data.projects.map((p) => p.id === projectId ? updated : p) });
        return updated;
      })
      .on('checkouts.inspect', async ({ path }) => {
        const facts = await inspectFolder(path);
        return {
          path: facts.root,
          name: projectNameFor(facts),
          repoKey: facts.repoKey,
          existingProject: findProjectFor(this.data, facts),
          alreadyAdded: this.data.checkouts.some((c) => samePath(c.path, facts.root)),
          suggestedProfileId: suggestProfile(this.machines.profileFoldersHere(), facts.root),
        };
      })
      .on('checkouts.add', async ({ path, profileId }) => {
        const release = profileId ? this.profiles.useProfile(profileId) : () => {};
        try {
          const facts = await inspectFolder(path);
          const { data, checkout } = addCheckout(this.data, facts, profileId);
          await this.commit(data);
          return checkout;
        } finally {
          release();
        }
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
          await this.commit(removeCheckout(this.data, id));
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
          const updated = { ...project, profileId };
          await this.commit({ ...this.data, projects: this.data.projects.map((p) => (p.id === projectId ? updated : p)) });
          return updated;
        } finally {
          release();
        }
      });
  }

  async close() {
    await this.file.idle();
  }

  private async commit(next: ProjectsData) {
    this.data = next;
    this.broadcast('projects.changed', next);
    await this.file.write(next);
  }
}
