import { useState, type FormEvent } from 'react';
import { useHubs } from '../app/connection';
import { useAction } from '../app/useAction';

/** Pairs this machine with a hub by address and one-time code, then switches to it. */
export function PairHubForm({ className = 'setting-form' }: { className?: string }) {
  const { select, root } = useHubs();
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [code, setCode] = useState('');
  const { busy, error, run } = useAction();
  const pair = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const hub = await root.call('hubs.pair', { name, url, code }); setName(''); setUrl(''); setCode(''); select(hub.id);
  }); };
  return <form className={className} onSubmit={pair}>
    <label className="field"><span>Hub name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home server" maxLength={80} required /></label>
    <label className="field"><span>Hub address</span><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://accio.mediatom.cc" required /></label>
    <label className="field"><span>Pairing code</span><input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} required /></label>
    <p className="hint">For your first device, use the code displayed by the hub’s setup command. An already paired device can generate a code for another device.</p>
    <button type="submit" className="ghost primary" disabled={busy || !name.trim() || !url.trim() || !code.trim()}>Connect hub</button>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}
