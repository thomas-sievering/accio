import { useState } from 'react';
import type { AccountView } from '@accio/protocol';
import { useClient } from '../app/connection';

/**
 * GLOSSARY: Sign-in. Opens Claude's consent page; you approve, and paste back
 * the code Claude's page shows. The login is kept on the hub, never here.
 */
export function SignInWithClaude({ account }: { account: AccountView }) {
  const client = useClient();
  const [signInId, setSignInId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const r = await client.call('accounts.beginSignIn', { accountId: account.id });
      setSignInId(r.signInId);
      setCode('');
      window.open(r.url, '_blank', 'noopener');
    });

  // Not a <form>: this sits inside the account form, and a nested form would submit that one instead.
  const finish = () => {
    if (!signInId || !code.trim()) return;
    void run(async () => {
      await client.call('accounts.completeSignIn', { signInId, code });
      setSignInId(null);
    });
  };

  if (signInId) {
    return (
      <div className="signin">
        <p className="note">
          Approve accio on Claude’s page{account.isJob ? ', signed in with your work account' : ''}. Then paste the code it shows.
        </p>
        <span className="row-input">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code from Claude"
            autoFocus
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                finish();
              }
            }}
          />
          <button type="button" className="ghost primary" onClick={finish} disabled={busy || !code.trim()}>
            Finish
          </button>
        </span>
        <span className="signin-links">
          <button type="button" className="link" onClick={start}>
            Open Claude’s page again
          </button>
          <button type="button" className="link" onClick={() => setSignInId(null)}>
            Cancel
          </button>
        </span>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="signin">
      {account.signIn ? (
        <div className="signin-status">
          <span className="dot ok" />
          <span className="grow">
            Signed in as <b>{account.signIn.email ?? 'a Claude account'}</b>
            {account.signIn.organization ? <span className="dim"> · {account.signIn.organization}</span> : null}
          </span>
          <button type="button" className="link" onClick={start} disabled={busy}>
            Switch
          </button>
          <button
            type="button"
            className="link"
            onClick={() => run(() => client.call('accounts.signOut', { accountId: account.id }))}
            disabled={busy}
          >
            Sign out
          </button>
        </div>
      ) : (
        <button type="button" className="ghost primary signin-start" onClick={start} disabled={busy}>
          Sign in with Claude
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
