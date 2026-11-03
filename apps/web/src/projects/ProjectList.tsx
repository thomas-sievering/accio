import type { ReactNode } from 'react';
import type { ProjectView } from '@accio/protocol';
import { More } from '../app/icons';
import { AccountTile, useAccounts } from '../accounts/accounts';
import { useProjects } from './projects';

/** Sidebar groups, one per project of the selected account. */
export function ProjectList({
  onOpenProject,
  renderBody,
}: {
  onOpenProject: (p: ProjectView) => void;
  /** What goes under each project head (its threads, from the threads slice). */
  renderBody?: (p: ProjectView) => ReactNode;
}) {
  const { accounts = [], filter } = useAccounts();
  const { visible, state } = useProjects();

  if (state && visible.length === 0) {
    return <p className="side-empty">No projects{filter === 'all' ? '' : ' for this account'} yet.</p>;
  }

  return (
    <>
      {visible.map((p) => (
        <section key={p.id} className="group">
          <div className="group-head">
            {filter === 'all' && <AccountTile account={accounts.find((a) => a.id === p.accountId)} size="xs" />}
            <span className="group-name" title={p.repoKey ?? undefined}>
              {p.name}
            </span>
            <button className="group-action" title="Project settings" aria-label={`${p.name} settings`} onClick={() => onOpenProject(p)}>
              <More />
            </button>
          </div>
          {renderBody?.(p)}
        </section>
      ))}
    </>
  );
}
