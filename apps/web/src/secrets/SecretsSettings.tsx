import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { SecretSlot, type ProfileView, type ProjectView, type SecretSummary } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Plus } from '../app/icons';
import { SettingsFooter, SettingsSection, useEscape } from '../app/Settings';
import { useAction } from '../app/useAction';
import { useProfiles } from '../profiles/profiles';
import { useProjects } from '../projects/projects';
import { accessLabel, useSecretList, useSecretStore, type SecretStore } from './secrets';
import { focusFirstInvalid } from '../resources/Field';
import { safeError, valueInputProps, valueProblem } from './secretValue';

/** Where Secrets settings is open: a profile's list, a new secret, or one secret's edit or replace form. */
export type SecretsRoute = { profileId?: string; secretId?: string; replace?: boolean };

/**
 * One list and one form for a profile's saved secrets. Values are write-only:
 * they can be added or replaced, never shown.
 */
export function SecretsSettings({ route, onRoute }: { route: SecretsRoute; onRoute: (r: SecretsRoute) => void }) {
  const { profiles, filter } = useProfiles();
  const { state } = useProjects();
  const profile = profiles?.find((p) => p.id === route.profileId)
    ?? (route.profileId ? undefined : profiles?.find((p) => p.id === filter) ?? profiles?.[0]);
  const { secrets, error, retry } = useSecretList(profile?.id);
  const store = useSecretStore();
  if (!profiles) return null;
  if (!profiles.length) return <p className="note">Add a profile first. Secrets belong to one profile.</p>;

    const projectName = (id: string) => state?.projects.find((p) => p.id === id)?.name;
  const formOpen = !!route.secretId;
  const secret = secrets?.find((s) => s.id === route.secretId);
  const toList = (profileId = profile?.id) => onRoute({ profileId });

  return (
    <div className="settings-profile-form secrets-page">
      {!formOpen && <p className="note">Tokens and keys a profile’s threads can use. Values can be replaced, never shown.</p>}

      {!formOpen && (
        <label className="field secrets-profile">
          <span>Profile</span>
          <select aria-label="Profile" value={profile?.id ?? ''} onChange={(e) => onRoute({ profileId: e.target.value })}>
            {!profile && <option value="">Choose a profile</option>}
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}

      {!profile ? <p className="note">That profile no longer exists. Choose another.</p>
        : store?.available === false && <p className="note" role="status">Saved secrets are unavailable{store.reason ? `: ${store.reason}` : '.'} Threads can still use a secret once.</p>}

      {profile && (route.secretId === 'new' ? (
        <SecretForm key={`new:${profile.id}`} profile={profile} profiles={profiles} projects={state?.projects ?? []} store={store} onDone={toList} />
      ) : route.secretId ? (
        secret ? <SecretForm key={`${secret.id}:${route.replace ? 'replace' : 'edit'}`} profile={profile} profiles={profiles} projects={state?.projects ?? []} store={store} secret={secret} replace={route.replace}
          accessText={accessLabel(secret, profile.name, projectName)}
          onReplace={() => onRoute({ profileId: profile.id, secretId: secret.id, replace: true })} onDone={toList} />
          : secrets ? <div className="settings-card"><div className="setting-form"><p className="note">This secret no longer exists.</p><button type="button" className="ghost" onClick={() => toList()}>Back to secrets</button></div></div>
          : null
      ) : (
        <SecretList
          profile={profile}
          secrets={secrets}
          error={error}
          retry={retry}
          canWrite={store?.available !== false}
          projectName={projectName}
          onAdd={() => onRoute({ profileId: profile.id, secretId: 'new' })}
          onEdit={(id) => onRoute({ profileId: profile.id, secretId: id })}
          onReplace={(id) => onRoute({ profileId: profile.id, secretId: id, replace: true })}
        />
      ))}
    </div>
  );
}

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
      <section className="settings-section">
        <div className="settings-card">
          {!sorted ? (
            <div className="setting">
              {error ? <><p className="error grow" role="alert">Could not load secrets: {error}</p><button type="button" className="ghost" onClick={retry}>Retry</button></>
                : <p className="note">Loading…</p>}
            </div>
          ) : sorted.length === 0 ? (
            <div className="setting">
              <p className="note">No saved secrets for {profile.name}.</p>
            </div>
          ) : sorted.map((s) => (
            <SecretRow key={s.id} secret={s} access={accessLabel(s, profile.name, projectName)} canWrite={canWrite} onEdit={() => onEdit(s.id)} onReplace={() => onReplace(s.id)} />
          ))}
          <button type="button" className="setting setting-link" disabled={!canWrite} onClick={onAdd}>
            <span className="menu-icon"><Plus /></span>
            <span className="setting-text"><b>Add secret</b></span>
          </button>
        </div>
      </section>
    </>
  );
}

function SecretRow({ secret: s, access, canWrite, onEdit, onReplace }: { secret: SecretSummary; access: string; canWrite: boolean; onEdit: () => void; onReplace: () => void }) {
  const client = useClient();
  const [confirming, setConfirming] = useState(false);
  useEscape(confirming, () => setConfirming(false));
  const { busy, error, run } = useAction();
  const remove = () => void run(() => client.call('secrets.delete', { id: s.id }));
  return (
    <div className="setting secret-row">
      <div className="setting-text">
        <button type="button" className="secret-name" onClick={onEdit} title="Rename or change access">{s.name}</button>
        <small>Purpose <code>{s.slot}</code></small>
        <span className="secret-facts">
          <span className="secret-tag">{access}</span>
          <span>{s.lastUsedAt ? `Used ${shortDate(s.lastUsedAt)}` : 'Never used'}</span>
          <span>Updated {shortDate(s.updatedAt)}</span>
        </span>
      </div>
      {!confirming && (
        <div className="setting-value">
          <button type="button" className="ghost" disabled={!canWrite} onClick={onReplace} aria-label={`Replace ${s.name}`}>Replace</button>
          <button type="button" className="ghost danger" onClick={() => setConfirming(true)} aria-label={`Delete ${s.name}`}>Delete</button>
        </div>
      )}
      {confirming && (
        <div className="secret-confirm" role="group" aria-label={`Delete ${s.name}`}>
          <p>Delete {s.name}? Threads stop receiving it. This does not revoke the token at the service.</p>
          <button type="button" className="ghost" disabled={busy} onClick={() => setConfirming(false)} autoFocus>Cancel</button>
          <button type="button" className="ghost danger" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : `Delete ${s.name}`}</button>
          {error && <p className="error" role="alert">Could not delete: {error}</p>}
        </div>
      )}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const creating = !secret;
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
    setBusy(true);
    setError(undefined);
    const typed = value;
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
      setValue('');
      onDone(profile.id);
    } catch (err) {
      setError(safeError(err, typed, 'Could not save the secret. Nothing changed; try again.'));
    } finally {
      setBusy(false);
    }
  };
  const removeSecret = async () => {
    if (!secret) return;
    setBusy(true);
    setError(undefined);
    try {
      await client.call('secrets.delete', { id: secret.id });
      onDone();
    } catch (err) {
      setError('Could not delete: ' + (err as Error).message);
    } finally {
      setBusy(false);
    }
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
            <label className="field" htmlFor={profileFieldId}>
              <span>Profile</span>
              <select id={profileFieldId} value={profile.id} disabled={!creating} onChange={(e) => { setProfileId(e.target.value); setChosen([]); }}>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <small className="hint">Secrets belong to one profile and are only offered to its threads.</small>
            </label>
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
                aria-invalid={tooLarge || (tried && problems.value) ? true : undefined} autoFocus={!!replace} onChange={(e) => { setValue(e.target.value); setError(undefined); }} />
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
        remove={secret && !replace ? { name: secret.name, run: () => void removeSecret(), consequence: 'Threads stop receiving it. This does not revoke the token at the service.' } : undefined}
        busy={busy} onCancel={() => onDone()} onSave={() => void submit()} saveDisabled={!ready}
        saveLabel={busy ? 'Saving…' : creating ? 'Save secret' : replace ? 'Replace value' : 'Save'} />
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'today';
  return d.toLocaleDateString([], d.getFullYear() === today.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' });
}
