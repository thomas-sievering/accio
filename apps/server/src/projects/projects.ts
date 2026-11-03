import { join } from 'node:path';
import type { ProjectsState } from '@accio/protocol';
import type { Profiles } from '../profiles/profiles.js';
import type { Machines } from '../machine/machine.js';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { JsonFile } from '../store/jsonFile.js';
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

/** Threads (a later slice) veto removing a checkout they live in, or moving a project they belong to. */
export type CheckoutInUse = (checkoutId: string) => string | undefined;
export type ProjectInUse = (projectId: string) => string | undefined;

/** Projects and this machine's checkouts of them. */
export class Projects {
  private file: JsonFile<ProjectsData>;
  private data: ProjectsData = { projects: [], checkouts: [] };
  private inUseChecks: CheckoutInUse[] = [];
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

  register(router: Router) {
    router
      .on('projects.get', () => this.data)
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
        if (profileId) this.profiles.require(profileId);
        const facts = await inspectFolder(path);
        const { data, checkout } = addCheckout(this.data, facts, profileId);
        await this.commit(data);
        return checkout;
      })
      .on('checkouts.remove', async ({ id }) => {
        for (const check of this.inUseChecks) {
          const reason = check(id);
          if (reason) throw new UserError(`This checkout still has ${reason}`);
        }
        await this.commit(removeCheckout(this.data, id));
        return null;
      })
      .on('projects.setProfile', async ({ projectId, profileId }) => {
        this.profiles.require(profileId);
        const project = this.data.projects.find((p) => p.id === projectId);
        if (!project) throw new UserError('No such project');
        // GLOSSARY: a project's profile can change only while it has no threads,
        // since each thread keeps the profile it started with.
        if (project.profileId !== profileId) {
          for (const check of this.projectInUseChecks) {
            const reason = check(projectId);
            if (reason) throw new UserError(`This project still has ${reason}. Delete them before moving it to another profile.`);
          }
        }
        const updated = { ...project, profileId };
        await this.commit({ ...this.data, projects: this.data.projects.map((p) => (p.id === projectId ? updated : p)) });
        return updated;
      });
  }

  private async commit(next: ProjectsData) {
    this.data = next;
    this.broadcast('projects.changed', next);
    await this.file.write(next);
  }
}
