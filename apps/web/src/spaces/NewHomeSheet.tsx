import { useMemo, useRef, useState, type FormEvent } from 'react';
import { projectKey, type SaveSpace } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { useClient } from '../app/connection';
import { Sheet } from '../app/Sheet';
import { useAction } from '../app/useAction';
import { useLive } from '../app/useLive';
import { Field, focusFirstInvalid } from '../resources/Field';
import { useProfiles } from '../profiles/profiles';
import { useProjects } from '../projects/projects';
import { MenuSelect } from '../ui/MenuSelect';

type Location = 'folder' | 'github';
const NAME = /^(?!\.+$)[A-Za-z0-9._-]+$/;

/** A folder and repository name from the space's name, such as "hrc-home". */
function suggestedName(space: string) {
  const base = space.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '').toLowerCase();
  return base ? `${base}-home` : 'home';
}

/**
 * GLOSSARY: Home. "New home…" from the Home project picker: a new project from Accio's home template,
 * as a local folder or a new GitHub repo in the chosen profile, made this space's home in one step. It
 * saves the space as the editor shows it, then opens the home's first thread.
 */
export function NewHomeSheet({ space, onClose }: { space: SaveSpace; onClose: () => void }) {
  const client = useClient();
  const { profiles = [] } = useProfiles();
  const { state } = useProjects();
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  const here = machines?.find((m) => m.thisMachine);
  // The profile most of the space's projects use here, else the first one.
  const usual = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of state?.projects ?? []) if (space.projectKeys.includes(projectKey(p))) counts.set(p.profileId, (counts.get(p.profileId) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? profiles[0]?.id ?? '';
  }, [state, space.projectKeys, profiles]);
  const [name, setName] = useState(() => suggestedName(space.name));
  const [chosenProfile, setProfileId] = useState<string>();
  const profileId = chosenProfile ?? usual;
  const [location, setLocation] = useState<Location>('folder');
  const [tried, setTried] = useState(false);
  const { busy, error, run } = useAction();
  const form = useRef<HTMLFormElement>(null);

  const folder = here?.profileFolders?.[profileId]?.[0];
  const path = folder ? `${folder}${folder.includes('\\') ? '\\' : '/'}${name}` : undefined;
  const login = here?.profileGitHub?.[profileId];
  const nameProblem = !name.trim() ? 'Enter a name for the home.' : !NAME.test(name.trim()) ? "Use letters, digits, '.', '-' or '_', as in a folder or repository name." : undefined;
  const spaceProblem = !space.name.trim() ? 'Name the space first.' : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (nameProblem || !profileId) return focusFirstInvalid(form.current);
    if (spaceProblem) return;
    const created = await run(() => client.call('spaces.createHome', { space, name: name.trim(), profileId, location }));
    if (!created) return;
    emitAppEvent('thread.open', { id: created.thread.id });
  };

  return (
    <Sheet title="New home" onClose={onClose}>
      <form onSubmit={submit} ref={form} noValidate>
        <div className="sheet-body">
          <p className="note">Creates a project from Accio's home template, with AGENTS.md, a glossary, decisions and a wiki page per project, and makes it the home of {space.name.trim() || 'this space'}. A first thread then reads the space's projects and fills it in.</p>
          <Field label="Name" error={tried && nameProblem}
            hint={location === 'folder' ? (path ? `Created in ${path}` : "Created in your home folder on this machine, since this profile has no folder here.")
              : `A private repo${login ? ` under ${login}` : " under gh's signed-in account"}, cloned to ${path ?? 'your home folder'}.`}>
            {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} data-autofocus spellCheck={false} required />}
          </Field>
          <div className="field">
            <span>Profile</span>
            <MenuSelect label="Profile" value={profileId} placeholder="Choose…" onChange={setProfileId} invalid={tried && !profileId}
              options={profiles.map((p) => ({ value: p.id, label: p.name, ...(p.id === usual && space.projectKeys.length ? { detail: "Most of the space's projects" } : {}) }))} />
          </div>
          <div className="field">
            <span>Create as</span>
            <MenuSelect<Location> label="Create as" value={location} onChange={setLocation}
              options={[{ value: 'folder', label: 'Local folder', detail: 'A git repository on this machine only' }, { value: 'github', label: 'New GitHub repo', detail: "Private, with this profile's GitHub account" }]} />
          </div>
          {tried && spaceProblem && <p className="error" role="alert">{spaceProblem}</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
        <footer className="sheet-foot">
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="ghost primary" disabled={busy}>{busy ? 'Creating…' : 'Create home'}</button>
        </footer>
      </form>
    </Sheet>
  );
}
