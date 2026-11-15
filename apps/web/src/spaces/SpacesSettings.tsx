import { useState, type FormEvent } from 'react';
import { projectKey, type ProjectView, type Space } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { useClient } from '../app/connection';
import { Spaces as SpacesIcon } from '../app/icons';
import { SettingRow, SettingsFooter, SettingsSection } from '../app/Settings';
import { useAction } from '../app/useAction';
import { Field, focusFirstInvalid } from '../resources/Field';
import { useProfiles } from '../profiles/profiles';
import { useProjects } from '../projects/projects';
import { MenuSelect } from '../ui/MenuSelect';
import { useSpaces } from './spaces';

/** GLOSSARY: Space. Every space of the hub, each opening its editor as a detail page ('new' adds one) or its space view. */
export function SpacesSettings({ spaceId, onOpen, onBack }: { spaceId?: string; onOpen: (id: string) => void; onBack: () => void }) {
  const { spaces } = useSpaces();
  const { state } = useProjects();
  if (!spaces || !state) return <p className="note" role="status">Loading spaces…</p>;
  if (spaceId === 'new') return <SpaceForm onDone={onBack} />;
  const open = spaceId ? spaces.find((s) => s.id === spaceId) : undefined;
  if (spaceId && !open) return <><p className="note">This space no longer exists.</p><button type="button" className="link" onClick={onBack}>All spaces</button></>;
  if (open) return <SpaceForm key={open.id} space={open} onDone={onBack} />;
  const nameOf = (key: string) => projectName(state.projects, key);
  return (<>
    <p className="note">A space groups projects that share context, such as everything about one product. Its projects may belong to different profiles. Its home holds what applies to the whole space.</p>
    <SettingsSection add={{ label: 'Add space', onClick: () => onOpen('new') }}>
      {spaces.map((space) => (
        <SettingRow key={space.id} icon={<SpacesIcon />} title={space.name}
          description={[`${space.projectKeys.length} project${space.projectKeys.length === 1 ? '' : 's'}`, space.homeProjectKey ? `Home ${nameOf(space.homeProjectKey)}` : 'No home'].join(' · ')}>
          <button type="button" className="ghost" aria-label={`Edit ${space.name}`} onClick={() => onOpen(space.id)}>Edit</button>
          <button type="button" className="ghost" aria-label={`Open ${space.name}`} onClick={() => emitAppEvent('space.open', { id: space.id })}>Open</button>
        </SettingRow>
      ))}
    </SettingsSection>
  </>);
}

/** A project's name on this machine, else its key, for projects whose checkout is elsewhere. */
function projectName(projects: ProjectView[], key: string) {
  return projects.find((p) => projectKey(p) === key)?.name ?? key.replace(/^local:/, '');
}

const NO_HOME = '';

function SpaceForm({ space, onDone }: { space?: Space; onDone: () => void }) {
  const client = useClient();
  const { spaceOf } = useSpaces();
  const { state } = useProjects();
  const { profiles = [] } = useProfiles();
  const [name, setName] = useState(space?.name ?? '');
  const [keys, setKeys] = useState<string[]>(space?.projectKeys ?? []);
  const [home, setHome] = useState(space?.homeProjectKey ?? NO_HOME);
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const projects = [...(state?.projects ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const here = new Set(projects.map(projectKey));
  // Members whose checkout is on another machine stay listed, so saving keeps them.
  const elsewhere = keys.filter((key) => !here.has(key));
  const dirty = space
    ? name !== space.name || home !== (space.homeProjectKey ?? NO_HOME) || JSON.stringify(keys) !== JSON.stringify(space.projectKeys)
    : !!(name || keys.length);
  const toggle = (key: string, on: boolean) => {
    setKeys((list) => on ? [...list, key] : list.filter((k) => k !== key));
    // Removing the home's project leaves the space without a home, as the hub does.
    if (!on && key === home) setHome(NO_HOME);
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim()) return focusFirstInvalid(e.currentTarget);
    const saved = await run(() => client.call('spaces.save', { ...(space ? { id: space.id } : {}), name, projectKeys: keys, ...(home ? { homeProjectKey: home } : {}) }));
    if (saved) onDone();
  };
  const remove = async () => {
    if (space && (await run(async () => (await client.call('spaces.delete', { id: space.id }), true)))) onDone();
  };
  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name;
  return (
    <form onSubmit={submit} noValidate>
      <SettingsSection>
        <div className="setting-form">
          <Field label="Name" error={touched && !name.trim() && 'Enter a name for the space.'}>
            {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="hrc, Copilot Studio agents…" autoFocus={!space} required />}
          </Field>
          <div className="scope-list space-projects" role="group" aria-label="Projects">
            <span className="scope-list-label">Projects</span>
            {projects.length === 0 && elsewhere.length === 0 && <small className="hint">No projects yet. Add them in Settings / Projects.</small>}
            {projects.map((p) => {
              const key = projectKey(p);
              const other = spaceOf(key);
              const taken = !!other && other.id !== space?.id;
              return (
                <label key={p.id} className="check">
                  <input type="checkbox" checked={keys.includes(key)} disabled={taken} onChange={(e) => toggle(key, e.target.checked)} />
                  <span>
                    {p.name}
                    <small>{taken ? `In ${other.name}` : [profileName(p.profileId), p.repoKey ?? 'local folder'].filter(Boolean).join(' · ')}</small>
                  </span>
                </label>
              );
            })}
            {elsewhere.map((key) => (
              <label key={key} className="check">
                <input type="checkbox" checked onChange={(e) => toggle(key, e.target.checked)} />
                <span>
                  {projectName(projects, key)}
                  <small>Not on this machine</small>
                </span>
              </label>
            ))}
          </div>
          <Field label="Home project" hint="Holds what applies to the whole space, such as its glossary, decisions and notes about each project.">
            {(p) => <MenuSelect id={p.id} label="Home project" value={home} onChange={setHome} disabled={!keys.length}
              options={[{ value: NO_HOME, label: 'No home' }, ...keys.map((key) => ({ value: key, label: projectName(projects, key) }))]} />}
          </Field>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </SettingsSection>
      <SettingsFooter remove={space && { name: space.name, run: remove, consequence: 'Its projects, checkouts and threads stay as they are; only the grouping goes.' }}
        busy={busy} onCancel={onDone} saveLabel={space ? 'Save' : 'Add space'} saveDisabled={busy || (!!space && !dirty)} dirty={dirty && !busy} />
    </form>
  );
}
