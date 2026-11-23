import { harnessName as harnessNameOf } from '@accio/protocol';
import { useCallback, useEffect, useState } from 'react';
import type { SkillContext, SkillLevel, WorkspaceSkill, WorkspaceSkills } from '@accio/protocol';
import { useClient } from '../app/connection';

export type WorkspaceSkillsState = { value?: WorkspaceSkills; error?: string; loading: boolean; reload: () => void };

/**
 * The skills a thread (or draft) would get on its next turn. Reloaded when the
 * context changes, the connection reopens, the hub's resources or spaces change, a checkout
 * appears (such as a space's home cloned here), or this
 * thread's transcript reports a skill it loaded. A reload keeps the last list on
 * screen; a different context starts empty.
 */
export function useWorkspaceSkills(context: SkillContext | undefined): WorkspaceSkillsState {
  const client = useClient();
  const key = context ? JSON.stringify(context) : '';
  const [state, setState] = useState<{ key: string; value?: WorkspaceSkills; error?: string; loading: boolean }>({ key: '', loading: false });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!key) return;
    const params = JSON.parse(key) as SkillContext;
    let active = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      if (client.status !== 'open') return;
      setState((previous) => previous.key === key ? { ...previous, loading: true } : { key, loading: true });
      void client.call('threads.skills', params).then((value) => {
        if (active && current === generation) setState({ key, value, loading: false });
      }, (error: unknown) => {
        if (!active || current !== generation) return;
        const message = error instanceof Error ? error.message : String(error);
        setState((previous) => ({ key, value: previous.key === key ? previous.value : undefined, error: message, loading: false }));
      });
    };
    const offStatus = client.onStatus(load);
    const offResources = client.onEvent('resources.changed', load);
    const offSpaces = client.onEvent('spaces.changed', load);
    const offProjects = client.onEvent('projects.changed', load);
    const offItem = client.onEvent('thread.item', ({ threadId, item }) => {
      if (params.threadId && threadId === params.threadId && item.kind === 'tool' && item.loadedSkills?.length) load();
    });
    load();
    return () => {
      active = false;
      offStatus();
      offResources();
      offSpaces();
      offProjects();
      offItem();
    };
  }, [client, key, attempt]);

  return state.key === key ? { ...state, reload } : { loading: !!key, reload };
}

/** GLOSSARY: Skill level. How each level is named. */
export const LEVEL_NAMES: Record<SkillLevel, string> = { project: 'Project', space: 'Space', profile: 'Profile', global: 'Everywhere' };

/** GLOSSARY: Harness skill. The harness a section of its skills is titled with. */
export const harnessName = (harnessId: string) => (harnessId === 'claudeCode' ? 'Claude' : harnessNameOf(harnessId));

/** Where a skill comes from, as a short label. */
export function originLabel(skill: WorkspaceSkill): string {
  if (skill.origin === 'repository') return skill.enabledBy === 'space' ? 'Home' : 'Repository';
  const via = skill.enabledBy === 'global' || skill.enabledBy === 'profile' || skill.enabledBy === 'space' ? LEVEL_NAMES[skill.enabledBy] : 'Library';
  return skill.sourceName && skill.sourceName !== via ? `${via} · ${skill.sourceName}` : via;
}

/** Shown in the project list: files in the repository, and library skills this project turned on, unless a narrower one of the same name wins. */
export const isProjectSkill = (skill: WorkspaceSkill) => !skill.overriddenBy && skill.origin !== 'harness' && skill.enabled && skill.enabledBy === 'project';
/** GLOSSARY: Space. Files in the space's home, and library skills the space turned on, unless a narrower one of the same name wins. */
export const isSpaceSkill = (skill: WorkspaceSkill) => !skill.overriddenBy && skill.origin !== 'harness' && skill.enabled && skill.enabledBy === 'space';
/** Turned on for every project of the profile, or for everything, and not overridden by a narrower level. */
export const isInherited = (skill: WorkspaceSkill) => skill.origin === 'library' && skill.enabled && !skill.overriddenBy && (skill.enabledBy === 'profile' || skill.enabledBy === 'global');
/** ADR 0020: on at a level, but a narrower level has a skill of its name, which the thread gets instead. */
export const isOverridden = (skill: WorkspaceSkill) => skill.enabled && !!skill.overriddenBy;
/** GLOSSARY: Harness skill. Ships with the thread's harness. */
export const isHarnessSkill = (skill: WorkspaceSkill) => skill.origin === 'harness';
/** Library skills nothing turned on here yet: what the project's Add skill offers. */
export const isAddable = (skill: WorkspaceSkill) => skill.origin === 'library' && !skill.enabled;
/** Library skills the space hasn't turned on: what the space's Add skill offers, including ones on only for this project, profile or everywhere. */
export const isAddableToSpace = (skill: WorkspaceSkill) => skill.origin === 'library' && skill.enabledBy !== 'space';

export const byName = (a: WorkspaceSkill, b: WorkspaceSkill) => a.name.localeCompare(b.name);

/** The text a message gets when you reference a skill. */
export const skillReference = (skill: Pick<WorkspaceSkill, 'name'>) => `Use the ${skill.name} skill.`;
