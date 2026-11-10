import { describe, expect, it } from 'vitest';
import type { AccountLimitsView, AccountView, LimitWindow, ProfileProviderView, ProfileView } from '@accio/protocol';
import {
  allowancePace, blockingWindow, defaultLimitsScope, formatRemaining, limitsLayout, needsRefresh, nextReset, remainingPercent, resetPassed, retryBlockedUntil, splitWindows, tightestWindow,
} from './limitsModel';

const account = (id: string, providerId: 'anthropic' | 'openai' = 'anthropic'): AccountView =>
  ({ id, name: id, providerId, signedIn: true, email: null, organization: null });
const provider = (id: 'anthropic' | 'openai', accounts: AccountView[], available = true): ProfileProviderView =>
  ({ id, name: id === 'anthropic' ? 'Anthropic' : 'OpenAI', accountName: id === 'anthropic' ? 'Claude account' : 'ChatGPT account', available, accounts, inUseId: accounts.find((a) => a.signedIn)?.id ?? null });
const profile = (id: string, claude: AccountView | null, chatgpt: AccountView | null = null): ProfileView =>
  ({ id, name: id, house: { id, name: id }, providers: [provider('anthropic', claude ? [claude] : []), provider('openai', chatgpt ? [chatgpt] : [])] });
const win = (over: Partial<LimitWindow>): LimitWindow =>
  ({ id: 'w', kind: 'session', label: '5-hour', scope: null, usedPercent: 0, resetsAt: null, durationMinutes: 300, ...over });
const T = Date.parse('2026-11-03T12:00:00Z');
const iso = (offsetMs: number) => new Date(T + offsetMs).toISOString();
const view = (over: Partial<AccountLimitsView>): AccountLimitsView =>
  ({ accountId: 'a', providerId: 'anthropic', status: 'ready', snapshot: null, attemptedAt: null, retryAt: null, problem: null, ...over });

describe('limitsLayout', () => {
  const team = account('team');
  const own = account('own');
  const gpt = account('gpt', 'openai');
  const profiles = [profile('personal', team, gpt), profile('work', team), profile('side', own, gpt)];

  it('draws a shared account once in All profiles and references it from the others', () => {
    const groups = limitsLayout(profiles, 'all');
    expect(groups.map((g) => g.profile.id)).toEqual(['personal', 'work', 'side']);
    const kinds = groups.map((g) => g.entries.map((e) => `${e.kind}:${e.account.id}`));
    expect(kinds).toEqual([
      ['account:team', 'account:gpt'],
      ['reference:team'],
      ['account:own', 'reference:gpt'],
    ]);
    const work = groups[1]!.entries[0]!;
    expect(work.kind === 'reference' && work.shownUnder.id).toBe('personal');
  });

  it('draws every account of a single profile and says who else shares it', () => {
    const [work] = limitsLayout(profiles, 'work');
    expect(work!.entries[0]).toMatchObject({ kind: 'account', sharedWith: [{ id: 'personal' }] });
    const [side] = limitsLayout(profiles, 'side');
    expect(side!.entries.map((e) => e.kind)).toEqual(['account', 'account']);
    expect(side!.entries[1]).toMatchObject({ sharedWith: [{ id: 'personal' }] });
    expect(side!.entries[0]).toMatchObject({ sharedWith: [] });
  });

  it('marks which of several accounts at a provider the profile uses', () => {
    const out = { ...account('out'), signedIn: false };
    const p: ProfileView = { id: 'p', name: 'p', house: null, providers: [provider('anthropic', [out, team, own]), provider('openai', [gpt])] };
    expect(limitsLayout([p], 'p')[0]!.entries.map((e) => `${e.account.id}:${e.role}`)).toEqual(['out:standby', 'team:inUse', 'own:standby', 'gpt:only']);
    // The Sorting Hat's choice wins over the order.
    const chosen: ProfileView = { ...p, providers: [{ ...provider('anthropic', [out, team, own]), inUseId: 'own' }] };
    expect(limitsLayout([chosen], 'p')[0]!.entries.map((e) => e.role)).toEqual(['standby', 'standby', 'inUse']);
  });

  it('skips providers with no selected account regardless of availability', () => {
    const p: ProfileView = { id: 'p', name: 'p', house: null, providers: [provider('anthropic', []), provider('openai', [], false)] };
    expect(limitsLayout([p], 'p')[0]!.entries).toEqual([]);
  });

  it('returns nothing for a deleted profile', () => {
    expect(limitsLayout(profiles, 'gone')).toEqual([]);
  });
});

describe('defaultLimitsScope', () => {
  const profiles = [profile('personal', null), profile('work', null)];
  it('prefers the thread profile, then the sidebar filter, then All profiles', () => {
    expect(defaultLimitsScope(profiles, 'work', 'personal')).toBe('work');
    expect(defaultLimitsScope(profiles, 'deleted', 'personal')).toBe('personal');
    expect(defaultLimitsScope(profiles, undefined, 'all')).toBe('all');
    expect(defaultLimitsScope(profiles, 'deleted', 'also-deleted')).toBe('all');
  });
});

describe('windows', () => {
  it('compares allowance with time until reset, expressed as a time buffer at an even pace', () => {
    const halfSession = { resetsAt: iso(150 * 60_000) };
    expect(allowancePace(win({ ...halfSession, usedPercent: 30 }), T)).toEqual({ timeRemainingPercent: 50, minutesAhead: 60 });
    expect(allowancePace(win({ ...halfSession, usedPercent: 70 }), T)).toEqual({ timeRemainingPercent: 50, minutesAhead: -60 });
    expect(allowancePace(win({ ...halfSession, usedPercent: 50 }), T)?.minutesAhead).toBe(0);
    expect(allowancePace(win({ kind: 'weekly', durationMinutes: 10080, resetsAt: iso(5 * 86_400_000), usedPercent: 29 }), T)?.minutesAhead).toBe(-43);
    // As reset approaches without further usage, the buffer grows.
    expect(allowancePace(win({ ...halfSession, usedPercent: 30 }), T + 60 * 60_000)?.minutesAhead).toBe(120);
  });

  it('omits pacing when usage, duration or a current valid reset window is unknown', () => {
    for (const over of [
      { usedPercent: null }, { durationMinutes: null }, { durationMinutes: 0 },
      { resetsAt: null }, { resetsAt: 'invalid' }, { resetsAt: iso(0) },
      { resetsAt: iso(-60_000) }, { resetsAt: iso(301 * 60_000) },
    ]) expect(allowancePace(win({ resetsAt: iso(60_000), ...over }), T)).toBeNull();
  });

  it('keeps unknown usage unknown and never rounds a remainder to 0% or 100%', () => {
    expect(remainingPercent(win({ usedPercent: null }))).toBeNull();
    expect(remainingPercent(win({ usedPercent: 38 }))).toBe(62);
    expect(formatRemaining(0.4)).toBe('<1%');
    expect(formatRemaining(99.7)).toBe('99%');
    expect(formatRemaining(0)).toBe('0%');
  });

  it('orders general windows by length and groups model scopes', () => {
    const { general, scoped } = splitWindows([
      win({ id: 'week', kind: 'weekly', label: 'Weekly', durationMinutes: 10080 }),
      win({ id: 'opus', kind: 'weekly', label: 'Weekly', scope: 'opus' }),
      win({ id: 'five', kind: 'session' }),
    ]);
    expect(general.map((w) => w.id)).toEqual(['five', 'week']);
    expect(scoped).toEqual([{ scope: 'opus', windows: [expect.objectContaining({ id: 'opus' })] }]);
  });

  it('hides empty scoped placeholders while keeping reported limits and unknown general usage', () => {
    const { general, scoped } = splitWindows([
      win({ id: 'unknown', usedPercent: null }),
      win({ id: 'breakdown', kind: 'weekly', scope: 'breakdown', usedPercent: null }),
      win({ id: 'fable', kind: 'weekly', scope: 'Fable', usedPercent: 1 }),
      win({ id: 'reset-only', scope: 'Opus', usedPercent: null, resetsAt: iso(60_000) }),
    ]);
    expect(general.map((w) => w.id)).toEqual(['unknown']);
    expect(scoped.map((s) => s.windows.map((w) => w.id))).toEqual([['fable'], ['reset-only']]);
  });

  it('preserves the reported session value when the weekly window is used up', () => {
    const session = win({ id: 'five', usedPercent: 20 });
    const weekly = win({ id: 'week', kind: 'weekly', label: 'Weekly', usedPercent: 100, resetsAt: iso(86_400_000) });
    const snapshot = { observedAt: iso(0), windows: [session, weekly] };
    expect(blockingWindow(snapshot, T)?.id).toBe('week');
    expect(remainingPercent(session)).toBe(80);
    // A used-up model-scoped window does not block the whole account.
    expect(blockingWindow({ observedAt: iso(0), windows: [session, { ...weekly, scope: 'opus' }] }, T)).toBeNull();
    expect(tightestWindow(snapshot)?.id).toBe('week');
  });

  it('treats a passed reset as awaiting confirmation, not a refill', () => {
    const w = win({ usedPercent: 100, resetsAt: iso(-1_000) });
    const snapshot = { observedAt: iso(-60_000), windows: [w] };
    expect(resetPassed(w, snapshot, T)).toBe(true);
    expect(remainingPercent(w)).toBe(0);
    expect(blockingWindow({ observedAt: iso(-60_000), windows: [{ ...w, kind: 'weekly' }] }, T)).toBeNull();
    // A reset already before the observation is simply part of that observation.
    expect(resetPassed(w, { observedAt: iso(0), windows: [w] }, T)).toBe(false);
  });
});

describe('needsRefresh', () => {
  const fresh = { observedAt: iso(-10_000), windows: [win({ resetsAt: iso(3_600_000) })] };
  it('asks for missing, stale and reset-passed snapshots only', () => {
    expect(needsRefresh(view({ status: 'idle' }), T)).toBe(true);
    expect(needsRefresh(view({ snapshot: fresh, attemptedAt: iso(-10_000) }), T)).toBe(false);
    expect(needsRefresh(view({ snapshot: { ...fresh, observedAt: iso(-61_000) }, attemptedAt: iso(-61_000) }), T)).toBe(false);
    expect(needsRefresh(view({ snapshot: { ...fresh, observedAt: iso(-301_000) }, attemptedAt: iso(-301_000) }), T)).toBe(true);
    const passed = { observedAt: iso(-20_000), windows: [win({ resetsAt: iso(-1_000) })] };
    expect(needsRefresh(view({ snapshot: passed, attemptedAt: iso(-20_000) }), T)).toBe(true);
  });

  it('respects in-flight refreshes, sign-out, retryAt and the hub cooldown', () => {
    expect(needsRefresh(undefined, T)).toBe(false);
    expect(needsRefresh(view({ status: 'refreshing' }), T)).toBe(false);
    expect(needsRefresh(view({ status: 'signedOut' }), T)).toBe(false);
    expect(needsRefresh(view({ status: 'error', retryAt: iso(30_000), attemptedAt: iso(-5_000) }), T)).toBe(false);
    expect(needsRefresh(view({ status: 'error', retryAt: iso(-1), attemptedAt: iso(-30_000) }), T)).toBe(true);
    expect(needsRefresh(view({ status: 'idle', attemptedAt: iso(-2_000) }), T)).toBe(false);
    expect(needsRefresh(view({ status: 'unsupported', attemptedAt: iso(-30_000) }), T)).toBe(false);
  });

  it('finds the next reset and exposes every hub retry deadline, including the short cooldown', () => {
    expect(nextReset([view({ snapshot: fresh }), undefined, view({ snapshot: { observedAt: iso(0), windows: [win({ resetsAt: iso(-5) })] } })], T)).toBe(T + 3_600_000);
    expect(retryBlockedUntil(view({ status: 'error', retryAt: iso(60_000), problem: { code: 'rateLimited', message: 'x' } }), T)).toBe(T + 60_000);
    expect(retryBlockedUntil(view({ status: 'error', retryAt: iso(60_000), problem: { code: 'unavailable', message: 'x' } }), T)).toBe(T + 60_000);
    expect(retryBlockedUntil(view({ attemptedAt: iso(-2_000) }), T)).toBe(T + 3_000);
    expect(retryBlockedUntil(view({ attemptedAt: iso(-6_000) }), T)).toBeNull();
  });
});
