import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { CheckoutView, MachineView, ProjectElsewhere, ProjectView, ProjectsState } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLive } from '../app/useLive';
import { useProfiles } from '../profiles/profiles';

type ProjectsCtx = {
  state: ProjectsState | undefined;
  /** Projects of the selected profile (or all), sorted by name. */
  visible: ProjectView[];
  /**
   * GLOSSARY: Project. Projects of the selected profile (or all) that this machine has no checkout of
   * but a thread can start in from here, sorted by name.
   */
  elsewhere: ProjectElsewhere[];
  checkoutsOf: (projectId: string) => CheckoutView[];
};

const Ctx = createContext<ProjectsCtx | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const { filter } = useProfiles();
  const state = useLive(() => client.call('projects.get', {}), 'projects.changed');

  const value = useMemo<ProjectsCtx>(() => {
    const projects = state?.projects ?? [];
    const shown = <P extends { profileId: string; name: string }>(list: P[]) => list.filter((p) => filter === 'all' || p.profileId === filter).sort((a, b) => a.name.localeCompare(b.name));
    return {
      state,
      visible: shown(projects),
      elsewhere: shown(state?.elsewhere ?? []),
      checkoutsOf: (id) => (state?.checkouts ?? []).filter((c) => c.projectId === id),
    };
  }, [state, filter]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjects(): ProjectsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useProjects outside ProjectsProvider');
  return c;
}

/** Where a project with no checkout here is: the online machines that have it, else nowhere yet. */
export function whereElsewhere(project: ProjectElsewhere, machines: MachineView[] | undefined): string {
  const names = project.on.map((c) => machines?.find((m) => m.id === c.machineId)?.name).filter((n): n is string => !!n);
  return names.length ? `On ${[...new Set(names)].join(', ')}` : 'Not on this machine';
}
