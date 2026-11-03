import { useState, type FormEvent } from 'react';
import type { AccountView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Sheet } from '../app/Sheet';
import { Plus } from '../app/icons';
import { AccountTile, useAccounts } from './accounts';
import { SignInWithClaude } from './SignInWithClaude';

/** List and edit accounts. Each one signs in with Claude; the login stays on the hub. */
export function AccountsSheet({ onClose, openAccountId }: { onClose: () => void; openAccountId?: string }) {
  const { accounts = [] } = useAccounts();
  const [editing, setEditing] = useState<string | 'new' | null>(openAccountId ?? (accounts.length ? null : 'new'));
  // Always the latest view, so sign-in changes show up while the form is open.
  const current = editing && editing !== 'new' ? accounts.find((a) => a.id === editing) : undefined;

  return (
    <Sheet title="Accounts" onClose={onClose}>
      {editing === 'new' ? (
        <AccountForm onSaved={(a) => setEditing(a.id)} onCancel={() => setEditing(null)} />
      ) : current ? (
        <AccountForm account={current} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
      ) : (
        <div className="sheet-body">
          <div className="list">
            {accounts.map((a) => (
              <button key={a.id} className="list-row" onClick={() => setEditing(a.id)}>
                <AccountTile account={a} size="md" />
                <span className="menu-text">
                  <b>{a.name}</b>
                  <small className={a.signIn ? undefined : 'warn'}>
                    {a.isJob ? 'Job account · ' : ''}
                    {a.signIn ? (a.signIn.email ?? 'Signed in') : 'Not signed in'}
                  </small>
                </span>
              </button>
            ))}
            <button className="list-row add" onClick={() => setEditing('new')}>
              <span className="menu-icon">
                <Plus />
              </span>
              <span>Add account</span>
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function AccountForm({ account, onSaved, onCancel }: { account?: AccountView; onSaved: (a: AccountView) => void; onCancel: () => void }) {
  const client = useClient();
  const [name, setName] = useState(account?.name ?? '');
  const [isJob, setIsJob] = useState(account?.isJob ?? false);
  const [roots, setRoots] = useState((account?.roots ?? []).join('\n'));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<AccountView | null>) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await action();
      if (result) onSaved(result);
      else onCancel();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const folders = roots
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
    void run(() => client.call('accounts.save', { id: account?.id, name, isJob, roots: folders }));
  };

  return (
    <>
      <form onSubmit={submit} id="account-form">
        <div className="sheet-body">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="personal, hrc…" autoFocus={!account} required />
          </label>
          <label className="check">
            <input type="checkbox" checked={isJob} onChange={(e) => setIsJob(e.target.checked)} />
            <span>
              Job account
              <small>Belongs to an employer. Its Claude login is never shared with another account.</small>
            </span>
          </label>
          <label className="field">
            <span>Folders</span>
            <textarea rows={2} value={roots} onChange={(e) => setRoots(e.target.value)} placeholder={'S:\\hrc'} spellCheck={false} />
            <small className="hint">One per line. New projects inside these folders default to this account.</small>
          </label>
          {account && (
            <div className="field">
              <span>Claude</span>
              <SignInWithClaude account={account} />
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      </form>
      <footer className="sheet-foot">
        {account && (
          <button
            type="button"
            className="ghost danger"
            disabled={busy}
            onClick={() => run(async () => (await client.call('accounts.delete', { id: account.id }), null))}
          >
            Delete
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="ghost" onClick={onCancel}>
          {account ? 'Done' : 'Cancel'}
        </button>
        <button type="submit" form="account-form" className="ghost primary" disabled={busy}>
          {account ? 'Save' : 'Add account'}
        </button>
      </footer>
    </>
  );
}
