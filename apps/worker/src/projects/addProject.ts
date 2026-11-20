import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { FolderInspection, HubProject } from '@accio/protocol';
import { accioTool } from '../tools/tools.js';
import { UserError } from '../rpc/router.js';
import type { ConfirmationRequest } from '../threads/confirmations.js';
import { normalizeRemoteUrl } from './repoIdentity.js';

type Outcome = 'allowed' | 'declined' | 'expired' | 'cancelled';
export type AddProjectDeps = {
  /** The calling thread's profile, when the thread runs on this machine. */
  caller: (threadId: string) => { profileId: string } | undefined;
  profiles: () => readonly { id: string; name: string }[];
  /** checkouts.inspect: what Settings → Projects would do with the folder. */
  inspect: (path: string) => Promise<FolderInspection>;
  /** checkouts.add, which also registers a new project with the hub. */
  addFolder: (path: string, profileId: string) => Promise<unknown>;
  /** The project this machine or the hub already keeps for a repository. */
  known: (repoKey: string) => { name: string; profileId: string } | undefined;
  /** Why the profile can't reach the repository, or nothing when it can or it can't be checked. */
  checkRepository: (repoKey: string, profileId: string) => Promise<string | undefined>;
  /** Projects.addRepository: the hub keeps it without a checkout until a thread clones it. */
  addRepository: (repoKey: string, profileId: string) => Promise<HubProject>;
  confirm: (threadId: string, request: ConfirmationRequest, signal: AbortSignal) => Promise<Outcome>;
};

type Plan = { name: string; repoKey: string | null; profileId: string; joins: boolean } & ({ path: string } | { path?: undefined });

/**
 * GLOSSARY: Project. The add_project accio tool: a thread adds projects for the user who asked for it
 * in the conversation, from folders on its machine as "Add project" in Settings → Projects does, or
 * from repositories alone, which the hub keeps until a thread clones them. A repository Accio already
 * knows keeps its project and profile; a new one takes the profile named, else for a folder the one
 * whose folders hold it, else the thread's. The project's profile then holds for every machine, so the
 * user allows the change first, as for edit_space.
 */
export function addProjectTool(deps: AddProjectDeps) {
  return accioTool({
    name: 'add_project',
    description: 'Add projects to Accio, as Settings → Projects does, so threads can start in them and spaces can include them. The user is asked to allow it first. '
      + 'Give folders on this machine, or repositories by their remote alone: Accio clones a repository when a thread starts in it. '
      + 'A repository Accio already knows keeps its project; a new one belongs to the profile named, else for a folder the profile whose folders hold it, else this thread\'s profile. '
      + 'To put the projects in a space, call edit_space afterwards.',
    input: {
      folders: z.array(z.string().trim().min(1).max(1000)).max(20).optional().describe('Absolute paths of folders on this machine, each a repository checkout or a plain folder'),
      repositories: z.array(z.string().trim().min(1).max(500)).max(20).optional().describe('Repositories by key or remote URL, such as github.com/owner/repo'),
      profile: z.string().trim().min(1).max(200).optional().describe('Name or id of the profile for new projects, as in Settings → Profiles'),
    },
    call: async (args, { threadId, signal, progress }) => {
      const folders = [...new Set(args.folders ?? [])];
      const repositories = [...new Set(args.repositories ?? [])];
      if (!folders.length && !repositories.length) throw new UserError('Nothing to add: give folders or repositories.');
      const profiles = deps.profiles();
      const named = args.profile ? findProfile(profiles, args.profile) : undefined;
      const fallback = named?.id ?? deps.caller(threadId)?.profileId;
      const nameOf = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;
      const needProfile = (name: string) => new UserError(`Name the profile for ${name} in profile: ${profiles.map((p) => p.name).join(', ')}.`);

      const plans: Plan[] = [];
      const already: string[] = [];
      for (const wanted of folders) {
        if (!isAbsolute(wanted)) throw new UserError(`${wanted} is not an absolute path. Give the full path of the folder on this machine.`);
        const found = await deps.inspect(wanted).catch((error: Error) => { throw new UserError(`${wanted}: ${error.message}`); });
        if (found.alreadyAdded) { already.push(found.name); continue; }
        if (plans.some((p) => p.path === found.path)) continue;
        const profileId = found.existingProject?.profileId ?? named?.id ?? found.suggestedProfileId ?? fallback;
        if (!profileId) throw needProfile(found.name);
        plans.push({ path: found.path, name: found.name, repoKey: found.repoKey, profileId, joins: !!found.existingProject });
      }
      for (const wanted of repositories) {
        const repoKey = repoKeyOf(wanted);
        if (plans.some((p) => p.repoKey === repoKey)) continue;
        const known = deps.known(repoKey);
        if (known) { already.push(`${known.name} (${repoKey})`); continue; }
        const name = repoKey.split('/').pop()!;
        if (!fallback) throw needProfile(name);
        progress(`Checking ${repoKey}`);
        const problem = await deps.checkRepository(repoKey, fallback);
        if (problem) throw new UserError(`${nameOf(fallback)} can't reach ${repoKey}: ${problem}`);
        plans.push({ name, repoKey, profileId: fallback, joins: false });
      }
      const alreadyText = already.length ? `${list(already)} ${already.length > 1 ? 'are' : 'is'} already a project.` : '';
      if (!plans.length) return `${alreadyText} Nothing was changed.`;

      const lines = plans.map((p) => p.path
        ? `${p.name} (${p.repoKey ?? 'no remote, stays on this machine'}) from ${p.path}, ${p.joins ? 'joining its project in' : 'in'} profile ${nameOf(p.profileId)}.`
        : `${p.name} (${p.repoKey}) in profile ${nameOf(p.profileId)}, cloned when a thread starts in it.`);
      const outcome = await deps.confirm(threadId, {
        title: plans.length > 1 ? `Add ${plans.length} projects?` : `Add the project ${plans[0]!.name}?`,
        detail: `${lines.join(' ')} A project's profile holds on every machine.`,
        allowLabel: plans.length > 1 ? 'Add projects' : 'Add project',
      }, signal);
      if (outcome !== 'allowed') return outcome === 'declined' ? 'The user declined adding these projects. Nothing was added.' : 'The confirmation ended without an answer. Nothing was added.';

      const added: string[] = [];
      for (const plan of plans) {
        progress(`Adding ${plan.name}`);
        let profileId = plan.profileId;
        try {
          if (plan.path) await deps.addFolder(plan.path, plan.profileId);
          else profileId = (await deps.addRepository(plan.repoKey!, plan.profileId)).profileId;
        } catch (error) {
          const done = added.length ? ` Added before it: ${list(added)}.` : '';
          throw new UserError(`Could not add ${plan.name}: ${(error as Error).message.replace(/\.?$/, '.')}${done}`);
        }
        added.push(`${plan.name}${plan.repoKey ? ` (${plan.repoKey})` : ''} in profile ${nameOf(profileId)}`);
      }
      return `Added ${list(added)}. ${alreadyText}`.trim();
    },
  });
}

/** github.com/owner/repo, or any remote URL of it, as its project key. */
function repoKeyOf(wanted: string): string {
  const key = normalizeRemoteUrl(/^[^:/]+\.[^:/]+\//.test(wanted) ? `https://${wanted}` : wanted);
  if (!key || key.split('/').length < 3) throw new UserError(`${wanted} is not a repository. Give its key, such as github.com/owner/repo, or its remote URL.`);
  return key;
}

function findProfile(profiles: readonly { id: string; name: string }[], wanted: string) {
  const text = wanted.toLowerCase();
  const found = profiles.find((p) => p.id === wanted) ?? profiles.find((p) => p.name.toLowerCase() === text);
  if (found) return found;
  throw new UserError(`There is no profile called ${wanted}. Profiles: ${profiles.map((p) => p.name).join(', ')}.`);
}

function list(items: string[]) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/**
 * Why gh, as the profile's GitHub account, can't see a GitHub repository; nothing when it can. Other
 * hosts aren't checked: a wrong key there fails when a thread first clones it.
 */
export async function githubRepoProblem(repoKey: string, gh: (args: string[]) => Promise<string>): Promise<string | undefined> {
  const [host, ...path] = repoKey.split('/');
  if (host !== 'github.com') return undefined;
  try {
    await gh(['repo', 'view', path.join('/'), '--json', 'name']);
    return undefined;
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? '').trim();
    if ((error as { code?: string }).code === 'ENOENT') return 'gh is not installed on this machine, so it can\'t be checked. Add a folder of it instead.';
    return stderr.split(/\r?\n/).filter(Boolean).pop() ?? (error as Error).message;
  }
}
