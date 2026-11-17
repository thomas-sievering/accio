import { useState, type FormEvent } from 'react';
import { projectKey, type ProjectView, type Space } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { useClient } from '../app/connection';
import { Spaces as SpacesIcon } from '../app/icons';
import { NEW, SettingRow, SettingsFooter, SettingsSection, type SettingsNav } from '../app/Settings';
import { useAction } from '../app/useAction';
import { Field, focusFirstInvalid } from '../resources/Field';
import { useProfiles } from '../profiles/profiles';
import { useProjects } from '../projects/projects';
import { MenuSelect } from '../ui/MenuSelect';
import { NewHomeSheet } from './NewHomeSheet';
import { useSpaces } from './spaces';

/** The spaces, once the projects they name have loaded too. */
export function useSpacesData() {
  const { spaces } = useSpaces();
  const { state } = useProjects();
  return { items: state ? spaces : undefined, projects: state?.projects ?? [] };
}
type Props = { nav: SettingsNav; data: ReturnType<typeof useSpacesData> };

export function NewSpace({ nav }: Props) {
  return <SpaceForm onDone={nav.back} />;
}

export function SpaceDetail({ nav, item }: Props & { item: Space }) {
  return <SpaceForm space={item} onDone={nav.back} />;
}

/** GLOSSARY: Space. Every space of the hub, each opening its editor as a detail page or its space view. */
export function SpacesList({ nav, data }: Props) {
  const nameOf = (key: string) => projectName(data.projects, key);
  return (<>
    <p className="note">A space groups projects that share context, such as everything about one product. Its projects may belong to different profiles. Its home holds what applies to the whole space.</p>
    <SettingsSection add={{ label: 'Add space', onClick: () => nav.open(NEW) }}>
      {data.items!.map((space) => (
        <SettingRow key={space.id} icon={<SpacesIcon />} title={space.name}
          description={[`${space.projectKeys.length} project${space.projectKeys.length === 1 ? '' : 's'}`, space.homeProjectKey ? `Home ${nameOf(space.homeProjectKey)}` : 'No home'].join(' · ')}>
          <button type="button" className="ghost" aria-label={`Edit ${space.name}`} onClick={() => nav.open(space.id)}>Edit</button>
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
/** The picker's "New home…" entry, which opens its dialog instead of choosing a project. */
const NEW_HOME = '\u0000new';

function SpaceForm({ space, onDone }: { space?: Space; onDone: () => void }) {
  const client = useClient();
  const { spaceOf } = useSpaces();
  const { state } = useProjects();
  const { profiles = [] } = useProfiles();
  const [name, setName] = useState(space?.name ?? '');
  const [keys, setKeys] = useState<string[]>(space?.projectKeys ?? []);
  const [home, setHome] = useState(space?.homeProjectKey ?? NO_HOME);
  const [touched, setTouched] = useState(false);
  const [creatingHome, setCreatingHome] = useState(false);
  const { busy, error, run, attempt } = useAction();
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
    if (space && (await attempt(() => client.call('spaces.delete', { id: space.id })))) onDone();
  };
  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name;
  return (<>
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
            {(p) => <MenuSelect id={p.id} label="Home project" value={home} onChange={(value) => value === NEW_HOME ? setCreatingHome(true) : setHome(value)}
              options={[{ value: NO_HOME, label: 'No home' }, ...keys.map((key) => ({ value: key, label: projectName(projects, key) })),
                { value: NEW_HOME, label: 'New home…', detail: 'A new project from the home template' }]} />}
          </Field>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </SettingsSection>
      <SettingsFooter remove={space && { name: space.name, run: remove, consequence: 'Its projects, checkouts and threads stay as they are; only the grouping goes.' }}
        busy={busy} onCancel={onDone} saveLabel={space ? 'Save' : 'Add space'} saveDisabled={busy || (!!space && !dirty)} dirty={dirty && !busy} />
    </form>
    {creatingHome && <NewHomeSheet space={{ ...(space ? { id: space.id } : {}), name, projectKeys: keys }} onSpaceName={setName} onClose={() => setCreatingHome(false)} />}
  </>);
}
