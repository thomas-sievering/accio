import { useEffect, useRef, useState } from 'react';
import { useClient } from '../app/connection';
import { Close, ScrollText, Search } from '../app/icons';
import { useLiveState } from '../app/useLive';
import { ProjectMark } from '../projects/ProjectMark';
import { useProjects } from '../projects/projects';
import { useProfiles } from '../profiles/profiles';
import { useThreads } from '../threads/threads';
import { byDay, filterChangelog } from './changelog';
import { ShippedNote } from './ShippedNote';

/**
 * GLOSSARY: Changelog. Every delivered change, newest first, within the sidebar's project
 * and profile filters. Each entry opens the thread it came from, while that thread exists.
 */
export function ChangelogView({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const client = useClient();
  const { value: entries, error, retry } = useLiveState(() => client.call('changelog.list', {}), 'changelog.changed');
  const { threads, select, projectScope, now } = useThreads();
  const { visible } = useProjects();
  const { filter } = useProfiles();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { search.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.target === search.current) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { state } = useProjects();
  // Opened from a thread's project name: that project only, whatever the sidebar shows.
  const projectIds = new Set(projectId ? [projectId] : projectScope ? [projectScope] : ['', ...visible.map((p) => p.id)]);
  const shown = entries ? filterChangelog(entries, { projectIds, profile: projectId ? 'all' : filter, query }) : [];
  const projectName = (id: string) => state?.projects.find((p) => p.id === id)?.name ?? 'No project';
  const live = new Set(threads?.map((t) => t.id));

  return (
    <>
      <header className="main-top drag">
        <div className="thread-title">
          {projectId
            ? <span className="thread-where"><ProjectMark id={projectId} size={16} /><span className="thread-project-name">{projectName(projectId)}</span></span>
            : <span className="limits-title-icon"><ScrollText /></span>}
          {projectId && <span className="faint" aria-hidden="true">/</span>}
          <b role="heading" aria-level={1}>Changelog</b>
        </div>
        <span className="spacer" />
        <label className="side-search changelog-search">
          <Search />
          <input ref={search} type="search" placeholder="Search changes" aria-label="Search changes" value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              if (query) setQuery('');
              else onClose();
            }} />
        </label>
        <button type="button" className="side-icon" title="Close changelog (Esc)" aria-label="Close changelog" onClick={onClose}><Close /></button>
      </header>
      <div className="settings-scroll">
        <div className="changelog-page">
          {error && (
            <div className="limits-banner error" role="alert">
              Could not load the changelog: {error} <button className="ghost" onClick={retry}>Retry</button>
            </div>
          )}
          {entries && shown.length === 0 && <p className="changelog-empty">{query.trim() ? 'No changes found.' : 'Nothing shipped yet.'}</p>}
          {byDay(shown, now).map((group) => (
            <section key={group.day} className="changelog-day" aria-label={group.day}>
              <h2>{group.day}</h2>
              {group.entries.map((e) => {
                const body = (
                  <>
                    <span className="changelog-thread">
                      {e.projectId ? <ProjectMark id={e.projectId} size={16} /> : <span className="no-project-mark" />}
                      <span className="changelog-thread-title">{e.title}</span>
                      <span className="changelog-project">{projectName(e.projectId)}</span>
                    </span>
                    <ShippedNote entry={e} link={false} />
                  </>
                );
                return live.has(e.threadId)
                  ? <button key={e.id} type="button" className="changelog-entry" title="Open its thread" onClick={() => select(e.threadId)}>{body}</button>
                  : <div key={e.id} className="changelog-entry gone" title="Its thread was deleted">{body}</div>;
              })}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
