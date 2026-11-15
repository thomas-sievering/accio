import { describe, expect, it } from 'vitest';
import { deliveryInProgress, deliveryPhase, threadPlace } from './places.js';
import { optionLetter, type ThreadDelivery, type ThreadView } from './threads.js';

const now = new Date('2026-11-03T12:00:00Z');
const later = '2026-11-04T09:00:00Z';
const thread = (extra: Partial<ThreadView> = {}): ThreadView => ({
  id: 't1', checkoutId: 'c1', projectId: 'p1', profileId: 'a1', model: { harnessId: 'claudeCode', modelId: 'opus' }, title: 't1',
  status: 'idle', createdAt: '2026-11-03T10:00:00Z', updatedAt: '2026-11-03T10:00:00Z', snoozedUntil: null, settledAt: null, ...extra,
});
const pr = { host: 'github.com' as const, repository: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7', state: 'open' as const, headRevision: 'abc', baseBranch: 'main' };
const delivering = (delivery: Partial<ThreadDelivery>, extra: Partial<ThreadView> = {}) =>
  thread({ delivery: { mode: 'ship', policy: 'pull-request', status: 'waiting', baseBranch: 'main', requestedAt: '2026-11-03T10:00:00Z', pullRequest: pr, ...delivery }, ...extra });

describe('threadPlace', () => {
  it.each<[string, ThreadView, ReturnType<typeof threadPlace>]>([
    ['settled wins over snoozed and running', thread({ settledAt: '2026-11-03T11:00:00Z', snoozedUntil: later, status: 'running' }), 'settled'],
    ['snoozed wins over running', thread({ snoozedUntil: later, status: 'running' }), 'snoozed'],
    ['a passed snooze is open', thread({ snoozedUntil: '2026-11-03T11:00:00Z' }), 'open'],
    ['a running turn is working', thread({ status: 'running' }), 'working'],
    ['a running turn waiting on a secret is open', thread({ status: 'running', needsSecret: true }), 'open'],
    ['a secret wins over a delivery in progress', delivering({ waitingOn: 'checks' }, { needsSecret: true }), 'open'],
    ['a delivery in progress is working', delivering({ waitingOn: 'checks' }), 'working'],
    ['a delivery waiting for review is open', delivering({ waitingOn: 'review' }), 'open'],
    ['an idle thread is open', thread(), 'open'],
    ['a failed thread is open', thread({ status: 'failed' }), 'open'],
  ])('%s', (_, t, place) => {
    expect(threadPlace(t, now)).toBe(place);
  });
});

describe('deliveryInProgress', () => {
  it.each<[string, ThreadView, boolean]>([
    ['queued behind a running turn', delivering({ status: 'queued' }, { status: 'running' }), true],
    ['queued behind an interrupted turn', delivering({ status: 'queued' }, { status: 'interrupted' }), false],
    ['shipping', delivering({ status: 'running' }), true],
    ['waiting for checks', delivering({ waitingOn: 'checks' }), true],
    ['continued by the agent', delivering({ waitingOn: 'agent' }), true],
    ['waiting for review', delivering({ waitingOn: 'review' }), false],
    ['a PR that merges itself', delivering({ status: 'ready' }), true],
    ['a PR that merges itself after follow-ups stopped', delivering({ status: 'ready', followUpsStoppedAt: '2026-11-03T11:00:00Z' }), false],
    ['prepared for review and waiting for a manual merge', delivering({ status: 'ready', mode: 'review' }), false],
    ['merged and checking the target', delivering({ integratedAt: '2026-11-03T11:00:00Z', pullRequest: { ...pr, state: 'merged' } }), true],
    ['blocked', delivering({ status: 'blocked' }), false],
    ['closed without merging', delivering({ pullRequest: { ...pr, state: 'closed' } }), false],
    ['observation failed', delivering({ observationError: 'offline' }), false],
    ['delivered', delivering({ status: 'delivered' }), false],
    ['superseded by newer work', delivering({ waitingOn: 'checks', workVersion: 1 }, { workVersion: 2 }), false],
    ['nothing requested', thread(), false],
  ])('%s', (_, t, inProgress) => {
    expect(deliveryInProgress(t)).toBe(inProgress);
  });

  it('reads a blocker over a known merge', () => {
    expect(deliveryPhase(delivering({ status: 'blocked', pullRequest: { ...pr, state: 'merged' } }))).toBe('attention');
  });
});

describe('optionLetter', () => {
  it('names options A, B, C…', () => {
    expect([0, 1, 2, 25].map(optionLetter)).toEqual(['A', 'B', 'C', 'Z']);
  });
});
