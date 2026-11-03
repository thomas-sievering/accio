import { describe, expect, it } from 'vitest';
import type { LimitWindow } from '@accio/protocol';
import { generalLimits, modelLimit, nextReset, scopeMatchesModel, usedUpMessage } from './modelLimits.js';

const now = Date.parse('2026-11-03T12:00:00Z');
const later = '2026-11-05T12:00:00Z';
const window = (over: Partial<LimitWindow>): LimitWindow => ({ id: 'seven_day', kind: 'weekly', label: 'Weekly', scope: null, usedPercent: 100, resetsAt: later, durationMinutes: 10080, ...over });

describe('matching limit scopes to models', () => {
  it.each([
    ['Fable', { id: 'fable', name: 'Claude Fable 5.1' }],
    ['Fable', { id: 'claude-fable-5[1m]', name: 'Claude Fable 5' }],
    ['fable', { id: 'opus-ish', name: 'Claude Fable' }],
    ['Opus', { id: 'opus', name: 'Claude Opus 5.5' }],
    ['Fable 5', { id: 'claude-fable-5[1m]', name: 'Fable' }],
    ['GPT-5.3-Codex-Spark', { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3-Codex-Spark' }],
  ])('%s names %o', (scope, model) => { expect(scopeMatchesModel(scope, model)).toBe(true); });

  it.each([
    ['Fable', { id: 'opus', name: 'Claude Opus 5.5' }],
    ['Opus', { id: 'claude-fable-5[1m]', name: 'Claude Fable 5' }],
    ['GPT-5', { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3-Codex-Spark' }],
    ['GPT-5.3-Codex-Spark', { id: 'gpt-5.3-codex', name: 'GPT-5.3-Codex' }],
    ['Fable 5.1', { id: 'fable', name: 'Claude Fable' }],
    ['oauth apps', { id: 'opus', name: 'Claude Opus' }],
    ['Claude', { id: 'opus', name: 'Claude Opus' }],
  ])('%s does not name %o', (scope, model) => { expect(scopeMatchesModel(scope, model)).toBe(false); });
});

describe('used-up limits', () => {
  const fable = { id: 'fable', name: 'Claude Fable 5.1' };

  it('limits a model only by its own fully used window that has not reset, the last to reset winning', () => {
    expect(modelLimit(fable, [window({ scope: 'Fable', usedPercent: 99 })], now)).toBeUndefined();
    expect(modelLimit(fable, [window({ scope: 'Fable', resetsAt: '2026-11-03T11:59:00Z' })], now)).toBeUndefined();
    expect(modelLimit(fable, [window({ scope: 'Fable', resetsAt: null })], now)).toBeUndefined();
    expect(modelLimit(fable, [window({})], now)).toBeUndefined();
    expect(modelLimit(fable, [window({ id: 'a', scope: 'Fable', label: '5-hour' }), window({ id: 'b', scope: 'Fable', resetsAt: '2026-11-09T00:00:00Z' })], now))
      .toEqual({ label: "Fable's weekly limit", resetsAt: '2026-11-09T00:00:00Z' });
  });

  it('reports general windows separately and finds the next reset', () => {
    const windows = [window({ id: 'five_hour', label: '5-hour', resetsAt: '2026-11-03T14:00:00Z' }), window({ scope: 'Fable' }), window({ id: 'x', label: 'Monthly credit limit', usedPercent: 50 })];
    expect(modelLimit(fable, [window({ scope: 'fable' })], now)?.label).toBe("Fable's weekly limit");
    expect(generalLimits(windows, now)).toEqual([{ label: 'The 5-hour limit', resetsAt: '2026-11-03T14:00:00Z' }]);
    expect(nextReset(windows, now)).toBe(Date.parse('2026-11-03T14:00:00Z'));
    expect(nextReset([window({ usedPercent: 10 })], now)).toBeUndefined();
  });

  it('says what is used up and until when', () => {
    expect(usedUpMessage({ label: "Fable's weekly limit", resetsAt: later })).toMatch(/^Fable's weekly limit is used up until \w{3} \d+ \w{3}, \d\d:\d\d .+\. Choose another model\.$/);
    expect(usedUpMessage({ label: "Fable's weekly limit", resetsAt: null })).toBe("Fable's weekly limit is used up. Choose another model.");
  });
});
