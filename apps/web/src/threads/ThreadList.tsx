import { useProfiles } from '../profiles/profiles';
import { useProjects } from '../projects/projects';
import { ThreadMenuProvider } from './ThreadMenu';
import { ThreadRow } from './ThreadRow';
import { ThreadShelves } from './ThreadShelves';
import { useThreads } from './threads';

/** The sidebar body, as in T3 Code: every open thread in one list (not grouped by project), then the shelves. Right-click a thread for its menu. */
export function ThreadList() {
  const { threads, shelves, query } = useThreads();
  const { visible, state } = useProjects();
  const { filter } = useProfiles();

  let empty: string | null = null;
  if (state && visible.length === 0) empty = `No projects${filter === 'all' ? '' : ' for this profile'} yet.`;
  else if (threads && query.trim() && shelves.open.length === 0) empty = 'No threads found.';

  return (
    <ThreadMenuProvider>
      {empty && <p className="side-empty">{empty}</p>}
      <div className="rows">
        {shelves.open.map((t) => (
          <ThreadRow key={t.id} thread={t} place="open" />
        ))}
      </div>
      <ThreadShelves />
    </ThreadMenuProvider>
  );
}
