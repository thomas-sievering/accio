import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { issueMessage, type IssueList, type IssueView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Close } from '../app/icons';
import { Sheet } from '../app/Sheet';
import { useEscapeClose } from '../app/useEscapeClose';
import { issueState } from '../threads/offerRows';
import { useThreads } from '../threads/threads';
import { ISSUE_STATE_LABEL, issueLinks } from './issueGraph';

/**
 * GLOSSARY: Project dashboard. The Issues fold's reader: one open issue with its state,
 * triage label, Blocked by and Blocks (which move the reader), body and GitHub link.
 * A panel beside the dashboard in wide windows, a sheet over it in narrow ones.
 */
export function IssueReader({ projectId, checkoutId, list, issue, narrow, onOpen, onClose }: {
  projectId: string; checkoutId: string; list: IssueList; issue: IssueView; narrow: boolean;
  onOpen: (ref: string) => void; onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  // In the panel, Escape closes the reader before the dashboard; a sheet's dialog handles its own.
  useEscapeClose(onClose, { first: true, enabled: !narrow });
  // Following a link from inside the reader keeps focus there, on the new issue's heading.
  const open = (ref: string) => {
    onOpen(ref);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('.issue-reader-title')?.focus());
  };

  if (narrow) {
    return (
      <Sheet title={`${issue.label} ${issue.title}`} onClose={onClose}>
        <div className="sheet-body issue-reader issue-reader-sheet">
          <IssueDetails projectId={projectId} checkoutId={checkoutId} list={list} issue={issue} onOpen={onOpen} titled={false} />
        </div>
      </Sheet>
    );
  }
  return (
    <aside ref={panel} className="issue-reader issue-reader-panel" aria-label="Issue">
      <IssueDetails projectId={projectId} checkoutId={checkoutId} list={list} issue={issue} onOpen={open} titled
        close={<button type="button" className="side-icon issue-reader-close" title="Close (Esc)" aria-label="Close issue" onClick={onClose}><Close /></button>} />
    </aside>
  );
}

function IssueDetails({ projectId, checkoutId, list, issue, onOpen, titled, close }: {
  projectId: string; checkoutId: string; list: IssueList; issue: IssueView; onOpen: (ref: string) => void; titled: boolean; close?: ReactNode;
}) {
  const state = issueState(issue);
  const links = issueLinks(list, issue.ref);
  const triage = issue.status && issue.status !== 'claimed' ? issue.status : undefined;
  return (
    <>
      <div className="issue-reader-meta">
        <span className="issue-reader-label">{issue.label}</span>
        <span className={`issue-pill issues-state ${state}`}>{ISSUE_STATE_LABEL[state]}</span>
        {triage && <span className="issue-triage">{triage}</span>}
        {close}
      </div>
      {titled && <h2 className="issue-reader-title" tabIndex={-1}>{issue.title}</h2>}
      <dl className="issue-reader-links">
        <dt>Blocked by</dt>
        <dd>{links.blockedBy.length ? links.blockedBy.map((i) => <IssueLink key={i.ref} issue={i} onOpen={onOpen} />) : <span className="issue-reader-none">Nothing open</span>}</dd>
        <dt>Blocks</dt>
        <dd>{links.blocks.length ? links.blocks.map((i) => <IssueLink key={i.ref} issue={i} onOpen={onOpen} />) : <span className="issue-reader-none">Nothing</span>}</dd>
      </dl>
      <IssueBody key={issue.ref} checkoutId={checkoutId} issueRef={issue.ref} />
      <div className="issue-reader-actions">
        <IssueThread key={issue.ref} projectId={projectId} checkoutId={checkoutId} issue={issue} />
        {issue.url && <a className="issue-reader-action" href={issue.url} target="_blank" rel="noopener noreferrer">View on GitHub ↗</a>}
      </div>
    </>
  );
}

/**
 * GLOSSARY: Issue. Open thread when an open thread in the project works on the issue (a
 * local claim lives in that thread's worktree, so the list may still say Ready); otherwise
 * Start a thread, through the issue picker's start-and-claim path, while the issue is ready.
 */
function IssueThread({ projectId, checkoutId, issue }: { projectId: string; checkoutId: string; issue: IssueView }) {
  const client = useClient();
  const { threads, select } = useThreads();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const working = useMemo(() => (threads ?? [])
    .filter((t) => t.issue === issue.ref && t.projectId === projectId && !t.settledAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0], [threads, issue.ref, projectId]);
  if (working) {
    return <button type="button" className="issue-reader-action primary" title={working.title} onClick={() => select(working.id)}>Open thread</button>;
  }
  const state = issueState(issue);
  const start = async () => {
    setStarting(true);
    setError(undefined);
    try {
      const thread = await client.call('threads.start', { checkoutId, text: issueMessage(issue, ''), issue: { ref: issue.ref, title: issue.title } });
      select(thread.id);
    } catch (err) {
      setError((err as Error).message);
      setStarting(false);
    }
  };
  return <>
    <button type="button" className="issue-reader-action primary" disabled={state !== 'ready' || starting}
      title={state === 'blocked' ? `Waits on ${issue.blockedBy.join(', ')}` : state === 'claimed' ? 'Already claimed' : `Start a thread on ${issue.label}, claiming it`}
      onClick={() => void start()}>{starting ? 'Starting…' : 'Start a thread'}</button>
    {error && <p className="issue-reader-note error" role="alert">{error}</p>}
  </>;
}

function IssueLink({ issue, onOpen }: { issue: IssueView; onOpen: (ref: string) => void }) {
  return (
    <button type="button" className="issue-reader-link" title={issue.title} onClick={() => onOpen(issue.ref)}>
      <span className={`issue-reader-dot ${issueState(issue)}`} aria-hidden />
      <span className="issue-reader-label">{issue.label}</span>{' '}
      <span className="issue-reader-link-title">{issue.title}</span>
    </button>
  );
}

/** The issue's body, read when it opens: GitHub's markdown, or the local file's. */
function IssueBody({ checkoutId, issueRef }: { checkoutId: string; issueRef: string }) {
  const client = useClient();
  const [read, setRead] = useState<{ body?: string; error?: string }>();
  useEffect(() => {
    let live = true;
    client.call('threads.issueBody', { checkoutId, ref: issueRef }).then(
      ({ body }) => { if (live) setRead({ body }); },
      (error: Error) => { if (live) setRead({ error: error.message }); });
    return () => { live = false; };
  }, [client, checkoutId, issueRef]);
  if (!read) return <p className="issue-reader-note">Loading…</p>;
  if (read.error !== undefined) return <p className="issue-reader-note error">Couldn’t read this issue: {read.error}</p>;
  if (!read.body?.trim()) return <p className="issue-reader-note">No description.</p>;
  return (
    <div className="issue-reader-body">
      <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={absoluteUrl}>{read.body}</Markdown>
    </div>
  );
}

/**
 * Only absolute web links, and mail links for anchors: a relative link in an issue file would
 * resolve against the app. Parsed without a base, so `https:file.md` can't pass as absolute.
 */
function absoluteUrl(url: string, key: string) {
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  const allowed = parsed.protocol === 'https:' || parsed.protocol === 'http:' || (key === 'href' && parsed.protocol === 'mailto:');
  return allowed ? parsed.href : undefined;
}

const components: Components = {
  a: function IssueBodyLink({ href, children, title }) {
    if (!href) return <span>{children}</span>;
    return <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>;
  },
  table: function IssueBodyTable({ children }) {
    return <div className="table-scroll"><table>{children}</table></div>;
  },
};
