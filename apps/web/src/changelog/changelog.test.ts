import { describe, expect, it } from 'vitest';
import type { ChangelogEntry } from '@accio/protocol';
import { byDay, entryForCommit, filterChangelog, landedText } from './changelog';

const entry = (id: string, extra: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
  id, threadId: `t-${id}`, projectId: 'p1', profileId: 'personal', title: `Thread ${id}`, target: 'main',
  deliveredAt: '2026-11-04T10:00:00Z', ...extra,
});
const ids = (es: ChangelogEntry[]) => es.map((e) => e.id);
const all = { projectId: 'p1', query: '' };

describe('filterChangelog', () => {
  const entries = [
    entry('rename', { note: { summary: 'Threads can be renamed in place', test: ['Double-click a title'] } }),
    entry('limits', { projectId: 'p2', title: 'Show limits', pullRequest: { number: 42, url: 'u' } }),
    entry('loose', { projectId: '', profileId: 'work' }),
  ];

  it('keeps one project’s entries', () => {
    expect(ids(filterChangelog(entries, all))).toEqual(['rename']);
    expect(ids(filterChangelog(entries, { ...all, projectId: 'p2' }))).toEqual(['limits']);
  });

  it('searches the note, things to try, title and PR number, every word anywhere', () => {
    expect(ids(filterChangelog(entries, { ...all, query: 'DOUBLE-click' }))).toEqual(['rename']);
    expect(ids(filterChangelog(entries, { ...all, query: 'renamed title' }))).toEqual(['rename']);
    expect(ids(filterChangelog(entries, { projectId: 'p2', query: '#42' }))).toEqual(['limits']);
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

describe('entryForCommit', () => {
  const commit = (sha: string, subject: string) => ({ sha, subject, author: 'Ada', at: '2026-11-04T10:00:00Z' });
  const direct = entry('direct', { revision: 'abc1234' });
  const merged = entry('merged', { pullRequest: { number: 100, url: 'u' }, revision: 'fff0000' });

  it('joins a commit to the delivery that published that revision, abbreviated or not', () => {
    expect(entryForCommit(commit('abc1234def5678', 'Fix login'), [merged, direct])?.id).toBe('direct');
    expect(entryForCommit(commit('fff0000', 'Anything'), [entry('full', { revision: 'fff0000aaaa' })])?.id).toBe('full');
  });

  it('falls back to the PR number a squash merge ends its subject with', () => {
    expect(entryForCommit(commit('9999999', 'Glide the first send (#100)'), [direct, merged])?.id).toBe('merged');
    expect(entryForCommit(commit('9999999', 'Mentions (#100) midway'), [merged])).toBeUndefined();
  });

  it('leaves commits made outside accio unjoined', () => {
    expect(entryForCommit(commit('1234567', 'Manual tweak'), [direct, merged])).toBeUndefined();
    expect(entryForCommit(commit('1234567', 'Other PR (#7)'), [direct, merged])).toBeUndefined();
  });
});
