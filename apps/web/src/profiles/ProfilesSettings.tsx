import { useState, type FormEvent } from 'react';
import type { ProfileView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Chevron, Plus, User } from '../app/icons';
import { SettingsSection } from '../app/Settings';
import { useAction } from '../app/useAction';
import { claudeAccount, hasSignedInAccount, useProfiles } from './profiles';

/** Profiles select accounts configured in Accounts settings. */
export function ProfilesSettings({
  profileId,
  onOpen,
  onBack,
  onOpenSecrets,
}: {
  /** The profile being edited, 'new' to add one, or none for the list. */
  profileId?: string;
  onOpen: (id: string) => void;
  onBack: () => void;
  /** Opens Settings / Secrets filtered to a profile. */
  onOpenSecrets?: (profileId: string) => void;
}) {
  const { profiles } = useProfiles();
  if (!profiles) return null;
  if (profileId === 'new') return <ProfileForm onSaved={(p) => onOpen(p.id)} onDone={onBack} />;
  // Always the latest view, so sign-in changes show up while the form is open.
  const current = profileId ? profiles.find((p) => p.id === profileId) : undefined;
  if (current) return <ProfileForm key={current.id} profile={current} onSaved={onBack} onDone={onBack} onOpenSecrets={onOpenSecrets} />;

  return (
    <SettingsSection title="Profiles">
      {profiles.map((p) => (
        <button key={p.id} className="setting setting-link" onClick={() => onOpen(p.id)}>
          <span className="menu-icon"><User /></span>
          <span className="setting-text">
            <b>{p.name}</b>
            <small className={hasSignedInAccount(p) ? undefined : 'warn'}>{p.providers.flatMap((provider) => provider.accounts.map((a) => `${a.name}${a.signedIn ? '' : ' · Signed out'}`)).join(', ') || 'No account selected'}</small>
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

function ProfileForm({ profile, onSaved, onDone, onOpenSecrets }: { profile?: ProfileView; onSaved: (p: ProfileView) => void; onDone: () => void; onOpenSecrets?: (profileId: string) => void }) {
  const client = useClient();
  const { accounts } = useProfiles();
  const [accountId, setAccountId] = useState(profile ? claudeAccount(profile)?.id ?? '' : '');
  const [openaiAccountId, setOpenAIAccountId] = useState(profile?.providers.find((p) => p.id === 'openai')?.accounts[0]?.id ?? '');
  const [name, setName] = useState(profile?.name ?? '');
  const { busy, error, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const saved = await run(() => client.call('profiles.save', { id: profile?.id, name, accountId: accountId || null, openaiAccountId: openaiAccountId || null }));
    if (saved) onSaved(saved);
  };
  const remove = async () => {
    if (profile && (await run(async () => (await client.call('profiles.delete', { id: profile.id }), true)))) onDone();
  };

  return (
    <form className="settings-profile-form" onSubmit={submit}>
      <SettingsSection title={profile ? profile.name : 'New profile'}>
        <div className="setting-form">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="personal, work…" autoFocus={!profile} required />
          </label>
          <small className="hint">Shared on the hub. Set profile folders under Machines.</small>
          {error && <p className="error">{error}</p>}
        </div>
      </SettingsSection>
      <SettingsSection title="Accounts">
        <div className="setting-form">
          <label className="field">
            <span>Anthropic · Claude account</span>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!accounts}>
              <option value="">No account selected</option>
              {accounts?.filter((a) => a.providerId === 'anthropic').map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.email ? ` · ${a.email}` : ''}{a.signedIn ? '' : ' · Signed out'}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>OpenAI · ChatGPT account</span>
            <select value={openaiAccountId} onChange={(e) => setOpenAIAccountId(e.target.value)} disabled={!accounts}>
              <option value="">No account selected</option>
              {accounts?.filter((a) => a.providerId === 'openai').map((a) => <option key={a.id} value={a.id}>{a.name}{a.email ? ` · ${a.email}` : ''}{a.signedIn ? '' : ' · Signed out'}</option>)}
            </select>
          </label>
          <small className="hint">Set up and name accounts in Settings / Accounts. Choose one account per provider for this profile.</small>
        </div>
      </SettingsSection>
      {profile && onOpenSecrets && (
        <SettingsSection title="Secrets">
          <button type="button" className="setting setting-link" onClick={() => onOpenSecrets(profile.id)}>
            <span className="setting-text"><b>Saved secrets</b><small>Tokens this profile’s threads can use, managed in Settings / Secrets.</small></span>
            <Chevron />
          </button>
        </SettingsSection>
      )}
      <footer className="settings-actions">
        {profile && (
          <button
            type="button"
            className="ghost danger"
            disabled={busy}
            onClick={remove}
          >
            Delete
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="ghost" onClick={onDone}>
          {profile ? 'Done' : 'Cancel'}
        </button>
        <button type="submit" className="ghost primary" disabled={busy || !accounts}>
          {profile ? 'Save' : 'Add profile'}
        </button>
      </footer>
    </form>
  );
}
