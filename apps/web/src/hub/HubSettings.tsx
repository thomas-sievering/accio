import { useState, type FormEvent } from 'react';
import { useHubs } from '../app/connection';
import { SettingsSection, SettingRow } from '../app/Settings';
import { useAction } from '../app/useAction';
import { HubSelector } from './HubSelector';

export function HubSettings() {
  const { hubs, selectedId, select, root } = useHubs();
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [code, setCode] = useState('');
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number }>();
  const { busy, error, run } = useAction();
  const current = hubs.find((h) => h.id === selectedId);
  const pair = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const hub = await root.call('hubs.pair', { name, url, code }); setName(''); setUrl(''); setCode(''); select(hub.id);
  }); };
  return <>
    <SettingsSection title="Saved hubs">
      {hubs.length > 0 && <div className="setting-form"><HubSelector /></div>}
      {hubs.map((hub) => <SettingRow key={hub.id} title={hub.name} description={hub.url}>
        <span className={`pill ${hub.status === 'connected' ? 'ok' : 'bad'}`}>{hub.status === 'connected' ? 'Connected' : hub.status === 'connecting' ? 'Connecting' : 'Offline'}</span>
        {hub.id !== selectedId && <button type="button" className="link" onClick={() => select(hub.id)}>Use hub</button>}
        <button type="button" className="link" disabled={busy || hub.running > 0} onClick={() => run(() => root.call('hubs.remove', { id: hub.id }))}>Remove</button>
      </SettingRow>)}
      {current?.error && <div className="setting-form"><p className="error" role="status">{current.error}</p></div>}
    </SettingsSection>
    <SettingsSection title="Add hub">
      <form className="setting-form" onSubmit={pair}>
        <label className="field"><span>Hub name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home server" maxLength={80} required /></label>
        <label className="field"><span>Hub address</span><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://accio.mediatom.cc" required /></label>
        <label className="field"><span>Pairing code</span><input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} required /></label>
        <p className="hint">For your first device, use the code displayed by the hub’s setup command. An already paired device can generate a code for another device.</p>
        <button type="submit" className="ghost primary" disabled={busy || !name.trim() || !url.trim() || !code.trim()}>Connect hub</button>
      </form>
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
