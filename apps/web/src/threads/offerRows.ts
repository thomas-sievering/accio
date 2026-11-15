import type { IssueView, OfferedIssue } from '@accio/protocol';

/** Whether an open issue can be started now: blocked while it waits on open issues, claimed once someone took it. */
export function issueState(issue: IssueView): 'ready' | 'blocked' | 'claimed' {
  if (issue.blockedBy.length) return 'blocked';
  if (issue.status === 'claimed' || issue.assignees.length) return 'claimed';
  return 'ready';
}

/** What a row of the offer says and offers, from the issue as the tracker has it now. */
export function offerRow(offered: OfferedIssue, now: IssueView | undefined, known: boolean):
  { state: 'started' | 'ready' | 'blocked' | 'claimed' | 'closed' | 'unknown'; pill?: string } {
  if (offered.threadId) return { state: 'started', pill: 'Started' };
  if (!known) return { state: 'unknown' };
  if (!now) return { state: 'closed', pill: 'Closed' };
  const state = issueState(now);
  return { state, pill: state === 'blocked' ? `Waits on ${now.blockedBy.join(', ')}` : state === 'claimed' ? 'Claimed' : 'Ready' };
}
