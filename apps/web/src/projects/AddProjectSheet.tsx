import { useEffect, useState, type FormEvent } from 'react';
import type { FolderInspection } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Sheet } from '../app/Sheet';
import { useAccounts } from '../accounts/accounts';

/** Add a folder on this machine. A known repo joins its project; anything else starts one. */
export function AddProjectSheet({ onClose }: { onClose: () => void }) {
  const client = useClient();
  const { accounts = [], filter } = useAccounts();
  const [path, setPath] = useState('');
  const [seen, setSeen] = useState<FolderInspection | null>(null);
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Look the folder up as you type or pick, so you see what will happen before adding.
  useEffect(() => {
    setSeen(null);
    setError(undefined);
    if (!path.trim()) return;
    let live = true;
    const timer = setTimeout(() => {
      client.call('checkouts.inspect', { path }).then(
        (r) => {
          if (!live) return;
          setSeen(r);
          setAccountId(r.existingProject?.accountId ?? r.suggestedAccountId ?? (filter !== 'all' ? filter : (accounts[0]?.id ?? '')));
        },
        (e: Error) => live && setError(e.message),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Only the path triggers a lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, client]);

  const browse = async () => {
    const picked = await window.accioDesktop?.pickFolder();
    if (picked) setPath(picked);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!seen) return;
    setBusy(true);
    try {
      await client.call('checkouts.add', { path: seen.path, accountId: seen.existingProject ? undefined : accountId });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const joining = seen?.existingProject;

  return (
    <Sheet title="Add project" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="sheet-body">
          <label className="field">
            <span>Folder</span>
            <span className="row-input">
              <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="S:\\my-repo" autoFocus spellCheck={false} />
              {window.accioDesktop && (
                <button type="button" className="ghost" onClick={browse}>
                  Browse…
                </button>
              )}
            </span>
          </label>

          {seen && (
            <div className="facts">
              <div>
                <span className="dim">Project</span> {seen.name}
              </div>
              <div>
                <span className="dim">Repository</span> {seen.repoKey ?? 'no git remote; this folder is its own project'}
              </div>
              {seen.path !== path.trim() && (
                <div>
                  <span className="dim">Checkout</span> {seen.path}
                </div>
              )}
            </div>
          )}

          {seen?.alreadyAdded ? (
            <p className="note">This folder is already added.</p>
          ) : joining ? (
            <p className="note">
              Joins the existing project <b>{joining.name}</b> as another checkout, under its account{' '}
              <b>{accounts.find((a) => a.id === joining.accountId)?.name}</b>.
            </p>
          ) : (
            seen && (
              <label className="field">
                <span>Account</span>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.id === seen.suggestedAccountId ? ' (from its folders)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )
          )}
          {error && <p className="error">{error}</p>}
        </div>
        <footer className="sheet-foot">
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="ghost primary" disabled={!seen || seen.alreadyAdded || (!joining && !accountId) || busy}>
            Add
          </button>
        </footer>
      </form>
    </Sheet>
  );
}
