import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { IssueList, IssueView, ThreadView } from '@accio/protocol';
import { Folder, Issue, MessageSquarePlus, Search } from '../app/icons';
import { usePopoverMenu } from '../ui/usePopoverMenu';
import { issueGroups } from './issueGroups';

/**
 * GLOSSARY: Issue. A quiet chip beside the machine that picks an open issue for a new
 * thread: a searchable list grouped by triage role (GitHub) or feature (local files).
 * The picked issue rides above the message and is claimed once the thread starts.
 * An issue an open thread already works on sits under In progress and opens that
 * thread; its New thread button attaches it anyway.
 */
export function IssuePicker({ list, value, onChange, onOpen, working = new Map(), onOpenThread }: {
  list: IssueList;
  value?: IssueView;
  onChange: (issue: IssueView) => void;
  /** Called as the list opens, to read the issues again. */
  onOpen: () => void;
  /** The open threads working on each issue, by ref, newest first. */
  working?: ReadonlyMap<string, ThreadView[]>;
  onOpenThread: (threadId: string) => void;
}) {
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const groups = issueGroups(list, query, new Set(working.keys()));
  const flat = groups.flatMap((group) => group.issues);
  const active = Math.min(highlight, flat.length - 1);
  // Opens downward so the list never covers the composer above it, unless far more room is above.
  const { props, trigger, popover: menu } = usePopoverMenu({
    placement: { width: 480, side: 'below', height: 220 },
    // Its keys stay in the search field; from anywhere else in it, the arrows return there.
    items: '[role="combobox"]',
    focus: () => search.current,
    onToggle: (open) => {
      if (!open) { setQuery(''); return; }
      onOpen();
      setHighlight(Math.max(0, value ? flat.findIndex((issue) => issue.ref === value.ref) : 0));
    },
  });
  const source = list.tracker?.kind === 'github' ? list.tracker.repository : list.tracker?.folder;

  const pick = (issue: IssueView) => { menu.current?.hidePopover(); onChange(issue); };
  // An issue in progress opens its thread rather than starting another.
  const choose = (issue: IssueView) => {
    const thread = working.get(issue.ref)?.[0];
    if (!thread) return pick(issue);
    menu.current?.hidePopover();
    onOpenThread(thread.id);
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length) setHighlight((active + (event.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const issue = flat[active];
      if (issue) choose(issue);
    }
  };

  return <>
    <button type="button" ref={trigger} className={`machine-trigger issue-trigger${value ? ' picked' : ''}`} popoverTarget={id} aria-haspopup="dialog"
      aria-label={value ? `Issue: ${value.label} ${value.title}. Change issue` : 'Pick an issue'}
      title={value ? `Claimed for this thread when it starts` : undefined}>
      <Issue />
      <span>{value ? <>{value.label} <span className="issue-trigger-note">· claims on send</span></> : 'Pick an issue'}</span>
    </button>
    <div id={id} {...props} className="issue-picker" popover="auto" role="dialog" aria-label="Pick an issue">
      <div className="issue-picker-search">
        <Search />
        <input ref={search} value={query} placeholder="Search open issues" aria-label="Search open issues" spellCheck={false}
          role="combobox" aria-expanded aria-controls={`${id}-list`} aria-activedescendant={flat[active] ? `${id}-${active}` : undefined}
          onChange={(e) => { setQuery(e.target.value); setHighlight(0); }} onKeyDown={keys} />
        {source && <span className="issue-picker-source">{list.tracker?.kind === 'local' ? <Folder /> : <Issue />}{source}</span>}
      </div>
      <div className="issue-picker-list" id={`${id}-list`} role="listbox" aria-label="Open issues">
        {list.unavailable && <p className="issue-picker-empty">{list.unavailable}</p>}
        {!list.unavailable && !flat.length && <p className="issue-picker-empty">{query ? 'No open issues match.' : 'No open issues.'}</p>}
        {groups.map((group) => <div key={group.name} role="group" aria-label={group.name}>
          <div className="issue-picker-group"><span>{group.name}</span><span>{group.issues.length}</span></div>
          {group.issues.map((issue) => {
            const index = flat.indexOf(issue);
            const threads = working.get(issue.ref) ?? [];
            return <div key={issue.ref} id={`${id}-${index}`} role="option" aria-selected={index === active}
              className={`issue-option${issue.blockedBy.length ? ' blocked' : ''}${threads.length ? ' working' : ''}${issue.ref === value?.ref ? ' current' : ''}`}
              title={threads.length ? `Open “${threads[0]!.title}”` : undefined}
              onMouseDown={(e) => e.preventDefault()} onMouseMove={() => index !== active && setHighlight(index)} onClick={() => choose(issue)}>
              <span className="issue-option-mark"><Issue /></span>
              <span className="issue-option-label">{issue.label}</span>
              <span className="issue-option-title">{issue.title}</span>
              {issue.labels.slice(0, 2).map((label) => <span key={label} className={`issue-pill${label === 'bug' ? ' bug' : ''}`}>{label}</span>)}
              {issue.assignees.length > 0 && <span className="issue-pill">{issue.assignees.join(', ')}</span>}
              {list.tracker?.kind === 'local' && issue.status === 'claimed' && <span className="issue-pill">claimed</span>}
              {issue.blockedBy.length > 0 && <span className="issue-pill blocked">blocked by {issue.blockedBy.join(', ')}</span>}
              {threads.length > 0 && <span className="issue-pill working">{threads.some((t) => t.status === 'running') ? 'working' : 'open'}{threads.length > 1 ? ` · ${threads.length} threads` : ''}</span>}
              {threads.length > 0 && <button type="button" className="issue-option-another" tabIndex={-1} title="Start another thread on this issue" aria-label={`Start another thread on ${issue.label}`}
                onClick={(e) => { e.stopPropagation(); pick(issue); }}><MessageSquarePlus /></button>}
            </div>;
          })}
        </div>)}
      </div>
      <div className="issue-picker-footer"><span><kbd>↑↓</kbd> move</span><span><kbd>Enter</kbd> {flat[active] && working.has(flat[active].ref) ? 'open thread' : 'attach'}</span><span><kbd>Esc</kbd> close</span></div>
    </div>
  </>;
}
