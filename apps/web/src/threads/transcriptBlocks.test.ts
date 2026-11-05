import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '@accio/protocol';
import { describeActivity, describeTools, layoutTranscript, toolLabel, toolSummary, type ToolItem, type TranscriptBlock } from './transcriptBlocks';

const tool = (id: string, name = 'Bash', turnId = 't1', status: ToolItem['status'] = 'done'): ToolItem => ({ kind: 'tool', id, turnId, name, summary: id, status });
const say = (id: string, text = id, turnId = 't1'): TranscriptItem => ({ kind: 'assistant', id, turnId, text });
const ask = (id: string, turnId = 't1'): TranscriptItem => ({ kind: 'user', id, turnId, text: id, at: '2026-11-03T12:00:00Z' });
const done = (turnId = 't1', ms = 5000): TranscriptItem => ({ kind: 'finished', id: `${turnId}:finished`, turnId, ms });

it('cleans legacy shell rows and live activity without changing other tool summaries', () => {
  const summary = String.raw`"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'Get-Content long…`;
  const shell = { ...tool('shell', 'Shell'), summary };
  expect(toolSummary(shell)).toBe('Get-Content long…');
  expect(describeActivity(shell)).toBe('Running Get-Content');
  expect(toolSummary({ ...shell, name: 'Read' })).toBe(summary);
  expect(shell.summary).toBe(summary);
});
type Shape = string | Shape[] | { work: Shape[] };
const shape = (blocks: TranscriptBlock[]): Shape[] => blocks.map((b) =>
  b.kind === 'tools' ? b.items.map((i) => i.id) : b.kind === 'work' ? { work: shape(b.blocks) } : b.item.id);

describe('layoutTranscript', () => {
  it('keeps mid-turn steering and responses visible in conversation order', () => {
    const correction: TranscriptItem = { kind: 'user', id: 'steer', turnId: 't1', text: 'use helper', at: '', steered: true };
    expect(shape(layoutTranscript([ask('q'), tool('1'), correction, say('a'), done()])))
      .toEqual(['q', 't1:finished', ['1'], 'steer', 'a']);
  });
  it('keeps the live line at the end of a running turn after a steer', () => {
    const correction: TranscriptItem = { kind: 'user', id: 'steer', turnId: 't1', text: 'use helper', at: '', steered: true };
    const blocks = layoutTranscript([ask('q'), tool('1'), correction], 't1');
    expect(shape(blocks)).toEqual(['q', ['1'], 'steer', { work: [] }]);
    expect(blocks.at(-1)).toMatchObject({ kind: 'work', live: true, activity: 'Working', startedAt: '2026-11-03T12:00:00Z' });
    expect(shape(layoutTranscript([ask('q'), tool('1'), correction], undefined))).toEqual(['q', ['1'], 'steer']);
  });
  it('lays out a running turn in full, joining consecutive calls', () => {
    expect(shape(layoutTranscript([ask('q'), say('a'), tool('1'), tool('2'), say('b'), tool('3')]))).toEqual(['q', 'a', ['1', '2'], 'b', ['3']]);
  });

  it('ignores blank assistant items between calls', () => {
    expect(shape(layoutTranscript([tool('1'), say('blank', '  '), tool('2')]))).toEqual([['1', '2']]);
  });

  it('never joins calls from different turns', () => {
    expect(shape(layoutTranscript([tool('1', 'Bash', 't1'), tool('2', 'Bash', 't2')]))).toEqual([['1'], ['2']]);
  });

  it('folds a completed turn’s work and keeps its trailing answer outside', () => {
    expect(shape(layoutTranscript([ask('q'), say('plan'), tool('1'), tool('2'), say('note'), tool('3'), say('a1'), say('blank', ''), say('a2'), done()])))
      .toEqual(['q', { work: ['plan', ['1', '2'], 'note', ['3']] }, 'a1', 'a2']);
  });

  it('keeps a choice outside the fold with the answer, since it waits for you', () => {
    const choice: TranscriptItem = { kind: 'choice', id: 'c', turnId: 't1', question: 'Which?', options: [] };
    expect(shape(layoutTranscript([ask('q'), tool('1'), choice, say('a'), done()]))).toEqual(['q', { work: [['1']] }, 'c', 'a']);
  });

  it.each(['pending', 'provided'] as const)('keeps a %s secret visible when other work is folded', (status) => {
    const secret: TranscriptItem = { kind: 'secret', id: 's', turnId: 't1', requestId: 'r', slot: 'test:token',
      label: 'Test token', reason: 'Test', profileId: 'p', profileName: 'Personal', projectId: 'project',
      projectName: 'Project', machineName: 'This machine', status, candidates: [], expiresAt: '2026-11-03T13:00:00Z' };
    const items = [ask('q'), tool('1'), secret, tool('2')];
    const blocks = layoutTranscript(items, 't1');
    expect(shape(blocks)).toEqual(['q', ['1'], 's', { work: [['2']] }]);
    if (status === 'pending') expect(blocks.at(-1)).toMatchObject({ activity: 'Waiting for secret' });
    expect(shape(layoutTranscript([...items, say('a'), done()]))).toEqual(['q', { work: [['1', '2']] }, 's', 'a']);
  });

  it('carries the duration, failures and a stable id on the work block', () => {
    const [, work] = layoutTranscript([ask('q'), tool('1', 'Bash', 't1', 'error'), tool('2'), say('a'), done('t1', 42_000)]);
    expect(work).toMatchObject({ kind: 'work', id: 't1:work', live: false, ms: 42_000, failed: 1 });
  });

  it('keeps the plain finished divider when a turn did no work', () => {
    expect(shape(layoutTranscript([ask('q'), say('a'), done()]))).toEqual(['q', 't1:finished', 'a']);
  });

  it('folds everything when a turn ends without an answer', () => {
    expect(shape(layoutTranscript([ask('q'), tool('1'), done()]))).toEqual(['q', { work: [['1']] }]);
  });

  it('folds a running turn behind what it is doing now, with the same id it keeps once done', () => {
    const items = [ask('q'), tool('1', 'Read', 't1'), { ...tool('2', 'Bash', 't1', 'running'), summary: 'pnpm test' }];
    const [, work] = layoutTranscript(items, 't1');
    expect(work).toMatchObject({ kind: 'work', id: 't1:work', live: true, activity: 'Running pnpm', startedAt: '2026-11-03T12:00:00Z' });
    expect(shape(layoutTranscript(items, 't1'))).toEqual(['q', { work: [['1', '2']] }]);
    expect(layoutTranscript([...items, say('a'), done()])[1]).toMatchObject({ id: 't1:work', live: false });
  });

  it('adds the latest step of a running sub-agent to what the turn is doing', () => {
    const agent: ToolItem = { ...tool('1', 'Agent', 't1', 'running'), summary: 'Count the files', step: { name: 'Read', summary: 'delivery.ts' } };
    expect(layoutTranscript([ask('q'), agent], 't1')[1]).toMatchObject({ live: true, activity: 'Running agent · Reading files' });
  });

  it('keeps what a running turn says between calls visible, with only its latest calls behind the live line', () => {
    const items = [ask('q'), say('plan'), tool('1'), tool('2'), say('note'), tool('3', 'Read', 't1', 'running')];
    expect(shape(layoutTranscript(items, 't1'))).toEqual(['q', 'plan', ['1', '2'], 'note', { work: [['3']] }]);
    expect(shape(layoutTranscript([...items, say('a'), done()]))).toEqual(['q', { work: ['plan', ['1', '2'], 'note', ['3']] }, 'a']);
  });

  it('says Thinking after a message and keeps the live line below a streaming answer', () => {
    const blocks = layoutTranscript([ask('q'), tool('1'), say('partial answer')], 't1');
    expect(blocks.at(-1)).toMatchObject({ live: true, activity: 'Thinking', blocks: [] });
    expect(shape(blocks)).toEqual(['q', ['1'], 'partial answer', { work: [] }]);
    expect(layoutTranscript([ask('q')], 't1')[1]).toMatchObject({ live: true, activity: 'Thinking', blocks: [] });
  });

  it('leaves a stopped or failed turn laid out in full', () => {
    expect(shape(layoutTranscript([ask('q'), tool('1', 'Bash', 't1', 'interrupted'), say('a')]))).toEqual(['q', ['1'], 'a']);
  });

  it('lays out each turn on its own', () => {
    expect(shape(layoutTranscript([ask('q1', 't1'), tool('1', 'Bash', 't1'), say('a1', 'a1', 't1'), done('t1'), ask('q2', 't2'), tool('2', 'Bash', 't2')])))
      .toEqual(['q1', { work: [['1']] }, 'a1', 'q2', ['2']]);
  });
});

describe('describeTools', () => {
  it('counts by kind in first-seen order across harnesses', () => {
    expect(describeTools([tool('1', 'Read'), tool('2', 'Bash'), tool('3', 'Shell'), tool('4', 'Read')])).toBe('Read 2 files, ran 2 commands');
  });

  it('pluralises and covers edits, searches and unknown tools', () => {
    expect(describeTools([tool('1', 'Edit')])).toBe('Edited 1 file');
    expect(describeTools([tool('1', 'Grep'), tool('2', 'Glob')])).toBe('Ran 2 searches');
    expect(describeTools([tool('1', 'linear/get_issue')])).toBe('Used 1 tool');
  });
});

describe('describeActivity', () => {
  it.each(['Bash', 'Shell', 'BashOutput', 'KillShell'])('keeps %s command text out of collapsed activity', (name) => {
    expect(describeActivity({ name, summary: 'pnpm build >/dev/null 2>&1; pnpm exec playwright test' })).toBe('Running pnpm');
  });

  it('keeps shell steps out of collapsed agent activity and steered turns', () => {
    const agent: ToolItem = { ...tool('agent', 'Agent', 't1', 'running'), summary: 'Review changes', step: { name: 'Bash', summary: 'git diff' } };
    expect(layoutTranscript([ask('q'), agent], 't1')[1]).toMatchObject({ activity: 'Running agent · Running git' });
    const correction: TranscriptItem = { kind: 'user', id: 'steer', turnId: 't1', text: 'continue', at: '', steered: true };
    expect(layoutTranscript([ask('q'), correction, { ...tool('shell', 'Shell', 't1', 'running'), summary: 'pnpm test' }], 't1').at(-1))
      .toMatchObject({ activity: 'Running pnpm' });
  });

  it.each([
    ['gh pr view --json url,state', 'gh'],
    ['bash -lc "gh pr view --json url,state"', 'gh'],
    ['"C:\\Program Files\\Git\\bin\\git.exe" diff --stat', 'git'],
    ['', 'command'],
    ['$(echo gh) pr view', 'command'],
    ['bash -c "$TASK"', 'command'],
    ['cd C:/repo; pnpm test 2>&1 | grep FAIL', 'pnpm'],
    ['cd /repo && git status', 'git'],
    ['cd /repo 2>&1; export CI=1; NODE_ENV=test sudo -E npx vitest', 'npx'],
    ['Set-Location C:\\repo; Get-Content README.md', 'Get-Content'],
    ['cd "C:/my repo"\npnpm build', 'pnpm'],
    ['cd /repo', 'command'],
  ])('shows only the program for %s', (summary, program) => {
    expect(describeActivity({ name: 'Bash', summary })).toBe(`Running ${program}`);
  });

  it('names what a running call is doing', () => {
    expect(describeActivity({ ...tool('1', 'Read'), summary: 'README.md' })).toBe('Reading files');
    expect(describeActivity({ ...tool('1', 'Grep'), summary: 'TODO' })).toBe('Searching');
    expect(describeActivity({ ...tool('1', 'Edit'), summary: '' })).toBe('Editing files');
    expect(describeActivity({ ...tool('1', 'Write'), summary: 'secret-config.json' })).toBe('Writing files');
    expect(describeActivity({ ...tool('1', 'WebFetch'), summary: 'https://example.com/path' })).toBe('Fetching page');
    expect(describeActivity({ ...tool('1', 'mcp__linear__get_issue'), summary: '{"id":"LIT-42"}' })).toBe('Using linear · get_issue');
  });

  it('labels Claude and Codex MCP tools alike', () => {
    expect(toolLabel('mcp__linear__get_issue')).toBe('linear · get_issue');
    expect(toolLabel('linear/get_issue')).toBe('linear · get_issue');
    expect(toolLabel('Bash')).toBe('Bash');
  });
});
