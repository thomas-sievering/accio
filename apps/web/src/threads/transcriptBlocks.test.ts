import { describe, expect, it } from 'vitest';
import type { TranscriptItem } from '@accio/protocol';
import { describeTools, layoutTranscript, type ToolItem, type TranscriptBlock } from './transcriptBlocks';

const tool = (id: string, name = 'Bash', turnId = 't1', status: ToolItem['status'] = 'done'): ToolItem => ({ kind: 'tool', id, turnId, name, summary: id, status });
const say = (id: string, text = id, turnId = 't1'): TranscriptItem => ({ kind: 'assistant', id, turnId, text });
const ask = (id: string, turnId = 't1'): TranscriptItem => ({ kind: 'user', id, turnId, text: id, at: '2026-11-03T12:00:00Z' });
const done = (turnId = 't1', ms = 5000): TranscriptItem => ({ kind: 'finished', id: `${turnId}:finished`, turnId, ms });
type Shape = string | Shape[] | { work: Shape[] };
const shape = (blocks: TranscriptBlock[]): Shape[] => blocks.map((b) =>
  b.kind === 'tools' ? b.items.map((i) => i.id) : b.kind === 'work' ? { work: shape(b.blocks) } : b.item.id);

describe('layoutTranscript', () => {
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

  it('carries the duration, failures and a stable id on the work block', () => {
    const [, work] = layoutTranscript([ask('q'), tool('1', 'Bash', 't1', 'error'), tool('2'), say('a'), done('t1', 42_000)]);
    expect(work).toMatchObject({ kind: 'work', id: 't1:finished', ms: 42_000, failed: 1 });
  });

  it('keeps the plain finished divider when a turn did no work', () => {
    expect(shape(layoutTranscript([ask('q'), say('a'), done()]))).toEqual(['q', 'a', 't1:finished']);
  });

  it('folds everything when a turn ends without an answer', () => {
    expect(shape(layoutTranscript([ask('q'), tool('1'), done()]))).toEqual(['q', { work: [['1']] }]);
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
