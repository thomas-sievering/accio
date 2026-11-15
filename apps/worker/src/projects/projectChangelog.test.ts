import { expect, test } from 'vitest';
import { parseCommits } from './projectChangelog.js';

const record = (...fields: string[]) => `${fields.join('\x1f')}\x1e\n`;

test('a merge commit reads as its pull request title; other commits keep their subject', () => {
  const output = record('a1', 'Merge pull request #200 from owner/accio/branch', 'Ada', '2026-11-15T10:00:00Z', 'Find a sibling checkout\n\nMore detail')
    + record('b2', 'Fold each skill level', 'Ada', '2026-11-15T09:00:00Z', 'Body line\n')
    + record('c3', 'Merge pull request #7 from owner/x', 'Ada', '2026-11-15T08:00:00Z', '');
  expect(parseCommits(output)).toEqual([
    { sha: 'a1', subject: 'Find a sibling checkout', author: 'Ada', at: '2026-11-15T10:00:00Z', pullRequest: 200 },
    { sha: 'b2', subject: 'Fold each skill level', author: 'Ada', at: '2026-11-15T09:00:00Z' },
    { sha: 'c3', subject: 'Merge pull request #7 from owner/x', author: 'Ada', at: '2026-11-15T08:00:00Z', pullRequest: 7 },
  ]);
});
