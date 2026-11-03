import { useCallback, useState } from 'react';
import { hasSignedInAccount, ProfilesProvider, useProfiles } from '../profiles/profiles';
import { ProjectsProvider, useProjects } from '../projects/projects';
import { AddProjectSheet } from '../projects/AddProjectSheet';
import { ProjectSheet } from '../projects/ProjectSheet';
import { ThreadsProvider, useThreads } from '../threads/threads';
import { ResourcesProvider } from '../resources/resources';
import { NewThreadButton } from '../threads/NewThreadButton';
import { ThreadList } from '../threads/ThreadList';
import { DraftPane, ThreadPane } from '../threads/ThreadPane';
import { ThreadSearch } from '../threads/ThreadSearch';
import { ConnectionNotice } from './ConnectionNotice';
import { FirstRun } from './FirstRun';
import { Close, FolderPlus, Limits, Owl, Settings as Gear } from './icons';
import { ScopeMenu } from './ScopeMenu';
import { SidebarResizer } from './Resizer';
import { Settings, type SettingsRoute } from './Settings';
import { PanelToggle, SidePanel, usePanelOpen } from './SidePanel';

type OpenSheet = { kind: 'addProject' } | { kind: 'project'; id: string } | null;

export function App() {
  return (
    <ProfilesProvider>
      <ProjectsProvider>
        <ThreadsProvider>
          <ResourcesProvider>
            <Shell />
          </ResourcesProvider>
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
  const { threads, selectedId, select, draft, projectScope, setProjectScope } = useThreads();
  const filterLabel = state?.projects.find((p) => p.id === projectScope)?.name
    ?? profiles?.find((p) => p.id === filter)?.name;
  const thread = threads?.find((t) => t.id === selectedId);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [settings, setSettings] = useState<SettingsRoute | null>(null);
  const closeSettings = useCallback(() => setSettings(null), []);
  const [panelOpen, togglePanel] = usePanelOpen();
  const openThread = (id: string) => {
    select(id);
    setSettings(null);
    setSheet(null);
  };
  const close = () => setSheet(null);
  const openProject = sheet?.kind === 'project' ? state?.projects.find((p) => p.id === sheet.id) : undefined;
  const openProfile = (profileId: string) => setSettings({ section: 'profiles', profileId });
  const setUp = profiles && state && profiles.length > 0 && profiles.some(hasSignedInAccount) && state.projects.length > 0;

  if (settings) return <Settings route={settings} onRoute={setSettings} onClose={closeSettings} onOpenThread={openThread} />;

  return (
    <div className={`layout${panelOpen ? ' with-panel' : ''}`}>
      <aside className="sidebar">
        <div className="side-controls drag">
          <div className="side-tools">
            <ThreadSearch />
            <ScopeMenu onOpenProject={(p) => setSheet({ kind: 'project', id: p.id })} />
            <button className="side-icon" title="Add project" aria-label="Add project" disabled={!profiles?.length} onClick={() => setSheet({ kind: 'addProject' })}>
              <FolderPlus />
            </button>
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
          <button className="side-icon" title="Settings" aria-label="Settings" onClick={() => setSettings({ section: 'profiles' })}>
            <Gear />
          </button>
          {/* Each account's usage limits, still to be built. */}
          <button className="side-icon" title="Usage limits · coming soon" aria-label="Usage limits, coming soon" aria-disabled="true">
            <Limits />
          </button>
          {/* The Owl, accio's agent across all threads, is still to be designed. */}
          <button className="side-icon" title="Owl · coming soon" aria-label="Owl, coming soon" aria-disabled="true">
            <Owl />
          </button>
          <ConnectionNotice />
        </footer>
      </aside>
      <SidebarResizer />
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
      {panelOpen && <SidePanel />}
      <PanelToggle open={panelOpen} onToggle={togglePanel} />
      {sheet?.kind === 'addProject' && <AddProjectSheet onClose={close} />}
      {openProject && <ProjectSheet project={openProject} onClose={close} onOpenSettings={(route) => { close(); setSettings(route); }} />}
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
