import { expect, it } from 'vitest';
import type { IssueView } from '@accio/protocol';
import { offerRow } from './offerRows';

const offered = { ref: '#208', label: '#208', title: 'Read an issue' };
const now = (more: Partial<IssueView> = {}): IssueView => ({ ...offered, blockedBy: [], labels: [], assignees: [], ...more });

it('offers Implement only on a ready issue, and says why the others wait', () => {
  expect(offerRow(offered, now(), true)).toEqual({ state: 'ready', pill: 'Ready' });
  expect(offerRow(offered, now({ blockedBy: ['#207'] }), true)).toEqual({ state: 'blocked', pill: 'Waits on #207' });
  expect(offerRow(offered, now({ assignees: ['me'] }), true)).toEqual({ state: 'claimed', pill: 'Claimed' });
  expect(offerRow(offered, undefined, true)).toEqual({ state: 'closed', pill: 'Closed' });
  expect(offerRow(offered, undefined, false)).toEqual({ state: 'unknown' });
  expect(offerRow({ ...offered, threadId: 't' }, undefined, true)).toEqual({ state: 'started', pill: 'Started' });
});
