import { stat } from 'node:fs/promises';
import { projectKey, type ProjectsState, type ProjectView, type Space } from '@accio/protocol';
import { maybeGit } from '../git.js';

export type SpaceContextDeps = {
  /** The spaces as the hub's shared settings hold them now. */
  spaces: () => readonly Space[];
  /** This machine's projects and checkouts. */
  projects: () => ProjectsState;
};

/** One other project of the space, as this machine sees it. */
type Sibling = { name: string; place: string };

/**
 * GLOSSARY: Space. What a thread's turn is told about the space its project is in (ADR 0019).
 * Built again for every turn, so a change to the space or to a checkout applies from the next one.
 */
export class SpaceContext {
  constructor(private deps: SpaceContextDeps) {}

  /**
   * The Space section of the per-turn instructions for a thread in `project` working in `cwd`,
   * or undefined when the project is in no space.
   */
  async section({ project }: { project: ProjectView; cwd: string }): Promise<string | undefined> {
    const key = projectKey(project);
    const space = this.deps.spaces().find((s) => s.projectKeys.includes(key));
    if (!space) return undefined;
    const siblings = await Promise.all(space.projectKeys.filter((k) => k !== key).map((k) => this.sibling(k)));
    return [
      `# Space: ${space.name}`,
      `This project is in the space "${space.name}", a group of projects that share context. You can read the other projects' checkouts on this machine directly.`,
      // #194 adds the home here: its name, checkout path and AGENTS.md as space-wide context.
      ...(siblings.length ? ['## Other projects in the space', siblings.map((s) => `- ${s.name}: ${s.place}`).join('\n')] : []),
    ].join('\n\n');
  }

  private async sibling(key: string): Promise<Sibling> {
    const { projects, checkouts } = this.deps.projects();
    const project = projects.find((p) => projectKey(p) === key);
    const name = project?.name ?? nameOfKey(key);
    // The first of the project's checkouts still on disk here, in the order they were added.
    let path: string | undefined;
    for (const c of project ? checkouts.filter((c) => c.projectId === project.id) : []) {
      if (await stat(c.path).then((s) => s.isDirectory(), () => false)) { path = c.path; break; }
    }
    // #195 clones a missing sibling and says when it can't be had on this machine.
    if (!path) return { name, place: 'not on this machine yet' };
    const branch = await currentBranch(path);
    return { name, place: branch ? `${path} (${branch})` : path };
  }
}

/** A project this machine has no record of goes by its repository's name, as a new checkout of it would. */
function nameOfKey(key: string) {
  return key.split('/').pop() || key;
}

async function currentBranch(path: string): Promise<string | undefined> {
  const branch = await maybeGit(path, 'symbolic-ref', '--quiet', '--short', 'HEAD');
  if (branch) return `branch ${branch}`;
  const commit = await maybeGit(path, 'rev-parse', '--short', 'HEAD');
  return commit ? `detached at ${commit}` : undefined;
}
