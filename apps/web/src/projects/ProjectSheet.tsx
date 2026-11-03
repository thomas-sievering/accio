import { useState } from 'react';
import type { ProjectView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Sheet } from '../app/Sheet';
import { useAccounts } from '../accounts/accounts';
import { useProjects } from './projects';

/** A project's account and its checkouts on this machine. */
export function ProjectSheet({ project, onClose }: { project: ProjectView; onClose: () => void }) {
  const client = useClient();
  const { accounts = [] } = useAccounts();
  const { checkoutsOf } = useProjects();
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
          <span>Account</span>
          <select
            value={project.accountId}
            onChange={(e) => act(client.call('projects.setAccount', { projectId: project.id, accountId: e.target.value }))}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <small className="hint">Applies to new threads. Existing threads keep the account they started with.</small>
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
