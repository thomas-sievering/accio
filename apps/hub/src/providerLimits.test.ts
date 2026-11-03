import { describe, expect, it } from 'vitest';
import { anthropicLimits, openaiLimits, retryAfterMs } from './providerLimits.js';

describe('provider allowance normalization', () => {
  it('keeps Claude general and model-scoped windows separate', () => {
    const result = anthropicLimits({ five_hour: { utilization: 48, resets_at: '2026-11-03T12:00:00Z' },
      seven_day: { utilization: 100, resets_at: null }, seven_day_sonnet: { utilization: 2 },
      limits: [{ id: 'fable', kind: 'weekly_scoped', percent: 1, scope: { model: { id: 'model-fable', display_name: 'Fable' } } }],
    });
    expect(result.windows).toMatchObject([
      { id: 'five_hour', usedPercent: 48, label: '5-hour', durationMinutes: 300, scope: null, resetsAt: '2026-11-03T12:00:00.000Z' },
      { id: 'seven_day', usedPercent: 100, kind: 'weekly', scope: null, resetsAt: null },
      { id: 'seven_day_sonnet', scope: 'sonnet' }, { id: 'fable', scope: 'Fable', usedPercent: 1 },
    ]);
    // Weekly exhaustion must never rewrite the provider's reported session value.
    expect(result.windows?.[0]?.usedPercent).toBe(48);
  });

  it('does not turn missing usage into zero or missing resets into a clock', () => {
    expect(anthropicLimits({ five_hour: { utilization: null, resets_at: 'invalid' }, seven_day: null }).windows)
      .toMatchObject([{ usedPercent: null, resetsAt: null }]);
    expect(anthropicLimits({ five_hour: null, seven_day: null })).toEqual({ windows: [] });
    expect(anthropicLimits({ rate_limits_available: false })).toEqual({ unsupported: true });
    expect(() => anthropicLimits({})).toThrow(/unreadable/);
    expect(() => anthropicLimits({ five_hour: { utilization: '40' } })).toThrow(/unreadable/);
    expect(() => anthropicLimits({ limits: 'wrong' })).toThrow(/unreadable/);
  });

  it('normalizes Codex durations, epoch resets, monthly and model-specific windows without double-counting snapshots', () => {
    const common = { limitId: 'codex', primary: { usedPercent: 39, windowDurationMins: 300, resetsAt: 1793707200 }, secondary: { usedPercent: 19, windowDurationMins: 10080 } };
    const result = openaiLimits({ rateLimits: common, rateLimitsByLimitId: {
      codex: common,
      'model-x': { limitName: 'Model X', primary: { usedPercent: 10, windowDurationMins: 43200 },
        individualLimit: { remainingPercent: 75 } },
    } });
    expect(result.windows).toHaveLength(4);
    expect(result.windows).toMatchObject([
      { id: 'codex:primary', label: '5-hour', usedPercent: 39, resetsAt: new Date(1793707200000).toISOString(), scope: null },
      { id: 'codex:secondary', kind: 'weekly', durationMinutes: 10080 },
      { id: 'model-x:primary', kind: 'monthly', label: 'Monthly', scope: 'Model X' },
      { id: 'model-x:individual', usedPercent: 25, scope: 'Model X' },
    ]);
  });

  it('keeps unknown durations and usage explicit instead of guessing the plan', () => {
    expect(openaiLimits({ rateLimits: { planType: 'free', primary: { resetsAt: null } } }).windows)
      .toMatchObject([{ kind: 'other', label: 'Primary window', usedPercent: null, resetsAt: null, durationMinutes: null }]);
    expect(openaiLimits({ rateLimits: null })).toEqual({ unsupported: true });
    expect(openaiLimits({ rateLimits: { primary: null, secondary: null } })).toEqual({ windows: [] });
    expect(() => openaiLimits({})).toThrow(/unreadable/);
    expect(() => openaiLimits({ rateLimits: {} })).toThrow(/unreadable/);
    expect(() => openaiLimits({ rateLimitsByLimitId: [] })).toThrow(/unreadable/);
  });

  it('reads bounded Retry-After seconds and dates', () => {
    const now = Date.parse('2026-11-03T12:00:00Z');
    expect(retryAfterMs('120', now)).toBe(120_000);
    expect(retryAfterMs('Tue, 03 Nov 2026 12:01:00 GMT', now)).toBe(60_000);
    expect(retryAfterMs('9999999999999', now)).toBe(86_400_000);
    expect(retryAfterMs('no', now)).toBeUndefined();
    expect(retryAfterMs('-1', now)).toBeUndefined();
    expect(retryAfterMs(null, now)).toBeUndefined();
  });
});
