import { useState, type FormEvent } from 'react';
import type { MachineView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLive } from '../app/useLive';
import { Chevron, Monitor } from '../app/icons';
import { SettingRow, SettingsSection } from '../app/Settings';
import { useProfiles } from '../profiles/profiles';
import { FolderList } from './FolderList';

/** The machines known to the hub, including those currently offline. */
export function MachineSettings({ machineId, onOpen }: { machineId?: string; onOpen: (id: string) => void }) {
  const client = useClient();
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  if (!machines) return <p className="note">Loading machines…</p>;
  const machine = machines.find((m) => m.id === machineId);
  if (machine) return <MachineDetail machine={machine} />;
  return (
    <>
      <p className="note">Machines known to the hub. Their profile folders are stored on the hub too.</p>
      <SettingsSection title="Machines">
        {machines.length === 0 && <SettingRow title="No machines connected yet" />}
        {machines.map((m) => (
          <button key={m.id} className="setting setting-link" onClick={() => onOpen(m.id)}>
            <Monitor />
            <span className="setting-text">
              <b>{m.name}{m.thisMachine ? ' (this machine)' : ''}</b>
              <small>{m.platform} · {m.harnesses.length} harness{m.harnesses.length === 1 ? '' : 'es'}</small>
            </span>
            <span className={`pill ${m.connected ? 'ok' : ''}`}><span className="dot" />{m.connected ? 'Connected' : 'Offline'}</span>
            <Chevron />
          </button>
        ))}
      </SettingsSection>
    </>
  );
}

function MachineDetail({ machine }: { machine: MachineView }) {
  const { profiles = [] } = useProfiles();
  return (
    <>
      <SettingsSection title={machine.name}>
        <SettingRow title="Status" description={machine.thisMachine ? 'The computer this window is talking to.' : undefined}>
          <span className={`pill ${machine.connected ? 'ok' : ''}`}><span className="dot" />{machine.connected ? 'Connected' : 'Offline'}</span>
        </SettingRow>
        <SettingRow title="Platform"><code>{machine.platform}</code></SettingRow>
        <SettingRow title="accio version"><code>{machine.version}</code></SettingRow>
        {!machine.connected && <SettingRow title="Last seen"><span>{new Date(machine.lastSeen).toLocaleString()}</span></SettingRow>}
      </SettingsSection>
      <SettingsSection title="Installed harnesses">
        {machine.harnesses.length === 0 && <SettingRow title="No harnesses reported" />}
        {machine.harnesses.map((h) => (
          <SettingRow key={h.harnessId} title={h.harnessId === 'claudeCode' ? 'Claude Code' : h.harnessId}>
            <code>{h.version ?? 'Version unknown'}</code>
          </SettingRow>
        ))}
      </SettingsSection>
      <SettingsSection title="Profile folders">
        {profiles.length === 0 && <SettingRow title="Add a profile first" />}
        {profiles.map((p) => (
          <ProfileFolders key={`${machine.id}:${p.id}`} machine={machine} profileId={p.id} name={p.name} />
        ))}
      </SettingsSection>
    </>
  );
}

function ProfileFolders({ machine, profileId, name }: { machine: MachineView; profileId: string; name: string }) {
  const client = useClient();
  const saved = machine.profileFolders[profileId] ?? [];
  const [draft, setDraft] = useState<string[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await client.call('machines.setProfileFolders', {
        machineId: machine.id, profileId,
        folders: draft ?? saved,
      });
      setDraft(undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="setting-form" onSubmit={submit}>
      <div className="field">
        <span>{name}</span>
        <FolderList folders={draft ?? saved} onChange={setDraft} disabled={busy} />
        <small className="hint">Folders on {machine.name}. New projects inside these folders default to {name}.</small>
      </div>
      {error && <p className="error">{error}</p>}
      <button type="submit" className="ghost primary" disabled={busy || draft === undefined || JSON.stringify(draft) === JSON.stringify(saved)}>Save folders</button>
    </form>
  );
}
