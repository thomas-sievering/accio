import { useState } from 'react';
import type { ChangelogEntry } from '@accio/protocol';
import { ChevronDown, Search } from '../app/icons';
import { useThreads } from '../threads/threads';
import { byDay, filterChangelog } from './changelog';
import { ShippedNote } from './ShippedNote';

/**
 * GLOSSARY: Changelog. A project dashboard's fold of every change delivered in the project,
 * newest first by day, searchable. Each entry opens the thread it came from, while that thread exists.
 */
export function ProjectChangelog({ projectId, entries }: { projectId: string; entries: readonly ChangelogEntry[] | undefined }) {
  const { threads, select, now } = useThreads();
  const [query, setQuery] = useState('');
  const own = entries ? filterChangelog(entries, { projectId, query: '' }) : [];
  const shown = query.trim() ? filterChangelog(own, { projectId, query }) : own;
  const live = new Set(threads?.map((t) => t.id));

  return (
    <details className="dashboard-section dashboard-fold" aria-label="Changelog">
      <summary className="dashboard-heading"><ChevronDown />Changelog {own.length > 0 && <span className="dashboard-count">{own.length}</span>}</summary>
      <div className="changelog-page">
        {own.length > 0 && (
          <label className="side-search changelog-search">
            <Search />
            <input type="search" placeholder="Search changes" aria-label="Search changes" value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); } }} />
          </label>
        )}
        {entries && shown.length === 0 && <p className="dashboard-empty">{query.trim() ? 'No changes found.' : 'Nothing shipped yet.'}</p>}
        {byDay(shown, now).map((group) => (
          <section key={group.day} className="changelog-day" aria-label={group.day}>
            <h4>{group.day}</h4>
            {group.entries.map((e) => {
              const body = <>
                <span className="changelog-thread-title">{e.title}</span>
                <ShippedNote entry={e} link={false} />
              </>;
              return live.has(e.threadId)
                ? <button key={e.id} type="button" className="changelog-entry" title="Open its thread" onClick={() => select(e.threadId)}>{body}</button>
                : <div key={e.id} className="changelog-entry gone" title="Its thread was deleted">{body}</div>;
            })}
          </section>
        ))}
      </div>
    </details>
  );
}
