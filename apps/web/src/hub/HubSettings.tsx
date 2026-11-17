import { useEffect, useState } from 'react';
import { useHubs } from '../app/connection';
import { Hub } from '../app/icons';
import { ConfirmAction, NEW, SettingRow, SettingsSection, StatusPill, type SettingsNav } from '../app/Settings';
import { useAction } from '../app/useAction';
import { PairHubForm } from './PairHubForm';
import { PairingCode, type Pairing } from './PairingCode';
import { SortingHatSettings } from './SortingHatSettings';

/** "Add hub" in Settings / Hubs: the pairing form as its own page. */
export function AddHub({ nav }: { nav: SettingsNav }) {
  return <PairHubForm onCancel={nav.back} />;
}

/** The saved hubs; "Add hub" opens the pairing form as its own page. Without a hub yet (first run) the form is the whole page. */
export function HubSettings({ nav }: { nav?: SettingsNav } = {}) {
  const { hubs, selectedId, select, root } = useHubs();
  const [pairing, setPairing] = useState<Pairing>();
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  const [confirming, setConfirming] = useState<string>();
  const { busy, error, run } = useAction();
  const current = hubs.find((h) => h.id === selectedId);
  if (!hubs.length) return <SettingsSection><PairHubForm /></SettingsSection>;
  return <>
    <p className="note">Hubs keep your profiles, accounts and threads. This device uses one at a time.</p>
    <SettingsSection add={nav && { label: 'Add hub', onClick: () => nav.open(NEW) }}>
      {hubs.map((hub) => <SettingRow key={hub.id} icon={<Hub />} title={hub.name} description={hub.url}>
        {confirming === hub.id ? (
          <ConfirmAction question={`Remove ${hub.name}?`} consequence="You will be disconnected from this hub." action={`Remove ${hub.name}`} busy={busy}
            onConfirm={() => void run(async () => { await root.call('hubs.remove', { id: hub.id }); setConfirming(undefined); })} onCancel={() => setConfirming(undefined)} />
        ) : <>
          <StatusPill tone={hub.status === 'connected' ? 'ok' : hub.error ? 'bad' : undefined}>{hub.status === 'connected' ? 'Connected' : hub.status === 'connecting' ? 'Connecting' : 'Offline'}</StatusPill>
          {hub.id !== selectedId && <button type="button" className="ghost" onClick={() => select(hub.id)}>Use hub</button>}
          <button type="button" className="ghost" disabled={busy || hub.running > 0} title={hub.running > 0 ? 'Threads are running on this hub.' : undefined} onClick={() => setConfirming(hub.id)}>Remove</button>
        </>}
      </SettingRow>)}
      {current?.error && <div className="setting-form"><p className="error" role="status">{current.error}</p></div>}
    </SettingsSection>
    {current?.status === 'connected' && <SortingHatSettings hubName={current.name} />}
    {current && <SettingsSection title="Pair another device">
      <div className="setting-form">
        <p className="hint">Generate a one-time code for {current.name}. Enter this hub’s address and the code on the other device.</p>
        <button type="button" className="ghost" disabled={busy || current.status !== 'connected'} onClick={(event) => {
          const trigger = event.currentTarget;
          void run(async () => { setPairing(await root.call('hubs.createPairingCode', { id: current.id })); setCopied(false); })
            .finally(() => requestAnimationFrame(() => { if (trigger.isConnected) trigger.focus(); }));
        }}>Generate pairing code</button>
        {pairing && <PairingCode pairing={pairing}><button type="button" className="ghost pairing-copy" onClick={() => void run(async () => { setCopied(false); try { await navigator.clipboard.writeText(pairing.code); setCopied(true); } catch { throw new Error('Couldn’t copy. Select and copy the code manually, or allow clipboard access.'); } })}>{copied ? 'Copied' : 'Copy code'}</button></PairingCode>}
      </div>
    </SettingsSection>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}
