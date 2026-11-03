import { useState, type FormEvent } from 'react';
import type { ProfileView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Chevron, Close, Plus } from '../app/icons';
import { SettingsSection } from '../app/Settings';
import { useAction } from '../app/useAction';
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
  const [folders, setFolders] = useState(profile?.folders ?? []);
  const { busy, error, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const saved = await run(() => client.call('profiles.save', { id: profile?.id, name, folders }));
    if (saved) onSaved(saved);
  };
  const remove = async () => {
    if (profile && (await run(async () => (await client.call('profiles.delete', { id: profile.id }), true)))) onDone();
  };

  return (
    <form onSubmit={submit}>
      <SettingsSection title={profile ? profile.name : 'New profile'}>
        <div className="setting-form">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="personal, work…" autoFocus={!profile} required />
          </label>
          <div className="field">
            <span>Folders</span>
            <FolderList folders={folders} onChange={setFolders} />
            <small className="hint">New projects inside these folders default to this profile.</small>
          </div>
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
          <button type="button" className="ghost danger" disabled={busy} onClick={remove}>
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

/** Profile folders as a list: type a path or browse for one, the same picker as Add project. */
function FolderList({ folders, onChange }: { folders: string[]; onChange: (f: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = (path: string) => {
    const p = path.trim();
    if (p && !folders.includes(p)) onChange([...folders, p]);
    setDraft('');
  };
  const browse = async () => {
    const picked = await window.accioDesktop?.pickFolder();
    if (picked) add(picked);
  };
  return (
    <div className="folder-list">
      {folders.map((f) => (
        <div key={f} className="folder-row">
          <code className="grow">{f}</code>
          <button type="button" className="row-action" aria-label={`Remove ${f}`} title="Remove" onClick={() => onChange(folders.filter((x) => x !== f))}>
            <Close />
          </button>
        </div>
      ))}
      <span className="row-input">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="S:\hrc"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
          onBlur={() => add(draft)}
        />
        {window.accioDesktop && (
          <button type="button" className="ghost" onClick={browse}>
            Browse…
          </button>
        )}
      </span>
    </div>
  );
}
