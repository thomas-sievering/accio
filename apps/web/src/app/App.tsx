import { useCallback, useEffect, useRef, useState } from 'react';
import { LimitsProvider } from '../limits/limits';
import type { LimitsScope } from '../limits/limitsModel';
import { defaultLimitsScope } from '../limits/limitsModel';
import { LimitsView } from '../limits/LimitsView';
import { ChangelogView } from '../changelog/ChangelogView';
import { hasSignedInAccount, ProfilesProvider, useProfiles } from '../profiles/profiles';
import { ProjectsProvider, useProjects } from '../projects/projects';
import { AddProjectSheet } from '../projects/AddProjectSheet';
import { ProjectDashboard } from '../projects/ProjectDashboard';
import { ThreadsProvider, useThreads } from '../threads/threads';
import { PendingSecretsProvider } from '../secrets/pendingSecrets';
import { ResourcesProvider } from '../resources/resources';
import { NewThreadButton } from '../threads/NewThreadButton';
import { ThreadList } from '../threads/ThreadList';
import { DraftPane, ThreadPane } from '../threads/ThreadPane';
import { ThreadSearch } from '../threads/ThreadSearch';
import { useAppEvent } from './appEvents';
import { ConnectionNotice } from './ConnectionNotice';
import { FirstRun } from './FirstRun';
import { Close, FolderPlus, Limits, ScrollText, Settings as Gear } from './icons';
import { ScopeMenu } from './ScopeMenu';
import { SidebarResizer } from './Resizer';
import { Settings, type SettingsRoute } from './Settings';
import { PanelToggle, SidePanel, useNarrow, usePanelOpen } from './SidePanel';
import { SnoozeNotice } from '../threads/SnoozeNotice';

type OpenSheet = { kind: 'addProject' } | null;

export function App() {
  return (
    <ProfilesProvider>
      <LimitsProvider>
        <ProjectsProvider>
          <ThreadsProvider>
            <ResourcesProvider>
              <PendingSecretsProvider>
                <Shell />
              </PendingSecretsProvider>
            </ResourcesProvider>
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
  const { threads, selectedId, select, draft, projectScope, setProjectScope, navigation } = useThreads();
  const filterLabel = state?.projects.find((p) => p.id === projectScope)?.name
    ?? profiles?.find((p) => p.id === filter)?.name;
  const thread = threads?.find((t) => t.id === selectedId);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [settings, setSettings] = useState<SettingsRoute | null>(null);
  const closeSettings = useCallback(() => setSettings(null), []);
  useAppEvent('settings.open', setSettings);
  // One project editor: the header chip and the Filter gear open its Settings page.
  useAppEvent('project.open', ({ id }) => setSettings({ section: 'projects', projectId: id }));
  const [panelWanted, togglePanel] = usePanelOpen();
  const [limits, setLimits] = useState<{ scope: LimitsScope; navigation: number } | null>(null);
  const [dashboard, setDashboard] = useState<{ projectId: string; navigation: number } | null>(null);
  // Like Limits, the dashboard covers the main pane until a thread or draft is opened.
  const dashboardProject = dashboard !== null && dashboard.navigation === navigation ? state?.projects.find((p) => p.id === dashboard.projectId) : undefined;
  const closeDashboard = useCallback(() => setDashboard(null), []);
  useAppEvent('project.dashboard', ({ id }) => { setLimits(null); setChangelog(null); setDashboard({ projectId: id, navigation }); });
  const limitsOpen = limits !== null && limits.navigation === navigation;
  // GLOSSARY: Changelog. Covers the main pane like Limits until a thread or draft is opened.
  const [changelog, setChangelog] = useState<{ navigation: number; projectId?: string } | null>(null);
  const changelogOpen = changelog !== null && changelog.navigation === navigation && !limitsOpen;
  const closeChangelog = useCallback(() => setChangelog(null), []);
  const openChangelog = (projectId?: string) => { setLimits(null); setSettings(null); setDashboard(null); setChangelog({ navigation, projectId }); };
  useAppEvent('changelog.open', ({ projectId }) => openChangelog(projectId));
  // The panel belongs to an open thread or draft: home, onboarding, Limits, the Changelog and a project dashboard have none.
  const hasPane = !!(thread || draft) && !limitsOpen && !changelogOpen && !dashboardProject;
  const panelOpen = panelWanted && hasPane;
  const narrow = useNarrow();
  const overlay = panelOpen && narrow && settings === null;
  const dismissOverlay = useCallback(() => {
    togglePanel();
    document.querySelector<HTMLElement>('.panel-toggle')?.focus();
  }, [togglePanel]);
  useEffect(() => {
    if (!overlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector(':popover-open')) return;
      dismissOverlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay, dismissOverlay]);
  const openThread = (id: string) => {
    select(id);
    setSettings(null);
    setSheet(null);
  };
  const close = () => setSheet(null);
  const openProfile = (profileId: string) => setSettings({ section: 'profiles', profileId });
  const openSecrets = useCallback((profileId: string) => setSettings({ section: 'secrets', profileId }), []);
  const openAccount = (accountId: string) => setSettings({ section: 'accounts', accountId });
  // Limits cover the main pane until a thread or draft is opened; settings opened from them return here.
  const limitsReturnFocus = useRef<HTMLElement | null>(null);
  const limitsOrigin = useRef<SettingsRoute | undefined>(undefined);
  const closeLimits = useCallback(() => {
    setLimits(null);
    const origin = limitsOrigin.current;
    limitsOrigin.current = undefined;
    if (origin) setSettings(origin);
    requestAnimationFrame(() => {
      if (origin) {
        [...document.querySelectorAll<HTMLElement>('.settings-link')].find((el) => el.textContent?.trim() === 'Limits')?.focus();
        return;
      }
      const target = limitsReturnFocus.current;
      if (target?.isConnected && !target.closest('[hidden]')) target.focus();
    });
  }, []);
  const openLimits = (scope: LimitsScope, origin?: SettingsRoute) => {
    limitsOrigin.current = origin;
    limitsReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDashboard(null);
    setLimits({ scope, navigation });
  };
  const draftProfileId = draft && (draft.profileId ?? state?.projects.find((p) => p.id === state.checkouts.find((c) => c.id === draft.checkoutId)?.projectId)?.profileId);
  const currentProfileId = draft ? draftProfileId ?? undefined : thread?.profileId;
  const setUp = profiles && state && profiles.length > 0 && profiles.some(hasSignedInAccount) && state.checkouts.length > 0;
  // Until setup is done there is nothing to search, filter or start a thread in.
  const settingUp = !!profiles && !!state && !setUp;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settings || settingUp || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'n') {
        e.preventDefault();
        document.querySelector<HTMLButtonElement>('.side-tools [aria-label="New thread"]')?.click();
        return;
      }
      // Ctrl+K anywhere, or "/" outside a text field, jumps to the sidebar search.
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
      if (((e.ctrlKey || e.metaKey) && key === 'k') || (e.key === '/' && !e.ctrlKey && !e.metaKey && !typing)) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('.side-search input')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings, settingUp]);
  // Arrow keys step between the sidebar's thread rows.
  const onRowKeys = (e: React.KeyboardEvent<HTMLElement>) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !(e.target instanceof HTMLElement) || !e.target.matches('.row-main')) return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.row-main')];
    const next = rows[rows.indexOf(e.target) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  return (
    <>
      {settings && <Settings route={settings} onRoute={setSettings} onClose={closeSettings} onOpenThread={openThread}
        onOpenLimits={() => { setSettings(null); openLimits(defaultLimitsScope(profiles, currentProfileId, filter), settings); }} />}
      <div className={`layout${panelOpen ? ' with-panel' : ''}`} hidden={settings !== null}>
        <aside className="sidebar" inert={overlay}>
          <div className="side-controls drag">
            <div className="side-tools">
              {!settingUp && <ThreadSearch />}
              {!settingUp && <ScopeMenu onOpenProject={(p) => setSettings({ section: 'projects', projectId: p.id })} />}
              <button className="side-icon" title="Add project" aria-label="Add project" disabled={!profiles?.length} onClick={() => setSheet({ kind: 'addProject' })}>
                <FolderPlus />
              </button>
              {!settingUp && <NewThreadButton />}
            </div>
            {filterLabel && (
              <div className="side-filter-summary">
                <button className="filter-chip" title={`Clear filter: ${filterLabel}`} aria-label={`Clear filter: ${filterLabel}`} onClick={() => { setFilter('all'); setProjectScope(''); }}>
                  <span>{filterLabel}</span><Close />
                </button>
              </div>
            )}
          </div>
          <nav className="side-body" onKeyDown={onRowKeys}>
            <ThreadList />
          </nav>
          <SnoozeNotice />
          <footer className="side-foot">
            <button className="side-icon" title="Settings" aria-label="Settings" onClick={() => setSettings({ section: 'accounts' })}>
              <Gear />
            </button>
            <button className={`side-icon${changelogOpen ? ' on-page' : ''}`} title="Changelog" aria-label="Changelog" aria-pressed={changelogOpen}
              onClick={() => changelogOpen ? closeChangelog() : openChangelog()}>
              <ScrollText />
            </button>
            <button className={`side-icon${limitsOpen ? ' on-page' : ''}`} title="Limits" aria-label="Limits" aria-pressed={limitsOpen}
              onClick={() => limitsOpen ? closeLimits() : openLimits(defaultLimitsScope(profiles, currentProfileId, filter))}>
              <Limits />
            </button>
            <ConnectionNotice />
          </footer>
        </aside>
        <div inert={overlay} style={{ display: 'contents' }}><SidebarResizer /></div>
        <div className="main" role="main" inert={overlay}>
          {limitsOpen && !settings && (
            <LimitsView scope={limits.scope} onScope={(scope) => setLimits({ scope, navigation })} onClose={closeLimits}
              onOpenAccount={openAccount} />
          )}
          {changelogOpen && !settings && <ChangelogView key={changelog.projectId ?? ''} projectId={changelog.projectId} onClose={closeChangelog} />}
          {dashboardProject && !limitsOpen && !changelogOpen && !settings && <ProjectDashboard key={dashboardProject.id} project={dashboardProject} onClose={closeDashboard} />}
          {/* Keep the composer and reading position mounted while checking limits/settings. */}
          <div className="thread-surface" hidden={limitsOpen || changelogOpen || !!dashboardProject || settings !== null}>
            {draft ? (
              <DraftPane key={`${draft.checkoutId}:${draft.profileId}`} {...draft} active={!limitsOpen && !changelogOpen && !dashboardProject && !settings} onOpenProfile={openProfile} onOpenLimits={openLimits} />
            ) : thread ? (
              <ThreadPane key={thread.id} thread={thread} onOpenSecrets={openSecrets} active={!limitsOpen && !changelogOpen && !dashboardProject && !settings} onOpenProfile={openProfile} onOpenLimits={openLimits} />
            ) : (
              <>
                <header className="main-top drag" />
                {settingUp ? <FirstRun /> : <Idle />}
              </>
            )}
          </div>
        </div>
        {overlay && <div className="panel-scrim" onClick={dismissOverlay} />}
        {panelOpen && <SidePanel overlay={overlay} />}
        {hasPane && <PanelToggle open={panelOpen} onToggle={togglePanel} />}
        {sheet?.kind === 'addProject' && <AddProjectSheet onClose={close} />}
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
