import { useState, type FormEvent } from 'react';
import type { ProfileView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Chevron, Plus } from '../app/icons';
import { SettingsSection } from '../app/Settings';
import { ProfileTile, useProfiles } from './profiles';
import { SignInWithClaude } from './SignInWithClaude';

/** List and edit profiles. Each one signs in to a Claude account, which stays on the hub. */
export function ProfilesSettings({
  profileId,
  onOpen,
  onBack,
}: {
  /** The profile being edited, 'new' to add one, or none for the list. */
  profileId?: string;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const { profiles } = useProfiles();
  if (!profiles) return null;
  if (profileId === 'new') return <ProfileForm onSaved={(p) => onOpen(p.id)} onDone={onBack} />;
  // Always the latest view, so sign-in changes show up while the form is open.
  const current = profileId ? profiles.find((p) => p.id === profileId) : undefined;
  if (current) return <ProfileForm key={current.id} profile={current} onSaved={onBack} onDone={onBack} />;

  return (
    <SettingsSection title="Profiles">
      {profiles.map((p) => (
        <button key={p.id} className="setting setting-link" onClick={() => onOpen(p.id)}>
          <ProfileTile profile={p} size="md" />
          <span className="setting-text">
            <b>{p.name}</b>
            <small className={p.account ? undefined : 'warn'}>{p.account ? (p.account.email ?? 'Signed in') : 'Not signed in'}</small>
          </span>
          <Chevron />
        </button>
      ))}
      <button className="setting setting-link" onClick={() => onOpen('new')}>
        <span className="menu-icon">
          <Plus />
        </span>
        <span className="setting-text">
          <b>Add profile</b>
          <small>A side of your life threads run under, such as personal or work.</small>
        </span>
      </button>
    </SettingsSection>
  );
}

function ProfileForm({ profile, onSaved, onDone }: { profile?: ProfileView; onSaved: (p: ProfileView) => void; onDone: () => void }) {
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
      else onDone();
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
    <form onSubmit={submit}>
      <SettingsSection title={profile ? profile.name : 'New profile'}>
        <div className="setting-form">
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
      </SettingsSection>
      <footer className="settings-actions">
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
        <button type="button" className="ghost" onClick={onDone}>
          {profile ? 'Done' : 'Cancel'}
        </button>
        <button type="submit" className="ghost primary" disabled={busy}>
          {profile ? 'Save' : 'Add profile'}
        </button>
      </footer>
    </form>
  );
}
