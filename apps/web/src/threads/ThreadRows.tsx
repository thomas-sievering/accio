import type { ProjectView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Plus } from '../app/icons';
import { useProjects } from '../projects/projects';
import { useThreads } from './threads';

/** The threads of one project in the sidebar, plus a way to start one per checkout. */
export function ThreadRows({ project }: { project: ProjectView }) {
  const client = useClient();
  const { threadsOf, selectedId, select } = useThreads();
  const { checkoutsOf } = useProjects();
  const checkouts = checkoutsOf(project.id);

  const start = async (checkoutId: string) => {
    const thread = await client.call('threads.create', { checkoutId });
    select(thread.id);
  };

  return (
    <div className="rows">
      {threadsOf(project.id).map((t) => (
        <button key={t.id} className={`row${t.id === selectedId ? ' active' : ''}`} onClick={() => select(t.id)}>
          <span className="row-name">{t.title}</span>
          {t.status === 'running' && <span className="row-working" title="Working" />}
          {t.status === 'interrupted' && <span className="row-flag interrupted" title="Interrupted" />}
          {t.status === 'failed' && <span className="row-flag failed" title="Last turn failed" />}
        </button>
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
