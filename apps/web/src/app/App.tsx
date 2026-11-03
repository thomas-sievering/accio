import { useCallback, useState } from 'react';
import { MachineBadge } from '../machine/MachineBadge';
import { claudeAccount, ProfilesProvider, useProfiles } from '../profiles/profiles';
import { ProjectsProvider, useProjects } from '../projects/projects';
import { AddProjectSheet } from '../projects/AddProjectSheet';
import { ProjectSheet } from '../projects/ProjectSheet';
import { ThreadsProvider, useThreads } from '../threads/threads';
import { NewThreadButton } from '../threads/NewThreadButton';
import { ThreadList } from '../threads/ThreadList';
import { DraftPane, ThreadPane } from '../threads/ThreadPane';
import { ThreadSearch } from '../threads/ThreadSearch';
import { FirstRun } from './FirstRun';
import { Close, FolderPlus, Settings as Gear } from './icons';
import { ScopeMenu } from './ScopeMenu';
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

/**
 * Sidebar filters narrow the thread list; the header adds projects and the
 * gear opens Settings (profiles, hub, machine); everything a
 * thread can do is on its right-click menu.
 */
function Shell() {
  const { profiles, filter, setFilter } = useProfiles();
  const { state } = useProjects();
  const { threads, selectedId, draft, projectScope, setProjectScope } = useThreads();
  const filterLabel = state?.projects.find((p) => p.id === projectScope)?.name
    ?? profiles?.find((p) => p.id === filter)?.name;
  const thread = threads?.find((t) => t.id === selectedId);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [settings, setSettings] = useState<SettingsRoute | null>(null);
  const closeSettings = useCallback(() => setSettings(null), []);
  const close = () => setSheet(null);
  const openProject = sheet?.kind === 'project' ? state?.projects.find((p) => p.id === sheet.id) : undefined;
  const openProfile = (profileId: string) => setSettings({ section: 'profiles', profileId });
  const setUp = profiles && state && profiles.length > 0 && profiles.some((p) => claudeAccount(p)?.signedIn) && state.projects.length > 0;

  if (settings) return <Settings route={settings} onRoute={setSettings} onClose={closeSettings} />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="side-top drag">
          <span className="side-title">Threads</span>
          <button className="side-icon" title="Add project" aria-label="Add project" disabled={!profiles?.length} onClick={() => setSheet({ kind: 'addProject' })}>
            <FolderPlus />
          </button>
        </header>
        <div className="side-controls">
          <div className="side-tools">
            <ThreadSearch />
            <ScopeMenu onOpenProject={(p) => setSheet({ kind: 'project', id: p.id })} />
            <NewThreadButton />
          </div>
          {filterLabel && (
            <div className="side-filter-summary">
              <button className="filter-chip" title={`Clear filter: ${filterLabel}`} aria-label={`Clear filter: ${filterLabel}`} onClick={() => { setFilter('all'); setProjectScope(''); }}>
                <span>{filterLabel}</span><Close />
              </button>
            </div>
          )}
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
        {draft ? (
          <DraftPane key={`${draft.checkoutId}:${draft.profileId}`} {...draft} onOpenProfile={openProfile} />
        ) : thread ? (
          <ThreadPane key={thread.id} thread={thread} onOpenProfile={openProfile} />
        ) : (
          <>
            <header className="main-top drag" />
            {profiles && state && !setUp ? <FirstRun /> : <Idle />}
          </>
        )}
      </main>
      {sheet?.kind === 'addProject' && <AddProjectSheet onClose={close} />}
      {openProject && <ProjectSheet project={openProject} onClose={close} />}
    </div>
  );
}

function Idle() {
  return (
    <div className="empty">
      <p>Pick a thread, or start a new one.</p>
      <NewThreadButton className="ghost primary with-icon" label="New thread" />
    </div>
  );
}
