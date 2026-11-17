import { useCallback, useEffect, useRef, useState } from 'react';
import { threadPlace, type ChangelogEntry, type ProjectChangelog, type ProjectView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { emitAppEvent } from '../app/appEvents';
import { ChevronDown, Close, Settings } from '../app/icons';
import { useEscapeClose } from '../app/useEscapeClose';
import { useLive } from '../app/useLive';
import { formatDayTime } from '../ui/dates';
import { ThreadMenuProvider } from '../threads/ThreadMenu';
import { ThreadRow, timeAgo } from '../threads/ThreadRow';
import { useThreads } from '../threads/threads';
import { ProjectMark } from './ProjectMark';
import { ProfileLabel } from '../profiles/ProfileLabel';
import { entryForCommit } from '../changelog/changelog';
import { ProjectChangelog as ChangelogFold } from '../changelog/ProjectChangelog';
import { ProjectIssues, useProjectIssues } from './ProjectIssues';
import { IssueReader } from './IssueReader';
import { useNarrow } from '../app/SidePanel';

const SETTLED_SHOWN = 10;
const SHIPPED_SHOWN = 8;

/**
 * GLOSSARY: Project dashboard. Opened from the project name in a thread's header:
 * its threads by state, then what recently landed on its default branch, then its
 * open issues, Changelog and settled threads, folded. An opened issue reads beside it
 * in wide windows, over it in narrow ones.
 */
export function ProjectDashboard({ project, onClose }: { project: ProjectView; onClose: () => void }) {
  const client = useClient();
  const entries = useLive(() => client.call('changelog.list', {}), 'changelog.changed');
  const heading = useRef<HTMLElement>(null);
  useEffect(() => { heading.current?.focus(); }, [project.id]);
  useEscapeClose(onClose);
  const issues = useProjectIssues(project);
  const [reading, setReading] = useState<string>();
  const closeReader = useCallback(() => setReading(undefined), []);
  const narrow = useNarrow();
  // The reader closes once its issue is no longer open in the list.
  const readingIssue = reading ? issues.list?.issues.find((issue) => issue.ref === reading) : undefined;

  return (
    <>
      <header className="main-top drag">
        <div className="thread-title">
          <ProjectMark id={project.id} size={16} />
          <b ref={heading} role="heading" aria-level={1} tabIndex={-1}>{project.name}</b>
        </div>
        <span className="spacer" />
        <ProfileLabel profileId={project.profileId} />
        <button type="button" className="side-icon" title={`${project.name} settings`} aria-label={`${project.name} settings`}
          onClick={() => emitAppEvent('settings.open', { section: 'projects', id: project.id, extra: { fromDashboard: true } })}><Settings /></button>
        <button type="button" className="side-icon" title="Close (Esc)" aria-label="Close dashboard" onClick={onClose}><Close /></button>
      </header>
      <div className="dashboard-body">
        <div className="settings-scroll">
          <div className="dashboard-page">
            <ThreadMenuProvider>
              <Threads project={project} />
              <Shipped project={project} entries={entries} />
              <ProjectIssues issues={issues} selected={readingIssue?.ref} onSelect={setReading} />
              <ChangelogFold projectId={project.id} entries={entries} />
              <Settled key={project.id} project={project} />
            </ThreadMenuProvider>
          </div>
        </div>
        {readingIssue && issues.checkoutId && issues.list && (
          <IssueReader projectId={project.id} checkoutId={issues.checkoutId} list={issues.list} issue={readingIssue} narrow={narrow} onOpen={setReading} onClose={closeReader} />
        )}
      </div>
    </>
  );
}

const GROUPS = [
  { place: 'open', label: 'Needs you' },
  { place: 'working', label: 'Working' },
  { place: 'snoozed', label: 'Snoozed' },
] as const;

/** Unsettled threads by what they wait on: you first, then the agent, then the clock. */
function Threads({ project }: { project: ProjectView }) {
  const { threads, now } = useThreads();
  const own = (threads ?? []).filter((t) => t.projectId === project.id);
  if (threads && own.length === 0) return <p className="dashboard-empty">No threads yet.</p>;
  const active = own.filter((t) => !t.settledAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <>
      {GROUPS.map(({ place, label }) => {
        const rows = active.filter((t) => threadPlace(t, now) === place);
        return rows.length > 0 && (
          <section key={place} className="dashboard-section" aria-label={label}>
            <h3 className="dashboard-heading">{label} <span className="dashboard-count">{rows.length}</span></h3>
            <div className="rows dashboard-rows">
              {rows.map((t) => <ThreadRow key={t.id} thread={t} place={place} withinProject />)}
            </div>
          </section>
        );
      })}
      {threads && own.length > 0 && active.length === 0 && <p className="dashboard-empty">Nothing in progress.</p>}
    </>
  );
}

/** Settled threads stay folded: history you can reach, out of the way. */
function Settled({ project }: { project: ProjectView }) {
  const [shown, setShown] = useState(SETTLED_SHOWN);
  const { threads } = useThreads();
  const settled = (threads ?? []).filter((t) => t.projectId === project.id && t.settledAt)
    .sort((a, b) => b.settledAt!.localeCompare(a.settledAt!));
  if (!settled.length) return null;
  return (
    <details className="dashboard-section dashboard-fold">
      <summary className="dashboard-heading"><ChevronDown />Settled <span className="dashboard-count">{settled.length}</span></summary>
      <div className="rows dashboard-rows">
        {settled.slice(0, shown).map((t) => <ThreadRow key={t.id} thread={t} place="settled" withinProject />)}
      </div>
      {settled.length > shown && <button type="button" className="ghost dashboard-more" onClick={() => setShown(n => n + SETTLED_SHOWN)}>Show {Math.min(SETTLED_SHOWN, settled.length - shown)} more settled threads</button>}
    </details>
  );
}

/**
 * Recently shipped: the default branch's newest commits, one line each, joined to the
 * Changelog entry that delivered it. Such a commit expands to its shipped note, what to
 * try, its thread and PR; the Changelog fold below covers older changes and other targets.
 */
function Shipped({ project, entries }: { project: ProjectView; entries: readonly ChangelogEntry[] | undefined }) {
  const client = useClient();
  const { threads, select } = useThreads();
  const [log, setLog] = useState<ProjectChangelog>();
  const [error, setError] = useState<string>();
  const [all, setAll] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const own = (entries ?? []).filter((e) => e.projectId === project.id);
  // A new delivery is a new commit on the branch: read it again.
  const delivered = own.length;
  useEffect(() => {
    let live = true;
    client.call('projects.changelog', { projectId: project.id }).then((l) => { if (live) { setLog(l); setError(undefined); } }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [client, project.id, delivered]);
  const existing = new Set(threads?.map((t) => t.id));
  const now = new Date();
  const commits = log?.commits ?? [];
  const shown = all ? commits : commits.slice(0, SHIPPED_SHOWN);
  return (
    <section className="dashboard-section" aria-label="Recently shipped">
      <h3 className="dashboard-heading">
        Recently shipped{log?.branch && <span className="dashboard-count">{log.branch}</span>}
      </h3>
      {error ? <p className="dashboard-empty error">{error}</p>
        : !log ? <p className="dashboard-empty">Loading…</p>
        : !commits.length ? <p className="dashboard-empty">No commits on origin’s default branch yet.</p>
        : <ol className="changelog">
          {shown.map((c) => {
            const entry = entryForCommit(c, own);
            const open = !!entry && expanded === c.sha;
            const tries = entry?.note?.test ?? [];
            const body = <>
              <span className="changelog-subject">{c.subject}</span>
              <span className="changelog-when">{timeAgo(c.at, now)}</span>
            </>;
            const title = `${c.sha.slice(0, 7)} · ${c.author} · ${formatDayTime(c.at, now)}`;
            return (
              <li key={c.sha} className={open ? 'expanded' : undefined}>
                {entry
                  ? <button type="button" className="changelog-commit" title={title} aria-expanded={open} onClick={() => setExpanded(open ? undefined : c.sha)}>
{body}</button>
                  : <div className="changelog-commit" title={title}>{body}</div>}
                {open && (
                  <div className="changelog-detail">
                    {entry.note && <p className="changelog-note">{entry.note.summary}</p>}
                    {tries.length > 0 && <ul className="shipped-try" aria-label="Things to try">{tries.map((t, i) => <li key={i}>{t}</li>)}</ul>}
                    <div className="changelog-actions">
                      {existing.has(entry.threadId)
                        ? <button type="button" className="ghost" onClick={() => select(entry.threadId)}>Open thread</button>
                        : <span className="dim">Its thread was deleted</span>}
                      {entry.pullRequest && <a className="ghost" href={entry.pullRequest.url} target="_blank" rel="noreferrer">PR #{entry.pullRequest.number}</a>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>}
      {!all && commits.length > SHIPPED_SHOWN && (
        <button type="button" className="ghost dashboard-more" onClick={() => setAll(true)}>Show {commits.length - SHIPPED_SHOWN} more</button>
      )}
    </section>
  );
}
