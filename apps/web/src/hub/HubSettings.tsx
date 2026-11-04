import { useState } from 'react';
import { useHubs } from '../app/connection';
import { Hub, Plus } from '../app/icons';
import { SettingRow, SettingsSection, StatusPill, useEscape } from '../app/Settings';
import { useAction } from '../app/useAction';
import { PairHubForm } from './PairHubForm';

/** The saved hubs; "Add hub" opens the pairing form as its own page. Without a hub yet (first run) the form is the whole page. */
export function HubSettings({ adding, onAdd, onBack }: { adding?: boolean; onAdd?: () => void; onBack?: () => void } = {}) {
  const { hubs, selectedId, select, root } = useHubs();
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number }>();
  const [confirming, setConfirming] = useState<string>();
  const { busy, error, run } = useAction();
  useEscape(!!confirming, () => setConfirming(undefined));
  const current = hubs.find((h) => h.id === selectedId);
  if (!hubs.length) return <SettingsSection><PairHubForm /></SettingsSection>;
  if (adding) return <PairHubForm onCancel={onBack} />;
  return <>
    <SettingsSection>
      {hubs.map((hub) => <SettingRow key={hub.id} icon={<Hub />} title={hub.name} description={confirming === hub.id ? 'You will be disconnected from this hub.' : hub.url}>
        {confirming === hub.id ? <>
          <button type="button" className="ghost danger" disabled={busy} autoFocus onClick={() => void run(async () => { await root.call('hubs.remove', { id: hub.id }); setConfirming(undefined); })}>Remove {hub.name}</button>
          <button type="button" className="ghost" disabled={busy} onClick={() => setConfirming(undefined)}>Cancel</button>
        </> : <>
          <StatusPill tone={hub.status === 'connected' ? 'ok' : hub.error ? 'bad' : undefined}>{hub.status === 'connected' ? 'Connected' : hub.status === 'connecting' ? 'Connecting' : 'Offline'}</StatusPill>
          {hub.id !== selectedId && <button type="button" className="ghost" onClick={() => select(hub.id)}>Use hub</button>}
          <button type="button" className="ghost" disabled={busy || hub.running > 0} title={hub.running > 0 ? 'Threads are running on this hub.' : undefined} onClick={() => setConfirming(hub.id)}>Remove</button>
        </>}
      </SettingRow>)}
      {current?.error && <div className="setting-form"><p className="error" role="status">{current.error}</p></div>}
      {onAdd && <button type="button" className="setting setting-link" onClick={onAdd}>
        <span className="menu-icon"><Plus /></span>
        <span className="setting-text"><b>Add hub</b><small>Pair this device with another hub by address and one-time code.</small></span>
      </button>}
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
