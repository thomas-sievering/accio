import { useState, type FormEvent } from 'react';
import { accountInUse, noSortingHatMessage, type AccountView, type ProfileView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { ArrowUp, Close, ProviderLogo, User } from '../app/icons';
import { SettingLink, SettingsFooter, SettingsSection } from '../app/Settings';
import { useAction } from '../app/useAction';
import { ResourcePicker } from '../resources/ResourcePicker';
import { Field, focusFirstInvalid } from '../resources/Field';
import { toggled, useResources } from '../resources/resources';
import { hasSignedInAccount, profileSave, selectionOf, useProfiles } from './profiles';
import { MenuSelect } from '../ui/MenuSelect';

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

  return (<>
    <p className="note">A profile groups the accounts and projects for one side of your life, such as personal or work.</p>
    <SettingsSection add={{ label: 'Add profile', onClick: () => onOpen('new') }}>
      {profiles.map((p) => (
        <SettingLink key={p.id} icon={<User />} title={p.name} warn={!hasSignedInAccount(p)} onClick={() => onOpen(p.id)}
          description={p.house === null ? 'No house on the Sorting Hat' : [p.house && `House ${p.house.name}`, p.providers.flatMap((provider) => provider.accounts.map((a) => `${a.name}${a.signedIn ? '' : ' · Signed out'}`)).join(', ') || 'No account in its house'].filter(Boolean).join(' · ')} />
      ))}
    </SettingsSection>
  </>);
}

function ProfileForm({ profile, onSaved, onDone, onOpenSecrets }: { profile?: ProfileView; onSaved: (p: ProfileView) => void; onDone: () => void; onOpenSecrets?: (profileId: string) => void }) {
  const client = useClient();
  const { accounts, sortingHat } = useProfiles();
  const initial = selectionOf(profile);
  const [selection, setSelection] = useState(initial);
  // GLOSSARY: House.
  const savedHouse = profile?.house?.id ?? '';
  // A new profile offers a house of its own name, or an existing one.
  const initialHouse = profile || !sortingHat ? savedHouse : NEW_HOUSE;
  const [house, setHouse] = useState(initialHouse);
  const relinked = !!sortingHat && house !== savedHouse;
  const [name, setName] = useState(profile?.name ?? '');
  const houseName = house === NEW_HOUSE ? name.trim() : sortingHat?.houses.find((h) => h.id === house)?.name ?? house;
  const { state: resources } = useResources();
  // Skill choices wait here until Save, keyed by skill id.
  const [skills, setSkills] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const skillChanges = Object.entries(skills).flatMap(([id, on]) => {
    const skill = resources?.skills.find((s) => s.id === id);
    return skill && profile && skill.scope.profileIds.includes(profile.id) !== on ? [{ skill, on }] : [];
  });
  const dirty = profile ? skillChanges.length > 0 || name !== profile.name || relinked || JSON.stringify(selection) !== JSON.stringify(initial) : !!(name || house !== initialHouse || selection.anthropic.length || selection.openai.length);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim()) return focusFirstInvalid(e.currentTarget);
    const saved = await run(async () => {
      const p = await client.call('profiles.save', house === NEW_HOUSE ? { ...profileSave(undefined, name, selection), createHouse: true } : profileSave(profile?.id, name, selection, sortingHat ? house || null : undefined));
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
      {/* One card for who the profile is and which accounts it uses, so Skills fits above the footer. */}
      <SettingsSection>
        <div className="setting-form">
          <Field label="Name" error={touched && !name.trim() && 'Enter a name for the profile.'}>
            {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="personal, work…" autoFocus={!profile} required />}
          </Field>
          {sortingHat === null && <p className="note">{noSortingHatMessage}</p>}
          {sortingHat?.problem && <p className="error" role="alert">{sortingHat.problem}</p>}
          {sortingHat && !sortingHat.problem && (
            <Field label="House on the Sorting Hat" hint={!house ? 'Threads of this profile can’t run until it links to a house.' : house === NEW_HOUSE ? 'Save to make this house on the Sorting Hat.' : relinked ? `Save to use the accounts of ${houseName}.` : undefined}>
              {(p) => <MenuSelect id={p.id} label="House on the Sorting Hat" value={house} placeholder="Choose a house…" onChange={setHouse}
                options={[...(profile ? [] : [{ value: NEW_HOUSE, label: `New house ${name.trim() || 'named like this profile'}` }]), ...(savedHouse && !sortingHat.houses.some((h) => h.id === savedHouse) ? [{ value: savedHouse, label: profile?.house?.name ?? savedHouse, detail: 'Not on the Sorting Hat' }] : []), ...sortingHat.houses.map((h) => ({ value: h.id, label: h.name }))]} />}
            </Field>
          )}
          {sortingHat && house && !relinked && !sortingHat.problem && PROVIDERS.map((provider) => (
            <ProviderAccounts key={provider.id} provider={provider} accounts={accounts} selected={selection[provider.id]}
              inUseId={profile && accountInUse(profile.providers.find((p) => p.id === provider.id))?.id}
              onChange={(ids) => setSelection((s) => ({ ...s, [provider.id]: ids }))} />
          ))}
          {error && <p className="error">{error}</p>}
          <small className="hint">{sortingHat && `Accounts are set up in Settings / Accounts. Choosing them here sets the accounts of ${houseName ? `the house ${houseName}` : 'its house'} on the Sorting Hat, for every app that uses it.`}{profile && onOpenSecrets && <> <button type="button" className="link" onClick={() => onOpenSecrets(profile.id)}>Saved secrets</button></>}</small>
        </div>
      </SettingsSection>
      {profile && (
        <SettingsSection title="Skills">
          <div className="setting-form">
            <small className="hint">Turned on for every project and thread of {profile.name}. Applied when you Save.</small>
            <ResourcePicker context={{ kind: 'profile', profile }} staged={{ values: skills, set: (id, on) => setSkills((s) => ({ ...s, [id]: on })) }} />
          </div>
        </SettingsSection>
      )}
      <SettingsFooter remove={profile && { name: profile.name, run: remove, consequence: 'Its house and accounts stay on the Sorting Hat; only the profile goes.' }} busy={busy} onCancel={onDone} saveLabel={profile ? 'Save' : 'Add profile'} saveDisabled={busy || !accounts || (!!profile && !dirty)} dirty={dirty && !busy} />
    </form>
  );
}

/** The house picker's value for "make a house of this profile's name"; never a house id. */
const NEW_HOUSE = ' new';

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic · Claude accounts', account: 'Claude account' },
  { id: 'openai', label: 'OpenAI · ChatGPT accounts', account: 'ChatGPT account' },
] as const;

/** One provider's accounts for a profile, in order of use, with the others offered to add. */
function ProviderAccounts({ provider, accounts, selected, inUseId, onChange }: {
  provider: (typeof PROVIDERS)[number];
  accounts: AccountView[] | undefined;
  selected: string[];
  /** The saved profile's account in use, as the hub chose it. */
  inUseId?: string;
  onChange: (ids: string[]) => void;
}) {
  const own = accounts?.filter((a) => a.providerId === provider.id) ?? [];
  const chosen = selected.flatMap((id) => own.filter((a) => a.id === id));
  const rest = own.filter((a) => !selected.includes(a.id));
  const add = `Add ${chosen.length ? 'another ' : ''}${provider.account}`;
  const moveUp = (i: number) => onChange(selected.map((id, j) => j === i - 1 ? selected[i]! : j === i ? selected[i - 1]! : id));
  return (
    <div className="profile-accounts">
      <span className="profile-accounts-label">{provider.label}</span>
      {chosen.length > 0 && (
        <ol className="profile-account-list" aria-label={provider.label}>
          {chosen.map((a, i) => (
            <li key={a.id} className="profile-account">
              <span className="profile-account-mark"><ProviderLogo providerId={a.providerId} /></span>
              <span className="profile-account-text">
                <b>{a.name}</b>
                <small>{a.signedIn ? a.email ?? 'Signed in' : 'Signed out'}</small>
              </span>
              {chosen.length > 1 && a.id === inUseId && <span className="profile-account-tag">In use</span>}
              {i > 0 && (
                <button type="button" className="row-action" title={`Move ${a.name} up`} aria-label={`Move ${a.name} up`} onClick={() => moveUp(i)}>
                  <ArrowUp />
                </button>
              )}
              <button type="button" className="row-action" title={`Remove ${a.name}`} aria-label={`Remove ${a.name}`} onClick={() => onChange(selected.filter((id) => id !== a.id))}>
                <Close />
              </button>
            </li>
          ))}
        </ol>
      )}
      {chosen.length === 0 && <small className="hint">No {provider.account} selected.</small>}
      {rest.length > 0 && (
        <div className="field">
          <MenuSelect label={add} value="" placeholder={`${add}…`} disabled={!accounts} onChange={(id) => onChange([...selected, id])}
            options={rest.map((a) => ({ value: a.id, label: a.name, detail: a.signedIn ? a.email ?? 'Signed in' : 'Signed out' }))} />
        </div>
      )}
    </div>
  );
}
