import { useState, type FormEvent } from 'react';
import { useHubs } from '../app/connection';
import { useAction } from '../app/useAction';
import { SettingsFooter, SettingsSection } from '../app/Settings';

/** Pairs this machine with a hub by address and one-time code, then switches to it. Without `askName` the hub is named after its host. */
export function PairHubForm({ className = 'setting-form', askName = true, submitClassName = 'ghost primary', onCancel }: { className?: string; askName?: boolean; submitClassName?: string; /** Set in Settings, where the form is a page with the shared footer. */ onCancel?: () => void }) {
  const { select, root } = useHubs();
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [code, setCode] = useState('');
  const { busy, error, run } = useAction();
  const pair = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const hub = await root.call('hubs.pair', { name: askName ? name : hostOf(url), url, code }); setName(''); setUrl(''); setCode(''); select(hub.id); onCancel?.();
  }); };
  const disabled = busy || (askName && !name.trim()) || !url.trim() || !code.trim();
  const fields = <>
    {askName && <label className="field"><span>Hub name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home server" maxLength={80} required /></label>}
    <label className="field"><span>Hub address</span><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://accio.mediatom.cc" required /></label>
    <label className="field"><span>Pairing code</span><input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} required /></label>
    {askName && <p className="hint">For your first device, use the code displayed by the hub’s setup command. An already paired device can generate a code for another device.</p>}
  </>;
  const failure = error && <p className="error" role="alert">{error}</p>;
  if (onCancel) return <form className="settings-profile-form" onSubmit={pair} noValidate>
    <SettingsSection><div className="setting-form">{fields}{failure}</div></SettingsSection>
    <SettingsFooter busy={busy} onCancel={onCancel} saveLabel="Connect hub" saveDisabled={disabled} />
  </form>;
  return <form className={className} onSubmit={pair} noValidate>
    {fields}
    <button type="submit" className={submitClassName} disabled={disabled}>Connect hub</button>
    {failure}
  </form>;
}

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
