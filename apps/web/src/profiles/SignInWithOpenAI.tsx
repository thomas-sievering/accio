import { useEffect, useState } from 'react';
import type { AccountView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';

export function SignInWithOpenAI({ account }: { account: AccountView }) {
  const client = useClient();
  const [pending, setPending] = useState<{ signInId: string; url: string; userCode?: string }>();
  const [statusError, setStatusError] = useState<string>();
  const { busy, error, run } = useAction();
  useEffect(() => {
    if (!pending) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const result = await client.call('accounts.signInStatus', { signInId: pending.signInId });
        if (!active) return;
        if (result.status === 'complete') setPending(undefined);
        else timer = setTimeout(check, 1500);
      } catch (err) {
        if (active) { setStatusError((err as Error).message); setPending(undefined); }
      }
    };
    timer = setTimeout(check, 1500);
    return () => {
      active = false; clearTimeout(timer);
      void client.call('accounts.cancelSignIn', { signInId: pending.signInId }).catch(() => {});
    };
  }, [client, pending]);

  const start = () => run(async () => {
    setStatusError(undefined);
    const result = await client.call('accounts.beginSignIn', { id: account.id });
    setPending(result);
    window.open(result.url, '_blank', 'noopener');
  });

  return <div className="signin">
    {pending ? <>
      <p className="note">Open ChatGPT’s page, sign in with the account for <b>{account.name}</b>, and enter this code:</p>
      <p><code>{pending.userCode}</code></p>
      <p className="hint" role="status">Waiting for sign-in. If device-code login is disabled, enable it in your ChatGPT security settings or ask your workspace administrator.</p>
      <span className="signin-links">
        <a className="link" href={pending.url} target="_blank" rel="noopener noreferrer">Open ChatGPT’s page</a>
        <button type="button" className="link" onClick={() => setPending(undefined)}>Cancel</button>
      </span>
    </> : account.signedIn ? <div className="signin-status">
      <span className="dot ok" /><span className="grow">Signed in as <b>{account.email ?? 'a ChatGPT account'}</b></span>
      <button type="button" className="link" onClick={start} disabled={busy}>Sign in again</button>
      <button type="button" className="link" disabled={busy} onClick={() => run(() => client.call('accounts.signOut', { id: account.id }))}>Sign out</button>
    </div> : <button type="button" className="ghost primary signin-start" onClick={start} disabled={busy}>Sign in with ChatGPT</button>}
    {(error || statusError) && <p className="error" role="alert">{error || statusError}</p>}
  </div>;
}
