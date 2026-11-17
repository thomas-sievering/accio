import { useEffect, useState } from 'react';
import type { HarnessView } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { useLive } from '../app/useLive';
import { SettingLink, SettingRow, SettingsSection, StatusPill, type SettingsNav } from '../app/Settings';
import { BuiltinToolsSettings, toolCount } from './BuiltinToolsSettings';

/** Shared harness catalogue and the installations each machine reports. */
export function useHarnessesData() {
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
  return { items: harnesses, error, machines, setHarnesses };
}
type Props = { nav: SettingsNav; data: ReturnType<typeof useHarnessesData> };

export function HarnessDetail({ data, item }: Props & { item: HarnessView }) {
  return <BuiltinToolsSettings harness={item} onChanged={data.setHarnesses} />;
}

export function HarnessesList({ nav, data }: Props) {
  const { machines } = data;
  return (
    <>
      <p className="note">Harnesses run your threads. Each uses models from the providers listed below.</p>
      {data.error && <p className="error">{data.error}</p>}
      {data.items!.map((h) => (
        <SettingsSection key={h.id} title={h.name}>
          <SettingRow title="Providers"><span>{h.providers.map((p) => p === 'anthropic' ? 'Anthropic' : 'OpenAI').join(', ')}</span></SettingRow>
          <SettingRow title="Models" description={h.id === 'codex' ? 'Available models come from the signed-in ChatGPT account.' : "Model aliases follow Claude Code's current versions."}><span>{h.models.length ? h.models.map((m) => m.name).join(', ') : 'Per account'}</span></SettingRow>
          <SettingLink title="Built-in tools" onClick={() => nav.open(h.id)}><span className="tool-required">{toolCount(h.tools)}</span></SettingLink>
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
