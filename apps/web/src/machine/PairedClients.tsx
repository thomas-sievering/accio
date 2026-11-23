import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { PairedClientView } from '@accio/protocol';
import { useClient, useHubs } from '../app/connection';
import { useLiveState } from '../app/useLive';
import { ConfirmAction, SettingRow, SettingsSection } from '../app/Settings';
import { useAction } from '../app/useAction';
import { PairingCode, type Pairing } from '../hub/PairingCode';
import { Button } from '../ui/Button';

export function PairedClients() {
  const client = useClient();
  const { hubs, selectedId } = useHubs();
  const hub = hubs.find(({ id }) => id === selectedId);
  const { value, error, retry } = useLiveState(() => client.call('clients.list', {}), 'clients.changed');
  const self = client.browser ? value?.find(({ id }) => id === client.clientId) : undefined;
  return <SettingsSection title="Paired clients">
    {error ? <SettingRow title="Could not load from the hub" description={error}><Button className="ghost" onClick={retry}>Retry</Button></SettingRow> :
      !value ? <SettingRow title="Loading paired clients…" /> : value.length === 0 ? <SettingRow title="No paired clients yet" /> :
        <>
          {self && <PairedClientRow key={self.id} item={self} self />}
          {value.filter(({ id }) => id !== self?.id).map((item) => <PairedClientRow key={item.id} item={item} />)}
        </>}
    {!client.browser && hub && <BrowserPairing key={hub.id} url={hub.url} connected={hub.status === 'connected'} />}
  </SettingsSection>;
}

function BrowserPairing({ url, connected }: { url: string; connected: boolean }) {
  const client = useClient();
  const [pairing, setPairing] = useState<Pairing & { url?: string }>();
  const [now, setNow] = useState(Date.now);
  const { busy, error, run } = useAction();
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, pairing.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing]);
  const expired = !!pairing && now >= pairing.expiresAt;
  const address = new URL('/', pairing?.url ?? url);
  const scan = new URL(address);
  if (pairing) scan.hash = pairing.code;
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(address.hostname);
  return <div className="setting-form machine-onboard">
    <div className="machine-onboard-actions">
      <Button className="ghost" disabled={!connected} busy={busy} busyLabel="Generating code…" onClick={() => void run(async () => {
        const result = await client.call('clients.createPairingCode', {});
        setNow(Date.now()); setPairing(result);
      })}>{pairing ? 'Generate new browser code' : 'Pair a browser'}</Button>
      {pairing && <Button className="ghost" onClick={() => setPairing(undefined)}>Done</Button>}
    </div>
    {pairing && !busy && <>
      {!expired && <>
        <p>Scan the QR code or open <code>{address.origin}</code> in the browser and enter the code.</p>
        <QRCodeSVG value={scan.href} size={176} marginSize={4} role="img" title="Browser pairing QR code" />
        {loopback && <p className="hint">This hub address only works on this computer. To pair a browser on another device, use a hub with a reachable HTTPS address.</p>}
      </>}
      <PairingCode pairing={pairing} expired={expired} />
      <p className="hint">Codes work once, for 10 minutes. A new browser code replaces the previous one.</p>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}

function PairedClientRow({ item, self }: { item: PairedClientView; self?: boolean }) {
  const client = useClient();
  const [confirming, setConfirming] = useState(false);
  const { busy, error, attempt } = useAction();
  const action = self ? 'Unpair' : `Unpair ${item.name}`;
  const consequence = client.browser && !self
    ? `${item.name} loses access immediately and needs a new code to pair again.`
    : 'This browser loses access immediately and needs a new code to pair again.';
  return <SettingRow title={item.name} description={self ? 'This browser' : undefined}>
    {confirming ? <ConfirmAction question={self ? 'Unpair this browser?' : `${action}?`} action={action} consequence={consequence}
      busyLabel={client.browser ? 'Unpairing…' : undefined}
      busy={busy} error={error} onCancel={() => setConfirming(false)} onConfirm={() => void attempt(() => client.call('clients.unpair', { clientId: item.id }))} /> :
      <Button className="ghost danger" onClick={() => setConfirming(true)}>{action}</Button>}
  </SettingRow>;
}
