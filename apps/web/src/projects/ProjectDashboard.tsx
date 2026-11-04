import { useEffect, useRef, useState } from 'react';
import type { ProjectAppView, ProjectChangelog, ProjectView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { emitAppEvent } from '../app/appEvents';
import { ChevronDown, Close, Play, Refresh, Settings, StopSquare } from '../app/icons';
import { useAction } from '../app/useAction';
import { useLive } from '../app/useLive';
import { relativeTime } from '../limits/limitsModel';
import { ThreadMenuProvider } from '../threads/ThreadMenu';
import { ThreadRow } from '../threads/ThreadRow';
import { placeOf } from '../threads/shelves';
import { useThreads } from '../threads/threads';
import { ProjectMark } from './ProjectMark';
import { ProfileLabel } from '../profiles/ProfileLabel';
import { entryForCommit } from '../changelog/changelog';

const SETTLED_SHOWN = 10;
const SHIPPED_SHOWN = 8;

/**
 * GLOSSARY: Project dashboard. Opened from the project name in a thread's header:
 * the project app's controls and logs on top, then its threads by state, then what
 * recently landed on its default branch, with settled threads folded away last.
 */
export function ProjectDashboard({ project, onClose }: { project: ProjectView; onClose: () => void }) {
  const client = useClient();
  const apps = useLive(() => client.call('projectApps.get', {}), 'projectApps.changed');
  const app = apps?.find((a) => a.projectId === project.id);
  const heading = useRef<HTMLElement>(null);
  useEffect(() => { heading.current?.focus(); }, [project.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector(':popover-open') && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
          onClick={() => emitAppEvent('settings.open', { section: 'projects', projectId: project.id, fromDashboard: true })}><Settings /></button>
        <button type="button" className="side-icon" title="Close (Esc)" aria-label="Close dashboard" onClick={onClose}><Close /></button>
      </header>
      <div className="settings-scroll">
        <div className="dashboard-page">
          <AppControls project={project} app={app} />
          <ThreadMenuProvider>
            <Threads project={project} />
            <Shipped project={project} running={app?.status === 'stopped' ? undefined : app?.commit?.sha} />
            <Settled project={project} />
          </ThreadMenuProvider>
        </div>
      </div>
    </>
  );
}

const STATUS: Record<ProjectAppView['status'], string> = {
  stopped: 'Stopped', starting: 'Starting…', running: 'Running', updating: 'Updating…', stopping: 'Stopping…', exited: 'Exited', failed: 'Failed',
};

function AppControls({ project, app }: { project: ProjectView; app: ProjectAppView | undefined }) {
  const client = useClient();
  const { busy, error, run } = useAction();
  const [logsOpen, setLogsOpen] = useState(false);
  const { threads, select } = useThreads();
  // GLOSSARY: Project setup thread. One still open is where the setup goes on.
  const setup = threads?.find((t) => t.projectSetup && t.projectId === project.id && !t.settledAt);
  const status = app?.status ?? 'stopped';
  const working = status === 'starting' || status === 'updating' || status === 'stopping';
  const call = (method: 'projectApps.start' | 'projectApps.stop' | 'projectApps.restart' | 'projectApps.update') =>
    void run(() => client.call(method, { projectId: project.id }));
  const openApp = (url: string) => void run(async () => {
    const desktop = window.accioDesktop?.openPreview;
    if (desktop) await desktop(url);
    else if (!window.open(url, '_blank', 'noopener')) throw new Error('Allow popups to open the app.');
  });
  const commit = app?.commit;
  const shown = status !== 'stopped' || commit;

  return (
    <section className="app-card" aria-label="App">
      <div className="app-row">
        <span className={`app-dot ${status}`} aria-hidden="true" />
        <span className="app-status">{STATUS[status]}</span>
        {!project.startCommand && <span className="dim app-hint">{setup ? 'An agent is setting up the app' : 'Run this project’s app from main'}</span>}
        {shown && commit && <span className="app-commit" title={`${commit.subject}\n${commit.author} · ${new Date(commit.at).toLocaleString()}`}>
          <code>{commit.sha.slice(0, 7)}</code> <span className="dim">{commit.subject}</span>
        </span>}
        <span className="spacer" />
        {/* The app's output belongs to the app, so it opens here rather than on a tab of its own. */}
        {project.startCommand && <button type="button" className="ghost" aria-expanded={logsOpen} onClick={() => setLogsOpen(!logsOpen)}>{logsOpen ? 'Hide logs' : 'Logs'}</button>}
        {!project.startCommand ? (
          <>
            <button type="button" className="ghost" onClick={() => emitAppEvent('settings.open', { section: 'projects', projectId: project.id, fromDashboard: true })}>Enter manually</button>
            {setup
              ? <button type="button" className="ghost primary" onClick={() => select(setup.id)}>Open setup thread</button>
              : <button type="button" className="ghost primary" disabled={busy} title="An agent finds the setup and start commands, tries them and saves them"
                onClick={() => void run(async () => select((await client.call('threads.setUpProject', { projectId: project.id })).id))}>Set up with agent</button>}
          </>
        ) : status === 'running' || working ? (
          <>
            {app?.url && <button type="button" className="ghost" disabled={busy} onClick={() => openApp(app.url!)}>Open app</button>}
            {!working && <button type="button" className="ghost with-icon" disabled={busy} onClick={() => call('projectApps.restart')}><Refresh />Restart</button>}
            {status !== 'stopping' && <button type="button" className="ghost with-icon" disabled={busy} onClick={() => call('projectApps.stop')}><StopSquare />Stop</button>}
          </>
        ) : (
          <>
            {status !== 'stopped' && <button type="button" className="ghost" disabled={busy} onClick={() => call('projectApps.stop')}>Stop</button>}
            <button type="button" className="ghost primary with-icon" disabled={busy} onClick={() => call(status === 'stopped' ? 'projectApps.start' : 'projectApps.restart')}><Play />{status === 'stopped' ? 'Start' : 'Restart'}</button>
          </>
        )}
      </div>
      {app?.available && !working && status !== 'stopped' && (
        <div className="app-row app-note">
          <span>Update available · <code>{app.available.sha.slice(0, 7)}</code> <span className="dim">{app.available.subject}</span></span>
          <span className="spacer" />
          <button type="button" className="ghost" disabled={busy} onClick={() => call('projectApps.update')}>Update &amp; restart</button>
        </div>
      )}
      {app?.failedUpdate && (
        <p className="app-note warn">Update to <code>{app.failedUpdate.commit.sha.slice(0, 7)}</code> failed: {app.failedUpdate.message} Kept the previous version.</p>
      )}
      {app?.error && <p className="app-note error">{app.error}</p>}
      {error && <p className="app-note error">{error}</p>}
      {project.startCommand && (
        <label className="app-row app-auto">
          <input type="checkbox" role="switch" className="switch" checked={app?.autoUpdate ?? true} disabled={busy}
            onChange={(e) => void run(() => client.call('projectApps.setAutoUpdate', { projectId: project.id, on: e.target.checked }))} />
          <span>Auto-update from {app?.branch ?? 'main'}</span>
        </label>
      )}
      {logsOpen && <Logs project={project} />}
    </section>
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
        const rows = active.filter((t) => placeOf(t, now) === place);
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
  const { threads } = useThreads();
  const settled = (threads ?? []).filter((t) => t.projectId === project.id && t.settledAt)
    .sort((a, b) => b.settledAt!.localeCompare(a.settledAt!));
  if (!settled.length) return null;
  return (
    <details className="dashboard-section dashboard-fold">
      <summary className="dashboard-heading"><ChevronDown />Settled <span className="dashboard-count">{settled.length}</span></summary>
      <div className="rows dashboard-rows">
        {settled.slice(0, SETTLED_SHOWN).map((t) => <ThreadRow key={t.id} thread={t} place="settled" withinProject />)}
      </div>
    </details>
  );
}

/**
 * Recently shipped: the default branch's newest commits, each joined to the Changelog entry
 * that delivered it. Such a commit shows its shipped note and expands to what to try, its
 * thread and PR; the full Changelog covers older changes and other targets.
 */
function Shipped({ project, running }: { project: ProjectView; running: string | undefined }) {
  const client = useClient();
  const { threads, select } = useThreads();
  const entries = useLive(() => client.call('changelog.list', {}), 'changelog.changed');
  const [log, setLog] = useState<ProjectChangelog>();
  const [error, setError] = useState<string>();
  const [all, setAll] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  useEffect(() => {
    let live = true;
    client.call('projects.changelog', { projectId: project.id }).then((l) => { if (live) setLog(l); }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [client, project.id, running]);
  const own = (entries ?? []).filter((e) => e.projectId === project.id);
  const existing = new Set(threads?.map((t) => t.id));
  const now = Date.now();
  const commits = log?.commits ?? [];
  const shown = all ? commits : commits.slice(0, SHIPPED_SHOWN);
  return (
    <section className="dashboard-section" aria-label="Recently shipped">
      <h3 className="dashboard-heading">
        Recently shipped{log?.branch && <span className="dashboard-count">to {log.branch}</span>}
        <span className="spacer" />
        <button type="button" className="dashboard-link" onClick={() => emitAppEvent('changelog.open', { projectId: project.id })}>Open changelog</button>
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
              <code>{c.sha.slice(0, 7)}</code>
              <span className="changelog-text">
                <span className="changelog-subject">{c.subject}</span>
                {entry?.note && <span className="changelog-note">{entry.note.summary}</span>}
              </span>
              {c.sha === running && <span className="changelog-running">running</span>}
              <span className="dim" title={`${c.author} · ${new Date(c.at).toLocaleString()}`}>{relativeTime(Date.parse(c.at), now)}</span>
            </>;
            return (
              <li key={c.sha} className={`${c.sha === running ? 'running' : ''}${open ? ' expanded' : ''}`}>
                {entry
                  ? <button type="button" className="changelog-commit" aria-expanded={open} onClick={() => setExpanded(open ? undefined : c.sha)}>
                    {body}<span className="changelog-chevron" aria-hidden="true"><ChevronDown /></span>
                  </button>
                  : <div className="changelog-commit">{body}<span className="changelog-chevron" /></div>}
                {open && (
                  <div className="changelog-detail">
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

function Logs({ project }: { project: ProjectView }) {
  const client = useClient();
  const [text, setText] = useState<string>();
  const pre = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    let live = true;
    const load = () => client.call('projectApps.logs', { projectId: project.id }).then((r) => { if (live) setText(r.text); }, () => {});
    void load();
    const timer = setInterval(load, 2000);
    return () => { live = false; clearInterval(timer); };
  }, [client, project.id]);
  // Follow new output unless you scrolled up to read.
  useEffect(() => { const el = pre.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; }, [text]);
  if (text === undefined) return <p className="app-note">Loading…</p>;
  if (!text.trim()) return <p className="app-note">No output yet.</p>;
  return <pre ref={pre} className="app-logs" onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>{text.trim()}</pre>;
}
