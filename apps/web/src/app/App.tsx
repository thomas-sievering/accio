import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { LimitsProvider } from '../limits/limits';
import type { LimitsScope } from '../limits/limitsModel';
import { defaultLimitsScope } from '../limits/limitsModel';
import { LimitsView } from '../limits/LimitsView';
import { hasSignedInAccount, ProfilesProvider, useProfiles } from '../profiles/profiles';
import { ProjectsProvider, useProjects } from '../projects/projects';
import { AddProjectSheet } from '../projects/AddProjectSheet';
import { ProjectDashboard } from '../projects/ProjectDashboard';
import { SpaceView } from '../spaces/SpaceView';
import { useSpaces } from '../spaces/spaces';
import { ThreadsProvider, useThreads } from '../threads/threads';
import { PendingSecretsProvider } from '../secrets/pendingSecrets';
import { ResourcesProvider } from '../resources/resources';
import { NewThreadButton } from '../threads/NewThreadButton';
import { ThreadList } from '../threads/ThreadList';
import { DraftPane, ThreadPane } from '../threads/ThreadPane';
import { ThreadSearch } from '../threads/ThreadSearch';
import { useAppEvent } from './appEvents';
import { useClient } from './connection';
import { ConnectionNotice } from './ConnectionNotice';
import { FirstRun } from './FirstRun';
import { ArrowLeft, Close, FolderPlus, Limits, Settings as Gear } from './icons';
import { closePage, limitsPage, loadPage, pageUnderSettings, savedPage, settingsPage, THREAD_PAGE, type Page } from './page';
import { ScopeMenu } from './ScopeMenu';
import { SidebarResizer } from './Resizer';
import { Settings, type SettingsRoute } from './Settings';
import { PanelToggle, SidePanel, useNarrow, usePanelOpen } from './SidePanel';
import { SnoozeNotice } from '../threads/SnoozeNotice';
import { PhoneMachine, usePhoneLayout } from './phoneLayout';
import { useLive } from './useLive';
import { viewTransition } from '../ui/viewTransition';
import { ThisBrowser, useBrowserTheme } from './ThisBrowser';

type OpenSheet = { kind: 'addProject' | 'browser' } | null;

export function App() {
  const { browser, hubId } = useClient();
  const viewKey = `accio:${hubId}:view`;
  // The app reopens on the page it closed on; a thread or draft under it comes back on its own.
  const [page, setPage] = useState<Page>(() => {
    const saved = loadPage(localStorage.getItem(viewKey));
    return browser ? pageUnderSettings(saved) : saved;
  });
  const phone = usePhoneLayout();
  const [inbox, setInbox] = useState(true);
  useEffect(() => localStorage.setItem(viewKey, JSON.stringify(savedPage(page))), [viewKey, page]);
  const showThread = useCallback((open?: () => void) => {
    const update = () => {
      open?.();
      if (open) setInbox(false);
      setPage(THREAD_PAGE);
    };
    if (open && phone && page.kind === 'thread' && document.querySelector('.phone-layout > .main[hidden]')) {
      void viewTransition('phone-open', update).then(() => document.querySelector<HTMLElement>('.phone-back')?.focus());
    } else update();
  }, [phone, page.kind]);
  const showInbox = () => {
    void viewTransition('phone-back', () => setInbox(true)).then(() => {
      const target = document.querySelector<HTMLElement>('.sidebar .row-main[aria-current="page"]')
        ?? document.querySelector<HTMLElement>('.phone-inbox-title');
      target?.scrollIntoView({ block: 'nearest' });
      target?.focus({ preventScroll: true });
    });
  };
  return (
    <ProfilesProvider>
      <LimitsProvider>
        <ProjectsProvider>
          <ThreadsProvider onNavigate={showThread}>
            <ResourcesProvider>
              <PendingSecretsProvider>
                <Shell page={page} setPage={setPage} phone={phone} inbox={inbox} onInbox={showInbox} />
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
function Shell({ page, setPage, phone, inbox, onInbox }: { page: Page; setPage: Dispatch<SetStateAction<Page>>; phone: boolean; inbox: boolean; onInbox: () => void }) {
  const client = useClient();
  const { browser } = client;
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  const theme = useBrowserTheme(browser);
  const { profiles, accounts, filter, setFilter } = useProfiles();
  const { state } = useProjects();
  const { spaces } = useSpaces();
  const { threads, selectedId, select, draft, emptyPage, projectScope, setProjectScope } = useThreads();
  const filterLabel = state?.projects.find((p) => p.id === projectScope)?.name
    ?? state?.elsewhere?.find((p) => p.id === projectScope)?.name
    ?? profiles?.find((p) => p.id === filter)?.name;
  const thread = threads?.find((t) => t.id === selectedId);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const settings = page.kind === 'settings' ? page.route : null;
  // The main pane's page (under Settings, the one they return to). A dashboard or space view whose project or space is gone shows the thread surface.
  const under = pageUnderSettings(page);
  const dashboardProject = under.kind === 'dashboard' ? state?.projects.find((p) => p.id === under.projectId) : undefined;
  const openSpace = under.kind === 'space' ? spaces?.find((s) => s.id === under.spaceId) : undefined;
  const covered = under.kind === 'limits' || !!dashboardProject || !!openSpace;
  // A machine without checkouts is set up once the hub has projects to clone here.
  const setUp = profiles && state && profiles.length > 0 && profiles.some((p) => hasSignedInAccount(p, accounts)) && (state.checkouts.length > 0 || !!state.elsewhere?.length);
  const settingUp = !browser && !!profiles && !!accounts && !!state && !setUp;
  const phoneInbox = phone && !covered && !settingUp && (inbox || (!thread && !draft));
  const openSettings = useCallback((route: SettingsRoute) => {
    if (!browser) setPage((p) => settingsPage(p, route));
  }, [browser, setPage]);
  const closeCurrent = useCallback(() => setPage(closePage), [setPage]);
  useAppEvent('settings.open', openSettings);
  // One project editor: the header chip and the Filter gear open its Settings page.
  useAppEvent('project.open', ({ id }) => openSettings({ section: 'projects', id }));
  useAppEvent('project.dashboard', ({ id }) => setPage({ kind: 'dashboard', projectId: id }));
  useAppEvent('space.open', ({ id }) => setPage({ kind: 'space', spaceId: id }));
  const [panelWanted, togglePanel] = usePanelOpen();
  // The panel belongs to an open thread or draft: home, onboarding, Limits, a project dashboard and a space view have none.
  const hasPane = !!(thread || draft) && !covered && !phoneInbox;
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
    setSheet(null);
  };
  useAppEvent('thread.open', ({ id }) => openThread(id));
  const close = () => setSheet(null);
  const openProfile = (profileId: string) => openSettings({ section: 'profiles', id: profileId });
  const openSecrets = useCallback((profileId: string) => openSettings({ section: 'secrets', extra: { profileId } }), [openSettings]);
  const openAccount = (accountId: string) => openSettings({ section: 'accounts', id: accountId });
  // Closing Limits returns focus to what opened them, or to Settings' Limits link when they return to Settings.
  const limitsReturnFocus = useRef<HTMLElement | null>(null);
  const closeLimits = useCallback(() => {
    const toSettings = page.kind === 'limits' && page.back?.kind === 'settings';
    setPage(closePage);
    requestAnimationFrame(() => {
      if (toSettings) {
        [...document.querySelectorAll<HTMLElement>('.settings-link')].find((el) => el.textContent?.trim() === 'Limits')?.focus();
        return;
      }
      const target = limitsReturnFocus.current;
      if (target?.isConnected && !target.closest('[hidden]')) target.focus();
    });
  }, [page, setPage]);
  const openLimits = (scope: LimitsScope) => {
    limitsReturnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPage((p) => limitsPage(p, scope));
  };
  const draftProfileId = draft && (draft.profileId ?? state?.projects.find((p) => p.id === state.checkouts.find((c) => c.id === draft.checkoutId)?.projectId)?.profileId);
  const currentProfileId = draft ? draftProfileId ?? undefined : thread?.profileId;
  const inSettings = settings !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inSettings || settingUp || (phone && !phoneInbox) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      // Ctrl+N or Ctrl+T opens the New thread picker.
      if ((e.ctrlKey || e.metaKey) && (key === 'n' || key === 't')) {
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
  }, [inSettings, settingUp, phone, phoneInbox]);
  // Arrow keys step between the sidebar's thread rows.
  const onRowKeys = (e: React.KeyboardEvent<HTMLElement>) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !(e.target instanceof HTMLElement) || !e.target.matches('.row-main')) return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.row-main')];
    const next = rows[rows.indexOf(e.target) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
  };
  // The page over the thread surface. Under Settings none renders, so Escape stays with Settings.
  const coveringPage = () => {
    if (inSettings) return null;
    switch (under.kind) {
      case 'limits':
        return <LimitsView scope={under.scope} onScope={(scope) => setPage((p) => p.kind === 'limits' ? { ...p, scope } : p)} onClose={closeLimits} onOpenAccount={openAccount} />;
      case 'dashboard':
        return dashboardProject && <ProjectDashboard key={dashboardProject.id} project={dashboardProject} onClose={closeCurrent} />;
      case 'space':
        return openSpace && <SpaceView key={openSpace.id} space={openSpace} onClose={closeCurrent} />;
      case 'thread':
        return null;
    }
  };
  const threadActive = !covered && !inSettings && !phoneInbox;

  return (
    <PhoneMachine.Provider value={phone ? machines?.find((machine) => machine.thisMachine)?.name : undefined}>
      {settings && <Settings route={settings} onRoute={openSettings} onClose={closeCurrent} onOpenThread={openThread}
        onOpenLimits={() => openLimits(defaultLimitsScope(profiles, currentProfileId, filter))} />}
      <div className={`layout${panelOpen ? ' with-panel' : ''}${phone ? ' phone-layout' : ''}`} hidden={inSettings}>
        <aside className="sidebar" hidden={phone && !phoneInbox} inert={overlay}>
          <div className="side-controls drag">
            {phone && <h1 className="phone-inbox-title" tabIndex={-1}>Inbox</h1>}
            <div className="side-tools">
              {!settingUp && <ThreadSearch />}
              {!settingUp && <ScopeMenu onOpenProject={(p) => openSettings({ section: 'projects', id: p.id })} />}
              {!browser && <button className="side-icon" title="Add project" aria-label="Add project" disabled={!profiles?.length} onClick={() => setSheet({ kind: 'addProject' })}>
                <FolderPlus />
              </button>}
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
            {browser ? <button className="side-icon" title="This browser" aria-label="This browser" onClick={() => setSheet({ kind: 'browser' })}>
              <Gear />
            </button> : <button className="side-icon" title="Settings" aria-label="Settings" onClick={() => openSettings({ section: 'accounts' })}>
              <Gear />
            </button>}
            <button className={`side-icon${page.kind === 'limits' ? ' on-page' : ''}`} title="Limits" aria-label="Limits" aria-pressed={page.kind === 'limits'}
              onClick={() => page.kind === 'limits' ? closeLimits() : openLimits(defaultLimitsScope(profiles, currentProfileId, filter))}>
              <Limits />
            </button>
            <ConnectionNotice />
          </footer>
        </aside>
        <div inert={overlay} style={{ display: 'contents' }}><SidebarResizer /></div>
        <div className="main" role="main" hidden={phoneInbox} inert={overlay}>
          {phone && threadActive && (thread || draft) && <div className="phone-navigation drag">
            <button className="phone-back" onClick={onInbox}><ArrowLeft /> Inbox</button>
            {client.browser && <ConnectionNotice />}
          </div>}
          {coveringPage()}
          {/* Keep the composer and reading position mounted under every other page. */}
          <div className="thread-surface" hidden={!threadActive}>
            {draft ? (
              <DraftPane key={`${draft.checkoutId}:${draft.profileId}:${draft.elsewhereId ?? ''}`} {...draft} active={threadActive} onOpenProfile={openProfile} onOpenLimits={openLimits} />
            ) : thread ? (
              <ThreadPane key={thread.id} thread={thread} onOpenSecrets={browser ? undefined : openSecrets} active={threadActive} onOpenProfile={openProfile} onOpenLimits={openLimits} />
            ) : (
              <>
                <header className="main-top drag" />
                {settingUp ? <FirstRun /> : emptyPage ? <EmptyPage /> : <Idle />}
              </>
            )}
          </div>
        </div>
        {overlay && <div className="panel-scrim" onClick={dismissOverlay} />}
        {panelOpen && <SidePanel overlay={overlay} />}
        {hasPane && <PanelToggle open={panelOpen} onToggle={togglePanel} />}
        {sheet?.kind === 'addProject' && <AddProjectSheet onClose={close} />}
        {sheet?.kind === 'browser' && <ThisBrowser {...theme} onClose={close} />}
      </div>
    </PhoneMachine.Provider>
  );
}

/** GLOSSARY: Move on. Where Move on lands when the inbox is empty; it becomes a landing page later. */
function EmptyPage() {
  return <section className="empty-page" aria-label="Empty page" />;
}

function Idle() {
  return (
    <div className="empty">
      <p>Pick a thread, or start a new one.</p>
      <NewThreadButton className="ghost primary with-icon" label="New thread" />
    </div>
  );
}
