import { describe, expect, it } from 'vitest';
import type { LimitWindow } from './types.js';
import { chooseAccount, type Candidate } from './accountChoice.js';

const T = Date.parse('2026-11-04T12:00:00Z');
const hours = (n: number) => new Date(T + n * 3_600_000).toISOString();
const win = (kind: LimitWindow['kind'], usedPercent: number | null, resetsAt: string | null, scope: string | null = null): LimitWindow =>
  ({ id: `${kind}:${scope}`, kind, label: kind, scope, usedPercent, resetsAt, durationMinutes: kind === 'session' ? 300 : 10080 });
const account = (id: string, ...windows: LimitWindow[]): Candidate => ({ id, snapshot: windows.length ? { observedAt: hours(-0.01), windows } : null });

describe('chooseAccount', () => {
  it('prefers the account whose weekly allowance resets soonest', () => {
    const later = account('later', win('session', 10, hours(3)), win('weekly', 20, hours(100)));
    const sooner = account('sooner', win('session', 60, hours(1)), win('weekly', 80, hours(30)));
    expect(chooseAccount([later, sooner], T)).toBe('sooner');
  });

  it('sets an account aside at 5% left in any general window, and returns to it once that resets', () => {
    const sooner = account('sooner', win('session', 95, hours(2)), win('weekly', 50, hours(30)));
    const later = account('later', win('session', 10, hours(3)), win('weekly', 20, hours(100)));
    expect(chooseAccount([sooner, later], T)).toBe('later');
    expect(chooseAccount([sooner, later], T + 2 * 3_600_000)).toBe('sooner');
    const almost = account('sooner', win('session', 94, hours(2)), win('weekly', 50, hours(30)));
    expect(chooseAccount([almost, later], T)).toBe('sooner');
  });

  it('ignores model-scoped windows and unknown usage', () => {
    const scoped = account('scoped', win('weekly', 100, hours(5), 'fable'), win('weekly', null, hours(10)));
    const other = account('other', win('weekly', 10, hours(50)));
    expect(chooseAccount([other, scoped], T)).toBe('scoped');
  });

  it('puts unknown limits after known resets, and keeps the profile order on ties', () => {
    const unknown = account('unknown');
    const known = account('known', win('weekly', 10, hours(50)));
    expect(chooseAccount([unknown, known], T)).toBe('known');
    expect(chooseAccount([unknown, account('also-unknown')], T)).toBe('unknown');
  });

  it('takes the account available first when all are low', () => {
    const week = account('week', win('session', 10, hours(1)), win('weekly', 100, hours(40)));
    const session = account('session', win('session', 99, hours(2)), win('weekly', 50, hours(20)));
    const never = account('never', win('weekly', 100, null));
    expect(chooseAccount([never, week, session], T)).toBe('session');
    expect(chooseAccount([], T)).toBeNull();
  });
});
