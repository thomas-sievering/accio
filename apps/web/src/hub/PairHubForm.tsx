import { useState, type FormEvent } from 'react';
import { useHubs } from '../app/connection';
import { useAction } from '../app/useAction';
import { SettingsFooter, SettingsSection } from '../app/Settings';
import { Field, focusFirstInvalid } from '../resources/Field';

/** Pairs this machine with a hub by address and one-time code, then switches to it. Without `askName` the hub is named after its host. */
export function PairHubForm({ className = 'setting-form', askName = true, submitClassName = 'ghost primary', onCancel }: { className?: string; askName?: boolean; submitClassName?: string; /** Set in Settings, where the form is a page with the shared footer. */ onCancel?: () => void }) {
  const { select, root } = useHubs();
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [code, setCode] = useState('');
  const { busy, error, run } = useAction();
  const [tried, setTried] = useState(false);
  const problems = {
    name: askName && !name.trim() ? 'Enter a name for the hub.' : undefined,
    url: !url.trim() ? 'Enter the hub’s address.' : undefined,
    code: !code.trim() ? 'Enter the pairing code.' : undefined,
  };
  const pair = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setTried(true); if (Object.values(problems).some(Boolean)) return focusFirstInvalid(e.currentTarget); void run(async () => {
    const hub = await root.call('hubs.pair', { name: askName ? name : hostOf(url), url, code }); setName(''); setUrl(''); setCode(''); select(hub.id); onCancel?.();
  }); };
  const fields = <>
    {askName && <Field label="Hub name" error={tried && problems.name}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Home server" maxLength={80} required />}</Field>}
    <Field label="Hub address" error={tried && problems.url}>{(p) => <input {...p} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://accio.mediatom.cc" required />}</Field>
    <Field label="Pairing code" error={tried && problems.code}>{(p) => <input {...p} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} required />}</Field>
    {askName && <p className="hint">For your first device, use the code displayed by the hub’s setup command. An already paired device can generate a code for another device.</p>}
  </>;
  const failure = error && <p className="error" role="alert">{error}</p>;
  if (onCancel) return <form className="settings-profile-form" onSubmit={pair} noValidate>
    <SettingsSection><div className="setting-form">{fields}{failure}</div></SettingsSection>
    <SettingsFooter busy={busy} onCancel={onCancel} saveLabel="Connect hub" saveDisabled={busy} dirty={!!(name || url || code) && !busy} />
  </form>;
  return <form className={className} onSubmit={pair} noValidate>
    {fields}
    <button type="submit" className={submitClassName} disabled={busy}>Connect hub</button>
    {failure}
  </form>;
}

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
