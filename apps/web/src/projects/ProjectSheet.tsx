import { useState } from 'react';
import type { ProjectView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Sheet } from '../app/Sheet';
import { useProfiles } from '../profiles/profiles';
import { useThreads } from '../threads/threads';
import { useProjects } from './projects';

/** A project's profile and its checkouts on this machine. */
export function ProjectSheet({ project, onClose }: { project: ProjectView; onClose: () => void }) {
  const client = useClient();
  const { profiles = [] } = useProfiles();
  const { checkoutsOf } = useProjects();
  const { threads = [] } = useThreads();
  const threadCount = threads.filter((t) => t.projectId === project.id).length;
  const [error, setError] = useState<string>();

  const act = (p: Promise<unknown>) => p.catch((e: Error) => setError(e.message));

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
            disabled={threadCount > 0}
            onChange={(e) => act(client.call('projects.setProfile', { projectId: project.id, profileId: e.target.value }))}
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
        <div className="field">
          <span>Checkouts on this machine</span>
          <div className="list">
            {checkoutsOf(project.id).map((c) => (
              <div key={c.id} className="list-row static">
                <code className="grow">{c.path}</code>
                <button className="ghost danger" onClick={() => act(client.call('checkouts.remove', { id: c.id }))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </Sheet>
  );
}
