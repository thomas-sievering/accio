import { useState, type FormEvent } from 'react';
import type { MachineView } from '@accio/protocol';
import { useClient, useHubs } from '../app/connection';
import { useLiveState } from '../app/useLive';
import { Chevron, Hub, Monitor } from '../app/icons';
import { SettingRow, SettingsFooter, SettingsSection, StatusPill, type SettingsNav } from '../app/Settings';
import { Field } from '../resources/Field';
import { useProfiles } from '../profiles/profiles';
import { FolderList } from './FolderList';
import { useAction } from '../app/useAction';
import { useResources } from '../resources/resources';
import { ToolStatusCard } from '../tools/ToolStatusCard';
import { OnboardMachine } from './OnboardMachine';
import { MachineUpdate, useMachineUpdate } from './MachineUpdate';
import { RevokeMachine } from './RevokeMachine';
import { formatDayTime } from '../ui/dates';

/** The machines known to the hub, including those currently offline, and those revoked from this window. */
export function useMachinesData() {
  const client = useClient();
  // Machines revoked here: the hub keeps their records, so until one is paired again it shows as Revoked rather than Offline.
  const [revokedIds, setRevokedIds] = useState<string[]>([]);
  const { value: items, error, retry } = useLiveState(() => client.call('machines.list', {}), 'machines.changed');
  const revoked = (m: MachineView) => !m.connected && revokedIds.includes(m.id);
  return { items, error, retry, revoked, markRevoked: (id: string) => setRevokedIds((ids) => [...ids, id]) };
}
type Props = { nav: SettingsNav; data: ReturnType<typeof useMachinesData> };

export function MachinePage({ nav, data, item: machine }: Props & { item: MachineView }) {
  return <MachineDetail machine={machine} revoked={data.revoked(machine)} onRevoked={() => { data.markRevoked(machine.id); nav.back(); }} onBack={nav.back} onOpenThread={nav.openThread} />;
}

export function MachinesList({ nav, data }: Props) {
  const [onboarding, setOnboarding] = useState(false);
  const machines = data.items!;
  return (
    <>
      <p className="note">Workers connected to this hub run coding turns. Open a machine to manage its name, tools and what each profile uses there.</p>
      <HubRow />
      <SettingsSection add={!onboarding ? { label: 'Add machine', onClick: () => setOnboarding(true) } : undefined}>
        {machines.length === 0 && <SettingRow title="No machines connected yet" />}
        {machines.map((m) => <MachineRow key={m.id} machine={m} revoked={data.revoked(m)} onOpen={() => nav.open(m.id)} />)}
      </SettingsSection>
      {onboarding && <OnboardMachine onClose={() => { setOnboarding(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.settings-add')?.focus()); }} />}
    </>
  );
}

/** GLOSSARY: Hub. The hub these machines connect to, with the Accio version it runs. */
function HubRow() {
  const { hubs, selectedId } = useHubs();
  const hub = hubs.find((h) => h.id === selectedId);
  if (!hub) return null;
  const where = hub.local ? 'Hub on this machine' : `Hub at ${new URL(hub.url).host}`;
  return (
    <SettingsSection>
      <SettingRow icon={<Hub />} title={hub.name} description={hub.version ? `${where} · ${hub.version}` : where}>
        <StatusPill tone={hub.status === 'connected' ? 'ok' : hub.error ? 'bad' : undefined}>{hub.status === 'connected' ? 'Connected' : hub.status === 'connecting' ? 'Connecting' : 'Offline'}</StatusPill>
      </SettingRow>
    </SettingsSection>
  );
}

/** One machine: opens its settings, and updates its Accio when main is ahead. */
function MachineRow({ machine: m, revoked, onOpen }: { machine: MachineView; revoked: boolean; onOpen: () => void }) {
  const { view, canUpdate, start, busy, error } = useMachineUpdate(m);
  const progress = error ?? (view?.state === 'updating' ? `${view.detail ?? 'Updating'}…` : view?.state === 'restarting' ? 'Restarting…' : view?.state === 'failed' ? 'Update failed' : view?.state === 'blocked' ? `Can’t update: ${view.detail}` : undefined);
  const details = [m.platform, `${m.harnesses.length} harness${m.harnesses.length === 1 ? '' : 'es'}`, m.version, progress].filter(Boolean);
  return (
    <div className="setting setting-link machine-row">
      <span className="menu-icon"><Monitor /></span>
      <span className="setting-text">
        <button type="button" className="machine-row-open" onClick={onOpen}><b>{m.name}{m.thisMachine ? ' (this machine)' : ''}</b></button>
        <small>{details.join(' · ')}</small>
      </span>
      {canUpdate && <button type="button" className="ghost machine-row-action" disabled={busy} title={`${view!.behind} commit${view!.behind === 1 ? '' : 's'} behind main`} onClick={start}>Update</button>}
      <StatusPill tone={m.connected ? 'ok' : undefined}>{m.connected ? 'Connected' : revoked ? 'Revoked' : 'Offline'}</StatusPill>
      <Chevron />
    </div>
  );
}

function MachineDetail({ machine, revoked, onRevoked, onBack, onOpenThread }: { machine: MachineView; revoked: boolean; onRevoked: () => void; onBack: () => void; onOpenThread: (threadId: string) => void }) {
  const client = useClient();
  const { profiles = [] } = useProfiles();
  const { state: resources } = useResources();
  // Edits wait here until Save: the name, and each profile's folders by profile id.
  const [name, setName] = useState<string>();
  const [folders, setFolders] = useState<Record<string, string[]>>({});
  const [touched, setTouched] = useState(false);
  const { busy, error, attempt } = useAction();
  const shownName = name ?? machine.name;
  const changedFolders = Object.keys(folders).filter((id) => JSON.stringify(folders[id]) !== JSON.stringify(machine.profileFolders[id] ?? []));
  const renamed = shownName.trim() !== machine.name;
  const dirty = renamed || changedFolders.length > 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!shownName.trim()) return;
    const done = await attempt(async () => {
      if (renamed) await client.call('machines.rename', { machineId: machine.id, name: shownName.trim() });
      for (const profileId of changedFolders) await client.call('machines.setProfileFolders', { machineId: machine.id, profileId, folders: folders[profileId]! });
    });
    if (done) { setName(undefined); setFolders({}); }
  };
  return (
    <form className="settings-profile-form" id="machine-form" onSubmit={submit} noValidate>
      <SettingsSection>
        <div className="setting-form">
          <Field label="Machine name" error={touched && !shownName.trim() && 'Enter a name for the machine.'} hint="Shared with everyone connected to the hub.">
            {(p) => <input {...p} value={shownName} onChange={(e) => setName(e.target.value)} maxLength={100} required disabled={busy} />}
          </Field>
        </div>
        <SettingRow title="Status" description={machine.thisMachine ? 'The computer this window is talking to.' : undefined}>
          <StatusPill tone={machine.connected ? 'ok' : undefined}>{machine.connected ? 'Connected' : revoked ? 'Revoked' : 'Offline'}</StatusPill>
        </SettingRow>
        <SettingRow title="Platform"><code>{machine.platform}</code></SettingRow>
        <MachineUpdate machine={machine} />
        {!machine.connected && <SettingRow title="Last seen"><span>{formatDayTime(machine.lastSeen)}</span></SettingRow>}
      </SettingsSection>
      <SettingsSection title="Installed harnesses">
        {machine.harnesses.length === 0 && <SettingRow title="No harnesses reported" />}
        {machine.harnesses.map((h) => (
          <SettingRow key={h.harnessId} title={h.harnessId === 'claudeCode' ? 'Claude Code' : h.harnessId === 'codex' ? 'Codex' : h.harnessId}>
            <code>{h.version ?? 'Version unknown'}</code>
          </SettingRow>
        ))}
      </SettingsSection>
      <section className="settings-section">
        <h2>CLIs</h2>
        {!resources ? <p className="note" role="status">Loading CLIs…</p> : resources.tools.length === 0 ? (
          <div className="settings-card"><SettingRow title="No CLIs" description="Add CLIs in Settings / CLIs." /></div>
        ) : (
          <div className="tool-cards">
            {[...resources.tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <ToolStatusCard key={t.id} heading="tool" tool={t} machine={machine} status={resources.toolStatuses.find((s) => s.toolId === t.id && s.machineId === machine.id)} onOpenThread={onOpenThread} />
            ))}
          </div>
        )}
      </section>
      <SettingsSection title={`Profile folders and GitHub on ${machine.name}`}>
        {profiles.length === 0 && <SettingRow title="Add a profile first" />}
        {profiles.map((p) => (
          <div key={p.id} className="setting-form">
            <div className="field">
              <span>{p.name}</span>
              <FolderList folders={folders[p.id] ?? machine.profileFolders[p.id] ?? []} onChange={(f) => setFolders((d) => ({ ...d, [p.id]: f }))} disabled={busy} />
              <small className="hint">Folders on {machine.name}. New projects inside these folders default to {p.name}.</small>
            </div>
            <GitHubStatus machine={machine} profile={p.name} login={p.githubLogin} />
          </div>
        ))}
      </SettingsSection>
      {!machine.thisMachine && <RevokeMachine machine={machine} revoked={revoked} onRevoked={onRevoked} />}
      {error && <p className="error" role="alert">{error}</p>}
      <SettingsFooter busy={busy} onCancel={onBack} saveLabel="Save" saveDisabled={busy || !dirty} dirty={!busy && dirty} />
    </form>
  );
}

/**
 * GLOSSARY: GitHub account. Chosen per profile in Settings / Profiles; a machine only shows
 * whether its gh is signed in to it, since the token comes from there.
 */
function GitHubStatus({ machine, profile, login }: { machine: MachineView; profile: string; login: string | null }) {
  const signedIn = !!login && machine.githubAccounts?.includes(login);
  return (
    <div className="field">
      <span>GitHub account</span>
      {login && <span><StatusPill tone={signedIn ? 'ok' : 'warn'}>{login}</StatusPill></span>}
      <small className="hint">
        {!login ? `Automatic: the account git uses for each repository. Choose ${profile}’s in Settings / Profiles.`
          : signedIn ? `${profile}’s, chosen in Settings / Profiles.`
          : `gh on ${machine.name} isn’t signed in to ${login}. Run gh auth login there; until then ${profile}’s threads there use gh’s active account.`}
      </small>
    </div>
  );
}
