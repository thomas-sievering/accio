import { projectKey, type ProjectsState, type Space } from '@accio/protocol';
import { UserError } from '../rpc/router.js';
import { checkoutHere, nameOfKey } from './spaceContext.js';

export type SiblingThreadsDeps = {
  /** The spaces as the hub's shared settings hold them now. */
  spaces: () => readonly Space[];
  /** This machine's projects and checkouts. */
  projects: () => ProjectsState;
  /** Another machine's projects and checkouts, as the relay last heard them; undefined when it can't be reached. */
  projectsOn: (machineId: string) => ProjectsState | undefined;
};

/** Where a thread started in another project of the space runs. */
export type SiblingTarget = { name: string; checkoutId: string; profileId: string };

type Member = { key: string; name: string; home: boolean };

/**
 * GLOSSARY: Space, Started thread. Where start_thread's `project` starts a thread: another project
 * of the caller's space, including its home, in that project's checkout on the chosen machine, so it
 * runs under that project's profile (ADR 0019). Anything outside the space is refused.
 */
export class SiblingThreads {
  constructor(private deps: SiblingThreadsDeps) {}

  /**
   * The checkout on `machine` (this one when undefined) of the project of the caller's space that
   * `wanted` names, by name or key. Undefined when it names the caller's own project.
   */
  async target(callerProjectId: string, wanted: string, machine?: { id: string; name: string }): Promise<SiblingTarget | undefined> {
    const here = this.deps.projects();
    const caller = here.projects.find((p) => p.id === callerProjectId);
    const own = caller && projectKey(caller);
    const space = own ? this.deps.spaces().find((s) => s.projectKeys.includes(own)) : undefined;
    if (!space) throw new UserError(`This thread's project is in no space, so it can only start threads in its own project. Leave out project.`);
    const there = machine && this.deps.projectsOn(machine.id);
    if (machine && !there) throw new UserError(`${machine.name} can't be reached to find its projects. It is offline or on an earlier version of Accio.`);
    const members = space.projectKeys.map((key): Member => ({ key, name: nameOf(key, here, there), home: key === space.homeProjectKey }));
    const member = this.member(space, members, own!, wanted);
    if (member.key === own) return undefined;
    return this.checkout(member, machine && { ...machine, projects: there! });
  }

  private member(space: Space, members: Member[], own: string, wanted: string): Member {
    const text = wanted.trim().toLowerCase();
    const byKey = members.find((m) => m.key.toLowerCase() === text);
    if (byKey) return byKey;
    const byName = members.filter((m) => m.name.toLowerCase() === text);
    if (byName.length === 1) return byName[0]!;
    if (byName.length > 1) throw new UserError(`More than one project in the space "${space.name}" is called ${wanted}. Name one by its key: ${byName.map((m) => m.key).join(', ')}.`);
    const allowed = members.map((m) => m.name + (m.key === own ? ' (this project)' : m.home ? ' (home)' : '')).join(', ');
    throw new UserError(`${wanted} is not a project in the space "${space.name}". Projects you can start a thread in: ${allowed}.`);
  }

  /**
   * The member's checkout on the machine: this machine's first one still on disk, or the first one
   * the other machine reported. A project without one there is refused (#195 clones it instead).
   */
  private async checkout(member: Member, machine?: { name: string; projects: ProjectsState }): Promise<SiblingTarget> {
    const state = machine?.projects ?? this.deps.projects();
    const project = state.projects.find((p) => projectKey(p) === member.key);
    const checkout = machine
      ? state.checkouts.find((c) => c.projectId === project?.id)
      : await checkoutHere(state, project);
    if (!project || !checkout) throw new UserError(`${member.name} has no checkout on ${machine?.name ?? 'this machine'}. Add one there first, or start the thread on a machine that has it.`);
    return { name: project.name, checkoutId: checkout.id, profileId: project.profileId };
  }
}

/** This machine's name for the project, else the other machine's, else its repository's. */
function nameOf(key: string, ...states: (ProjectsState | undefined)[]) {
  for (const state of states) {
    const project = state?.projects.find((p) => projectKey(p) === key);
    if (project) return project.name;
  }
  return nameOfKey(key);
}
