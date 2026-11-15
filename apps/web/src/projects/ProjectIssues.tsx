import { useCallback, useEffect, useState } from 'react';
import type { IssueList, ProjectView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { ChevronDown } from '../app/icons';
import { useProjects } from './projects';
import { issueFilterGroups, issueGraph, type IssueRow } from './issueGraph';

const LANE = 14;
const ROW = 34;
const STATE = { ready: 'Ready', blocked: 'Blocked', claimed: 'Claimed' } as const;

export type ProjectIssueList = { checkoutId?: string; list?: IssueList; error?: string; reread: () => void };

/**
 * A project's open issues, read from its first checkout here, for the Issues fold and its
 * reader. `reread` reads the tracker again, as the fold does each time it opens.
 */
export function useProjectIssues(project: ProjectView): ProjectIssueList {
  const client = useClient();
  const { checkoutsOf } = useProjects();
  const checkoutId = checkoutsOf(project.id)[0]?.id;
  const [read, setRead] = useState<{ checkoutId: string; list?: IssueList; error?: string }>();
  const reread = useCallback(() => {
    if (!checkoutId) return;
    client.call('threads.issues', { checkoutId }).then(
      (list) => setRead({ checkoutId, list }),
      (error: Error) => setRead({ checkoutId, error: error.message }));
  }, [client, checkoutId]);
  useEffect(reread, [reread]);
  const current = read?.checkoutId === checkoutId ? read : undefined;
  return { checkoutId, list: current?.list, error: current?.error, reread };
}

/**
 * GLOSSARY: Project dashboard. The Issues fold: the project's open issues in dependency
 * order with a git-log style graph in the gutter, each with Ready, Blocked or Claimed and
 * what a blocked one waits on. Read again each time it opens; narrows to one parent
 * issue or feature folder. Clicking an issue opens it in the reader; `selected` is its ref.
 */
export function ProjectIssues({ issues, selected, onSelect }: { issues: ProjectIssueList; selected?: string; onSelect: (ref: string) => void }) {
  const { checkoutId, list, error, reread } = issues;
  const [group, setGroup] = useState<string>();
  const groups = list ? issueFilterGroups(list) : [];
  const shownGroup = group !== undefined && groups.includes(group) ? group : undefined;
  const graph = list ? issueGraph(list, shownGroup) : undefined;
  const source = list?.tracker?.kind === 'github' ? list.tracker.repository : list?.tracker?.folder;

  const empty = !checkoutId ? 'This project has no checkout on this machine to read issues from.'
    : error ? `Couldn’t read issues: ${error}`
    : !list ? 'Loading…'
    : list.unavailable ? list.unavailable
    : !list.tracker ? 'No issue tracker. Name one in the project’s agent skills, or add issue files under .scratch/<feature>/issues/.'
    : !list.issues.length ? 'No open issues.'
    : undefined;

  return (
    <details className="dashboard-section dashboard-fold" aria-label="Issues" onToggle={(e) => { if (e.currentTarget.open) reread(); }}>
      <summary className="dashboard-heading"><ChevronDown />Issues {!!list?.issues.length && <span className="dashboard-count">{list.issues.length}</span>}</summary>
      <div className="issues-page">
        {list?.tracker && (groups.length > 0 || source) && (
          <div className="issues-bar">
            {groups.length > 0 && (
              <select className="issues-filter" aria-label={list.tracker.kind === 'local' ? 'Feature folder' : 'Parent issue'} value={shownGroup ?? ''}
                onChange={(e) => setGroup(e.currentTarget.value || undefined)}>
                <option value="">{list.tracker.kind === 'local' ? 'All feature folders' : 'All parent issues'}</option>
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            {source && <span className="issues-source">{source}</span>}
          </div>
        )}
        {empty ? <p className="dashboard-empty">{empty}</p> : graph && (
          <ol className="issues-graph" aria-label="Open issues">
            {graph.rows.map((row) => <IssueLine key={row.issue.ref} row={row} lanes={graph.lanes} selected={row.issue.ref === selected} onSelect={onSelect} />)}
          </ol>
        )}
      </div>
    </details>
  );
}

function IssueLine({ row, lanes, selected, onSelect }: { row: IssueRow; lanes: number; selected: boolean; onSelect: (ref: string) => void }) {
  const { issue, state } = row;
  // The whole row opens the issue; its title is the button keyboards reach.
  return (
    <li className={`issues-row ${state}`} aria-current={selected || undefined} onClick={() => onSelect(issue.ref)}>
      <Gutter row={row} lanes={lanes} />
      <span className="issues-label">{issue.label}</span>
      <button type="button" className="issues-title">{issue.title}</button>
      {state === 'blocked' && <span className="issues-waits">waits on {issue.blockedBy.join(', ')}</span>}
      <span className={`issue-pill issues-state ${state}`}>{STATE[state]}</span>
    </li>
  );
}

/** One row's slice of the graph: lines passing by, lines into and out of its dot, then the dot. */
function Gutter({ row, lanes }: { row: IssueRow; lanes: number }) {
  const x = (lane: number) => lane * LANE + LANE / 2;
  const mid = ROW / 2;
  const dot = x(row.lane);
  // Lines between lanes bend smoothly, as in git log.
  const bend = (fromX: number, fromY: number, toX: number, toY: number) =>
    fromX === toX ? `M${fromX} ${fromY}V${toY}` : `M${fromX} ${fromY}C${fromX} ${(fromY + toY) / 2} ${toX} ${(fromY + toY) / 2} ${toX} ${toY}`;
  return (
    <svg className="issues-gutter" width={lanes * LANE} height={ROW} viewBox={`0 0 ${lanes * LANE} ${ROW}`} aria-hidden>
      {row.through.map((l) => <path key={`t${l}`} d={`M${x(l)} 0V${ROW}`} />)}
      {row.incoming.map((l) => <path key={`i${l}`} d={bend(x(l), 0, dot, mid)} />)}
      {row.outgoing.map((l) => <path key={`o${l}`} d={bend(dot, mid, x(l), ROW)} />)}
      <circle className={row.state} cx={dot} cy={mid} r={4} />
    </svg>
  );
}
