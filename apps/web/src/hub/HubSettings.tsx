import { useState } from 'react';
import { useHubs } from '../app/connection';
import { SettingsSection, SettingRow } from '../app/Settings';
import { useAction } from '../app/useAction';
import { PairHubForm } from './PairHubForm';

export function HubSettings() {
  const { hubs, selectedId, select, root } = useHubs();
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number }>();
  const { busy, error, run } = useAction();
  const current = hubs.find((h) => h.id === selectedId);
  return <>
    <SettingsSection title="Saved hubs">
      {hubs.map((hub) => <SettingRow key={hub.id} title={hub.name} description={hub.url}>
        <span className={`pill ${hub.status === 'connected' ? 'ok' : 'bad'}`}>{hub.status === 'connected' ? 'Connected' : hub.status === 'connecting' ? 'Connecting' : 'Offline'}</span>
        {hub.id !== selectedId && <button type="button" className="link" onClick={() => select(hub.id)}>Use hub</button>}
        <button type="button" className="link" disabled={busy || hub.running > 0} onClick={() => run(() => root.call('hubs.remove', { id: hub.id }))}>Remove</button>
      </SettingRow>)}
      {current?.error && <div className="setting-form"><p className="error" role="status">{current.error}</p></div>}
    </SettingsSection>
    <SettingsSection title="Add hub">
      <PairHubForm />
    </SettingsSection>
    {current && <SettingsSection title="Pair another device">
      <div className="setting-form">
        <p className="hint">Generate a one-time code for {current.name}. Enter this hub’s address and the code on the other device.</p>
        <button type="button" className="ghost" disabled={busy || current.status !== 'connected'} onClick={() => run(async () => setPairing(await root.call('hubs.createPairingCode', { id: current.id })))}>Generate pairing code</button>
        {pairing && <p role="status"><code>{pairing.code}</code> · expires {new Date(pairing.expiresAt).toLocaleTimeString()}</p>}
      </div>
    </SettingsSection>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}
