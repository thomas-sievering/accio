import { useCallback, useEffect, useState } from 'react';
import type { SkillContext, WorkspaceSkill, WorkspaceSkills } from '@accio/protocol';
import { useClient } from '../app/connection';

export type WorkspaceSkillsState = { value?: WorkspaceSkills; error?: string; loading: boolean; reload: () => void };

/**
 * The skills a thread (or draft) would get on its next turn. Reloaded when the
 * context changes, the connection reopens, the hub's resources change, or this
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
    const offItem = client.onEvent('thread.item', ({ threadId, item }) => {
      if (params.threadId && threadId === params.threadId && item.kind === 'tool' && item.loadedSkills?.length) load();
    });
    load();
    return () => {
      active = false;
      offStatus();
      offResources();
      offItem();
    };
  }, [client, key, attempt]);

  return state.key === key ? { ...state, reload } : { loading: !!key, reload };
}

/** Where a skill comes from, as a short label. */
export function originLabel(skill: WorkspaceSkill): string {
  if (skill.origin === 'repository') return 'Repository';
  const via = skill.enabledBy === 'global' ? 'Everywhere' : skill.enabledBy === 'profile' ? 'Profile' : 'Library';
  return skill.sourceName ? `${via} · ${skill.sourceName}` : via;
}

/** Shown in the project list: files in the repository, and library skills this project turned on. */
export const isProjectSkill = (skill: WorkspaceSkill) => skill.origin === 'repository' || (skill.enabled && skill.enabledBy === 'project');
/** Turned on for every project of the profile, or for everything. */
export const isInherited = (skill: WorkspaceSkill) => skill.origin === 'library' && skill.enabled && (skill.enabledBy === 'profile' || skill.enabledBy === 'global');
/** Library skills nothing turned on here yet: what Add skill offers. */
export const isAddable = (skill: WorkspaceSkill) => skill.origin === 'library' && !skill.enabled;

export const byName = (a: WorkspaceSkill, b: WorkspaceSkill) => a.name.localeCompare(b.name);

/** The text a message gets when you reference a skill. */
export const skillReference = (skill: Pick<WorkspaceSkill, 'name'>) => `Use the ${skill.name} skill.`;
