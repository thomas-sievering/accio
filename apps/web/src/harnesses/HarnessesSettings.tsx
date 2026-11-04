import { useEffect, useState } from 'react';
import type { HarnessView } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { useLive } from '../app/useLive';
import { SettingLink, SettingRow, SettingsSection, StatusPill } from '../app/Settings';
import { BuiltinToolsSettings, toolCount } from './BuiltinToolsSettings';

/** Shared harness catalogue and the installations each machine reports. */
export function HarnessesSettings({ harnessId, onOpen, onBack }: { harnessId?: string; onOpen: (harnessId: string) => void; onBack: () => void }) {
  const client = useClient();
  const status = useConnectionStatus();
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  const [harnesses, setHarnesses] = useState<HarnessView[]>();
  const [error, setError] = useState<string>();
  // The models offered change with every profile's sign-ins, not only with machines.
  const [revision, setRevision] = useState(0);
  useEffect(() => client.onEvent('models.changed', () => setRevision((n) => n + 1)), [client]);
  useEffect(() => {
    if (status !== 'open') return;
    let active = true;
    client.call('harnesses.list', {}).then(
      (list) => { if (active) { setHarnesses(list); setError(undefined); } },
      (err: Error) => { if (active) setError(err.message); },
    );
    return () => { active = false; };
  }, [client, status, machines, revision]);
  if (harnessId) {
    const harness = harnesses?.find((h) => h.id === harnessId);
    if (!harnesses) return error ? <p className="error">{error}</p> : <p className="note" role="status">Loading tools…</p>;
    if (!harness) return <><p className="note">This harness is not available.</p><button className="link" onClick={onBack}>All harnesses</button></>;
    return <BuiltinToolsSettings harness={harness} onChanged={setHarnesses} />;
  }
  return (
    <>
      <p className="note">Harnesses run your threads. Each uses models from the providers listed below.</p>
      {error && <p className="error">{error}</p>}
      {harnesses?.map((h) => (
        <SettingsSection key={h.id} title={h.name}>
          <SettingRow title="Providers"><span>{h.providers.map((p) => p === 'anthropic' ? 'Anthropic' : 'OpenAI').join(', ')}</span></SettingRow>
          <SettingRow title="Models" description={h.id === 'codex' ? 'Available models come from the signed-in ChatGPT account.' : "Model aliases follow Claude Code's current versions."}><span>{h.models.length ? h.models.map((m) => m.name).join(', ') : 'Per account'}</span></SettingRow>
          <SettingLink title="Built-in tools" onClick={() => onOpen(h.id)}><span className="tool-required">{toolCount(h.tools)}</span></SettingLink>
          {h.machines.length === 0 && <SettingRow title="No installations reported" />}
          {h.machines.map((install) => {
            const machine = machines?.find((m) => m.id === install.machineId);
            return (
              <SettingRow key={install.machineId} title={machine?.name ?? install.machineId}>
                <StatusPill tone={machine?.connected ? 'ok' : undefined}>{machine?.connected ? 'Connected' : 'Offline'}</StatusPill>
                <code>{install.version ?? 'Version unknown'}</code>
              </SettingRow>
            );
          })}
        </SettingsSection>
      ))}
    </>
  );
}

