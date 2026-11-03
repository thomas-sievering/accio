import { useCallback, useRef, useState } from 'react';
import { LimitsProvider } from '../limits/limits';
import type { LimitsScope } from '../limits/limitsModel';
import { defaultLimitsScope } from '../limits/limitsModel';
import { LimitsView } from '../limits/LimitsView';
import { MachineBadge } from '../machine/MachineBadge';
import { hasSignedInAccount, ProfilesProvider, useProfiles } from '../profiles/profiles';
import { ProjectsProvider, useProjects } from '../projects/projects';
import { AddProjectSheet } from '../projects/AddProjectSheet';
import { ProjectSheet } from '../projects/ProjectSheet';
import { ThreadsProvider, useThreads } from '../threads/threads';
import { NewThreadButton } from '../threads/NewThreadButton';
import { ThreadList } from '../threads/ThreadList';
import { DraftPane, ThreadPane } from '../threads/ThreadPane';
import { ThreadSearch } from '../threads/ThreadSearch';
import { FirstRun } from './FirstRun';
import { Close, FolderPlus, Limits, Settings as Gear } from './icons';
import { ScopeMenu } from './ScopeMenu';
import { SidebarResizer } from './SidebarResizer';
import { Settings, type SettingsRoute } from './Settings';

type OpenSheet = { kind: 'addProject' } | { kind: 'project'; id: string } | null;

export function App() {
  return (
    <ProfilesProvider>
      <LimitsProvider>
        <ProjectsProvider>
          <ThreadsProvider>
            <Shell />
          </ThreadsProvider>
        </ProjectsProvider>
      </LimitsProvider>
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
  const { threads, selectedId, draft, projectScope, setProjectScope, navigation } = useThreads();
  const filterLabel = state?.projects.find((p) => p.id === projectScope)?.name
    ?? profiles?.find((p) => p.id === filter)?.name;
  const thread = threads?.find((t) => t.id === selectedId);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [settings, setSettings] = useState<SettingsRoute | null>(null);
  const closeSettings = useCallback(() => setSettings(null), []);
  const close = () => setSheet(null);
  const openProject = sheet?.kind === 'project' ? state?.projects.find((p) => p.id === sheet.id) : undefined;
  const openProfile = (profileId: string) => setSettings({ section: 'profiles', profileId });
  const openAccount = (accountId: string) => setSettings({ section: 'accounts', accountId });
  // Limits cover the main pane until a thread or draft is opened; settings opened from them return here.
  const [limits, setLimits] = useState<{ scope: LimitsScope; navigation: number } | null>(null);
  const limitsReturnFocus = useRef<HTMLElement | null>(null);
  const limitsOpen = limits !== null && limits.navigation === navigation;
  const closeLimits = useCallback(() => {
    setLimits(null);
    requestAnimationFrame(() => {
      const target = limitsReturnFocus.current;
      if (target?.isConnected && !target.closest('[hidden]')) target.focus();
    });
  }, []);
  const openLimits = (scope: LimitsScope) => {
    limitsReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLimits({ scope, navigation });
  };
  const draftProfileId = draft && (draft.profileId ?? state?.projects.find((p) => p.id === state.checkouts.find((c) => c.id === draft.checkoutId)?.projectId)?.profileId);
  const currentProfileId = draft ? draftProfileId ?? undefined : thread?.profileId;
  const setUp = profiles && state && profiles.length > 0 && profiles.some(hasSignedInAccount) && state.projects.length > 0;

  return (
    <>
      {settings && <Settings route={settings} onRoute={setSettings} onClose={closeSettings} />}
      <div className="layout" hidden={settings !== null}>
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
            <button className={`side-icon${limitsOpen ? ' on-page' : ''}`} title="Limits" aria-label="Limits" aria-pressed={limitsOpen}
              onClick={() => limitsOpen ? closeLimits() : openLimits(defaultLimitsScope(profiles, currentProfileId, filter))}>
              <Limits />
            </button>
          </footer>
        </aside>
        <SidebarResizer />
        <main className="main">
          {limitsOpen && !settings && (
            <LimitsView scope={limits.scope} onScope={(scope) => setLimits({ scope, navigation })} onClose={closeLimits}
              onOpenAccount={openAccount} onOpenProfile={openProfile} />
          )}
          {/* Keep the composer and reading position mounted while checking limits/settings. */}
          <div className="thread-surface" hidden={limitsOpen || settings !== null}>
            {draft ? (
              <DraftPane key={`${draft.checkoutId}:${draft.profileId}`} {...draft} active={!limitsOpen && !settings} onOpenProfile={openProfile} onOpenLimits={openLimits} />
            ) : thread ? (
              <ThreadPane key={thread.id} thread={thread} active={!limitsOpen && !settings} onOpenProfile={openProfile} onOpenLimits={openLimits} />
            ) : (
              <>
                <header className="main-top drag" />
                {profiles && state && !setUp ? <FirstRun /> : <Idle />}
              </>
            )}
          </div>
        </main>
        {sheet?.kind === 'addProject' && <AddProjectSheet onClose={close} />}
        {openProject && <ProjectSheet project={openProject} onClose={close} />}
      </div>
    </>
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
