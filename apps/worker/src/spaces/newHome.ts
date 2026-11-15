import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { projectKey, type CreatedHome, type CreateHome, type ParamsOf, type ProjectsState, type SaveSpace, type Space, type ThreadView } from '@accio/protocol';
import { git, maybeGit } from '../git.js';
import type { Checkout } from '../projects/project.js';
import { UserError, type Router } from '../rpc/router.js';
import { homeTemplate, starterPrompt, type TemplateProject } from './homeTemplate.js';
import { nameOfKey } from './spaceContext.js';

export type NewHomeDeps = {
  spaces: () => readonly Space[];
  /** spaces.save, with the hub's refusals as user errors. */
  saveSpace: (space: SaveSpace) => Promise<Space>;
  projects: () => ProjectsState;
  addFolder: (path: string, profileId: string) => Promise<Checkout>;
  /** Throws for an unknown profile. */
  requireProfile: (profileId: string) => void;
  /** The profile's first folder on this machine, if it has one. */
  profileFolder: (profileId: string) => string | undefined;
  /** Refuses, as threads.start would, when a thread can't start in the profile on its default model now. */
  requireThreadsStart: (profileId: string) => Promise<void>;
  /** Removes a checkout this machine added, and its project with its last checkout. */
  removeCheckout: (checkoutId: string) => Promise<void>;
  /** The GitHub login chosen for the profile on this machine, if any. */
  githubLogin: (profileId: string) => string | undefined;
  /** Runs gh in `cwd` as the profile's GitHub account. */
  gh: (profileId: string, cwd: string, args: string[]) => Promise<string>;
  start: (params: ParamsOf<'threads.start'>) => Promise<ThreadView>;
};

/**
 * GLOSSARY: Home. "New home…" in Settings → Spaces: a new project from Accio's home template, made
 * the space's home in one step, with a first thread that fills it in from the sibling projects. A user
 * action only: no accio tool reaches it, since only the user decides what a space holds (ADR 0019).
 */
export class NewHomes {
  constructor(private deps: NewHomeDeps) {}

  register(router: Router) {
    router.on('spaces.createHome', (params) => this.create(params));
  }

  async create({ space, name, profileId, location }: CreateHome): Promise<CreatedHome> {
    this.deps.requireProfile(profileId);
    const members = this.members(space);
    await this.deps.requireThreadsStart(profileId).catch((error: Error) => {
      throw new UserError(`The home's first thread can't start in this profile: ${error.message}`);
    });
    // The repo belongs to the account the home's threads push as: the profile's chosen login, never gh's active one.
    const login = location === 'github' ? this.deps.githubLogin(profileId) : undefined;
    if (location === 'github' && !login) throw new UserError("Choose a GitHub account for this profile on this machine in Settings / Machines first. The home's repo is created under it.");
    const base = this.deps.profileFolder(profileId) ?? homedir();
    const path = join(base, name);
    await mkdir(base, { recursive: true });
    // Claims the folder: a second request for the same name fails here, and never removes this one's.
    await mkdir(path).catch((error: NodeJS.ErrnoException) => {
      throw error.code === 'EEXIST' ? new UserError(`${path} already exists. Choose another name.`) : error;
    });
    // Until the space is saved, nothing else points at the folder: a failure removes it, so the name stays free.
    const discard = () => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});

    let checkout: Checkout;
    try {
      await writeTemplate(path, homeTemplate(space.name, members));
      await commitAll(path, `Start the ${space.name} home`);
      if (login) await this.publish(path, name, profileId, login);
      checkout = await this.deps.addFolder(path, profileId);
    } catch (error) {
      await discard();
      throw error;
    }
    const project = this.deps.projects().projects.find((p) => p.id === checkout.projectId)!;
    const key = projectKey(project);
    const saved = await this.deps.saveSpace({ ...space, projectKeys: [...space.projectKeys.filter((k) => k !== key), key], homeProjectKey: key }).catch(async (error: Error) => {
      await this.deps.removeCheckout(checkout.id).then(discard, () => {});
      throw new UserError(`Couldn't make ${name} the home of ${space.name}: ${error.message}${location === 'github' ? ` Its GitHub repo stays; delete it there or add it again in Settings / Projects.` : ''}`);
    });
    const thread = await this.deps.start({ checkoutId: checkout.id, text: starterPrompt(saved.name, members) }).catch((error: Error) => {
      throw new UserError(`Created the home ${project.name}, but couldn't start its first thread: ${error.message}`);
    });
    return { space: saved, checkoutId: checkout.id, path, thread };
  }

  /** The space's projects by name, after the hub's rules are checked here so a refusal creates nothing. */
  private members(space: CreateHome['space']): TemplateProject[] {
    const spaces = this.deps.spaces();
    if (space.id !== undefined && !spaces.some((s) => s.id === space.id)) throw new UserError('This space no longer exists.');
    const { projects } = this.deps.projects();
    const members = [...new Set(space.projectKeys)].map((key) => ({ key, name: projects.find((p) => projectKey(p) === key)?.name ?? nameOfKey(key) }));
    for (const member of members) {
      const other = spaces.find((s) => s.id !== space.id && s.projectKeys.includes(member.key));
      if (other) throw new UserError(`${member.name} is already in the space ${other.name}. Remove it there first.`);
    }
    return members;
  }

  /**
   * A new private GitHub repo for the home under the profile's chosen GitHub login, created and pushed
   * by gh as that account. Only this call needs GitHub; tests fake gh here.
   */
  private async publish(path: string, name: string, profileId: string, login: string) {
    try {
      await this.deps.gh(profileId, path, ['repo', 'create', `${login}/${name}`, '--private', '--source', path, '--remote', 'origin', '--push']);
    } catch (error) {
      const lines = String((error as { stderr?: string }).stderr ?? (error as Error).message ?? '').trim().split(/\r?\n/).filter(Boolean);
      throw new UserError(`Could not create the GitHub repo ${name}${lines.length ? `: ${lines[lines.length - 1]}` : '.'}`);
    }
  }
}

async function writeTemplate(path: string, files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(path, file)), { recursive: true });
    await writeFile(join(path, file), content, { flag: 'wx' });
  }
}

/** The template as the home's first commit on main, by the user's git identity, else Accio's. */
async function commitAll(path: string, message: string) {
  await git(path, 'init', '--quiet', '-b', 'main');
  await git(path, 'add', '.');
  const identity = (await maybeGit(path, 'config', 'user.email')) ? [] : ['-c', 'user.name=Accio', '-c', 'user.email=accio@localhost'];
  await git(path, ...identity, 'commit', '--quiet', '-m', message);
}
