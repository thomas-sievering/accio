import { describe, expect, it } from 'vitest';
import type { DeliveryPullRequest, ThreadDelivery, ThreadView } from '@accio/protocol';
import { autoSettled, checkedAgo, deliveryStatus, shortStatus, statusText, threadStatus } from './status';

const pr = (extra: Partial<DeliveryPullRequest> = {}): DeliveryPullRequest => ({
  host: 'github.com', repository: 'acme/app', number: 123, url: 'https://github.com/acme/app/pull/123',
  state: 'open', headRevision: 'f'.repeat(40), baseBranch: 'main', ...extra,
});
const delivery = (extra: Partial<ThreadDelivery> = {}): ThreadDelivery => ({
  id: 'd1', workVersion: 1, mode: 'ship', policy: 'pull-request', status: 'waiting', baseBranch: 'main', requestedAt: '2026-11-03T10:00:00Z', ...extra,
});
const thread = (extra: Partial<ThreadView> = {}): ThreadView => ({
  id: 't1', checkoutId: 'c1', projectId: 'p1', profileId: 'a1', model: { harnessId: 'claudeCode', modelId: 'opus' }, title: 't1',
  status: 'idle', createdAt: '2026-11-03T10:00:00Z', updatedAt: '2026-11-03T10:00:00Z', snoozedUntil: null, settledAt: null, workVersion: 1, ...extra,
});
const sidebar = (t: ThreadView) => { const s = threadStatus(t); return { label: statusText(s.label, s.delivery?.pullRequest), glyph: s.glyph, tone: s.tone }; };

describe('threadStatus without delivery', () => {
  it('says Ready for an idle turn and only spins for a running one', () => {
    expect(sidebar(thread())).toEqual({ label: 'Ready', glyph: 'dot', tone: 'ready' });
    expect(threadStatus(thread({ status: 'running' }))).toMatchObject({ label: 'Working', glyph: 'spinner', showLabel: false });
    expect(sidebar(thread({ status: 'interrupted' }))).toMatchObject({ label: 'Interrupted', glyph: 'dot' });
    expect(sidebar(thread({ status: 'failed' }))).toMatchObject({ label: 'Failed', tone: 'failed' });
  });

  it('puts a pending secret first', () => {
    expect(threadStatus(thread({ status: 'running' }), { needsSecret: true })).toMatchObject({ label: 'Needs a secret', tone: 'secret', showLabel: true });
  });
});

describe('queued and running delivery', () => {
  it('ships when done behind a running turn and can cancel unpublished intent', () => {
    const t = thread({ status: 'running', delivery: delivery({ status: 'queued', policy: 'direct' }) });
    expect(threadStatus(t)).toMatchObject({ label: 'Ships when done', glyph: 'spinner', showLabel: true });
    expect(deliveryStatus(t)).toMatchObject({ phase: 'queued', canCancel: true, canStopFollowUps: false, published: false });
  });

  it('pauses an interrupted request without a spinner', () => {
    const s = threadStatus(thread({ status: 'interrupted', delivery: delivery({ status: 'queued' }) }));
    expect(s).toMatchObject({ label: 'Ship paused', glyph: 'dot' });
    expect(threadStatus(thread({ status: 'failed', delivery: delivery({ status: 'queued', mode: 'review' }) })).label).toBe('Review paused');
  });

  it('shows the delivery turn as Shipping or Preparing review', () => {
    expect(threadStatus(thread({ status: 'running', delivery: delivery({ status: 'running' }) })).label).toBe('Shipping');
    expect(threadStatus(thread({ status: 'running', delivery: delivery({ status: 'running', mode: 'review' }) })).label).toBe('Preparing review');
  });

  it('turns a queued continuation after publication into stopping follow-ups', () => {
    const s = deliveryStatus(thread({ status: 'running', delivery: delivery({ status: 'queued', pullRequest: pr() }) }))!;
    expect(s).toMatchObject({ canCancel: false, canStopFollowUps: true, published: true });
  });
});

describe('waiting on GitHub', () => {
  it('waits for checks and review with a static PR glyph and the PR number', () => {
    expect(sidebar(thread({ delivery: delivery({ waitingOn: 'checks', pullRequest: pr() }) }))).toEqual({ label: 'Waiting for checks · #123', glyph: 'pr', tone: 'waiting' });
    expect(sidebar(thread({ delivery: delivery({ waitingOn: 'review', pullRequest: pr() }) })).label).toBe('Waiting for review · #123');
  });

  it('a waiting PR is not Working even if no turn runs', () => {
    expect(threadStatus(thread({ delivery: delivery({ pullRequest: pr() }) })).glyph).not.toBe('spinner');
  });

  it('prepared review waits for a manual merge and can stop later automatic fixes', () => {
    const s = deliveryStatus(thread({ delivery: delivery({ mode: 'review', status: 'ready', pullRequest: pr() }) }))!;
    expect(s).toMatchObject({ label: 'Waiting for merge', detail: 'Prepared for review; merge manually', canCheck: true, canStopFollowUps: true, canShip: false });
  });

  it('ship with PR policy promises a merge only while authorized', () => {
    const t = thread({ delivery: delivery({ status: 'ready', pullRequest: pr() }) });
    expect(deliveryStatus(t)).toMatchObject({ label: 'Waiting for merge', detail: 'Merges when GitHub allows', canStopFollowUps: true });
    const stopped = deliveryStatus(thread({ delivery: delivery({ status: 'ready', pullRequest: pr(), followUpsStoppedAt: '2026-11-03T11:00:00Z', keepOpen: true }) }))!;
    expect(stopped).toMatchObject({ label: 'Waiting for merge', detail: 'Automatic fixes stopped · still tracking #123', canStopFollowUps: false, canCheck: true });
  });

  it('reads the PR number from a legacy URL', () => {
    expect(sidebar(thread({ delivery: delivery({ pullRequestUrl: 'https://github.com/acme/app/pull/7' }) })).label).toBe('Waiting for checks · #7');
  });

  it('legacy waiting without a PR can still be cancelled', () => {
    expect(deliveryStatus(thread({ delivery: delivery({ policy: 'direct', workVersion: undefined }) }))).toMatchObject({ glyph: 'ship', canCancel: true, published: false });
  });
});

describe('integration and verification', () => {
  it('shows a host-confirmed merge while target checks are pending', () => {
    const t = thread({ delivery: delivery({ pullRequest: pr({ state: 'merged', mergeRevision: 'abcdef0123' }), integratedAt: '2026-11-03T11:00:00Z' }) });
    expect(sidebar(t)).toEqual({ label: 'Merged · checking main · #123', glyph: 'merge', tone: 'waiting' });
    expect(deliveryStatus(t)).toMatchObject({ phase: 'integrated', badge: 'Merged #123', revision: 'abcdef0' });
  });

  it('shows a direct push while target checks are pending', () => {
    const t = thread({ delivery: delivery({ policy: 'direct', publishedRevision: 'abc1234def', integratedAt: '2026-11-03T11:00:00Z' }) });
    expect(sidebar(t)).toMatchObject({ label: 'Pushed · checking main', glyph: 'push' });
  });

  it('verified PR delivery reads Merged into the target with a settled badge', () => {
    const t = thread({ settledAt: '2026-11-03T12:00:00Z', delivery: delivery({ status: 'delivered', pullRequest: pr({ state: 'merged' }), publishedRevision: 'a1b2c3d4e5', autoSettle: true }) });
    expect(sidebar(t)).toEqual({ label: 'Merged into main · #123', glyph: 'merge', tone: 'delivered' });
    expect(deliveryStatus(t)).toMatchObject({ badge: 'Merged #123', revision: 'a1b2c3d', canCheck: false, canStopFollowUps: false });
    expect(autoSettled(t)).toBe(true);
  });

  it('verified direct delivery reads Shipped to the target', () => {
    const t = thread({ delivery: delivery({ status: 'delivered', policy: 'direct', publishedRevision: 'a1b2c3d4e5' }) });
    expect(sidebar(t)).toEqual({ label: 'Shipped to main', glyph: 'push', tone: 'delivered' });
    expect(deliveryStatus(t)?.badge).toBe('main');
  });

  it('legacy delivered records without IDs or versions still read as delivered', () => {
    const t = thread({ workVersion: undefined, delivery: { mode: 'ship', policy: 'direct', status: 'delivered', baseBranch: 'main', requestedAt: '2026-11-03T10:00:00Z', publishedRevision: '0123456789' } });
    expect(sidebar(t).label).toBe('Shipped to main');
  });

  it('a reopened or manually settled delivery is not auto-settled', () => {
    const d = delivery({ status: 'delivered', autoSettle: true, keepOpen: true });
    expect(autoSettled(thread({ settledAt: '2026-11-03T12:00:00Z', delivery: d }))).toBe(false);
    expect(autoSettled(thread({ settledAt: '2026-11-03T12:00:00Z', delivery: { ...d, keepOpen: false, autoSettle: undefined } }))).toBe(false);
  });
});

describe('live CI progress', () => {
  const ci = (step = 'Build image') => ({ revision: 'a'.repeat(40), updatedAt: '2026-11-03T11:00:00Z', checks: [
    { name: 'lint', status: 'success' }, { name: 'image', status: 'in_progress', step: { name: step, current: 2, total: 4 } }] });

  it('names the current job and step while waiting on checks, in the row and the sidebar', () => {
    const t = thread({ delivery: delivery({ waitingOn: 'checks', pullRequest: pr(), ci: ci() }) });
    expect(deliveryStatus(t)).toMatchObject({ phase: 'waiting', label: 'CI · Build image · 2 of 4', glyph: 'pr', ci: ci() });
    expect(sidebar(t).label).toBe('CI · Build image · 2 of 4 · #123');
  });

  it('keeps a direct push visible while target checks run', () => {
    const s = deliveryStatus(thread({ delivery: delivery({ policy: 'direct', integratedAt: '2026-11-03T11:00:00Z', ci: ci('Push image') }) }))!;
    expect(s).toMatchObject({ phase: 'integrated', label: 'CI · Push image · 2 of 4', glyph: 'push', detail: 'Pushed · waiting for checks on main' });
  });

  it('never lets stale CI override a known outcome', () => {
    const stale = { ci: ci() };
    const read = (t: ThreadView) => { const s = deliveryStatus(t)!; return { phase: s.phase, label: s.label, ci: s.ci }; };
    expect(read(thread({ delivery: delivery({ status: 'delivered', policy: 'direct', ...stale }) }))).toEqual({ phase: 'delivered', label: 'Shipped to main', ci: undefined });
    expect(read(thread({ delivery: delivery({ status: 'delivered', pullRequest: pr({ state: 'merged' }), ...stale }) }))).toEqual({ phase: 'delivered', label: 'Merged into main', ci: undefined });
    expect(read(thread({ workVersion: 2, delivery: delivery({ waitingOn: 'checks', ...stale }) }))).toEqual({ phase: 'superseded', label: 'New work', ci: undefined });
    expect(read(thread({ delivery: delivery({ waitingOn: 'review', pullRequest: pr(), ...stale }) }))).toEqual({ phase: 'waiting', label: 'Waiting for review', ci: undefined });
    expect(read(thread({ delivery: delivery({ status: 'blocked', pullRequest: pr(), ...stale }) }))).toEqual({ phase: 'attention', label: 'Needs attention', ci: undefined });
  });
});

describe('problems', () => {
  it('a blocked delivery needs attention with its reason, even after a known merge', () => {
    const t = thread({ delivery: delivery({ status: 'blocked', pullRequest: pr({ state: 'merged' }), integratedAt: '2026-11-03T11:00:00Z', detail: 'Checks on main failed: build' }) });
    expect(sidebar(t)).toEqual({ label: 'Needs attention · #123', glyph: 'alert', tone: 'attention' });
    expect(deliveryStatus(t)).toMatchObject({ detail: 'Checks on main failed: build', canShip: true, canCheck: true });
  });

  it('an unpublished blocker such as Nothing to ship offers Ship, not Check now', () => {
    const s = deliveryStatus(thread({ delivery: delivery({ status: 'blocked', policy: 'direct', detail: 'Nothing to ship: this thread has no new commits.' }) }))!;
    expect(s).toMatchObject({ phase: 'attention', detail: 'Nothing to ship: this thread has no new commits.', canShip: true, canCheck: false });
    const outage = deliveryStatus(thread({ delivery: delivery({ status: 'blocked', policy: 'direct', observationError: 'gh: unavailable' }) }))!;
    expect(outage).toMatchObject({ phase: 'unavailable', canCheck: true });
  });

  it('a closed PR is never delivered', () => {
    const s = deliveryStatus(thread({ delivery: delivery({ status: 'blocked', pullRequest: pr({ state: 'closed' }) }) }))!;
    expect(s).toMatchObject({ phase: 'closed', label: 'Closed without merging', canShip: true });
  });

  it('an observation error keeps the last known fact', () => {
    const t = thread({ delivery: delivery({ status: 'ready', mode: 'review', pullRequest: pr(), observationError: 'gh: rate limited', checkedAt: '2026-11-03T11:00:00Z' }) });
    expect(sidebar(t)).toMatchObject({ label: 'Status unavailable · #123', tone: 'unavailable' });
    expect(deliveryStatus(t)).toMatchObject({ detail: 'Last known: Waiting for merge · #123', canCheck: true, checkedAt: '2026-11-03T11:00:00Z' });
  });
});

describe('new work', () => {
  it('supersedes an old delivery: the sidebar returns to the turn and Ship is offered', () => {
    const t = thread({ workVersion: 2, delivery: delivery({ status: 'delivered', policy: 'direct', publishedRevision: 'abc' }) });
    expect(sidebar(t)).toEqual({ label: 'Ready', glyph: 'dot', tone: 'ready' });
    expect(deliveryStatus(t)).toMatchObject({ phase: 'superseded', canShip: true, canCheck: false, canStopFollowUps: false });
  });

  it('a superseded open PR says Ship again updates it', () => {
    expect(deliveryStatus(thread({ workVersion: 3, delivery: delivery({ pullRequest: pr() }) }))?.detail).toBe('New work since PR #123; Ship again to update it');
  });

  it('a running turn on new work is just Working', () => {
    expect(threadStatus(thread({ status: 'running', workVersion: 2, delivery: delivery({ pullRequest: pr() }) }))).toMatchObject({ label: 'Working', showLabel: false, delivery: undefined });
  });
});

describe('checkedAgo', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  it('formats the observation age', () => {
    expect(checkedAgo(undefined, now)).toBeUndefined();
    expect(checkedAgo('2026-11-03T11:59:20Z', now)).toBe('checked just now');
    expect(checkedAgo('2026-11-03T11:56:00Z', now)).toBe('checked 4m ago');
    expect(checkedAgo('2026-11-03T09:00:00Z', now)).toBe('checked 3h ago');
  });

  it('shortens delivery statuses to what a sidebar row has room for', () => {
    expect(shortStatus('CI · Build image · 2 of 4')).toBe('CI · step 2/4');
    expect(shortStatus('CI · Checks finishing')).toBe('CI');
    expect(shortStatus('Waiting for merge')).toBe('Review');
    expect(shortStatus('Waiting for checks')).toBe('Checks');
    expect(shortStatus('Shipped to main')).toBe('Shipped');
    expect(shortStatus('Merged into main')).toBe('Merged');
    expect(shortStatus('Merged · checking main')).toBe('Checking');
    expect(shortStatus('Ships when done')).toBe('Ships when done');
  });
});
