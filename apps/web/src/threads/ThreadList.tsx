import { useProfiles } from '../profiles/profiles';
import { useProjects } from '../projects/projects';
import { ThreadMenuProvider } from './ThreadMenu';
import { ThreadRow } from './ThreadRow';
import { ThreadShelves } from './ThreadShelves';
import { useThreads } from './threads';

/** The sidebar body, as in T3 Code: every open thread in one list (not grouped by project), then the shelves. Right-click a thread for its menu. */
export function ThreadList() {
  const { threads, shelves, query, loadError, retryLoad } = useThreads();
  const { visible, state } = useProjects();
  const { filter } = useProfiles();

  const listed = shelves.open.length + shelves.working.length;
  let empty: string | null = null;
  if (state && visible.length === 0 && listed === 0) empty = `No projects${filter === 'all' ? '' : ' for this profile'} yet.`;
  else if (threads && query.trim() && listed === 0) empty = 'No threads found.';

  return (
    <ThreadMenuProvider>
      {loadError && (
        <div className="side-empty">
          <p className="error" role="alert">Could not load threads: {loadError}</p>
          <button className="ghost" onClick={retryLoad}>Retry</button>
        </div>
      )}
      {!loadError && empty && <p className="side-empty">{empty}</p>}
      <div className="rows">
        {shelves.open.map((t) => (
          <ThreadRow key={t.id} thread={t} place="open" />
        ))}
      </div>
      <ThreadShelves />
    </ThreadMenuProvider>
  );
}
