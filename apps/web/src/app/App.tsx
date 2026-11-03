import { useState } from 'react';
import { MachineBadge } from '../machine/MachineBadge';
import { AccountsProvider, useAccounts } from '../accounts/accounts';
import { AccountSwitcher } from '../accounts/AccountSwitcher';
import { AccountsSheet } from '../accounts/AccountsSheet';
import { ProjectsProvider, useProjects } from '../projects/projects';
import { ProjectList } from '../projects/ProjectList';
import { AddProjectSheet } from '../projects/AddProjectSheet';
import { ProjectSheet } from '../projects/ProjectSheet';
import { ThreadsProvider, useThreads } from '../threads/threads';
import { ThreadRows } from '../threads/ThreadRows';
import { ThreadPane } from '../threads/ThreadPane';
import { FolderPlus, Users } from './icons';

type OpenSheet = { kind: 'accounts'; accountId?: string } | { kind: 'addProject' } | { kind: 'project'; id: string } | null;

export function App() {
  return (
    <AccountsProvider>
      <ProjectsProvider>
        <ThreadsProvider>
          <Shell />
        </ThreadsProvider>
      </ProjectsProvider>
    </AccountsProvider>
  );
}

function Shell() {
  const { accounts } = useAccounts();
  const { state } = useProjects();
  const { threads, selectedId } = useThreads();
  const thread = threads?.find((t) => t.id === selectedId);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const close = () => setSheet(null);
  const openProject = sheet?.kind === 'project' ? state?.projects.find((p) => p.id === sheet.id) : undefined;
  const noAccounts = accounts?.length === 0;

  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="side-top drag">
          <AccountSwitcher onManage={() => setSheet({ kind: 'accounts' })} />
          <button
            className="side-icon"
            title="Add project"
            aria-label="Add project"
            disabled={noAccounts}
            onClick={() => setSheet({ kind: 'addProject' })}
          >
            <FolderPlus />
          </button>
        </header>
        <nav className="side-body">
          <ProjectList onOpenProject={(p) => setSheet({ kind: 'project', id: p.id })} renderBody={(p) => <ThreadRows project={p} />} />
        </nav>
        <footer className="side-foot">
          <MachineBadge />
          <button className="side-icon" title="Accounts" aria-label="Accounts" onClick={() => setSheet({ kind: 'accounts' })}>
            <Users />
          </button>
        </footer>
      </aside>
      <main className="main">
        {thread ? (
          <ThreadPane key={thread.id} thread={thread} onOpenAccount={(accountId) => setSheet({ kind: 'accounts', accountId })} />
        ) : (
          <>
            <header className="main-top drag" />
            <div className="empty">
              {noAccounts ? (
                <>
                  <p>Add an account first. Every thread runs under one.</p>
                  <button className="ghost" onClick={() => setSheet({ kind: 'accounts' })}>
                    Add account
                  </button>
                </>
              ) : state?.projects.length === 0 ? (
                <>
                  <p>Add a project: a folder on this machine, usually a git repository.</p>
                  <button className="ghost" onClick={() => setSheet({ kind: 'addProject' })}>
                    Add project
                  </button>
                </>
              ) : (
                'Pick a thread, or start one under a project.'
              )}
            </div>
          </>
        )}
      </main>
      {sheet?.kind === 'accounts' && <AccountsSheet onClose={close} openAccountId={sheet.accountId} />}
      {sheet?.kind === 'addProject' && <AddProjectSheet onClose={close} />}
      {openProject && <ProjectSheet project={openProject} onClose={close} />}
    </div>
  );
}
