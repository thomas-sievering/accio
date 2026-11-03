import { useState } from 'react';
import { MachineBadge } from '../machine/MachineBadge';
import { ProfilesProvider, useProfiles } from '../profiles/profiles';
import { ProfileSwitcher } from '../profiles/ProfileSwitcher';
import { ProfilesSheet } from '../profiles/ProfilesSheet';
import { ProjectsProvider, useProjects } from '../projects/projects';
import { ProjectList } from '../projects/ProjectList';
import { AddProjectSheet } from '../projects/AddProjectSheet';
import { ProjectSheet } from '../projects/ProjectSheet';
import { ThreadsProvider, useThreads } from '../threads/threads';
import { ThreadRows } from '../threads/ThreadRows';
import { ThreadPane } from '../threads/ThreadPane';
import { ThreadShelves } from '../threads/ThreadShelves';
import { FolderPlus, Users } from './icons';

type OpenSheet = { kind: 'profiles'; profileId?: string } | { kind: 'addProject' } | { kind: 'project'; id: string } | null;

export function App() {
  return (
    <ProfilesProvider>
      <ProjectsProvider>
        <ThreadsProvider>
          <Shell />
        </ThreadsProvider>
      </ProjectsProvider>
    </ProfilesProvider>
  );
}

function Shell() {
  const { profiles } = useProfiles();
  const { state } = useProjects();
  const { threads, selectedId } = useThreads();
  const thread = threads?.find((t) => t.id === selectedId);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const close = () => setSheet(null);
  const openProject = sheet?.kind === 'project' ? state?.projects.find((p) => p.id === sheet.id) : undefined;
  const noProfiles = profiles?.length === 0;

  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="side-top drag">
          <ProfileSwitcher onManage={() => setSheet({ kind: 'profiles' })} />
          <button
            className="side-icon"
            title="Add project"
            aria-label="Add project"
            disabled={noProfiles}
            onClick={() => setSheet({ kind: 'addProject' })}
          >
            <FolderPlus />
          </button>
        </header>
        <nav className="side-body">
          <ProjectList onOpenProject={(p) => setSheet({ kind: 'project', id: p.id })} renderBody={(p) => <ThreadRows project={p} />} />
          <ThreadShelves />
        </nav>
        <footer className="side-foot">
          <MachineBadge />
          <button className="side-icon" title="Profiles" aria-label="Profiles" onClick={() => setSheet({ kind: 'profiles' })}>
            <Users />
          </button>
        </footer>
      </aside>
      <main className="main">
        {thread ? (
          <ThreadPane key={thread.id} thread={thread} onOpenProfile={(profileId) => setSheet({ kind: 'profiles', profileId })} />
        ) : (
          <>
            <header className="main-top drag" />
            <div className="empty">
              {noProfiles ? (
                <>
                  <p>Add a profile first. Every thread runs under one.</p>
                  <button className="ghost" onClick={() => setSheet({ kind: 'profiles' })}>
                    Add profile
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
      {sheet?.kind === 'profiles' && <ProfilesSheet onClose={close} openProfileId={sheet.profileId} />}
      {sheet?.kind === 'addProject' && <AddProjectSheet onClose={close} />}
      {openProject && <ProjectSheet project={openProject} onClose={close} />}
    </div>
  );
}
