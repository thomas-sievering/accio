import { useEffect, useRef, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { IssueList, IssueView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Close } from '../app/icons';
import { Sheet } from '../app/Sheet';
import { issueState } from '../threads/offerRows';
import { issueLinks } from './issueGraph';

const STATE = { ready: 'Ready', blocked: 'Blocked', claimed: 'Claimed' } as const;

/**
 * GLOSSARY: Project dashboard. The Issues fold's reader: one open issue with its state,
 * triage label, Blocked by and Blocks (which move the reader), body and GitHub link.
 * A panel beside the dashboard in wide windows, a sheet over it in narrow ones.
 */
export function IssueReader({ checkoutId, list, issue, narrow, onOpen, onClose }: {
  checkoutId: string; list: IssueList; issue: IssueView; narrow: boolean;
  onOpen: (ref: string) => void; onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  // In the panel, Escape closes the reader before it reaches the dashboard; a sheet's dialog handles its own.
  useEffect(() => {
    if (narrow) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector(':popover-open, dialog[open]') || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [narrow, onClose]);
  // Following a link from inside the reader keeps focus there, on the new issue's heading.
  const open = (ref: string) => {
    onOpen(ref);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('.issue-reader-title')?.focus());
  };

  if (narrow) {
    return (
      <Sheet title={`${issue.label} ${issue.title}`} onClose={onClose}>
        <div className="sheet-body issue-reader issue-reader-sheet">
          <IssueDetails checkoutId={checkoutId} list={list} issue={issue} onOpen={onOpen} titled={false} />
        </div>
      </Sheet>
    );
  }
  return (
    <aside ref={panel} className="issue-reader issue-reader-panel" aria-label="Issue">
      <IssueDetails checkoutId={checkoutId} list={list} issue={issue} onOpen={open} titled
        close={<button type="button" className="side-icon issue-reader-close" title="Close (Esc)" aria-label="Close issue" onClick={onClose}><Close /></button>} />
    </aside>
  );
}

function IssueDetails({ checkoutId, list, issue, onOpen, titled, close }: {
  checkoutId: string; list: IssueList; issue: IssueView; onOpen: (ref: string) => void; titled: boolean; close?: ReactNode;
}) {
  const state = issueState(issue);
  const links = issueLinks(list, issue.ref);
  const triage = issue.status && issue.status !== 'claimed' ? issue.status : undefined;
  return (
    <>
      <div className="issue-reader-meta">
        <span className="issue-reader-label">{issue.label}</span>
        <span className={`issue-pill issues-state ${state}`}>{STATE[state]}</span>
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
        {/* #209: Start a thread (ready issues) and Open thread (claimed ones) go first here. */}
        {issue.url && <a className="issue-reader-action" href={issue.url} target="_blank" rel="noopener noreferrer">View on GitHub ↗</a>}
      </div>
    </>
  );
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

/** Only absolute web and mail links: a relative link in an issue file would resolve against the app. */
function absoluteUrl(url: string) {
  return /^(?:https?|mailto):/i.test(url) ? url : undefined;
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
