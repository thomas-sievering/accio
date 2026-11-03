import { useEffect, useState } from 'react';
import type { HarnessView } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { useLive } from '../app/useLive';
import { SettingRow, SettingsSection } from '../app/Settings';

/** Shared harness catalogue and the installations each machine reports. */
export function HarnessesSettings() {
  const client = useClient();
  const status = useConnectionStatus();
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  const [harnesses, setHarnesses] = useState<HarnessView[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (status !== 'open') return;
    let active = true;
    client.call('harnesses.list', {}).then(
      (list) => { if (active) { setHarnesses(list); setError(undefined); } },
      (err: Error) => { if (active) setError(err.message); },
    );
    return () => { active = false; };
  }, [client, status, machines]);
  return (
    <>
      <p className="note">Harnesses run your threads. Each uses models from the providers listed below.</p>
      {error && <p className="error">{error}</p>}
      {harnesses?.map((h) => (
        <SettingsSection key={h.id} title={h.name}>
          <SettingRow title="Providers"><span>{h.providers.map((p) => p === 'anthropic' ? 'Anthropic' : 'OpenAI').join(', ')}</span></SettingRow>
          <SettingRow title="Models" description={h.id === 'codex' ? 'Available models come from the signed-in ChatGPT account.' : "Model aliases follow Claude Code's current versions."}><span>{h.models.map((m) => m.name).join(', ')}</span></SettingRow>
          {h.machines.length === 0 && <SettingRow title="No installations reported" />}
          {h.machines.map((install) => {
            const machine = machines?.find((m) => m.id === install.machineId);
            return (
              <SettingRow key={install.machineId} title={machine?.name ?? install.machineId} description={machine?.connected ? 'Connected' : 'Offline'}>
                <code>{install.version ?? 'Version unknown'}</code>
              </SettingRow>
            );
          })}
        </SettingsSection>
      ))}
    </>
  );
}
