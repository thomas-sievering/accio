import { useEffect, useRef, useState } from 'react';
import type { CommitView, ProjectAppView, ProjectChangelog, ProjectView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { emitAppEvent } from '../app/appEvents';
import { Close, Play, Refresh, Settings, StopSquare } from '../app/icons';
import { useAction } from '../app/useAction';
import { useLive } from '../app/useLive';
import { relativeTime } from '../limits/limitsModel';
import { ThreadMenuProvider } from '../threads/ThreadMenu';
import { ThreadRow } from '../threads/ThreadRow';
import { placeOf } from '../threads/shelves';
import { useThreads } from '../threads/threads';
import { ProjectMark } from './ProjectMark';

const TABS = [{ id: 'threads', label: 'Threads' }, { id: 'changelog', label: 'Changelog' }, { id: 'logs', label: 'Logs' }] as const;
type Tab = (typeof TABS)[number]['id'];
const SETTLED_SHOWN = 10;

/**
 * GLOSSARY: Project dashboard. Opened from the project name in a thread's header:
 * the project app's controls on top, then its threads, changelog and app logs.
 */
export function ProjectDashboard({ project, onClose }: { project: ProjectView; onClose: () => void }) {
  const client = useClient();
  const apps = useLive(() => client.call('projectApps.get', {}), 'projectApps.changed');
  const app = apps?.find((a) => a.projectId === project.id);
  const [tab, setTab] = useState<Tab>('threads');
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
        <button type="button" className="side-icon" title={`${project.name} settings`} aria-label={`${project.name} settings`}
          onClick={() => emitAppEvent('settings.open', { section: 'projects', projectId: project.id, fromDashboard: true })}><Settings /></button>
        <button type="button" className="side-icon" title="Close (Esc)" aria-label="Close dashboard" onClick={onClose}><Close /></button>
      </header>
      <div className="settings-scroll">
        <div className="dashboard-page">
          <AppControls project={project} app={app} />
          <div className="dashboard-tabs" role="tablist" aria-label={`${project.name} dashboard`}>
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="side-panel-tab" onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          <div role="tabpanel">
            {tab === 'threads' ? <Threads project={project} />
              : tab === 'changelog' ? <Changelog project={project} running={app?.status === 'stopped' ? undefined : app?.commit?.sha} />
              : <Logs project={project} />}
          </div>
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
        {shown && commit && <span className="app-commit" title={`${commit.subject}\n${commit.author} · ${new Date(commit.at).toLocaleString()}`}>
          <code>{commit.sha.slice(0, 7)}</code> <span className="dim">{commit.subject}</span>
        </span>}
        <span className="spacer" />
        {!project.startCommand ? (
          <button type="button" className="ghost" onClick={() => emitAppEvent('settings.open', { section: 'projects', projectId: project.id, fromDashboard: true })}>Set start command</button>
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
    </section>
  );
}

function Threads({ project }: { project: ProjectView }) {
  const { threads, now } = useThreads();
  const own = (threads ?? []).filter((t) => t.projectId === project.id);
  const active = own.filter((t) => !t.settledAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const settled = own.filter((t) => t.settledAt).sort((a, b) => b.settledAt!.localeCompare(a.settledAt!)).slice(0, SETTLED_SHOWN);
  if (threads && own.length === 0) return <p className="dashboard-empty">No threads yet.</p>;
  return (
    <ThreadMenuProvider>
      <div className="rows dashboard-rows">
        {active.map((t) => <ThreadRow key={t.id} thread={t} place={placeOf(t, now)} />)}
      </div>
      {settled.length > 0 && <>
        <h3 className="dashboard-heading">Recently settled</h3>
        <div className="rows dashboard-rows">
          {settled.map((t) => <ThreadRow key={t.id} thread={t} place="settled" />)}
        </div>
      </>}
    </ThreadMenuProvider>
  );
}

function Changelog({ project, running }: { project: ProjectView; running: string | undefined }) {
  const client = useClient();
  const [log, setLog] = useState<ProjectChangelog>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    client.call('projects.changelog', { projectId: project.id }).then((l) => { if (live) setLog(l); }, (e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [client, project.id, running]);
  if (error) return <p className="dashboard-empty error">{error}</p>;
  if (!log) return <p className="dashboard-empty">Loading…</p>;
  if (!log.commits.length) return <p className="dashboard-empty">No commits on origin’s default branch yet.</p>;
  const now = Date.now();
  return (
    <ol className="changelog">
      {log.commits.map((c: CommitView) => (
        <li key={c.sha} className={c.sha === running ? 'running' : undefined}>
          <code>{c.sha.slice(0, 7)}</code>
          <span className="changelog-subject" title={c.subject}>{c.subject}</span>
          {c.sha === running && <span className="changelog-running">running</span>}
          <span className="dim" title={new Date(c.at).toLocaleString()}>{c.author} · {relativeTime(Date.parse(c.at), now)}</span>
        </li>
      ))}
    </ol>
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
  if (text === undefined) return <p className="dashboard-empty">Loading…</p>;
  if (!text.trim()) return <p className="dashboard-empty">No output yet.</p>;
  return <pre ref={pre} className="app-logs" onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>{text.trim()}</pre>;
}
