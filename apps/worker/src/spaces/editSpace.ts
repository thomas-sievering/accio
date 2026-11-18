import { z } from 'zod';
import { projectKey, type ProjectsState, type SaveSpace, type Space } from '@accio/protocol';
import { accioTool } from '../tools/tools.js';
import { UserError } from '../rpc/router.js';
import type { ConfirmationRequest } from '../threads/confirmations.js';
import { nameOfKey } from './spaceContext.js';

type Outcome = 'allowed' | 'declined' | 'expired' | 'cancelled';
export type EditSpaceDeps = {
  /** The calling thread's project, when the thread runs on this machine. */
  caller: (threadId: string) => { projectId: string } | undefined;
  spaces: () => readonly Space[];
  /** This machine's projects, and the hub's projects it has no checkout of. */
  projects: () => ProjectsState;
  /** spaces.save, which the hub checks against the spaces' rules. */
  save: (space: SaveSpace) => Promise<Space>;
  confirm: (threadId: string, request: ConfirmationRequest, signal: AbortSignal) => Promise<Outcome>;
};

const NO_HOME = 'none';
type Known = { key: string; name: string };

/**
 * GLOSSARY: Space. The edit_space accio tool: a thread adds projects to a space, removes them, sets
 * or clears its home, or renames it, for the user who asked for it in the conversation. Which space
 * a project is in decides what context and siblings every thread in the space gets, so every edit
 * waits for the user to allow it (ADR 0019). It never creates or deletes a space; Settings does.
 */
export function editSpaceTool(deps: EditSpaceDeps) {
  return accioTool({
    name: 'edit_space',
    description: 'Change a space: add projects to it, remove projects, set or clear its home, or rename it. The user is asked to allow the change first. '
      + 'Use it when the user asks to change which projects are in a space. A project is in at most one space, so remove it from its other space first. '
      + 'Threads in the space see the change from their next turn. It can\'t create or delete a space: that is in Settings → Spaces.',
    input: {
      space: z.string().trim().min(1).max(200).optional().describe('Name or id of the space to change. Defaults to the space of this thread\'s project.'),
      add_projects: z.array(z.string().trim().min(1).max(300)).max(50).optional().describe('Projects to add, by name as in Settings → Projects or by repository key, such as github.com/owner/repo'),
      remove_projects: z.array(z.string().trim().min(1).max(300)).max(50).optional().describe('Projects to remove, by name or key'),
      home: z.string().trim().min(1).max(300).optional().describe(`The project to make the home, which must be in the space after the change, or "${NO_HOME}" for no home`),
      rename: z.string().trim().min(1).max(100).optional().describe('A new name for the space'),
    },
    call: async (args, { threadId, signal, progress }) => {
      const add = args.add_projects ?? [];
      const remove = args.remove_projects ?? [];
      if (!add.length && !remove.length && !args.home && !args.rename) throw new UserError('Nothing to change: give add_projects, remove_projects, home or rename.');
      const spaces = deps.spaces();
      const space = args.space ? findSpace(spaces, args.space) : ownSpace(deps, threadId, spaces);
      const known = knownProjects(deps.projects(), space);
      const nameOf = (key: string) => known.find((p) => p.key === key)?.name ?? nameOfKey(key);

      const added = add.map((wanted) => findProject(known, wanted)).filter((p) => !space.projectKeys.includes(p.key));
      for (const p of added) {
        const other = spaces.find((s) => s.id !== space.id && s.projectKeys.includes(p.key));
        if (other) throw new UserError(`${p.name} is already in the space "${other.name}". Remove it there first: edit_space with space "${other.name}" and remove_projects.`);
      }
      const members = known.filter((p) => space.projectKeys.includes(p.key));
      const removed = remove.map((wanted) => findProject(members, wanted, `the space "${space.name}"`));
      const removedKeys = new Set(removed.map((p) => p.key));
      const projectKeys = [...new Set([...space.projectKeys.filter((k) => !removedKeys.has(k)), ...added.map((p) => p.key)])];

      let home = space.homeProjectKey && projectKeys.includes(space.homeProjectKey) ? space.homeProjectKey : undefined;
      if (args.home) {
        home = args.home.toLowerCase() === NO_HOME ? undefined
          : findProject(known.filter((p) => projectKeys.includes(p.key)), args.home, `the space "${space.name}" after this change`).key;
      }
      const name = args.rename ?? space.name;

      const changes = [
        name !== space.name && `Rename it to ${name}.`,
        added.length && `Add ${list(added.map((p) => p.name))}.`,
        removed.length && `Remove ${list(removed.map((p) => p.name))}.`,
        home !== space.homeProjectKey && (home ? `Make ${nameOf(home)} its home.` : 'Leave it without a home.'),
      ].filter(Boolean);
      if (!changes.length) return `The space "${space.name}" already looks like that. Nothing was changed.`;
      const outcome = await deps.confirm(threadId, {
        title: `Change the space ${space.name}?`,
        detail: `${changes.join(' ')} Its projects will be ${projectKeys.length ? list(projectKeys.map(nameOf)) : 'none'}. Threads in the space get this as their context from their next turn.`,
        allowLabel: 'Change space',
      }, signal);
      if (outcome !== 'allowed') return outcome === 'declined' ? 'The user declined this change to the space. Nothing was saved.' : 'The confirmation ended without an answer. Nothing was saved.';

      progress(`Saving ${name}`);
      const saved = await deps.save({ id: space.id, name, projectKeys, ...(home ? { homeProjectKey: home } : {}) });
      const homeText = saved.homeProjectKey ? `home ${nameOf(saved.homeProjectKey)}` : 'no home';
      return `Saved the space "${saved.name}": ${saved.projectKeys.length ? list(saved.projectKeys.map(nameOf)) : 'no projects'}; ${homeText}. Threads in the space see it from their next turn.`;
    },
  });
}

function findSpace(spaces: readonly Space[], wanted: string): Space {
  const text = wanted.toLowerCase();
  const found = spaces.find((s) => s.id === wanted) ?? spaces.find((s) => s.name.toLowerCase() === text);
  if (found) return found;
  throw new UserError(spaces.length ? `There is no space called ${wanted}. Spaces: ${spaces.map((s) => s.name).join(', ')}.` : 'There are no spaces yet. Add one in Settings → Spaces.');
}

function ownSpace(deps: EditSpaceDeps, threadId: string, spaces: readonly Space[]): Space {
  const caller = deps.caller(threadId);
  const project = caller && deps.projects().projects.find((p) => p.id === caller.projectId);
  const own = project && spaces.find((s) => s.projectKeys.includes(projectKey(project)));
  if (own) return own;
  throw new UserError(`This thread's project is in no space. Name the space to change in space${spaces.length ? `: ${spaces.map((s) => s.name).join(', ')}` : ''}.`);
}

/** Projects by key: this machine's, the hub's others, then members known only by their key. */
function knownProjects(state: ProjectsState, space: Space): Known[] {
  const all: Known[] = [
    ...state.projects.map((p) => ({ key: projectKey(p), name: p.name })),
    ...(state.elsewhere ?? []).map((p) => ({ key: p.repoKey, name: p.name })),
    ...space.projectKeys.map((key) => ({ key, name: nameOfKey(key) })),
  ];
  return all.filter((p, i) => all.findIndex((q) => q.key === p.key) === i);
}

function findProject(candidates: Known[], wanted: string, where = 'Settings → Projects'): Known {
  const text = wanted.toLowerCase();
  const byKey = candidates.find((p) => p.key.toLowerCase() === text);
  if (byKey) return byKey;
  const byName = candidates.filter((p) => p.name.toLowerCase() === text);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) throw new UserError(`More than one project is called ${wanted}. Name one by its key: ${byName.map((p) => p.key).join(', ')}.`);
  const names = candidates.map((p) => p.name).slice(0, 40);
  throw new UserError(`${wanted} is not a project in ${where}.${names.length ? ` Projects there: ${names.join(', ')}${candidates.length > names.length ? ', …' : ''}.` : ''}`
    + (where === 'Settings → Projects' ? ' Add it there first.' : ''));
}

function list(items: string[]) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}
