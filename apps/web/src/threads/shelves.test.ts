import { describe, expect, it } from 'vitest';
import type { ThreadView } from '@accio/protocol';
import { filterThreads, nextMorning, shelveThreads } from './shelves';

const now = new Date('2026-11-03T12:00:00');
const thread = (id: string, extra: Partial<ThreadView> = {}): ThreadView => ({
  id,
  checkoutId: 'c1',
  projectId: 'p1',
  profileId: 'a1',
  model: { harnessId: 'claudeCode', modelId: 'default' },
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
  it('puts settled before snoozed, and keeps a running thread in the open list', () => {
    const s = shelveThreads(
      [
        thread('settled', { settledAt: '2026-11-03T11:00:00', snoozedUntil: later }),
        thread('snoozed', { snoozedUntil: later }),
        thread('working', { status: 'running' }),
      ],
      now,
    );
    expect(ids(s.settled)).toEqual(['settled']);
    expect(ids(s.snoozed)).toEqual(['snoozed']);
    expect(ids(s.open)).toEqual(['working']);
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

describe('filterThreads', () => {
  const threads = [thread('Fix login'), thread('Add search', { projectId: 'p2' }), thread('Search docs', { projectId: 'p3' })];

  it('keeps only threads of the given projects', () => {
    expect(ids(filterThreads(threads, new Set(['p1', 'p2']), ''))).toEqual(['Fix login', 'Add search']);
  });

  it('matches the search against titles, ignoring case', () => {
    expect(ids(filterThreads(threads, new Set(['p1', 'p2', 'p3']), '  SEARCH '))).toEqual(['Add search', 'Search docs']);
  });
});

describe('nextMorning', () => {
  it('is today at 9 before 8, tomorrow at 9 after', () => {
    expect(nextMorning(new Date('2026-11-03T07:00:00')).getDate()).toBe(3);
    expect(nextMorning(new Date('2026-11-03T08:30:00')).getDate()).toBe(4);
    expect(nextMorning(now).getHours()).toBe(9);
  });
});
