import { describe, expect, it } from 'vitest';
import type { ThreadView } from '@accio/protocol';
import { nextMorning, shelveThreads } from './shelves';

const now = new Date('2026-11-03T12:00:00');
const thread = (id: string, extra: Partial<ThreadView> = {}): ThreadView => ({
  id,
  checkoutId: 'c1',
  projectId: 'p1',
  profileId: 'a1',
  title: id,
  status: 'idle',
  createdAt: '2026-11-03T10:00:00Z',
  updatedAt: '2026-11-03T10:00:00Z',
  ...extra,
});
const ids = (ts: ThreadView[]) => ts.map((t) => t.id);

describe('shelveThreads', () => {
  it('puts settled before snoozed before working', () => {
    const later = '2026-11-04T09:00:00';
    const s = shelveThreads(
      [thread('settled', { status: 'running' }), thread('snoozed', { status: 'running' }), thread('working', { status: 'running' })],
      { settled: { settledAt: '2026-11-03T11:00:00', snoozedUntil: later }, snoozed: { snoozedUntil: later } },
      now,
    );
    expect(ids(s.settled)).toEqual(['settled']);
    expect(ids(s.snoozed)).toEqual(['snoozed']);
    expect(ids(s.working)).toEqual(['working']);
    expect(s.open.size).toBe(0);
  });

  it('wakes a thread whose snooze has passed', () => {
    const s = shelveThreads([thread('woke')], { woke: { snoozedUntil: '2026-11-03T11:00:00' } }, now);
    expect(s.snoozed).toEqual([]);
    expect(ids(s.open.get('p1') ?? [])).toEqual(['woke']);
  });

  it('keeps idle, interrupted and failed threads open under their project, newest first', () => {
    const s = shelveThreads(
      [
        thread('old', { createdAt: '2026-11-01T00:00:00Z' }),
        thread('cut', { status: 'interrupted', createdAt: '2026-11-03T11:00:00Z' }),
        thread('other', { projectId: 'p2', status: 'failed' }),
      ],
      {},
      now,
    );
    expect(ids(s.open.get('p1') ?? [])).toEqual(['cut', 'old']);
    expect(ids(s.open.get('p2') ?? [])).toEqual(['other']);
  });
});

describe('nextMorning', () => {
  it('is today at 9 before 8, tomorrow at 9 after', () => {
    expect(nextMorning(new Date('2026-11-03T07:00:00')).getDate()).toBe(3);
    expect(nextMorning(new Date('2026-11-03T08:30:00')).getDate()).toBe(4);
    expect(nextMorning(now).getHours()).toBe(9);
  });
});
