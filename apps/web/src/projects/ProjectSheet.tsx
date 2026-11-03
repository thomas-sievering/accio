import { useState } from 'react';
import type { ProjectView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Sheet } from '../app/Sheet';
import { useProfiles } from '../profiles/profiles';
import { useThreads } from '../threads/threads';
import { useProjects } from './projects';

/**
 * A project's profile and its checkouts on this machine. A checkout with threads
 * is removed only after a second, explicit click that deletes those threads too.
 */
export function ProjectSheet({ project, onClose }: { project: ProjectView; onClose: () => void }) {
  const client = useClient();
  const { profiles = [] } = useProfiles();
  const { checkoutsOf } = useProjects();
  const { threads = [] } = useThreads();
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState<string>();

  const act = (p: Promise<unknown>) => {
    setError(undefined);
    return p.catch((e: Error) => setError(e.message));
  };
  const remove = (checkoutId: string) =>
    act(
      (async () => {
        for (const t of threads.filter((t) => t.checkoutId === checkoutId)) await client.call('threads.delete', { threadId: t.id });
        await client.call('checkouts.remove', { id: checkoutId });
      })(),
    ).finally(() => setConfirming(undefined));

  return (
    <Sheet title={project.name} onClose={onClose}>
      <div className="sheet-body">
        <div className="facts">
          <div>
            <span className="dim">Repository</span> {project.repoKey ?? 'no git remote'}
          </div>
        </div>
        <label className="field">
          <span>Profile</span>
          <select
            value={project.profileId}
            onChange={(e) => act(client.call('projects.setProfile', { projectId: project.id, profileId: e.target.value }))}
          >
            {profiles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <small className="hint">Applies to new threads. Existing threads keep the profile they started with.</small>
        </label>
        <div className="field">
          <span>Checkouts on this machine</span>
          <div className="list">
            {checkoutsOf(project.id).map((c) => {
              const count = threads.filter((t) => t.checkoutId === c.id).length;
              return (
                <div key={c.id} className="list-row static">
                  <code className="grow">{c.path}</code>
                  {confirming === c.id ? (
                    <>
                      <button className="ghost" onClick={() => setConfirming(undefined)}>
                        Cancel
                      </button>
                      <button className="ghost danger" onClick={() => remove(c.id)}>
                        Delete {count} {count === 1 ? 'thread' : 'threads'} and remove
                      </button>
                    </>
                  ) : (
                    <button className="ghost danger" onClick={() => (count > 0 ? setConfirming(c.id) : remove(c.id))}>
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </Sheet>
  );
}
