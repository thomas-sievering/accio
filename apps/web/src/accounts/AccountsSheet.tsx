import { useState, type FormEvent } from 'react';
import type { AccountView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Sheet } from '../app/Sheet';
import { Plus } from '../app/icons';
import { AccountTile, useAccounts } from './accounts';

/** List and edit accounts. Each account reaches its provider only through its hub proxy. */
export function AccountsSheet({ onClose }: { onClose: () => void }) {
  const { accounts = [] } = useAccounts();
  const [editing, setEditing] = useState<AccountView | 'new' | null>(accounts.length ? null : 'new');

  return (
    <Sheet title="Accounts" onClose={onClose}>
      {editing ? (
        <AccountForm account={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />
      ) : (
        <div className="sheet-body">
          <div className="list">
            {accounts.map((a) => (
              <button key={a.id} className="list-row" onClick={() => setEditing(a)}>
                <AccountTile account={a} size="md" />
                <span className="menu-text">
                  <b>{a.name}</b>
                  <small>
                    {a.isJob ? 'Job account · ' : ''}
                    {a.hubUrl}
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

function AccountForm({ account, onDone }: { account?: AccountView; onDone: () => void }) {
  const client = useClient();
  const [name, setName] = useState(account?.name ?? '');
  const [hubUrl, setHubUrl] = useState(account?.hubUrl ?? '');
  const [hubKey, setHubKey] = useState('');
  const [isJob, setIsJob] = useState(account?.isJob ?? false);
  const [roots, setRoots] = useState((account?.roots ?? []).join('\n'));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      onDone();
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
    void run(() => client.call('accounts.save', { id: account?.id, name, hubUrl, hubKey, isJob, roots: folders }));
  };

  return (
    <form onSubmit={submit}>
      <div className="sheet-body">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="personal, hrc…" autoFocus required />
        </label>
        <label className="field">
          <span>Hub URL</span>
          <input value={hubUrl} onChange={(e) => setHubUrl(e.target.value)} placeholder="https://hub.example.com:8318" required />
        </label>
        <label className="field">
          <span>Hub key</span>
          <input
            type="password"
            value={hubKey}
            onChange={(e) => setHubKey(e.target.value)}
            placeholder={account?.hasHubKey ? 'Unchanged' : 'Access key of this account’s hub proxy'}
            required={!account?.hasHubKey}
            autoComplete="off"
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={isJob} onChange={(e) => setIsJob(e.target.checked)} />
          <span>
            Job account
            <small>Belongs to an employer. Needs a hub proxy no other account uses.</small>
          </span>
        </label>
        <label className="field">
          <span>Folders</span>
          <textarea rows={2} value={roots} onChange={(e) => setRoots(e.target.value)} placeholder={'S:\\hrc'} spellCheck={false} />
          <small className="hint">One per line. New projects inside these folders default to this account.</small>
        </label>
        {error && <p className="error">{error}</p>}
      </div>
      <footer className="sheet-foot">
        {account && (
          <button
            type="button"
            className="ghost danger"
            disabled={busy}
            onClick={() => run(() => client.call('accounts.delete', { id: account.id }))}
          >
            Delete
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="ghost primary" disabled={busy}>
          {account ? 'Save' : 'Add account'}
        </button>
      </footer>
    </form>
  );
}
