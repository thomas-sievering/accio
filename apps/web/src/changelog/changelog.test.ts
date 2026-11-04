import { describe, expect, it } from 'vitest';
import type { ChangelogEntry } from '@accio/protocol';
import { byDay, filterChangelog, landedText } from './changelog';

const entry = (id: string, extra: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
  id, threadId: `t-${id}`, projectId: 'p1', profileId: 'personal', title: `Thread ${id}`, target: 'main',
  deliveredAt: '2026-11-04T10:00:00Z', ...extra,
});
const ids = (es: ChangelogEntry[]) => es.map((e) => e.id);
const all = { projectIds: new Set(['', 'p1', 'p2']), profile: 'all', query: '' };

describe('filterChangelog', () => {
  const entries = [
    entry('rename', { note: { summary: 'Threads can be renamed in place', test: ['Double-click a title'] } }),
    entry('limits', { projectId: 'p2', title: 'Show limits', pullRequest: { number: 42, url: 'u' } }),
    entry('loose', { projectId: '', profileId: 'work' }),
  ];

  it('follows the sidebar scope: projects in view, and No project entries of the shown profile', () => {
    expect(ids(filterChangelog(entries, { ...all, projectIds: new Set(['', 'p1']) }))).toEqual(['rename', 'loose']);
    expect(ids(filterChangelog(entries, { ...all, profile: 'personal' }))).toEqual(['rename', 'limits']);
  });

  it('searches the note, things to try, title and PR number, every word anywhere', () => {
    expect(ids(filterChangelog(entries, { ...all, query: 'DOUBLE-click' }))).toEqual(['rename']);
    expect(ids(filterChangelog(entries, { ...all, query: 'renamed title' }))).toEqual(['rename']);
    expect(ids(filterChangelog(entries, { ...all, query: '#42' }))).toEqual(['limits']);
    expect(ids(filterChangelog(entries, { ...all, query: 'nothing like it' }))).toEqual([]);
  });
});

it('says where a change landed', () => {
  expect(landedText(entry('a', { pullRequest: { number: 7, url: 'u' } }))).toBe('Merged into main · #7');
  expect(landedText(entry('a'))).toBe('Shipped to main');
});

it('groups entries by the day they shipped', () => {
  const now = new Date('2026-11-04T18:00:00');
  const groups = byDay([
    entry('a', { deliveredAt: new Date('2026-11-04T09:00:00').toISOString() }),
    entry('b', { deliveredAt: new Date('2026-11-04T08:00:00').toISOString() }),
    entry('c', { deliveredAt: new Date('2026-11-03T09:00:00').toISOString() }),
  ], now);
  expect(groups.map((g) => [g.day, ids(g.entries)])).toEqual([['Today', ['a', 'b']], ['Yesterday', ['c']]]);
});
