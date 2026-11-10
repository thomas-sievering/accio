import { useState, type FormEvent } from 'react';
import { useClient } from '../app/connection';
import { Hub } from '../app/icons';
import { SettingRow, SettingsSection, StatusPill, useEscape } from '../app/Settings';
import { useAction } from '../app/useAction';
import { Field, focusFirstInvalid } from '../resources/Field';
import { useProfiles } from '../profiles/profiles';

/**
 * GLOSSARY: Sorting Hat. The current hub's link to one: its address and an admin
 * token pasted from its dashboard. The token goes to the hub and never comes back;
 * this card only learns whether one is saved.
 */
export function SortingHatSettings({ hubName }: { hubName: string }) {
  const client = useClient();
  const { sortingHat } = useProfiles();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();
  useEscape(confirming, () => setConfirming(false));
  if (sortingHat === undefined) return null;
  const linked = sortingHat !== null;
  return (
    <SettingsSection title="Sorting Hat">
      {linked && !editing ? <>
        <SettingRow icon={<Hub />} title={new URL(sortingHat.url).host}
          description={confirming ? 'Threads go back to the accounts this hub keeps itself; its hat keys there are deleted.' : `${sortingHat.threadUrl ? `Threads use ${new URL(sortingHat.threadUrl).host}. ` : ''}Hat keys are named “Accio · ${sortingHat.hubName} · …”.`}>
          {confirming ? <>
            <button type="button" className="ghost" disabled={busy} autoFocus onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="ghost danger" disabled={busy} onClick={() => void run(async () => { await client.call('sortingHat.disconnect', {}); setConfirming(false); })}>Disconnect</button>
          </> : <>
            <StatusPill tone={sortingHat.problem ? 'bad' : 'ok'}>{sortingHat.problem ? 'Unreachable' : `${sortingHat.houses.length} ${sortingHat.houses.length === 1 ? 'house' : 'houses'}`}</StatusPill>
            <button type="button" className="ghost" onClick={() => setEditing(true)}>Change</button>
            <button type="button" className="ghost" onClick={() => setConfirming(true)}>Disconnect</button>
          </>}
        </SettingRow>
        {(sortingHat.problem || error) && <div className="setting-form"><p className="error" role="status">{sortingHat.problem ?? error}</p></div>}
      </> : (
        <SortingHatForm key={sortingHat?.url ?? 'new'} saved={sortingHat ?? undefined} hubName={sortingHat?.hubName || hubName} onDone={() => setEditing(false)} />
      )}
    </SettingsSection>
  );
}

function SortingHatForm({ saved, hubName, onDone }: { saved?: { url: string; threadUrl: string | null }; hubName: string; onDone: () => void }) {
  const client = useClient();
  const [url, setUrl] = useState(saved?.url ?? '');
  const [threadUrl, setThreadUrl] = useState(saved?.threadUrl ?? '');
  const [token, setToken] = useState('');
  const [name, setName] = useState(hubName);
  const [tried, setTried] = useState(false);
  const { busy, error, run } = useAction();
  // The saved token is kept for the same address; a new address needs its own.
  const keepsToken = !!saved && url.trim().replace(/\/+$/, '') === saved.url;
  const problems = {
    url: !url.trim() ? 'Enter the Sorting Hat’s address.' : undefined,
    token: !token.trim() && !keepsToken ? 'Paste the admin token from the Sorting Hat’s dashboard.' : undefined,
    name: !name.trim() ? 'Name this hub.' : undefined,
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setTried(true);
    if (Object.values(problems).some(Boolean)) return focusFirstInvalid(e.currentTarget);
    void run(async () => {
      await client.call('sortingHat.configure', { url: url.trim(), hubName: name.trim(), ...(token.trim() ? { adminToken: token.trim() } : {}), ...(threadUrl.trim() ? { threadUrl: threadUrl.trim() } : {}) });
      setToken(''); onDone();
    });
  };
  return (
    <form className="setting-form" onSubmit={submit} noValidate>
      {!saved && <p className="hint">Run this hub’s threads through a Sorting Hat, which holds the provider accounts. Without one, the hub keeps accounts itself.</p>}
      <Field label="Address" error={tried && problems.url}>{(p) => <input {...p} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://sortinghat.example.com" required />}</Field>
      <Field label="Address for threads" hint="Where threads on every machine reach it, when the address above works only from the hub. Leave empty to use that one.">
        {(p) => <input {...p} type="url" value={threadUrl} onChange={(e) => setThreadUrl(e.target.value)} placeholder="https://sortinghat.example.com" />}
      </Field>
      <Field label="Admin token" error={tried && problems.token} hint="Stays on the hub; no device or thread receives it.">
        {(p) => <input {...p} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={keepsToken ? 'Saved · paste to replace' : 'hat-admin-…'} autoComplete="off" spellCheck={false} />}
      </Field>
      <Field label="This hub’s name on the Sorting Hat" error={tried && problems.name} hint="Its hat keys are named “Accio · this name · profile · machine” on the dashboard.">
        {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />}
      </Field>
      <div className="sorting-hat-actions">
        {saved && <button type="button" className="ghost" disabled={busy} onClick={onDone}>Cancel</button>}
        <button type="submit" className="ghost primary" disabled={busy}>{busy ? 'Checking…' : saved ? 'Save' : 'Connect Sorting Hat'}</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
