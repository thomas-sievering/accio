import { useCallback, useState } from 'react';
import { MachineBadge } from '../machine/MachineBadge';
import { ProfilesProvider, useProfiles } from '../profiles/profiles';
import { ProfileSwitcher } from '../profiles/ProfileSwitcher';
import { ProjectsProvider, useProjects } from '../projects/projects';
import { ProjectScopeMenu } from '../projects/ProjectScopeMenu';
import { AddProjectSheet } from '../projects/AddProjectSheet';
import { ProjectSheet } from '../projects/ProjectSheet';
import { ThreadsProvider, useThreads } from '../threads/threads';
import { NewThreadButton } from '../threads/NewThreadButton';
import { ThreadList } from '../threads/ThreadList';
import { ThreadPane } from '../threads/ThreadPane';
import { ThreadSearch } from '../threads/ThreadSearch';
import { FolderPlus, Settings as Gear } from './icons';
import { Settings, type SettingsRoute } from './Settings';

type OpenSheet = { kind: 'addProject' } | { kind: 'project'; id: string } | null;

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
  const { threads, selectedId, projectScope, setProjectScope } = useThreads();
  const thread = threads?.find((t) => t.id === selectedId);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [settings, setSettings] = useState<SettingsRoute | null>(null);
  const closeSettings = useCallback(() => setSettings(null), []);
  const close = () => setSheet(null);
  const openProject = sheet?.kind === 'project' ? state?.projects.find((p) => p.id === sheet.id) : undefined;
  const noProfiles = profiles?.length === 0;

  if (settings) return <Settings route={settings} onRoute={setSettings} onClose={closeSettings} />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="side-top drag">
          <ProfileSwitcher onManage={() => setSettings({ section: 'profiles' })} />
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
        <div className="side-tools">
          <ThreadSearch />
          <ProjectScopeMenu scope={projectScope} onScope={setProjectScope} onOpenProject={(p) => setSheet({ kind: 'project', id: p.id })} />
          <NewThreadButton />
        </div>
        <nav className="side-body">
          <ThreadList />
        </nav>
        <footer className="side-foot">
          <MachineBadge onOpen={() => setSettings({ section: 'machines' })} />
          <button className="side-icon" title="Settings" aria-label="Settings" onClick={() => setSettings({ section: 'profiles' })}>
            <Gear />
          </button>
        </footer>
      </aside>
      <main className="main">
        {thread ? (
          <ThreadPane key={thread.id} thread={thread} onOpenProfile={(profileId) => setSettings({ section: 'profiles', profileId })} />
        ) : (
          <>
            <header className="main-top drag" />
            <div className="empty">
              {noProfiles ? (
                <>
                  <p>Add a profile first. Every thread runs under one.</p>
                  <button className="ghost" onClick={() => setSettings({ section: 'profiles', profileId: 'new' })}>
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
                'Pick a thread, or start a new one.'
              )}
            </div>
          </>
        )}
      </main>
      {sheet?.kind === 'addProject' && <AddProjectSheet onClose={close} />}
      {openProject && <ProjectSheet project={openProject} onClose={close} />}
    </div>
  );
}
