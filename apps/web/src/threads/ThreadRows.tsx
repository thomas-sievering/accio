import type { ProjectView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Plus } from '../app/icons';
import { useProjects } from '../projects/projects';
import { useThreads } from './threads';
import { ThreadRow } from './ThreadRow';

/** The open threads of one project in the sidebar (shelved ones sit at the bottom), plus a way to start one per checkout. */
export function ThreadRows({ project }: { project: ProjectView }) {
  const client = useClient();
  const { shelves, select } = useThreads();
  const { checkoutsOf } = useProjects();
  const checkouts = checkoutsOf(project.id);

  const start = async (checkoutId: string) => {
    const thread = await client.call('threads.create', { checkoutId });
    select(thread.id);
  };

  return (
    <div className="rows">
      {(shelves.open.get(project.id) ?? []).map((t) => (
        <ThreadRow key={t.id} thread={t} place="open" />
      ))}
      {checkouts.map((c) => (
        <button key={c.id} className="row row-add" onClick={() => start(c.id)}>
          <Plus />
          <span className="row-name">New thread{checkouts.length > 1 ? ` in ${folderName(c.path)}` : ''}</span>
        </button>
      ))}
    </div>
  );
}

function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
