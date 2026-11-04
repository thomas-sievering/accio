import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { FolderInspection } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Close, Folder, FolderPlus } from '../app/icons';
import { Sheet } from '../app/Sheet';
import { useAction } from '../app/useAction';
import { useProfiles } from '../profiles/profiles';
import { focusFirstInvalid } from '../resources/Field';
import { MenuSelect } from '../ui/MenuSelect';

export function AddProjectSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Add project" onClose={onClose}>
      <AddProjectForm onAdded={onClose} onCancel={onClose} />
    </Sheet>
  );
}

/**
 * Add a folder on this machine. A known repo joins its project; anything else
 * starts one. Shown in its sheet and inline on first run.
 */
export function AddProjectForm({ onAdded, onCancel }: { onAdded?: () => void; onCancel?: () => void }) {
  const client = useClient();
  const { profiles = [], filter } = useProfiles();
  const [path, setPath] = useState('');
  const [seen, setSeen] = useState<FolderInspection | null>(null);
  const [profileId, setProfileId] = useState('');
  const { busy, error, run, clear } = useAction();
  const [tried, setTried] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Look the folder up as you type or pick, so you see what will happen before adding.
  useEffect(() => {
    setSeen(null);
    clear();
    if (!path.trim()) return;
    let live = true;
    const timer = setTimeout(() => {
      void run(() => client.call('checkouts.inspect', { path })).then((r) => {
        if (!live || !r) return;
        setSeen(r);
        setProfileId(r.existingProject?.profileId ?? r.suggestedProfileId ?? (filter !== 'all' ? filter : (profiles[0]?.id ?? '')));
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Only the path triggers a lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, client]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    // Problems sit under the field they belong to; Add itself stays pressable.
    if (!seen || seen.alreadyAdded || (!seen.existingProject && !profileId && !onlyProfileId)) return focusFirstInvalid(formRef.current);
    const added = await run(() => client.call('checkouts.add', { path: seen.path, profileId: seen.existingProject ? undefined : (profileId || onlyProfileId) }));
    if (added) {
      setPath('');
      setTried(false);
      onAdded?.();
    }
  };

  const joining = seen?.existingProject;
  // With one profile there is nothing to choose: say where it goes instead.
  const onlyProfile = profiles.length === 1 ? profiles[0] : undefined;
  const onlyProfileId = onlyProfile?.id;
  const pathProblem = !path.trim() ? (tried ? 'Choose a folder' : undefined) : error;
  const profileProblem = tried && !joining && !profileId && !onlyProfileId ? 'Choose a profile' : undefined;

  return (
    <form onSubmit={submit} ref={formRef} noValidate>
      <div className="sheet-body">
        <FolderPicker path={path} seen={seen} invalid={!!pathProblem || (tried && !!seen?.alreadyAdded)} profile={!joining ? onlyProfile?.name : undefined}
          onPath={(p) => { setPath(p); setTried(false); }} />
        {pathProblem && <small className="error" role="alert">{pathProblem}</small>}

        {seen?.alreadyAdded ? (
          <p className="note">This folder is already added.</p>
        ) : joining ? (
          <p className="note">
            Joins the existing project <b>{joining.name}</b> as another checkout, under its profile{' '}
            <b>{profiles.find((a) => a.id === joining.profileId)?.name}</b>.
          </p>
        ) : (
          seen &&
          !onlyProfile && (
            <div className="field">
              <span>Profile</span>
              <MenuSelect label="Profile" value={profileId} placeholder="Choose…" onChange={setProfileId} invalid={!!profileProblem}
                options={profiles.map((a) => ({ value: a.id, label: a.name, ...(a.id === seen.suggestedProfileId ? { detail: 'From its folders' } : {}) }))} />
              {profileProblem && <small className="error" role="alert">{profileProblem}</small>}
            </div>
          )
        )}
      </div>
      <footer className="sheet-foot">
        <span className="spacer" />
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="ghost primary" disabled={busy}>
          Add
        </button>
      </footer>
    </form>
  );
}

/**
 * The folder as one target: browse or paste while empty; once Accio
 * recognises it, the same box shows the project it found. The path stays
 * editable underneath either way.
 */
function FolderPicker(props: { path: string; seen: FolderInspection | null; invalid: boolean; profile?: string; onPath: (path: string) => void }) {
  const { path, seen, onPath } = props;
  const desktop = window.accioDesktop;
  const input = useRef<HTMLInputElement>(null);
  const browse = async () => {
    const picked = await desktop?.pickFolder();
    if (picked) onPath(picked);
  };
  const head = seen ? (
    <>
      <span className="folder-pick-icon"><Folder /></span>
      <span className="folder-pick-text">
        <b>{seen.name}</b>
        <small>{seen.repoKey ?? 'no git remote; this folder is its own project'}{props.profile && <span> · {props.profile}</span>}</small>
      </span>
    </>
  ) : (
    <>
      <span className="folder-pick-icon"><FolderPlus /></span>
      <span className="folder-pick-text">
        <b>{desktop ? 'Choose a folder' : 'Paste a folder path'}</b>
      </span>
    </>
  );
  return (
    <div className={`folder-pick${seen ? ' found' : ''}`}>
      <div className="folder-pick-head">
        {desktop ? <button type="button" className="folder-pick-target" onClick={browse} title="Browse for a folder">{head}</button> : <div className="folder-pick-target">{head}</div>}
        {path && <button type="button" className="folder-pick-clear" aria-label="Clear folder" onClick={() => { onPath(''); input.current?.focus(); }}><Close /></button>}
      </div>
      <input ref={input} className="folder-pick-path" value={path} onChange={(e) => onPath(e.target.value)} placeholder="S:\my-repo" aria-label="Folder"
        autoFocus data-autofocus spellCheck={false} aria-invalid={props.invalid || undefined} />
      {seen && seen.path !== path.trim() && <small className="folder-pick-root">Checkout {seen.path}</small>}
    </div>
  );
}
