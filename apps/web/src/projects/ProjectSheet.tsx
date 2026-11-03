import { useState } from 'react';
import type { ProjectView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Sheet } from '../app/Sheet';
import { useAction } from '../app/useAction';
import { useProfiles } from '../profiles/profiles';
import { useThreads } from '../threads/threads';
import { useProjects } from './projects';
import { ResourcePicker } from '../resources/ResourcePicker';
import type { SettingsRoute } from '../app/Settings';

/**
 * A project's profile and its checkouts on this machine. A checkout with threads
 * is removed only after a second, explicit click that deletes those threads too.
 */
export function ProjectSheet({ project, onClose, onOpenSettings }: { project: ProjectView; onClose: () => void; onOpenSettings: (route: SettingsRoute) => void }) {
  const client = useClient();
  const { profiles = [] } = useProfiles();
  const { checkoutsOf } = useProjects();
  const { threads = [] } = useThreads();
  const threadCount = threads.filter((t) => t.projectId === project.id).length;
  const { busy, error, run } = useAction();
  const [confirming, setConfirming] = useState<string>();

  const remove = (checkoutId: string) =>
    run(async () => {
      await client.call('checkouts.remove', { id: checkoutId, deleteThreads: confirming === checkoutId });
    }).finally(() => setConfirming(undefined));

  return (
    <Sheet title={project.name} onClose={onClose}>
      <div className="sheet-body">
        <div className="facts">
          <div>
            <span className="dim">Repository</span> {project.repoKey ?? 'no git remote'}
          </div>
          {profiles.length === 1 && (
            <div>
              <span className="dim">Profile</span> {profiles[0]!.name}
            </div>
          )}
        </div>
        {profiles.length > 1 ? (
          <label className="field">
            <span>Profile</span>
            <select
              value={project.profileId}
              disabled={busy || threadCount > 0}
              onChange={(e) => run(() => client.call('projects.setProfile', { projectId: project.id, profileId: e.target.value }))}
            >
              {profiles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <small className="hint">
              {threadCount > 0
                ? `Fixed while the project has threads (${threadCount}): each thread keeps the profile it started with.`
                : 'You can change it while the project has no threads.'}
            </small>
          </label>
        ) : null}
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
                      <button disabled={busy} className="ghost" onClick={() => setConfirming(undefined)}>
                        Cancel
                      </button>
                      <button disabled={busy} className="ghost danger" onClick={() => remove(c.id)}>
                        Delete {count} {count === 1 ? 'thread' : 'threads'} and remove
                      </button>
                    </>
                  ) : (
                    <button disabled={busy} className="ghost danger" onClick={() => (count > 0 ? setConfirming(c.id) : remove(c.id))}>
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="field">
          <span>Tools, MCP servers and skills</span>
          <small className="hint">
            Turn on what this project needs, for every checkout and thread of it. Things on everywhere or for its profile are inherited. Changes save immediately.
          </small>
          <ResourcePicker context={{ kind: 'project', project }} />
          <span className="signin-links">
            <button type="button" className="link" onClick={() => onOpenSettings({ section: 'tools' })}>Manage tools</button>
            <button type="button" className="link" onClick={() => onOpenSettings({ section: 'mcps' })}>MCP servers</button>
            <button type="button" className="link" onClick={() => onOpenSettings({ section: 'skills' })}>Skills</button>
          </span>
        </div>
      </div>
    </Sheet>
  );
}
