import { useState } from 'react';
import type { ProfileView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';
import { claudeAccount } from './profiles';

/**
 * GLOSSARY: Sign-in. Opens Claude's consent page; you approve, and paste back
 * the code Claude's page shows. The account is kept on the hub, never here.
 */
export function SignInWithClaude({ profile }: { profile: ProfileView }) {
  const client = useClient();
  const account = claudeAccount(profile);
  const [signInId, setSignInId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const { busy, error, run } = useAction();

  const start = () =>
    run(async () => {
      const r = await client.call('profiles.beginSignIn', { profileId: profile.id });
      setSignInId(r.signInId);
      setCode('');
      window.open(r.url, '_blank', 'noopener');
    });

  // Not a <form>: this sits inside the profile form, and a nested form would submit that one instead.
  const finish = () => {
    if (!signInId || !code.trim()) return;
    void run(async () => {
      await client.call('profiles.completeSignIn', { signInId, code });
      setSignInId(null);
    });
  };

  if (signInId) {
    return (
      <div className="signin">
        <p className="note">
          Approve accio on Claude’s page, signed in with the Claude account for {profile.name}. Then paste the code it shows.
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
      {account ? (
        <div className="signin-status">
          <span className="dot ok" />
          <span className="grow">
            Signed in as <b>{account.email ?? 'a Claude account'}</b>
            {account.organization ? <span className="dim"> · {account.organization}</span> : null}
          </span>
          <button type="button" className="link" onClick={start} disabled={busy}>
            Switch
          </button>
          <button
            type="button"
            className="link"
            onClick={() => run(() => client.call('profiles.signOut', { profileId: profile.id }))}
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
