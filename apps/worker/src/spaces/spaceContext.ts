import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { projectKey, type CheckoutView, type ProjectsState, type ProjectView, type Space } from '@accio/protocol';
import { maybeGit } from '../git.js';

export type SpaceContextDeps = {
  /** The spaces as the hub's shared settings hold them now. */
  spaces: () => readonly Space[];
  /** This machine's projects and checkouts. */
  projects: () => ProjectsState;
};

/** A project of the space as this machine sees it: its checkout here, if any, and where that checkout is. */
type Member = { name: string; path?: string; place: string };

/** The longest home AGENTS.md given in full; a longer one is cut with a pointer to the file. */
const HOME_INSTRUCTIONS_BYTES = 16 * 1024;

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
    const siblings = await Promise.all(space.projectKeys.filter((k) => k !== key).map((k) => this.member(k)));
    return [
      `# Space: ${space.name}`,
      `This project is in the space "${space.name}", a group of projects that share context. You can read the other projects' checkouts on this machine directly.`,
      ...space.homeProjectKey ? await this.home(space.homeProjectKey, space.homeProjectKey === key) : [],
      ...(siblings.length ? ['## Other projects in the space', siblings.map((s) => `- ${s.name}: ${s.place}`).join('\n')] : []),
    ].join('\n\n');
  }

  /**
   * GLOSSARY: Home. The home's part of the section: where it is and its AGENTS.md, read again each turn.
   * A thread in the home already has that file from its working folder, so it isn't repeated.
   */
  private async home(key: string, inHome: boolean): Promise<string[]> {
    if (inHome) return ['## Home: this project', "This project is the space's home: its own instructions are the space-wide context for the other projects."];
    const home = await this.member(key);
    // #195 clones a home with no checkout here before the turn, and reports here when that fails.
    if (!home.path) return [`## Home: ${home.name}`, `The space's home, ${home.name}, is not on this machine yet, so its space-wide instructions are missing from this turn.`];
    const file = join(home.path, 'AGENTS.md');
    const text = await readFile(file).catch(() => undefined);
    return [
      `## Home: ${home.name}`,
      `The space's home is ${home.name}, checked out at ${home.place}.`,
      ...text?.toString('utf8').trim() ? [
        "Its AGENTS.md below is space-wide context for every project in the space. Where it conflicts with this project's own instructions, this project's own instructions win.",
        `<home-agents-md path="${file}">\n${capped(text, file)}\n</home-agents-md>`,
      ] : [],
    ];
  }

  private async member(key: string): Promise<Member> {
    const { projects, checkouts } = this.deps.projects();
    const project = projects.find((p) => projectKey(p) === key);
    const name = project?.name ?? nameOfKey(key);
    const path = (await checkoutHere({ projects, checkouts }, project))?.path;
    // #195 clones a missing sibling and says when it can't be had on this machine.
    if (!path) return { name, place: 'not on this machine yet' };
    const branch = await currentBranch(path);
    return { name, path, place: branch ? `${path} (${branch})` : path };
  }
}

/** The file's text, cut at the cap on a character boundary with a note pointing to the full file. */
function capped(text: Buffer, file: string) {
  if (text.length <= HOME_INSTRUCTIONS_BYTES) return text.toString('utf8').trimEnd();
  // A character split by the cut decodes to a replacement character; drop it.
  const kept = text.subarray(0, HOME_INSTRUCTIONS_BYTES).toString('utf8').replace(/�+$/, '');
  return `${kept}\n\n[Cut at 16 KB of ${Math.ceil(text.length / 1024)} KB. Read the full file at ${file}.]`;
}

/** The first of the project's checkouts still on disk here, in the order they were added. */
export async function checkoutHere({ checkouts }: ProjectsState, project: ProjectView | undefined): Promise<CheckoutView | undefined> {
  for (const c of project ? checkouts.filter((c) => c.projectId === project.id) : []) {
    if (await stat(c.path).then((s) => s.isDirectory(), () => false)) return c;
  }
  return undefined;
}

/** A project this machine has no record of goes by its repository's name, as a new checkout of it would. */
export function nameOfKey(key: string) {
  return key.split('/').pop() || key;
}

async function currentBranch(path: string): Promise<string | undefined> {
  const branch = await maybeGit(path, 'symbolic-ref', '--quiet', '--short', 'HEAD');
  if (branch) return `branch ${branch}`;
  const commit = await maybeGit(path, 'rev-parse', '--short', 'HEAD');
  return commit ? `detached at ${commit}` : undefined;
}
