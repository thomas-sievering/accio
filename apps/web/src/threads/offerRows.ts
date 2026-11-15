import type { IssueView, OfferedIssue } from '@accio/protocol';

/** What a row of the offer says and offers, from the issue as the tracker has it now. */
export function offerRow(offered: OfferedIssue, now: IssueView | undefined, known: boolean):
  { state: 'started' | 'ready' | 'blocked' | 'claimed' | 'closed' | 'unknown'; pill?: string } {
  if (offered.threadId) return { state: 'started', pill: 'Started' };
  if (!known) return { state: 'unknown' };
  if (!now) return { state: 'closed', pill: 'Closed' };
  if (now.blockedBy.length) return { state: 'blocked', pill: `Waits on ${now.blockedBy.join(', ')}` };
  if (now.status === 'claimed' || now.assignees.length) return { state: 'claimed', pill: 'Claimed' };
  return { state: 'ready', pill: 'Ready' };
}
