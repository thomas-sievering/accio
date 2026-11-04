import { Fragment, createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { HubSettings } from '../hub/HubSettings';
import { MachineSettings } from '../machine/MachineSettings';
import { HarnessesSettings } from '../harnesses/HarnessesSettings';
import { SystemPromptSettings } from '../harnesses/SystemPromptSettings';
import { NamingSettings } from '../threads/NamingSettings';
import { AccountsSettings } from '../profiles/AccountsSettings';
import { ProfilesSettings } from '../profiles/ProfilesSettings';
import { useProfiles } from '../profiles/profiles';
import { SecretsSettings, type SecretsRoute } from '../secrets/SecretsSettings';
import { ToolsSettings } from '../tools/ToolsSettings';
import { McpSettings } from '../mcp/McpSettings';
import { SkillsSettings } from '../skills/SkillsSettings';
import { ProjectsSettings } from '../projects/ProjectsSettings';
import { useProjects } from '../projects/projects';
import { useResources } from '../resources/resources';
import { ArrowLeft, BookOpen, Chevron, Folder, IdCard, Key, Layers, Limits, Monitor, Plug, ScrollText, Users, Wrench } from './icons';
import { useClient } from './connection';
import { useLive } from './useLive';
import { SidebarResizer } from './Resizer';
import { HubSelector } from '../hub/HubSelector';

/** Where Settings is open. `profileId` opens one profile ('new' to add one). */
export type SettingsRoute = { section: 'profiles'; profileId?: string } | { section: 'accounts'; accountId?: string } | ({ section: 'secrets' } & SecretsRoute) | { section: 'hub'; hubId?: string } | { section: 'harnesses'; harnessId?: string } | { section: 'systemPrompt' } | { section: 'machines'; machineId?: string }
  | { section: 'naming' } | { section: 'tools'; toolId?: string } | { section: 'mcps'; mcpId?: string } | { section: 'skills'; sourceId?: string } | { section: 'projects'; projectId?: string };
type Section = SettingsRoute['section'];

/**
 * Every page listed is a shared setting of the hub chosen in the selector above them. This machine's saved hubs
 * open from that selector's menu instead. `limits` opens the Limits sheet, not a page.
 */
const GROUPS: { label: string; items: { id: Exclude<Section, 'hub'> | 'limits'; label: string; icon: ReactNode }[] }[] = [
  { label: 'Profiles', items: [
    { id: 'profiles', label: 'Profiles', icon: <Users /> },
    { id: 'accounts', label: 'Accounts', icon: <IdCard /> },
    { id: 'limits', label: 'Limits', icon: <Limits /> },
    { id: 'secrets', label: 'Secrets', icon: <Key /> },
  ] },
  { label: 'Threads', items: [
    { id: 'harnesses', label: 'Harnesses', icon: <Layers /> },
    { id: 'systemPrompt', label: 'System prompt', icon: <ScrollText /> },
    { id: 'naming', label: 'Thread naming', icon: <ScrollText /> },
  ] },
  { label: 'Tools and skills', items: [
    { id: 'tools', label: 'Tools', icon: <Wrench /> },
    { id: 'mcps', label: 'MCP servers', icon: <Plug /> },
    { id: 'skills', label: 'Skills', icon: <BookOpen /> },
  ] },
  { label: 'Projects and machines', items: [
    { id: 'projects', label: 'Projects', icon: <Folder /> },
    { id: 'machines', label: 'Machines', icon: <Monitor /> },
  ] },
];
const LABEL = { hub: 'Hubs', ...Object.fromEntries(GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label]))) } as Record<Section | 'limits', string>;

/**
 * Leaving a settings page with unsaved edits asks first. The page's footer registers
 * `ask` while it is dirty; it returns true when it took over (and calls `go` on Discard).
 */
const LeaveGuard = createContext<{ current?: (go: () => void) => boolean }>({});

/** Settings replace the whole window while open, as in T3 Code. Back (top of the sidebar, as in Cal.com and Circle) or Escape returns to the threads. */
export function Settings({ route, onRoute, onClose, onOpenThread, onOpenLimits }: { route: SettingsRoute; onRoute: (r: SettingsRoute) => void; onClose: () => void; onOpenThread: (threadId: string) => void; onOpenLimits?: () => void }) {
  const { profiles, accounts } = useProfiles();
  const { state: resources } = useResources();
  const { state: projectState } = useProjects();
  const profileId = route.section === 'profiles' ? route.profileId : undefined;
  const accountId = route.section === 'accounts' ? route.accountId : undefined;
  const accountLabel = accountId === 'new' || accountId === 'new-openai' ? 'New account' : accounts?.find((a) => a.id === accountId)?.name;
  const profileLabel = profileId === 'new' ? 'New profile' : profiles?.find((p) => p.id === profileId)?.name;
  const secretLabel = route.section === 'secrets' && route.secretId ? route.secretId === 'new' ? 'New secret' : route.replace ? 'Replace value' : 'Edit secret' : undefined;
  const backTo: SettingsRoute = route.section === 'secrets' ? { section: 'secrets', profileId: route.profileId } : { section: route.section };
  const toolId = route.section === 'tools' ? route.toolId : undefined;
  const mcpId = route.section === 'mcps' ? route.mcpId : undefined;
  const sourceId = route.section === 'skills' ? route.sourceId : undefined;
  const resourceLabel = toolId ? (toolId === 'new' ? 'New tool' : resources?.tools.find((t) => t.id === toolId)?.name)
    : mcpId ? (mcpId === 'new' ? 'New MCP server' : resources?.mcps.find((m) => m.id === mcpId)?.name)
      : sourceId ? (sourceId === 'new' ? 'New skill source' : resources?.sources.find((s) => s.id === sourceId)?.name)
        : undefined;
  const client = useClient();
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  const machineLabel = route.section === 'machines' && route.machineId ? machines?.find((m) => m.id === route.machineId)?.name : undefined;
  const hubLabel = route.section === 'hub' && route.hubId ? 'Add hub' : undefined;
  const projectLabel = route.section === 'projects' && route.projectId ? projectState?.projects.find((p) => p.id === route.projectId)?.name : undefined;
  const harnessLabel = route.section === 'harnesses' && route.harnessId ? 'Built-in tools' : undefined;
  const detailLabel = projectLabel || profileLabel || accountLabel || secretLabel || resourceLabel || machineLabel || hubLabel || harnessLabel;
  const previousDetail = useRef<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const previous = previousDetail.current;
    previousDetail.current = detailLabel;
    // Wait until hidden/unmounted panes have released browser focus.
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      if (active && root.current?.contains(active) && active !== document.body && !active.matches('.crumbs') && active.getClientRects().length) return;
      const rows = [...(root.current?.querySelectorAll<HTMLElement>('.settings-page .setting-link') ?? [])];
      const row = rows.find(el => el.querySelector('b')?.textContent === previous) ?? rows[0];
      (row ?? root.current?.querySelector<HTMLElement>('.settings-page input:not(:disabled), .settings-page button:not(:disabled)') ?? root.current?.querySelector<HTMLElement>('.main-top .crumbs'))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [route, detailLabel]);

  const inDetail = !!((route.section === 'harnesses' && route.harnessId) || profileId || accountId || toolId || mcpId || sourceId || (route.section === 'secrets' && route.secretId) || (route.section === 'machines' && route.machineId) || (route.section === 'hub' && route.hubId) || (route.section === 'projects' && route.projectId));
  // Escape goes up one level and leaves Settings only from a top-level page; an open inline confirmation takes it first (useEscape).
  const leave = useRef<(go: () => void) => boolean>(undefined);
  /** Every way out of a page (section, breadcrumb, Back, Escape) goes through the page's unsaved-edit check. */
  const go = (to: () => void) => { if (!leave.current?.(to)) to(); };
  const navigate = (r: SettingsRoute) => go(() => onRoute(r));
  const leaveSettings = () => go(onClose);
  const escape = useRef<() => void>(() => undefined);
  escape.current = () => (inDetail ? navigate(backTo) : leaveSettings());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Text fields use the same leave guard; native selects keep their own Escape.
      const t = e.target;
      // A sheet over Settings (project settings) takes Escape itself.
      if (document.querySelector('dialog[open], :popover-open')) return;
      if (e.key === 'Escape' && !e.defaultPrevented && !(t instanceof HTMLSelectElement)) {
        e.preventDefault();
        escape.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div ref={root} className="layout">
      <aside className="sidebar">
        <header className="side-top drag">
          <button className="settings-back" title="Back to threads (Esc)" onClick={leaveSettings}>
            <ArrowLeft />
            Back
          </button>
        </header>
        <nav className="side-body">
          <HubSelector onManage={() => navigate({ section: 'hub' })} />
          {GROUPS.map((g, n) => (
            <div key={n} className="settings-group">
              <div className="settings-group-label">{g.label}</div>
              {g.items.map(({ id, label, icon }) => id === 'limits' ? onOpenLimits && (
                <button key={id} className="settings-link" onClick={() => go(onOpenLimits)}>
                  {icon}
                  {label}
                </button>
              ) : (
                <button
                  key={id}
                  className={`settings-link${route.section === id ? ' active' : ''}`}
                  aria-current={route.section === id ? 'page' : undefined}
                  onClick={() => navigate({ section: id })}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <SidebarResizer />
      <main className="main">
        <header className="main-top drag">
          <nav className="crumbs" tabIndex={-1}>
            <span>Settings</span>
            <span className="sep">/</span>
            {detailLabel ? (
              <>
                <button onClick={() => navigate(backTo)}>{LABEL[route.section]}</button>
                <span className="sep">/</span>
                <b>{detailLabel}</b>
              </>
            ) : (
              <b>{LABEL[route.section]}</b>
            )}
          </nav>
        </header>
        <LeaveGuard.Provider value={leave}>
        <div className="settings-scroll">
          <div className="settings-page">
            {route.section === 'profiles' && (
              <ProfilesSettings
                profileId={profileId}
                onOpen={(id) => onRoute({ section: 'profiles', profileId: id })}
                onBack={() => onRoute({ section: 'profiles' })}
                onOpenSecrets={(id) => navigate({ section: 'secrets', profileId: id })}
              />
            )}
            {route.section === 'accounts' && <AccountsSettings accountId={accountId} onOpen={(id) => onRoute({ section: 'accounts', accountId: id })} onBack={() => onRoute({ section: 'accounts' })} />}
            {route.section === 'secrets' && <SecretsSettings route={route} onRoute={(r) => onRoute({ section: 'secrets', ...r })} />}
            {route.section === 'hub' && <HubSettings adding={!!route.hubId} onAdd={() => onRoute({ section: 'hub', hubId: 'new' })} onBack={() => onRoute({ section: 'hub' })} />}
            {route.section === 'harnesses' && <HarnessesSettings harnessId={route.harnessId} onOpen={(harnessId) => onRoute({ section: 'harnesses', harnessId })} onBack={() => onRoute({ section: 'harnesses' })} />}
            {route.section === 'systemPrompt' && <SystemPromptSettings />}
            {route.section === 'naming' && <NamingSettings />}
            {route.section === 'tools' && <ToolsSettings key={toolId ?? ''} toolId={toolId} onOpen={(id) => onRoute({ section: 'tools', toolId: id })} onBack={() => onRoute({ section: 'tools' })} onOpenThread={onOpenThread} />}
            {route.section === 'mcps' && <McpSettings key={mcpId ?? ''} mcpId={mcpId} onOpen={(id) => onRoute({ section: 'mcps', mcpId: id })} onBack={() => onRoute({ section: 'mcps' })} />}
            {route.section === 'skills' && <SkillsSettings key={sourceId ?? ''} sourceId={sourceId} onOpen={(id) => onRoute({ section: 'skills', sourceId: id })} onBack={() => onRoute({ section: 'skills' })} />}
            {route.section === 'projects' && <ProjectsSettings projectId={route.projectId} onOpen={(projectId) => onRoute({ section: 'projects', projectId })} onRoute={navigate} />}
            {route.section === 'machines' && <MachineSettings machineId={route.machineId} onOpen={(machineId) => onRoute({ section: 'machines', machineId })} onBack={() => onRoute({ section: 'machines' })} onOpenThread={onOpenThread} />}
          </div>
        </div>
        </LeaveGuard.Provider>
      </main>
    </div>
  );
}

/** While `active` (an inline confirmation is open), Escape cancels it and goes no further: this capture listener runs before Settings' own Escape handling. */
export function useEscape(active: boolean, cancel: () => void) {
  const latest = useRef(cancel);
  latest.current = cancel;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
}

/** A titled group of settings, drawn as one card. */
export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      {title && <h2>{title}</h2>}
      <div className="settings-card">{children}</div>
    </section>
  );
}

/** The one status treatment: a dot and a word, as Connected, Signed out or Local. */
export function StatusPill({ tone, children }: { tone?: 'ok' | 'bad' | 'warn' | 'busy'; children: ReactNode }) {
  return <span className={`pill${tone ? ` ${tone === 'warn' ? 'warn-pill' : tone}` : ''}`}><span className="dot" />{children}</span>;
}

/** One setting: what it is on the left, its value or control on the right. */
export function SettingRow({ icon, title, description, children }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="setting">
      {icon && <span className="menu-icon">{icon}</span>}
      <div className="setting-text">
        <b>{title}</b>
        {description && <small>{description}</small>}
      </div>
      {children && <div className="setting-value">{children}</div>}
    </div>
  );
}

/** A setting row that opens a page: icon, title and description, then any status and a chevron. Add rows skip the chevron. */
export function SettingLink({ icon, title, description, warn, chevron = true, onClick, children }: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Shows the description as a warning. */
  warn?: boolean;
  chevron?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button type="button" className="setting setting-link" onClick={onClick}>
      {icon && <span className="menu-icon">{icon}</span>}
      <span className="setting-text">
        <b>{title}</b>
        {description && <small className={warn ? 'warn' : undefined}>{description}</small>}
      </span>
      {children}
      {chevron && <Chevron />}
    </button>
  );
}

/**
 * The one footer of every settings detail page: Delete on the left, Cancel and Save on the right.
 * Without `saveLabel` the page has nothing to save and offers Done. Delete stays visible but disabled,
 * with `blocked` as its reason, when the thing is in use.
 * Every confirmation reads the same way: what happens, then Cancel, then the red action last.
 * With `dirty`, leaving the page another way asks "Discard changes?" here first.
 */
export function SettingsFooter({ remove, busy, onCancel, saveLabel, saveDisabled, saveForm, onSave, dirty = false }: {
  remove?: { name: string; run: () => void; blocked?: string; consequence?: string };
  busy?: boolean;
  onCancel: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  /** The id of the form to submit when the footer sits outside it. */
  saveForm?: string;
  /** Saves without a form; otherwise the button submits one. */
  onSave?: () => void;
  /** Unsaved edits: leaving through the sidebar, breadcrumb, Back or Escape asks first. */
  dirty?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState<() => void>();
  const save = useRef<HTMLButtonElement>(null);
  const guard = useContext(LeaveGuard);
  useEffect(() => {
    if (!dirty) return;
    guard.current = (go) => { setLeaving(() => go); return true; };
    return () => { guard.current = undefined; };
  }, [dirty, guard]);
  const keepEditing = () => { setLeaving(undefined); requestAnimationFrame(() => save.current?.focus()); };
  useEscape(confirming, () => setConfirming(false));
  useEscape(!!leaving, keepEditing);
  return (
    <footer className="settings-actions" role={leaving || confirming ? 'group' : undefined} aria-label={leaving ? 'Discard changes?' : confirming ? `Delete ${remove?.name}?` : undefined}>
      {remove && !leaving && (confirming ? (
        <>
          {remove.consequence && <small className="hint">{remove.consequence}</small>}
          <button type="button" className="ghost" disabled={busy} autoFocus onClick={() => setConfirming(false)}>Cancel</button>
          <button type="button" className="ghost danger" disabled={busy} onClick={remove.run}>Delete {remove.name}</button>
        </>
      ) : (
        <>
          <button type="button" className="ghost danger" disabled={busy || !!remove.blocked} onClick={() => setConfirming(true)}>Delete</button>
          {remove.blocked && <small className="hint">{remove.blocked}</small>}
        </>
      ))}
      <span className="spacer" />
      {/* Keep confirmation buttons distinct from Save: reusing a clicked button as
          type=submit can submit the form after its click handler keeps editing. */}
      {leaving ? (
        <Fragment key="discard-prompt">
          <small className="hint">Discard changes?</small>
          <button type="button" className="ghost" autoFocus onClick={keepEditing}>Keep editing</button>
          <button type="button" className="ghost danger" onClick={() => { const go = leaving; setLeaving(undefined); go(); }}>Discard</button>
        </Fragment>
      ) : !confirming && (
        <Fragment key="edit-actions">
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>{saveLabel ? 'Cancel' : 'Done'}</button>
          {saveLabel && (
            <button ref={save} type={onSave ? 'button' : 'submit'} form={onSave ? undefined : saveForm} className="ghost primary" disabled={saveDisabled} onClick={onSave}>{saveLabel}</button>
          )}
        </Fragment>
      )}
    </footer>
  );
}
