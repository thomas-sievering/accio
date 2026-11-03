import { useState, type FormEvent } from 'react';
import type { MachineView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLive } from '../app/useLive';
import { Chevron, Monitor } from '../app/icons';
import { SettingRow, SettingsSection } from '../app/Settings';
import { useProfiles } from '../profiles/profiles';
import { FolderList } from './FolderList';
import { useAction } from '../app/useAction';
import { useResources } from '../resources/resources';
import { ToolStatusCard } from '../tools/ToolStatusCard';

/** The machines known to the hub, including those currently offline. */
export function MachineSettings({ machineId, onOpen, onOpenThread }: { machineId?: string; onOpen: (id: string) => void; onOpenThread: (threadId: string) => void }) {
  const client = useClient();
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  if (!machines) return <p className="note">Loading machines…</p>;
  const machine = machines.find((m) => m.id === machineId);
  if (machine) return <MachineDetail key={machine.id} machine={machine} onOpenThread={onOpenThread} />;
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

function MachineDetail({ machine, onOpenThread }: { machine: MachineView; onOpenThread: (threadId: string) => void }) {
  const { profiles = [] } = useProfiles();
  const { state: resources } = useResources();
  return (
    <>
      <SettingsSection title={machine.name}>
        <MachineName machine={machine} />
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
          <ProfileFolders key={`${machine.id}:${p.id}`} machine={machine} profileId={p.id} name={p.name} />
        ))}
      </SettingsSection>
    </>
  );
}

function MachineName({ machine }: { machine: MachineView }) {
  const client = useClient();
  const [draft, setDraft] = useState<string>();
  const { busy, error, run } = useAction();
  const name = draft ?? machine.name;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const saved = await run(() => client.call('machines.rename', { machineId: machine.id, name }));
    if (saved) setDraft(undefined);
  };
  return (
    <form className="setting-form" onSubmit={submit}>
      <label className="field">
        <span>Machine name</span>
        <input value={name} onChange={(e) => setDraft(e.target.value)} maxLength={100} required disabled={busy} />
        <small className="hint">Shared with everyone connected to the hub.</small>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="ghost primary" disabled={busy || !name.trim() || name.trim() === machine.name}>Save name</button>
    </form>
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
