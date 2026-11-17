import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { SecretSlot, type ProfileView, type ProjectView, type SecretSummary } from '@accio/protocol';
import { useClient } from '../app/connection';
import { ConfirmAction, NEW, SectionStatus, SettingsFooter, SettingsSection, type SettingsNav, type SettingsRoute } from '../app/Settings';
import { useAction } from '../app/useAction';
import { useProfiles } from '../profiles/profiles';
import { useProjects } from '../projects/projects';
import { accessLabel, useSecretList, useSecretStore, type SecretStore } from './secrets';
import { focusFirstInvalid } from '../resources/Field';
import { safeError, valueInputProps, valueProblem } from './secretValue';
import { MenuSelect } from '../ui/MenuSelect';
import { formatDay } from '../ui/dates';

/** A profile's saved secrets: the one in `extra.profileId`, else the profile the sidebar filters by, else the first. */
export function useSecretsData(route: SettingsRoute) {
  const { profiles, filter } = useProfiles();
  const { state } = useProjects();
  const profileId = route.extra?.profileId;
  const profile = profiles?.find((p) => p.id === profileId)
    ?? (profileId ? undefined : profiles?.find((p) => p.id === filter) ?? profiles?.[0]);
  const { secrets, error, retry } = useSecretList(profile?.id);
  const store = useSecretStore();
  const projects = state?.projects ?? [];
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name;
  return { items: !profiles ? undefined : profile ? secrets : [], error, retry, profiles, profile, projects, projectName, store };
}
type Props = { nav: SettingsNav; data: ReturnType<typeof useSecretsData> };

/** Values are write-only: they can be added or replaced, never shown. */
function StoreNote({ store }: { store: SecretStore | undefined }) {
  return store?.available === false ? <p className="note" role="status">Saved secrets are unavailable{store.reason ? `: ${store.reason}` : '.'} Threads can still use a secret once.</p> : null;
}

export function NewSecret({ nav, data }: Props) {
  const { profile, profiles = [] } = data;
  if (!profile) return <p className="note">That profile no longer exists. Choose another.</p>;
  return (
    <div className="settings-profile-form secrets-page">
      <StoreNote store={data.store} />
      <SecretForm profile={profile} profiles={profiles} projects={data.projects} store={data.store} onDone={(profileId = profile.id) => nav.toList({ profileId })} />
    </div>
  );
}

export function SecretDetail({ nav, data, item: secret }: Props & { item: SecretSummary }) {
  const profile = data.profile!;
  const replace = nav.route.extra?.replace;
  return (
    <div className="settings-profile-form secrets-page">
      <StoreNote store={data.store} />
      <SecretForm profile={profile} profiles={data.profiles!} projects={data.projects} store={data.store} secret={secret} replace={replace}
        accessText={accessLabel(secret, profile.name, data.projectName)}
        onReplace={() => nav.open(secret.id, { profileId: profile.id, replace: true })} onDone={(profileId = profile.id) => nav.toList({ profileId })} />
    </div>
  );
}

/** One list for a profile's saved secrets, with the profile picker. */
export function SecretsList({ nav, data }: Props) {
  const { profiles, profile } = data;
  if (!profiles) return <SectionStatus what="secrets" />;
  if (!profiles.length) return <p className="note">Add a profile first. Secrets belong to one profile.</p>;
  return (
    <div className="settings-profile-form secrets-page">
      <p className="note">Tokens and keys a profile’s threads can use. Values can be replaced, never shown.</p>
      <div className="field secrets-profile">
        <span>Profile</span>
        <MenuSelect label="Profile" value={profile?.id ?? ''} placeholder="Choose a profile" onChange={(profileId) => nav.toList({ profileId })}
          options={profiles.map((p) => ({ value: p.id, label: p.name }))} />
      </div>
      {!profile ? <p className="note">That profile no longer exists. Choose another.</p> : <>
        <StoreNote store={data.store} />
        <SecretList
          profile={profile}
          secrets={data.items}
          error={data.error}
          retry={data.retry}
          canWrite={data.store?.available !== false}
          projectName={data.projectName}
          onAdd={() => nav.open(NEW, { profileId: profile.id })}
          onEdit={(id) => nav.open(id, { profileId: profile.id })}
          onReplace={(id) => nav.open(id, { profileId: profile.id, replace: true })}
        />
      </>}
    </div>
  );
}

const DELETE_CONSEQUENCE = 'Threads stop receiving it. This does not revoke the token at the service.';

function SecretList({ profile, secrets, error, retry, canWrite, projectName, onAdd, onEdit, onReplace }: {
  profile: ProfileView;
  secrets?: SecretSummary[];
  error?: string;
  retry: () => void;
  canWrite: boolean;
  projectName: (id: string) => string | undefined;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onReplace: (id: string) => void;
}) {
  const sorted = secrets?.slice().sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <SettingsSection add={{ label: 'Add secret', disabled: !canWrite, onClick: onAdd }}>
          {!sorted ? (
            <div className="setting">
              <SectionStatus what="secrets" error={error} retry={retry} />
            </div>
          ) : sorted.length === 0 ? (
            <div className="setting">
              <p className="note">No saved secrets for {profile.name}.</p>
            </div>
          ) : sorted.map((s) => (
            <SecretRow key={s.id} secret={s} access={accessLabel(s, profile.name, projectName)} canWrite={canWrite} onEdit={() => onEdit(s.id)} onReplace={() => onReplace(s.id)} />
          ))}
      </SettingsSection>
    </>
  );
}

function SecretRow({ secret: s, access, canWrite, onEdit, onReplace }: { secret: SecretSummary; access: string; canWrite: boolean; onEdit: () => void; onReplace: () => void }) {
  const client = useClient();
  const [confirming, setConfirming] = useState(false);
  const { busy, error, run } = useAction();
  const remove = () => void run(() => client.call('secrets.delete', { id: s.id }));
  return (
    <div className="setting secret-row">
      <div className="setting-text">
        <button type="button" className="secret-name" onClick={onEdit} title="Rename or change access">{s.name}</button>
        <small>Purpose <code>{s.slot}</code></small>
        <span className="secret-facts">
          <span className="secret-tag">{access}</span>
          <span>{s.lastUsedAt ? `Used ${formatDay(s.lastUsedAt)}` : 'Never used'}</span>
          <span>Updated {formatDay(s.updatedAt)}</span>
        </span>
      </div>
      <div className="setting-value">
        {confirming ? (
          <ConfirmAction question={`Delete ${s.name}?`} consequence={DELETE_CONSEQUENCE} action={`Delete ${s.name}`} busy={busy}
            error={error && `Could not delete: ${error}`} onConfirm={remove} onCancel={() => setConfirming(false)} />
        ) : <>
          <button type="button" className="ghost" disabled={!canWrite} onClick={onReplace} aria-label={`Replace ${s.name}`}>Replace</button>
          <button type="button" className="ghost danger" onClick={() => setConfirming(true)} aria-label={`Delete ${s.name}`}>Delete</button>
        </>}
      </div>
    </div>
  );
}

function SecretForm({ profile: initial, profiles, projects: allProjects, store, secret, replace, accessText, onReplace, onDone }: {
  profile: ProfileView;
  profiles: ProfileView[];
  projects: ProjectView[];
  store?: SecretStore;
  secret?: SecretSummary;
  replace?: boolean;
  accessText?: string;
  onReplace?: () => void;
  onDone: (profileId?: string) => void;
}) {
  const client = useClient();
  const profileFieldId = useId();
  const nameId = useId();
  const slotId = useId();
  const valueId = useId();
  const [profileId, setProfileId] = useState(initial.id);
  const profile = profiles.find((p) => p.id === profileId) ?? initial;
  const projects = allProjects.filter((p) => p.profileId === profile.id).sort((a, b) => a.name.localeCompare(b.name));
  const [name, setName] = useState(secret?.name ?? '');
  const [slot, setSlot] = useState(secret?.slot ?? '');
  const [wide, setWide] = useState(secret?.profileWide ?? false);
  const [chosen, setChosen] = useState<string[]>(secret?.projectIds ?? []);
  const [value, setValue] = useState('');
  const { busy, error, run, clear } = useAction();
  const creating = !secret;
  const dirty = !!value || name !== (secret?.name ?? '') || slot !== (secret?.slot ?? '') || wide !== (secret?.profileWide ?? false) || JSON.stringify(chosen) !== JSON.stringify(secret?.projectIds ?? []) || profileId !== initial.id;
  const writesValue = creating || !!replace;
  const editsMetadata = !replace;
  const slotOk = SecretSlot.safeParse(slot).success;
  const tooLarge = valueProblem(value);
  const storeDown = writesValue && store?.available === false;
  const ready = !busy && !storeDown;
  // Empty fields are reported when Save is pressed, not by a dead button.
  const [tried, setTried] = useState(false);
  const problems = {
    name: editsMetadata && !name.trim() ? 'Enter a name for the secret.' : undefined,
    slot: editsMetadata && !slot.trim() ? 'Enter a purpose key.' : editsMetadata && !slotOk ? 'Use letters, numbers and . _ : / - only, starting with a letter or number.' : undefined,
    value: writesValue && !value.length ? 'Paste the secret’s value.' : tooLarge,
  };
  const problem = Object.values(problems).some(Boolean);
  const form = useRef<HTMLDivElement>(null);
  // Projects that were removed stay in the list until unticked, so saving never narrows access silently.
  const listed: { id: string; name: string }[] = [...projects, ...chosen.filter((id) => !projects.some((p) => p.id === id)).map((id) => ({ id, name: 'Removed project' }))];

  const submit = async () => {
    if (!ready) return;
    setTried(true);
    if (problem) return focusFirstInvalid(form.current);
    const typed = value;
    await run(async () => {
      try {
        await client.call('secrets.save', {
          id: secret?.id,
          profileId: profile.id,
          name: editsMetadata ? name.trim() : secret!.name,
          slot: editsMetadata ? slot : secret!.slot,
          projectIds: editsMetadata ? (wide ? [] : chosen) : secret!.projectIds,
          profileWide: editsMetadata ? wide : secret!.profileWide,
          ...(writesValue ? { value: typed } : {}),
        });
      } catch (err) {
        throw new Error(safeError(err, typed, 'Could not save the secret. Nothing changed; try again.'));
      }
      setValue('');
      onDone(profile.id);
    });
  };
  const removeSecret = async () => {
    if (!secret) return;
    await run(async () => {
      try {
        await client.call('secrets.delete', { id: secret.id });
      } catch (err) {
        throw new Error('Could not delete: ' + (err as Error).message);
      }
      onDone();
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Enter' && !e.nativeEvent.isComposing && t instanceof HTMLInputElement && (t.type === 'text' || t.type === 'password')) {
      e.preventDefault();
      void submit();
    }
  };
  const toggle = (id: string, on: boolean) => setChosen((c) => on ? [...c.filter((x) => x !== id), id] : c.filter((x) => x !== id));

  return (
    <div className="settings-profile-form" ref={form} onKeyDown={onKeyDown}>
      <SettingsSection>
        <div className="setting-form">
          {editsMetadata ? <>
            <div className="field">
              <span>Profile</span>
              <MenuSelect id={profileFieldId} label="Profile" value={profile.id} disabled={!creating} onChange={(next) => { setProfileId(next); setChosen([]); }}
                options={profiles.map((p) => ({ value: p.id, label: p.name }))} />
              <small className="hint">Secrets belong to one profile and are only offered to its threads.</small>
            </div>
            <label className="field" htmlFor={nameId}>
              <span>Name</span>
              <input id={nameId} type="text" autoComplete="off" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} placeholder="Cloudflare Pages deploy" autoFocus={creating} aria-invalid={tried && problems.name ? true : undefined} required />
              {tried && problems.name && <small className="error">{problems.name}</small>}
            </label>
            <label className="field" htmlFor={slotId}>
              <span>Purpose key</span>
              <input id={slotId} type="text" autoComplete="off" spellCheck={false} value={slot} maxLength={160} onChange={(e) => setSlot(e.target.value)} placeholder="cloudflare.pages.deploy:docs" aria-invalid={(slot && !slotOk) || (tried && problems.slot) ? true : undefined} required />
              {(slot && !slotOk) || (tried && problems.slot) ? <small className="error">{problems.slot}</small>
                : <small className="hint">Use the purpose shown by the requesting thread, such as cloudflare.pages.deploy:docs. Threads in allowed projects that ask for it get the secret without asking again.</small>}
            </label>
            <fieldset className="secret-scope-choice">
              <legend>Projects that can use it</legend>
              <label className="check">
                <input type="radio" name={`${nameId}:scope`} checked={!wide} onChange={() => setWide(false)} />
                <span>Selected {profile.name} projects<small>Only the projects you tick below.</small></span>
              </label>
              {!wide && (
                <div className="secret-projects">
                  {listed.length ? listed.map((p) => (
                    <label key={p.id} className="check">
                      <input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
                      <span>{p.name}</span>
                    </label>
                  )) : <small className="hint">{profile.name} has no projects yet.</small>}
                  {listed.length > 0 && chosen.length === 0 && <small className="hint">No thread can use it until you tick a project.</small>}
                </div>
              )}
              <label className="check">
                <input type="radio" name={`${nameId}:scope`} checked={wide} onChange={() => setWide(true)} />
                <span>All {profile.name} projects<small>Including projects added later and threads with no project. Never other profiles.</small></span>
              </label>
            </fieldset>
          </> : (
            <p className="facts">
              <span><span className="dim">Purpose key</span><code>{secret!.slot}</code></span>
              <span><span className="dim">Projects</span>{accessText}</span>
            </p>
          )}
          {writesValue ? (
            <label className="field" htmlFor={valueId}>
              <span>{replace ? 'New value' : 'Value'}</span>
              <input id={valueId} className="secret-input" {...valueInputProps} placeholder="Paste secret" value={value} readOnly={busy}
                aria-invalid={tooLarge || (tried && problems.value) ? true : undefined} autoFocus={!!replace} onChange={(e) => { setValue(e.target.value); clear(); }} />
              {tooLarge || (tried && problems.value) ? <small className="error">{tooLarge ?? problems.value}</small>
                : <small className="hint">{replace
                  ? 'Replaces the stored value. Threads get the new one from their next request; the old value is not shown.'
                  : 'Stored on the Hub. It can be replaced later but never shown again.'}</small>}
            </label>
          ) : (
            <p className="note">The value is not shown. <button type="button" className="link" onClick={onReplace} disabled={store?.available === false}>Replace value</button></p>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          {storeDown && <p className="note">Saving values is unavailable right now.</p>}
        </div>
      </SettingsSection>
      <SettingsFooter
        remove={secret && !replace ? { name: secret.name, run: () => void removeSecret(), consequence: DELETE_CONSEQUENCE } : undefined}
        busy={busy} onCancel={() => onDone()} onSave={() => void submit()} saveDisabled={!ready}
        saveLabel={busy ? 'Saving…' : creating ? 'Save secret' : replace ? 'Replace value' : 'Save'} dirty={dirty && !busy} />
    </div>
  );
}
