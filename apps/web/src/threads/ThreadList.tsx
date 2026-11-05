import { useClient } from '../app/connection';
import { useProfiles } from '../profiles/profiles';
import { useProjects } from '../projects/projects';
import { DraftRow, draftTitle } from './DraftRow';
import { useNewThreadDrafts } from './drafts';
import { ThreadMenuProvider } from './ThreadMenu';
import { ThreadRow } from './ThreadRow';
import { ThreadShelves } from './ThreadShelves';
import { useThreads } from './threads';

/** The sidebar body, as in T3 Code: threads that came back to you in one list (not grouped by project), then the shelves. Right-click a thread for its menu. */
export function ThreadList() {
  const { threads, shelves, query, projectScope, loadError, retryLoad } = useThreads();
  const { visible, state } = useProjects();
  const { filter } = useProfiles();
  const client = useClient();
  // Drafts head the inbox, under the same project scope, profile and search as threads.
  const q = query.trim().toLowerCase();
  const drafts = useNewThreadDrafts(client.hubId).filter((d) => {
    const project = state?.projects.find((p) => p.id === state.checkouts.find((c) => c.id === d.checkoutId)?.projectId);
    if (projectScope && project?.id !== projectScope) return false;
    if (filter !== 'all' && (d.profileId ?? project?.profileId) !== filter) return false;
    return !q || draftTitle(d).toLowerCase().includes(q);
  });

  const listed = drafts.length + shelves.open.length + shelves.working.length;
  let empty: string | null = null;
  if (state && visible.length === 0 && listed === 0) empty = `No projects${filter === 'all' ? '' : ' for this profile'} yet.`;
  else if (threads && query.trim() && listed === 0) empty = 'No threads found.';
  // A project with nothing in it yet still says so, rather than leaving the sidebar blank.
  else if (threads && listed === 0 && shelves.snoozed.length === 0 && shelves.settled.length === 0) empty = 'No threads yet.';

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
        {drafts.map((d) => <DraftRow key={d.key} draft={d} />)}
        {shelves.open.map((t) => (
          <ThreadRow key={t.id} thread={t} place="open" />
        ))}
      </div>
      <ThreadShelves />
    </ThreadMenuProvider>
  );
}
