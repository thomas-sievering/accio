import { describe, expect, it } from 'vitest';
import type { ThreadView } from '@accio/protocol';
import { createPlacementTracker, filterThreads, nextMorning, shelveThreads, WORKING_GRACE_MS } from './shelves';

const now = new Date('2026-11-03T12:00:00');
const thread = (id: string, extra: Partial<ThreadView> = {}): ThreadView => ({
  id,
  checkoutId: 'c1',
  projectId: 'p1',
  profileId: 'a1',
  model: { harnessId: 'claudeCode', modelId: 'opus' },
  title: id,
  status: 'idle',
  createdAt: '2026-11-03T10:00:00Z',
  updatedAt: '2026-11-03T10:00:00Z',
  snoozedUntil: null,
  settledAt: null,
  ...extra,
});
const ids = (ts: ThreadView[]) => ts.map((t) => t.id);
const later = '2026-11-04T09:00:00';

describe('shelveThreads', () => {
  it('puts settled before snoozed, snoozed before working, and running threads on Working', () => {
    const s = shelveThreads(
      [
        thread('settled', { settledAt: '2026-11-03T11:00:00', snoozedUntil: later }),
        thread('snoozed', { snoozedUntil: later }),
        thread('sleeping', { status: 'running', snoozedUntil: later }),
        thread('working', { status: 'running' }),
        thread('open'),
      ],
      now,
    );
    expect(ids(s.settled)).toEqual(['settled']);
    expect(ids(s.snoozed)).toEqual(['snoozed', 'sleeping']);
    expect(ids(s.working)).toEqual(['working']);
    expect(ids(s.open)).toEqual(['open']);
  });

  it('brings a running thread that waits for a secret up to the open list', () => {
    const s = shelveThreads([thread('secret', { status: 'running', needsSecret: true })], now);
    expect(ids(s.open)).toEqual(['secret']);
  });

  it('wakes a thread whose snooze has passed', () => {
    const s = shelveThreads([thread('woke', { snoozedUntil: '2026-11-03T11:00:00' })], now);
    expect(s.snoozed).toEqual([]);
    expect(ids(s.open)).toEqual(['woke']);
  });

  it('keeps threads of every project in one open list, most recently active first', () => {
    const s = shelveThreads(
      [
        thread('old', { updatedAt: '2026-11-01T00:00:00Z' }),
        thread('cut', { status: 'interrupted', updatedAt: '2026-11-03T11:00:00Z' }),
        thread('other', { projectId: 'p2', status: 'failed', updatedAt: '2026-11-03T10:30:00Z' }),
      ],
      now,
    );
    expect(ids(s.open)).toEqual(['cut', 'other', 'old']);
  });
});

describe('deliveries on Working', () => {
  const pr = { host: 'github.com' as const, repository: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7', state: 'open' as const, headRevision: 'abc', baseBranch: 'main' };
  const delivering = (id: string, delivery: Partial<NonNullable<ThreadView['delivery']>>) =>
    thread(id, { delivery: { mode: 'ship', policy: 'pull-request', status: 'waiting', baseBranch: 'main', requestedAt: '2026-11-03T10:00:00Z', pullRequest: pr, ...delivery } });
  const placed = (t: ThreadView) => {
    const s = shelveThreads([t], now);
    return s.working.length ? 'working' : 'open';
  };

  it('keeps a delivery that GitHub carries on Working', () => {
    expect(placed(delivering('checks', { waitingOn: 'checks' }))).toBe('working');
    expect(placed(delivering('merges itself', { status: 'ready' }))).toBe('working');
    expect(placed(delivering('checking main', { integratedAt: '2026-11-03T11:00:00Z', pullRequest: { ...pr, state: 'merged' } }))).toBe('working');
    expect(placed(delivering('fixing', { waitingOn: 'agent' }))).toBe('working');
  });

  it('brings a delivery that needs you back to the open list', () => {
    expect(placed(delivering('review', { waitingOn: 'review' }))).toBe('open');
    expect(placed(delivering('merge by hand', { mode: 'review', status: 'ready' }))).toBe('open');
    expect(placed(delivering('stopped', { status: 'ready', followUpsStoppedAt: '2026-11-03T11:00:00Z' }))).toBe('open');
    expect(placed(delivering('blocked', { status: 'blocked', detail: 'Conflicts' }))).toBe('open');
    expect(placed(delivering('closed', { pullRequest: { ...pr, state: 'closed' } }))).toBe('open');
    expect(placed(delivering('unavailable', { observationError: 'gh failed' }))).toBe('open');
  });
});

describe('createPlacementTracker', () => {
  const at = now.getTime();

  it('holds a thread that finished quietly on Working for the grace period, then returns it to the top', () => {
    const observe = createPlacementTracker();
    const older = thread('older', { updatedAt: '2026-11-03T08:00:00Z' });
    observe([thread('t', { status: 'running' }), older], at);
    const done = thread('t', { updatedAt: '2026-11-03T09:00:00Z' });
    const held = observe([done, older], at + 500);
    expect(held.place(done)).toBe('working');
    expect(held.nextDeadline).toBe(at + 500 + WORKING_GRACE_MS);
    const back = observe([done, older], at + 500 + WORKING_GRACE_MS);
    expect(back.place(done)).toBe('open');
    expect(ids(shelveThreads([older, done], now, back).open)).toEqual(['t', 'older']);
  });

  it('keeps a thread on Working when the next turn starts within the grace period', () => {
    const observe = createPlacementTracker();
    const running = thread('t', { status: 'running' });
    observe([running], at);
    observe([thread('t')], at + 100);
    const again = observe([running], at + 600);
    expect(again.place(running)).toBe('working');
    expect(again.returnedAt('t')).toBeUndefined();
  });

  it('returns a failed thread at once', () => {
    const observe = createPlacementTracker();
    observe([thread('t', { status: 'running' })], at);
    const failed = thread('t', { status: 'failed' });
    const p = observe([failed], at + 100);
    expect(p.place(failed)).toBe('open');
    expect(p.returnedAt('t')).toBe(at + 100);
  });

  it('counts a woken snooze as a return, but not the first observation', () => {
    const observe = createPlacementTracker();
    expect(observe([thread('t')], at).returnedAt('t')).toBeUndefined();
    observe([thread('t', { snoozedUntil: later })], at + 1);
    expect(observe([thread('t')], at + 2).returnedAt('t')).toBe(at + 2);
  });
});

describe('filterThreads', () => {
  const projects = [{ id: 'p1', profileId: 'a1' }, { id: 'p2', profileId: 'a1' }, { id: 'p3', profileId: 'a2' }];
  const all = { project: '', profileId: 'all', projects };
  const threads = [
    thread('Fix login'), thread('Add search', { projectId: 'p2' }), thread('Search docs', { projectId: 'p3', profileId: 'a2' }),
    thread('Loose', { projectId: '', profileId: 'a2' }),
    // Another machine's thread in a repository with no checkout on this one.
    thread('Remote work', { projectId: 'elsewhere', profileId: 'a1', projectName: 'accio', machine: { id: 'm2', name: 'PC', online: true } }),
  ];

  it('keeps every thread when no project or profile is chosen, including other machines projects', () => {
    expect(ids(filterThreads(threads, all, ''))).toEqual(['Fix login', 'Add search', 'Search docs', 'Loose', 'Remote work']);
  });

  it('keeps one project when the sidebar is narrowed to it', () => {
    expect(ids(filterThreads(threads, { ...all, project: 'p2' }, ''))).toEqual(['Add search']);
  });

  it('places threads of projects this machine lacks, and No project threads, by their own profile', () => {
    expect(ids(filterThreads(threads, { ...all, profileId: 'a1' }, ''))).toEqual(['Fix login', 'Add search', 'Remote work']);
    expect(ids(filterThreads(threads, { ...all, profileId: 'a2' }, ''))).toEqual(['Search docs', 'Loose']);
  });

  it('matches the search against titles, ignoring case', () => {
    expect(ids(filterThreads(threads, all, '  SEARCH '))).toEqual(['Add search', 'Search docs']);
  });
});

describe('nextMorning', () => {
  it('is today at 9 before 8, tomorrow at 9 after', () => {
    expect(nextMorning(new Date('2026-11-03T07:00:00')).getDate()).toBe(3);
    expect(nextMorning(new Date('2026-11-03T08:30:00')).getDate()).toBe(4);
    expect(nextMorning(now).getHours()).toBe(9);
  });
});
