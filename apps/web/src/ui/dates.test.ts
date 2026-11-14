import { describe, expect, it } from 'vitest';
import { formatDay, formatDayTime, formatRelative } from './dates';

const now = new Date('2026-11-14T12:00:00');
const time = (d: Date) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(d);

describe('formatDay', () => {
  it('names today, yesterday and tomorrow', () => {
    expect(formatDay(new Date('2026-11-14T00:05:00'), now)).toBe('today');
    expect(formatDay(new Date('2026-11-13T23:55:00'), now)).toBe('yesterday');
    expect(formatDay(new Date('2026-11-15T08:00:00'), now)).toBe('tomorrow');
  });

  it('adds the year only when it is not the current year', () => {
    const sameYear = formatDay(new Date('2026-03-02T12:00:00'), now);
    expect(sameYear).toMatch(/2/);
    expect(sameYear).not.toContain('2026');
    expect(formatDay(new Date('2025-11-03T12:00:00'), now)).toContain('2025');
    expect(formatDay(new Date('2027-01-05T12:00:00'), now)).toContain('2027');
  });

  it('accepts ISO strings and epoch milliseconds', () => {
    expect(formatDay(new Date('2026-11-14T09:00:00').toISOString(), now)).toBe('today');
    expect(formatDay(new Date('2026-11-13T09:00:00').getTime(), now)).toBe('yesterday');
  });
});

describe('formatDayTime', () => {
  it('shows only the time today', () => {
    const at = new Date('2026-11-14T09:30:00');
    expect(formatDayTime(at, now)).toBe(time(at));
  });

  it('leads with the day on other days', () => {
    const tomorrow = new Date('2026-11-15T09:00:00');
    expect(formatDayTime(tomorrow, now)).toBe(`tomorrow ${time(tomorrow)}`);
    const later = new Date('2026-11-20T13:00:00');
    expect(formatDayTime(later, now)).toBe(`${formatDay(later, now)} ${time(later)}`);
    expect(formatDayTime(new Date('2025-06-01T13:00:00'), now)).toContain('2025');
  });
});

describe('formatRelative', () => {
  const t = now.getTime();
  it('says how far away a moment is', () => {
    expect(formatRelative(t + 20_000, t)).toBe('in under a minute');
    expect(formatRelative(t - 20_000, t)).toBe('just now');
    expect(formatRelative(t - 4 * 60_000, t)).toBe('4 min ago');
    expect(formatRelative(t + (2 * 60 + 14) * 60_000, t)).toBe('in 2 h 14 min');
    expect(formatRelative(t + 12 * 3_600_000 + 5 * 60_000, t)).toBe('in 12 h');
    expect(formatRelative(t + 3 * 86_400_000, t)).toBe('in 3 days');
  });
});
