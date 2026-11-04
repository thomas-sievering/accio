import { useEffect, useState, type ReactNode } from 'react';
import { HubSettings } from '../hub/HubSettings';
import { MachineSettings } from '../machine/MachineSettings';
import { HarnessesSettings } from '../harnesses/HarnessesSettings';
import { SystemPromptSettings } from '../harnesses/SystemPromptSettings';
import { AccountsSettings } from '../profiles/AccountsSettings';
import { ProfilesSettings } from '../profiles/ProfilesSettings';
import { useProfiles } from '../profiles/profiles';
import { SecretsSettings, type SecretsRoute } from '../secrets/SecretsSettings';
import { ToolsSettings } from '../tools/ToolsSettings';
import { McpSettings } from '../mcp/McpSettings';
import { SkillsSettings } from '../skills/SkillsSettings';
import { useResources } from '../resources/resources';
import { ArrowLeft, BookOpen, Chevron, Hub, IdCard, Key, Layers, Monitor, Plug, ScrollText, Users, Wrench } from './icons';
import { useClient } from './connection';
import { useLive } from './useLive';
import { SidebarResizer } from './Resizer';
import { HubSelector } from '../hub/HubSelector';

/** Where Settings is open. `profileId` opens one profile ('new' to add one). */
export type SettingsRoute = { section: 'profiles'; profileId?: string } | { section: 'accounts'; accountId?: string } | ({ section: 'secrets' } & SecretsRoute) | { section: 'hub'; hubId?: string } | { section: 'harnesses' } | { section: 'systemPrompt' } | { section: 'machines'; machineId?: string }
  | { section: 'tools'; toolId?: string } | { section: 'mcps'; mcpId?: string } | { section: 'skills'; sourceId?: string };
type Section = SettingsRoute['section'];

const GROUPS: { label?: string; items: { id: Section; label: string; icon: ReactNode }[] }[] = [
  { label: 'Hub settings', items: [
    { id: 'accounts', label: 'Accounts', icon: <IdCard /> },
    { id: 'secrets', label: 'Secrets', icon: <Key /> },
    { id: 'profiles', label: 'Profiles', icon: <Users /> },
    { id: 'harnesses', label: 'Harnesses', icon: <Layers /> },
    { id: 'systemPrompt', label: 'System prompt', icon: <ScrollText /> },
    { id: 'machines', label: 'Machines', icon: <Monitor /> },
  ] },
  { label: 'Tools and skills', items: [
    { id: 'tools', label: 'Tools', icon: <Wrench /> },
    { id: 'mcps', label: 'MCP servers', icon: <Plug /> },
    { id: 'skills', label: 'Skills', icon: <BookOpen /> },
  ] },
  {
    label: 'Connections',
    items: [
      { id: 'hub', label: 'Hubs', icon: <Hub /> },
    ],
  },
];
const LABEL = Object.fromEntries(GROUPS.flatMap((g) => g.items.map((i) => [i.id, i.label]))) as Record<Section, string>;

/** Settings replace the whole window while open, as in T3 Code. Back (top of the sidebar, as in Cal.com and Circle) or Escape returns to the threads. */
export function Settings({ route, onRoute, onClose, onOpenThread }: { route: SettingsRoute; onRoute: (r: SettingsRoute) => void; onClose: () => void; onOpenThread: (threadId: string) => void }) {
  const { profiles, accounts } = useProfiles();
  const { state: resources } = useResources();
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
  const detailLabel = profileLabel || accountLabel || secretLabel || resourceLabel || machineLabel || hubLabel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape inside a field only leaves the field.
      const t = e.target;
      if (e.key === 'Escape' && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <header className="side-top drag">
          <button className="settings-back" title="Back to threads (Esc)" onClick={onClose}>
            <ArrowLeft />
            Back
          </button>
        </header>
        <nav className="side-body">
          <HubSelector />
          {GROUPS.map((g, n) => (
            <div key={n} className="settings-group">
              {g.label && <div className="settings-group-label">{g.label}</div>}
              {g.items.map((i) => (
                <button
                  key={i.id}
                  className={`settings-link${route.section === i.id ? ' active' : ''}`}
                  aria-current={route.section === i.id ? 'page' : undefined}
                  onClick={() => onRoute({ section: i.id })}
                >
                  {i.icon}
                  {i.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <SidebarResizer />
      <main className="main">
        <header className="main-top drag">
          <nav className="crumbs">
            <span>Settings</span>
            <span className="sep">/</span>
            {detailLabel ? (
              <>
                <button onClick={() => onRoute(backTo)}>{LABEL[route.section]}</button>
                <span className="sep">/</span>
                <b>{detailLabel}</b>
              </>
            ) : (
              <b>{LABEL[route.section]}</b>
            )}
          </nav>
        </header>
        <div className="settings-scroll">
          <div className="settings-page">
            {route.section === 'profiles' && (
              <ProfilesSettings
                profileId={profileId}
                onOpen={(id) => onRoute({ section: 'profiles', profileId: id })}
                onBack={() => onRoute({ section: 'profiles' })}
                onOpenSecrets={(id) => onRoute({ section: 'secrets', profileId: id })}
              />
            )}
            {route.section === 'accounts' && <AccountsSettings accountId={accountId} onOpen={(id) => onRoute({ section: 'accounts', accountId: id })} onBack={() => onRoute({ section: 'accounts' })} />}
            {route.section === 'secrets' && <SecretsSettings route={route} onRoute={(r) => onRoute({ section: 'secrets', ...r })} />}
            {route.section === 'hub' && <HubSettings adding={!!route.hubId} onAdd={() => onRoute({ section: 'hub', hubId: 'new' })} onBack={() => onRoute({ section: 'hub' })} />}
            {route.section === 'harnesses' && <HarnessesSettings />}
            {route.section === 'systemPrompt' && <SystemPromptSettings />}
            {route.section === 'tools' && <ToolsSettings key={toolId ?? ''} toolId={toolId} onOpen={(id) => onRoute({ section: 'tools', toolId: id })} onBack={() => onRoute({ section: 'tools' })} onOpenThread={onOpenThread} />}
            {route.section === 'mcps' && <McpSettings key={mcpId ?? ''} mcpId={mcpId} onOpen={(id) => onRoute({ section: 'mcps', mcpId: id })} onBack={() => onRoute({ section: 'mcps' })} />}
            {route.section === 'skills' && <SkillsSettings key={sourceId ?? ''} sourceId={sourceId} onOpen={(id) => onRoute({ section: 'skills', sourceId: id })} onBack={() => onRoute({ section: 'skills' })} />}
            {route.section === 'machines' && <MachineSettings machineId={route.machineId} onOpen={(machineId) => onRoute({ section: 'machines', machineId })} onBack={() => onRoute({ section: 'machines' })} onOpenThread={onOpenThread} />}
          </div>
        </div>
      </main>
    </div>
  );
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
export function SettingRow({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="setting">
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
 * The one footer of every settings detail page: Delete on the left (it asks inline, naming what it deletes),
 * Cancel and Save on the right. Without `saveLabel` the page has nothing to save and offers Back.
 * Delete stays visible but disabled, with `blocked` as its reason, when the thing is in use.
 */
export function SettingsFooter({ remove, busy, onCancel, saveLabel, saveDisabled, saveForm, onSave }: {
  remove?: { name: string; run: () => void; blocked?: string; consequence?: string };
  busy?: boolean;
  onCancel: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  /** The id of the form to submit when the footer sits outside it. */
  saveForm?: string;
  /** Saves without a form; otherwise the button submits one. */
  onSave?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <footer className="settings-actions">
      {remove && (confirming ? (
        <>
          <button type="button" className="ghost danger" disabled={busy} onClick={remove.run}>Delete {remove.name}</button>
          <button type="button" className="ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          {remove.consequence && <small className="hint">{remove.consequence}</small>}
        </>
      ) : (
        <>
          <button type="button" className="ghost danger" disabled={busy || !!remove.blocked} onClick={() => setConfirming(true)}>Delete</button>
          {remove.blocked && <small className="hint">{remove.blocked}</small>}
        </>
      ))}
      <span className="spacer" />
      {!confirming && (
        <>
          <button type="button" className="ghost" disabled={busy} onClick={onCancel}>{saveLabel ? 'Cancel' : 'Back'}</button>
          {saveLabel && (
            <button type={onSave ? 'button' : 'submit'} form={onSave ? undefined : saveForm} className="ghost primary" disabled={saveDisabled} onClick={onSave}>{saveLabel}</button>
          )}
        </>
      )}
    </footer>
  );
}
