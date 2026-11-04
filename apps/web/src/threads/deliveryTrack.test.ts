import { describe, expect, it } from 'vitest';
import type { DeliveryCI, DeliveryPullRequest, ThreadDelivery, ThreadView } from '@accio/protocol';
import { deliveryTrack } from './deliveryTrack';

const pr = (extra: Partial<DeliveryPullRequest> = {}): DeliveryPullRequest => ({
  host: 'github.com', repository: 'acme/app', number: 61, url: 'https://github.com/acme/app/pull/61',
  state: 'open', headRevision: 'f'.repeat(40), baseBranch: 'main', ...extra,
});
const ci: DeliveryCI = { revision: 'a'.repeat(40), updatedAt: '2026-11-03T10:05:00Z', checks: [{ name: 'verify', status: 'in_progress', step: { name: 'Playwright', current: 5, total: 7 } }] };
const thread = (delivery?: Partial<ThreadDelivery>, extra: Partial<ThreadView> = {}): ThreadView => ({
  id: 't1', checkoutId: 'c1', projectId: 'p1', profileId: 'a1', model: { harnessId: 'claudeCode', modelId: 'opus' }, title: 't1',
  status: 'idle', createdAt: '2026-11-03T10:00:00Z', updatedAt: '2026-11-03T10:00:00Z', snoozedUntil: null, settledAt: null, workVersion: 1,
  ...(delivery ? { delivery: { id: 'd1', workVersion: 1, mode: 'ship', policy: 'pull-request', status: 'waiting', baseBranch: 'main', requestedAt: '2026-11-03T10:00:00Z', ...delivery } } : {}),
  ...extra,
});
const states = (t: ThreadView) => deliveryTrack(t)!.stations.map((s) => `${s.id}:${s.state}`);

describe('deliveryTrack', () => {
  it('has no track before anything is shipped', () => {
    expect(deliveryTrack(thread())).toBeUndefined();
  });

  it('waits on the running turn when shipping is queued', () => {
    const t = thread({ status: 'queued' }, { status: 'running' });
    expect(states(t)).toEqual(['prepare:waiting', 'publish:todo', 'checks:todo', 'merge:todo', 'target:todo']);
    expect(deliveryTrack(t)!.stations[0]!.detail).toBe('Starts when the turn ends');
  });

  it('shows the reported step, its place, elapsed time and note while preparing', () => {
    const now = new Date('2026-11-03T10:06:30Z');
    const running = (step?: ThreadDelivery['step']) => thread({ status: 'running', startedAt: '2026-11-03T10:00:00Z', ...(step ? { step } : {}) }, { status: 'running' });
    expect(deliveryTrack(running(), now)!.stations[0]).toMatchObject({ state: 'active', detail: 'Agent is working · 6m' });
    // A scripted ship has no turn running.
    expect(deliveryTrack(thread({ status: 'running', startedAt: '2026-11-03T10:00:00Z' }), now)!.stations[0]).toMatchObject({ state: 'active', detail: 'Starting · 6m' });
    const verifying = deliveryTrack(running({ name: 'verify', at: '2026-11-03T10:05:00Z', note: 'Rerunning the failing test on main' }), now)!;
    expect(verifying.stations[0]).toMatchObject({ state: 'active', detail: 'Verify · 3 of 3 · 6m', note: 'Rerunning the failing test on main' });
    expect(deliveryTrack(running({ name: 'integrate', at: '2026-11-03T10:05:00Z' }), now)!.stations[0]!.detail).toBe('Integrate main · 2 of 3 · 6m');
    const publishing = deliveryTrack(running({ name: 'publish', at: '2026-11-03T10:06:00Z', note: 'Opening the pull request' }), now)!;
    expect(publishing.stations.slice(0, 2)).toMatchObject([{ state: 'done' }, { state: 'active', detail: 'Agent is publishing', note: 'Opening the pull request' }]);
  });

  it('opens Checks with live CI while a PR waits on them', () => {
    const track = deliveryTrack(thread({ pullRequest: pr(), waitingOn: 'checks', ci }))!;
    expect(track.route).toBe('To main via PR');
    expect(track.stations.map((s) => s.state)).toEqual(['done', 'done', 'waiting', 'todo', 'todo']);
    expect(track.stations[1]).toMatchObject({ detail: '#61', link: pr().url });
    expect(track.stations[2]!.ci).toBe(ci);
  });

  it('shows the agent fixing checks, then a merge that GitHub allows', () => {
    expect(states(thread({ pullRequest: pr(), waitingOn: 'agent' }))).toContain('checks:active');
    const ready = deliveryTrack(thread({ pullRequest: pr(), status: 'ready' }))!;
    expect(ready.stations[3]).toMatchObject({ state: 'waiting', detail: 'Merges when GitHub allows' });
  });

  it('marks a blocked PR and a closed PR as failed on the right station', () => {
    expect(states(thread({ pullRequest: pr(), status: 'blocked', detail: 'verify failed' }))).toContain('checks:failed');
    expect(states(thread({ pullRequest: pr({ state: 'closed' }), status: 'blocked' }))).toContain('merge:failed');
  });

  it('follows checks on the target after a merge, and completes when delivered', () => {
    const merged = pr({ state: 'merged', mergeRevision: 'b'.repeat(40) });
    const after = deliveryTrack(thread({ pullRequest: merged, waitingOn: 'checks', ci }))!;
    expect(after.stations.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'waiting']);
    expect(after.stations[4]!.ci).toBe(ci);
    expect(states(thread({ pullRequest: merged, status: 'delivered' }))).toEqual(['prepare:done', 'publish:done', 'checks:done', 'merge:done', 'target:done']);
  });

  it('is three stations when pushing straight to the target', () => {
    const t = thread({ policy: 'direct', integratedAt: '2026-11-03T10:03:00Z', publishedRevision: 'c'.repeat(40), waitingOn: 'checks', ci });
    const track = deliveryTrack(t)!;
    expect(track.route).toBe('To main');
    expect(track.stations.map((s) => `${s.label}:${s.state}`)).toEqual(['Rebase and test:done', 'Push to main:done', 'Checks on main:waiting']);
    expect(track.stations[1]!.detail).toBe('ccccccc');
    // Waiting on checks after the agent's push, before the push itself was observed.
    expect(states(thread({ policy: 'direct', waitingOn: 'checks', ci }))).toEqual(['prepare:done', 'publish:done', 'target:waiting']);
  });
});
