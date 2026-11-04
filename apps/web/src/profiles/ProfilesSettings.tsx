import { useState, type FormEvent } from 'react';
import type { ProfileView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Plus, User } from '../app/icons';
import { SettingLink, SettingsFooter, SettingsSection } from '../app/Settings';
import { useAction } from '../app/useAction';
import { ResourcePicker } from '../resources/ResourcePicker';
import { Field } from '../resources/Field';
import { toggled, useResources } from '../resources/resources';
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
    <SettingsSection>
      {profiles.map((p) => (
        <SettingLink key={p.id} icon={<User />} title={p.name} warn={!hasSignedInAccount(p)} onClick={() => onOpen(p.id)}
          description={p.providers.flatMap((provider) => provider.accounts.map((a) => `${a.name}${a.signedIn ? '' : ' · Signed out'}`)).join(', ') || 'No account selected'} />
      ))}
      <SettingLink icon={<Plus />} title="Add profile" description="A side of your life threads run under, such as personal or work." chevron={false} onClick={() => onOpen('new')} />
    </SettingsSection>
  );
}

function ProfileForm({ profile, onSaved, onDone, onOpenSecrets }: { profile?: ProfileView; onSaved: (p: ProfileView) => void; onDone: () => void; onOpenSecrets?: (profileId: string) => void }) {
  const client = useClient();
  const { accounts } = useProfiles();
  const [accountId, setAccountId] = useState(profile ? claudeAccount(profile)?.id ?? '' : '');
  const [openaiAccountId, setOpenAIAccountId] = useState(profile?.providers.find((p) => p.id === 'openai')?.accounts[0]?.id ?? '');
  const [name, setName] = useState(profile?.name ?? '');
  const { state: resources } = useResources();
  // Skill choices wait here until Save, keyed by skill id.
  const [skills, setSkills] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const skillChanges = Object.entries(skills).flatMap(([id, on]) => {
    const skill = resources?.skills.find((s) => s.id === id);
    return skill && profile && skill.scope.profileIds.includes(profile.id) !== on ? [{ skill, on }] : [];
  });
  const dirty = !profile || skillChanges.length > 0 || name !== profile.name || accountId !== (claudeAccount(profile)?.id ?? '') || openaiAccountId !== (profile.providers.find((p) => p.id === 'openai')?.accounts[0]?.id ?? '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim()) return;
    const saved = await run(async () => {
      const p = await client.call('profiles.save', { id: profile?.id, name, accountId: accountId || null, openaiAccountId: openaiAccountId || null });
      for (const { skill, on } of skillChanges) await client.call('skills.setScope', { id: skill.id, scope: { ...skill.scope, profileIds: toggled(skill.scope.profileIds, p.id, on) } });
      return p;
    });
    if (saved) onSaved(saved);
  };
  const remove = async () => {
    if (profile && (await run(async () => (await client.call('profiles.delete', { id: profile.id }), true)))) onDone();
  };

  return (
    <form className="settings-profile-form" onSubmit={submit} noValidate>
      <SettingsSection>
        <div className="setting-form">
          <Field label="Name" error={touched && !name.trim() && 'Name required'} hint="Shared on the hub. Set profile folders under Machines.">
            {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="personal, work…" autoFocus={!profile} required />}
          </Field>
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
          <SettingLink title="Saved secrets" description="Tokens this profile’s threads can use, managed in Settings / Secrets." onClick={() => onOpenSecrets(profile.id)} />
        </SettingsSection>
      )}
      {profile && (
        <SettingsSection title="Skills">
          <div className="setting-form">
            <small className="hint">Turned on for every project and thread of {profile.name}. Applied when you Save.</small>
            <ResourcePicker context={{ kind: 'profile', profile }} staged={{ values: skills, set: (id, on) => setSkills((s) => ({ ...s, [id]: on })) }} />
          </div>
        </SettingsSection>
      )}
      <SettingsFooter remove={profile && { name: profile.name, run: remove }} busy={busy} onCancel={onDone} saveLabel={profile ? 'Save' : 'Add profile'} saveDisabled={busy || !accounts || !dirty} />
    </form>
  );
}
