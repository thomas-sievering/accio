import { useState, type FormEvent } from 'react';
import type { ProfileView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Sheet } from '../app/Sheet';
import { Plus } from '../app/icons';
import { ProfileTile, useProfiles } from './profiles';
import { SignInWithClaude } from './SignInWithClaude';

/** List and edit profiles. Each one signs in to a Claude account, which stays on the hub. */
export function ProfilesSheet({ onClose, openProfileId }: { onClose: () => void; openProfileId?: string }) {
  const { profiles = [] } = useProfiles();
  const [editing, setEditing] = useState<string | 'new' | null>(openProfileId ?? (profiles.length ? null : 'new'));
  // Always the latest view, so sign-in changes show up while the form is open.
  const current = editing && editing !== 'new' ? profiles.find((a) => a.id === editing) : undefined;

  return (
    <Sheet title="Profiles" onClose={onClose}>
      {editing === 'new' ? (
        <ProfileForm onSaved={(a) => setEditing(a.id)} onCancel={() => setEditing(null)} />
      ) : current ? (
        <ProfileForm profile={current} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />
      ) : (
        <div className="sheet-body">
          <div className="list">
            {profiles.map((a) => (
              <button key={a.id} className="list-row" onClick={() => setEditing(a.id)}>
                <ProfileTile profile={a} size="md" />
                <span className="menu-text">
                  <b>{a.name}</b>
                  <small className={a.account ? undefined : 'warn'}>
                    {a.account ? (a.account.email ?? 'Signed in') : 'Not signed in'}
                  </small>
                </span>
              </button>
            ))}
            <button className="list-row add" onClick={() => setEditing('new')}>
              <span className="menu-icon">
                <Plus />
              </span>
              <span>Add profile</span>
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function ProfileForm({ profile, onSaved, onCancel }: { profile?: ProfileView; onSaved: (a: ProfileView) => void; onCancel: () => void }) {
  const client = useClient();
  const [name, setName] = useState(profile?.name ?? '');
  const [folderText, setFolderText] = useState((profile?.folders ?? []).join('\n'));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<ProfileView | null>) => {
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
    const folders = folderText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
    void run(() => client.call('profiles.save', { id: profile?.id, name, folders }));
  };

  return (
    <>
      <form onSubmit={submit} id="profile-form">
        <div className="sheet-body">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="personal, work…" autoFocus={!profile} required />
          </label>
          <label className="field">
            <span>Folders</span>
            <textarea rows={2} value={folderText} onChange={(e) => setFolderText(e.target.value)} placeholder={'S:\\hrc'} spellCheck={false} />
            <small className="hint">One per line. New projects inside these folders default to this profile.</small>
          </label>
          {profile && (
            <div className="field">
              <span>Claude</span>
              <SignInWithClaude profile={profile} />
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      </form>
      <footer className="sheet-foot">
        {profile && (
          <button
            type="button"
            className="ghost danger"
            disabled={busy}
            onClick={() => run(async () => (await client.call('profiles.delete', { id: profile.id }), null))}
          >
            Delete
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="ghost" onClick={onCancel}>
          {profile ? 'Done' : 'Cancel'}
        </button>
        <button type="submit" form="profile-form" className="ghost primary" disabled={busy}>
          {profile ? 'Save' : 'Add profile'}
        </button>
      </footer>
    </>
  );
}
