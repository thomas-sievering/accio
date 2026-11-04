import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { FolderInspection } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Sheet } from '../app/Sheet';
import { useAction } from '../app/useAction';
import { useProfiles } from '../profiles/profiles';
import { focusFirstInvalid } from '../resources/Field';

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

  const browse = async () => {
    const picked = await window.accioDesktop?.pickFolder();
    if (picked) setPath(picked);
  };

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
        <label className="field">
          <span>Folder</span>
          <span className="row-input">
            <input value={path} onChange={(e) => { setPath(e.target.value); setTried(false); }} placeholder="S:\my-repo" autoFocus data-autofocus spellCheck={false} aria-invalid={pathProblem || (tried && seen?.alreadyAdded) ? true : undefined} />
            {window.accioDesktop && (
              <button type="button" className="ghost" onClick={browse}>
                Browse…
              </button>
            )}
          </span>
          {pathProblem && <small className="error" role="alert">{pathProblem}</small>}
        </label>

        {seen && (
          <div className="facts">
            <div>
              <span className="dim">Project</span> {seen.name}
            </div>
            <div>
              <span className="dim">Repository</span> {seen.repoKey ?? 'no git remote; this folder is its own project'}
            </div>
            {seen.path !== path.trim() && (
              <div>
                <span className="dim">Checkout</span> {seen.path}
              </div>
            )}
            {!joining && onlyProfile && (
              <div>
                <span className="dim">Profile</span> {onlyProfile.name}
              </div>
            )}
          </div>
        )}

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
            <label className="field">
              <span>Profile</span>
              <select value={profileId} onChange={(e) => setProfileId(e.target.value)} aria-invalid={profileProblem ? true : undefined}>
                <option value="" disabled>
                  Choose…
                </option>
                {profiles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.id === seen.suggestedProfileId ? ' (from its folders)' : ''}
                  </option>
                ))}
              </select>
              {profileProblem && <small className="error" role="alert">{profileProblem}</small>}
            </label>
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
