import { useEffect, useState } from 'react';
import type { AccountView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';

export function SignIn({ account }: { account: AccountView }) {
  const client = useClient();
  const key = `accio:${client.hubId}:signin:${account.id}`;
  const [pending, setPending] = useState<{ signInId: string; url: string } | undefined>(() => { try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? undefined; } catch { return undefined; } });
  const [statusError, setStatusError] = useState<string>();
  const { busy, error, run } = useAction();
  const provider = account.providerId === 'openai' ? 'ChatGPT' : 'Claude';
  const remember = (value?: { signInId: string; url: string }) => { setPending(value); if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); };
  useEffect(() => {
    if (!pending) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const result = await client.call('accounts.signInStatus', { signInId: pending.signInId });
        if (!active) return;
        if (result.status === 'complete') remember(); else timer = setTimeout(check, 1500);
      } catch (err) { if (active) { setStatusError((err as Error).message); remember(); } }
    };
    timer = setTimeout(check, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [client, pending]);
  const start = () => {
    // Reserve the browser tab during the click; starting a provider can outlive user activation.
    const popup = window.accioDesktop ? null : window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
    return run(async () => {
      try {
        setStatusError(undefined);
        const result = await client.call('accounts.beginSignIn', { id: account.id }); remember(result);
        if (popup) popup.location.replace(result.url); else window.open(result.url, '_blank', 'noopener');
      } catch (error) { popup?.close(); throw error; }
    });
  };
  return <div className="signin">
    {pending ? <>
      <p className="note">Complete sign-in on {provider}’s page using the account for <b>{account.name}</b>.</p>
      <p className="hint" role="status">Waiting for sign-in. Accio will finish automatically.</p>
      <span className="signin-links"><a className="link" href={pending.url} target="_blank" rel="noopener noreferrer">Open {provider}’s page</a>
        <button type="button" className="link" disabled={busy} onClick={() => run(async () => { await client.call('accounts.cancelSignIn', { signInId: pending.signInId }); remember(); })}>Cancel</button>
      </span>
    </> : account.signedIn ? <div className="signin-status">
      <span className="dot ok" /><span className="grow">Signed in as <b>{account.email ?? `a ${provider} account`}</b>{account.organization && <span className="dim"> · {account.organization}</span>}</span>
      <button type="button" className="link" onClick={start} disabled={busy}>Sign in again</button>
      <button type="button" className="link" disabled={busy} onClick={() => run(() => client.call('accounts.signOut', { id: account.id }))}>Sign out</button>
    </div> : <button type="button" className="ghost primary signin-start" onClick={start} disabled={busy}>Sign in with {provider}</button>}
    {(error || statusError) && <p className="error" role="alert">{error || statusError}</p>}
  </div>;
}
