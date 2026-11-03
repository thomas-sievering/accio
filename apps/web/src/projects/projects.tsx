import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { CheckoutView, ProjectView, ProjectsState } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLive } from '../app/useLive';
import { useAccounts } from '../accounts/accounts';

type ProjectsCtx = {
  state: ProjectsState | undefined;
  /** Projects of the selected account (or all), sorted by name. */
  visible: ProjectView[];
  checkoutsOf: (projectId: string) => CheckoutView[];
};

const Ctx = createContext<ProjectsCtx | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const { filter } = useAccounts();
  const state = useLive(() => client.call('projects.get', {}), 'projects.changed');

  const value = useMemo<ProjectsCtx>(() => {
    const projects = state?.projects ?? [];
    return {
      state,
      visible: projects.filter((p) => filter === 'all' || p.accountId === filter).sort((a, b) => a.name.localeCompare(b.name)),
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
