import { expect, it } from 'vitest';
import type { ThreadDelivery } from '@accio/protocol';
import { reportDeliveryStep } from './deliveryStep.js';
import { deliveryPrompt } from './delivery.js';

const delivery = (status: ThreadDelivery['status']): ThreadDelivery => ({ mode: 'review', policy: 'pull-request', status, baseBranch: 'main', requestedAt: '2026-11-04T10:00:00Z' });

it('records a step only while the delivery turn runs', () => {
  expect(reportDeliveryStep(delivery('running'), 'verify', 'Rerunning on main', '2026-11-04T10:05:00Z')?.step)
    .toEqual({ name: 'verify', note: 'Rerunning on main', at: '2026-11-04T10:05:00Z' });
  expect(reportDeliveryStep(delivery('waiting'), 'verify', undefined, '2026-11-04T10:05:00Z')?.step).toBeUndefined();
  expect(reportDeliveryStep(undefined, 'commit', undefined, '2026-11-04T10:05:00Z')).toBeUndefined();
});

it('asks the delivery turn to report its steps', () => {
  const workspace = { path: '/w', sourcePath: '/s', branch: 'accio/t', startRevision: 'a', releasedAt: null };
  expect(deliveryPrompt(workspace, delivery('running'))).toContain('delivery_step');
});

it('lets a failure that passes on one rerun count as flaky instead of a reason to keep rerunning', () => {
  const workspace = { path: '/w', sourcePath: '/s', branch: 'accio/t', startRevision: 'a', releasedAt: null };
  expect(deliveryPrompt(workspace, delivery('running'))).toContain('does not reproduce when you rerun it once, treat it as flaky');
});

it('asks the delivery turn for a shipped note written for the person trying the change', () => {
  const workspace = { path: '/w', sourcePath: '/s', branch: 'accio/t', startRevision: 'a', releasedAt: null };
  expect(deliveryPrompt(workspace, delivery('running'))).toContain('shipped_note');
});
