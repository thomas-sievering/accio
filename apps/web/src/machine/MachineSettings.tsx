import { useState, type FormEvent } from 'react';
import type { MachineView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLive } from '../app/useLive';
import { Chevron, Monitor } from '../app/icons';
import { SettingRow, SettingsFooter, SettingsSection, StatusPill } from '../app/Settings';
import { Field } from '../resources/Field';
import { useProfiles } from '../profiles/profiles';
import { FolderList } from './FolderList';
import { useAction } from '../app/useAction';
import { useResources } from '../resources/resources';
import { ToolStatusCard } from '../tools/ToolStatusCard';
import { OnboardMachine } from './OnboardMachine';

/** The machines known to the hub, including those currently offline. */
export function MachineSettings({ machineId, onOpen, onBack, onOpenThread }: { machineId?: string; onOpen: (id: string) => void; onBack: () => void; onOpenThread: (threadId: string) => void }) {
  const client = useClient();
  const [onboarding, setOnboarding] = useState(false);
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  if (!machines) return <p className="note">Loading machines…</p>;
  const machine = machines.find((m) => m.id === machineId);
  if (machine) return <MachineDetail key={machine.id} machine={machine} onBack={onBack} onOpenThread={onOpenThread} />;
  return (
    <>
      <p className="note">Workers connected to this hub run coding turns. Open a machine to manage its name, tools and profile folders.</p>
      <SettingsSection add={!onboarding ? { label: 'Add machine', onClick: () => setOnboarding(true) } : undefined}>
        {machines.length === 0 && <SettingRow title="No machines connected yet" />}
        {machines.map((m) => (
          <button key={m.id} className="setting setting-link" onClick={() => onOpen(m.id)}>
            <span className="menu-icon"><Monitor /></span>
            <span className="setting-text">
              <b>{m.name}{m.thisMachine ? ' (this machine)' : ''}</b>
              <small>Worker · {m.platform} · {m.harnesses.length} harness{m.harnesses.length === 1 ? '' : 'es'}</small>
            </span>
            <StatusPill tone={m.connected ? 'ok' : undefined}>{m.connected ? 'Connected' : 'Offline'}</StatusPill>
            <Chevron />
          </button>
        ))}
      </SettingsSection>
      {onboarding && <OnboardMachine onClose={() => { setOnboarding(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.settings-add')?.focus()); }} />}
    </>
  );
}

function MachineDetail({ machine, onBack, onOpenThread }: { machine: MachineView; onBack: () => void; onOpenThread: (threadId: string) => void }) {
  const client = useClient();
  const { profiles = [] } = useProfiles();
  const { state: resources } = useResources();
  // Edits wait here until Save: the name, and each profile's folders by profile id.
  const [name, setName] = useState<string>();
  const [folders, setFolders] = useState<Record<string, string[]>>({});
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const shownName = name ?? machine.name;
  const changedFolders = Object.keys(folders).filter((id) => JSON.stringify(folders[id]) !== JSON.stringify(machine.profileFolders[id] ?? []));
  const renamed = shownName.trim() !== machine.name;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!shownName.trim()) return;
    const done = await run(async () => {
      if (renamed) await client.call('machines.rename', { machineId: machine.id, name: shownName.trim() });
      for (const profileId of changedFolders) await client.call('machines.setProfileFolders', { machineId: machine.id, profileId, folders: folders[profileId]! });
      return true;
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
          <StatusPill tone={machine.connected ? 'ok' : undefined}>{machine.connected ? 'Connected' : 'Offline'}</StatusPill>
        </SettingRow>
        <SettingRow title="Platform"><code>{machine.platform}</code></SettingRow>
        <SettingRow title="Role" description="Runs coding turns. The desktop app also includes a client.">Worker</SettingRow>
        <SettingRow title="Accio version"><code>{machine.version}</code></SettingRow>
        {!machine.connected && <SettingRow title="Last seen"><span>{new Date(machine.lastSeen).toLocaleString()}</span></SettingRow>}
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
        <h2>Managed tools</h2>
        {!resources ? <p className="note" role="status">Loading tools…</p> : resources.tools.length === 0 ? (
          <div className="settings-card"><SettingRow title="No managed tools" description="Add tools in Settings / Tools." /></div>
        ) : (
          <div className="tool-cards">
            {[...resources.tools].sort((a, b) => a.name.localeCompare(b.name)).map((t) => (
              <ToolStatusCard key={t.id} heading="tool" tool={t} machine={machine} status={resources.toolStatuses.find((s) => s.toolId === t.id && s.machineId === machine.id)} onOpenThread={onOpenThread} />
            ))}
          </div>
        )}
      </section>
      <SettingsSection title="Profile folders">
        {profiles.length === 0 && <SettingRow title="Add a profile first" />}
        {profiles.map((p) => (
          <div key={p.id} className="setting-form">
            <div className="field">
              <span>{p.name}</span>
              <FolderList folders={folders[p.id] ?? machine.profileFolders[p.id] ?? []} onChange={(f) => setFolders((d) => ({ ...d, [p.id]: f }))} disabled={busy} />
              <small className="hint">Folders on {machine.name}. New projects inside these folders default to {p.name}.</small>
            </div>
          </div>
        ))}
      </SettingsSection>
      {error && <p className="error" role="alert">{error}</p>}
      <SettingsFooter busy={busy} onCancel={onBack} saveLabel="Save" saveDisabled={busy || (!renamed && changedFolders.length === 0)} dirty={!busy && (renamed || changedFolders.length > 0)} />
    </form>
  );
}
