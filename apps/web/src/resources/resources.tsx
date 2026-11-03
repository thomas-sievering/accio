import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ProfileView, ProjectView, ResourceScope, ResourcesState } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLiveState } from '../app/useLive';

type ResourcesCtx = {
  state: ResourcesState | undefined;
  loadError?: string;
  retry: () => void;
  /** Reads the hub's state now, for changes the hub does not announce (an OAuth callback). */
  refresh: () => Promise<ResourcesState>;
};

const Ctx = createContext<ResourcesCtx | null>(null);

/** Tools, MCP servers and skills the hub shares, kept current from `resources.changed`. */
export function ResourcesProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const live = useLiveState(() => client.call('resources.get', {}), 'resources.changed');
  const [fetched, setFetched] = useState<ResourcesState>();
  // A pushed state is newer than anything read before it.
  useEffect(() => setFetched(undefined), [live.value]);
  const refresh = useCallback(async () => {
    const next = await client.call('resources.get', {});
    setFetched(next);
    return next;
  }, [client]);
  const value = useMemo<ResourcesCtx>(() => ({ state: fetched ?? live.value, loadError: live.error, retry: live.retry, refresh }), [fetched, live.value, live.error, live.retry, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useResources(): ResourcesCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useResources outside ResourcesProvider');
  return c;
}

/** The key the hub selects a project by: its remote, so every checkout of it shares the selection. */
export const projectKey = (project: ProjectView) => project.repoKey ?? `local:${project.id}`;

export const optionalScope = (): ResourceScope => ({ global: false, profileIds: [], projectKeys: [] });
export const isOptional = (scope: ResourceScope) => !scope.global && scope.profileIds.length === 0 && scope.projectKeys.length === 0;

export function toggled(list: string[], id: string, on: boolean) {
  return on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id);
}

/** A short, human summary of where a resource is on. */
export function scopeSummary(scope: ResourceScope, profiles: ProfileView[] = [], projects: ProjectView[] = []): string {
  if (scope.global) return 'Everywhere';
  if (isOptional(scope)) return 'Optional · not enabled anywhere';
  const names = [
    ...scope.profileIds.map((id) => profiles.find((p) => p.id === id)?.name ?? 'Deleted profile'),
    ...scope.projectKeys.map((key) => projects.find((p) => projectKey(p) === key)?.name ?? key),
  ];
  return names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}

/** Why a resource is on for a profile or project, or undefined when it is not. */
export function enabledBecause(scope: ResourceScope, profileId?: string, key?: string): 'global' | 'profile' | 'project' | undefined {
  if (scope.global) return 'global';
  if (profileId && scope.profileIds.includes(profileId)) return 'profile';
  if (key && scope.projectKeys.includes(key)) return 'project';
  return undefined;
}

/** A hub id from a display name: letters, digits, `-` and `_`, starting with a letter or digit. */
export function slugId(name: string, taken: string[]) {
  const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 60) || 'item';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export const shortRevision = (revision: string) => revision.slice(0, 8);

/**
 * Edits on top of a live value. Fields the user has not touched keep following
 * the hub, so a broadcast never resets typing and never resurrects stale fields.
 */
export function useDraft<T extends object>(live: T) {
  const [changes, setChanges] = useState<Partial<T>>({});
  const value = { ...live, ...changes } as T;
  const dirty = (Object.keys(changes) as (keyof T)[]).some((k) => JSON.stringify(changes[k]) !== JSON.stringify(live[k]));
  const set = useCallback(<K extends keyof T>(key: K, v: T[K]) => setChanges((c) => ({ ...c, [key]: v })), []);
  const reset = useCallback(() => setChanges({}), []);
  return { value, dirty, set, reset };
}
