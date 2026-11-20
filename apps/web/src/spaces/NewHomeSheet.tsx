import { useRef, useState, type FormEvent } from 'react';
import type { SaveSpace } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { useClient } from '../app/connection';
import { Sheet } from '../app/Sheet';
import { useAction } from '../app/useAction';
import { useLive } from '../app/useLive';
import { Field, focusFirstInvalid } from '../resources/Field';
import { useProfiles } from '../profiles/profiles';
import { Button } from '../ui/Button';
import { MenuSelect } from '../ui/MenuSelect';

type Location = 'folder' | 'github';

/**
 * The home's folder and repository name, from the space's name: "hrc" makes "hrc-home", while a name
 * that already says home, such as "hrc-home-apps", is kept as it is.
 */
function homeName(space: string) {
  const base = space.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '').toLowerCase();
  if (!base) return 'home';
  return /(^|[-._])home([-._]|$)/.test(base) ? base : `${base}-home`;
}

/**
 * GLOSSARY: Home. "New home…" from the Home project picker: a new project from Accio's home template,
 * as a local folder or a new GitHub repo in the chosen profile, made this space's home in one step. It
 * saves the space as the editor shows it, then opens the home's first thread. A space without a name yet
 * gets one here, as the editor's own Name field is behind the sheet. The home's folder and repo are
 * named after the space, with no field of their own: one name to think of. A home is usually personal
 * even for a work space, so the profile has no default: you always pick it, and with it the GitHub account.
 */
export function NewHomeSheet({ space, onSpaceName, onClose }: { space: SaveSpace; onSpaceName: (name: string) => void; onClose: () => void }) {
  const client = useClient();
  const { profiles = [] } = useProfiles();
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  const here = machines?.find((m) => m.thisMachine);
  const [askSpaceName] = useState(() => !space.name.trim());
  const [spaceName, setSpaceName] = useState(space.name);
  const name = homeName(spaceName);
  const [profileId, setProfileId] = useState('');
  const [location, setLocation] = useState<Location>('folder');
  const [tried, setTried] = useState(false);
  const { busy, error, run } = useAction();
  const form = useRef<HTMLFormElement>(null);

  const folder = here?.profileFolders?.[profileId]?.[0];
  const path = folder ? `${folder}${folder.includes('\\') ? '\\' : '/'}${name}` : undefined;
  const loginOf = (id: string) => profiles.find((p) => p.id === id)?.githubLogin ?? undefined;
  const login = loginOf(profileId);
  const where = path ?? (profileId ? 'your home folder on this machine, since this profile has no folder here' : "the profile's folder on this machine");
  const githubProblem = location === 'github' && profileId && !login ? 'This profile has no GitHub account. Choose one in Settings / Profiles.' : undefined;
  const spaceProblem = !spaceName.trim() ? 'Enter a name for the space.' : undefined;
  // The editor behind keeps the name too.
  const changeSpaceName = (value: string) => {
    setSpaceName(value);
    onSpaceName(value);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (spaceProblem || !profileId || githubProblem) return focusFirstInvalid(form.current);
    const created = await run(() => client.call('spaces.createHome', { space: { ...space, name: spaceName }, name, profileId, location }));
    if (!created) return;
    emitAppEvent('thread.open', { id: created.thread.id });
  };

  return (
    <Sheet title="New home" onClose={onClose} busy={busy}>
      <form onSubmit={submit} ref={form} noValidate>
        <fieldset className="sheet-body" disabled={busy}>
          <p className="note">Creates a project from Accio's home template, with AGENTS.md, a glossary, decisions and a wiki page per project, and makes it the home of {spaceName.trim() || 'this space'}. A first thread then reads the space's projects and fills it in.</p>
          {askSpaceName && (
            <Field label="Space name" error={tried && spaceProblem}>
              {(p) => <input {...p} value={spaceName} onChange={(e) => changeSpaceName(e.target.value)} placeholder="hrc, Copilot Studio agents…" data-autofocus required />}
            </Field>
          )}
          <div className="field">
            <span>Profile</span>
            <MenuSelect label="Profile" value={profileId} placeholder="Choose…" onChange={setProfileId} invalid={tried && !profileId}
              options={profiles.map((p) => ({ value: p.id, label: p.name, detail: loginOf(p.id) ? `GitHub ${loginOf(p.id)}` : 'No GitHub account chosen' }))} />
            {tried && !profileId && <small className="error" role="alert">Choose a profile.</small>}
            <small className="hint">The home's threads run under this profile and push with its GitHub account. The space's other projects keep their own profiles.</small>
          </div>
          <div className="field">
            <span>Create as</span>
            <MenuSelect<Location> label="Create as" value={location} onChange={setLocation} invalid={tried && !!githubProblem}
              options={[{ value: 'folder', label: 'Local folder', detail: 'A git repository on this machine only' }, { value: 'github', label: 'New GitHub repo', detail: "Private, under the profile's GitHub account" }]} />
            {githubProblem && <small className="error" role="alert">{githubProblem}</small>}
            <small className="hint">{location === 'folder' ? `Creates ${name} in ${where}.` : `Creates the private repo ${login ? `${login}/` : ''}${name}, cloned to ${where}.`}</small>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </fieldset>
        <footer className="sheet-foot">
          <span className="spacer sheet-progress" role="status">
            {busy && (location === 'github' ? 'Creating the repo on GitHub and cloning it. This can take a minute.' : 'Creating the folder and its first commit.')}
          </span>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <Button type="submit" className="ghost primary" busy={busy} busyLabel="Creating…">Create home</Button>
        </footer>
      </form>
    </Sheet>
  );
}
