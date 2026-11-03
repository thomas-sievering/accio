import type { AccountLimitsView, AccountView, LimitWindow, LimitsSnapshot, ProfileProviderView, ProfileView } from '@accio/protocol';

/** 'all' or a profile id. */
export type LimitsScope = 'all' | (string & {});

/** The hub treats a snapshot as fresh for a minute; the client asks no more often. */
export const FRESH_MS = 60_000;
/** The hub ignores attempts closer together than this. */
const COOLDOWN_MS = 5_000;

/** The first preferred profile that still exists, else every profile. */
export function defaultLimitsScope(profiles: ProfileView[] | undefined, ...preferred: (string | undefined)[]): LimitsScope {
  for (const id of preferred) if (id && id !== 'all' && profiles?.some((p) => p.id === id)) return id;
  return 'all';
}

type Named = { id: string; name: string };
export type LimitsEntry =
  /** Meters are drawn here. `sharedWith` lists the other profiles selecting this account. */
  | { kind: 'account'; provider: ProfileProviderView; account: AccountView; sharedWith: Named[] }
  /** All profiles: this account's meters are already drawn under `shownUnder`. */
  | { kind: 'reference'; provider: ProfileProviderView; account: AccountView; shownUnder: Named; sharedWith: Named[] };
export type LimitsGroup = { profile: ProfileView; entries: LimitsEntry[] };

/**
 * Profile → provider → account. A shared account keeps its place under every
 * profile, but All profiles draws its meters only once, under the first profile.
 */
export function limitsLayout(profiles: ProfileView[], scope: LimitsScope): LimitsGroup[] {
  const users = new Map<string, Named[]>();
  for (const p of profiles) for (const provider of p.providers) for (const a of provider.accounts) {
    const list = users.get(a.id) ?? [];
    if (!list.some((u) => u.id === p.id)) list.push({ id: p.id, name: p.name });
    users.set(a.id, list);
  }
  const drawnUnder = new Map<string, Named>();
  return profiles.filter((p) => scope === 'all' || p.id === scope).map((profile) => ({
    profile,
    entries: profile.providers.flatMap((provider): LimitsEntry[] => {
      return provider.accounts.map((account) => {
        const sharedWith = (users.get(account.id) ?? []).filter((u) => u.id !== profile.id);
        const first = drawnUnder.get(account.id);
        if (first) return { kind: 'reference', provider, account, shownUnder: first, sharedWith };
        drawnUnder.set(account.id, { id: profile.id, name: profile.name });
        return { kind: 'account', provider, account, sharedWith };
      });
    }),
  }));
}

/** Remaining allowance, or null when the provider did not report usage. */
export function remainingPercent(w: LimitWindow): number | null {
  return w.usedPercent === null ? null : Math.max(0, Math.min(100, 100 - w.usedPercent));
}

/** Compare reported allowance with even use over the provider's full reset window. */
export function allowancePace(w: LimitWindow, now: number): { timeRemainingPercent: number; minutesAhead: number } | null {
  const remaining = remainingPercent(w);
  const minutes = w.durationMinutes;
  const untilReset = w.resetsAt ? (Date.parse(w.resetsAt) - now) / 60_000 : NaN;
  if (remaining === null || minutes === null || !Number.isFinite(minutes) || minutes <= 0
    || !Number.isFinite(untilReset) || untilReset <= 0 || untilReset > minutes) return null;
  return { timeRemainingPercent: untilReset / minutes * 100, minutesAhead: Math.round(remaining / 100 * minutes - untilReset) };
}

/** Never rounds a nearly used-up allowance to 0% or a barely used one to 100%. */
export function formatRemaining(remaining: number): string {
  if (remaining <= 0) return '0%';
  if (remaining < 1) return '<1%';
  if (remaining >= 100) return '100%';
  return `${Math.min(99, Math.round(remaining))}%`;
}

export type Level = 'ok' | 'low' | 'empty' | 'unknown';
export function level(w: LimitWindow): Level {
  const r = remainingPercent(w);
  return r === null ? 'unknown' : r <= 0 ? 'empty' : r <= 20 ? 'low' : 'ok';
}

const KIND_ORDER: Record<LimitWindow['kind'], number> = { session: 0, weekly: 1, monthly: 2, other: 3 };
const byWindow = (a: LimitWindow, b: LimitWindow) =>
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.durationMinutes ?? Infinity) - (b.durationMinutes ?? Infinity) || a.label.localeCompare(b.label);

/** General windows first, then scoped windows with reported usage or reset information. */
export function splitWindows(windows: LimitWindow[]): { general: LimitWindow[]; scoped: { scope: string; windows: LimitWindow[] }[] } {
  const general = windows.filter((w) => w.scope === null).sort(byWindow);
  const scoped = new Map<string, LimitWindow[]>();
  for (const w of windows) if (w.scope !== null && (w.usedPercent !== null || w.resetsAt !== null)) {
    scoped.set(w.scope, [...(scoped.get(w.scope) ?? []), w]);
  }
  return {
    general,
    scoped: [...scoped].sort(([a], [b]) => a.localeCompare(b)).map(([scope, list]) => ({ scope, windows: list.sort(byWindow) })),
  };
}

/** A reset the snapshot predates has passed: the allowance has probably returned, but nothing has confirmed it. */
export function resetPassed(w: LimitWindow, snapshot: LimitsSnapshot, now: number): boolean {
  if (!w.resetsAt) return false;
  const at = Date.parse(w.resetsAt);
  return at <= now && at > Date.parse(snapshot.observedAt);
}

/** For display: a reset time in the past is never shown as a countdown or as a refill. */
export function resetDue(w: LimitWindow, now: number): boolean {
  return !!w.resetsAt && Date.parse(w.resetsAt) <= now;
}

/**
 * A used-up general weekly or monthly window blocks the account regardless of
 * shorter windows, whose reported values stay as they are.
 */
export function blockingWindow(snapshot: LimitsSnapshot, now: number): LimitWindow | null {
  return snapshot.windows.find((w) => w.scope === null && (w.kind === 'weekly' || w.kind === 'monthly')
    && w.usedPercent !== null && w.usedPercent >= 100 && !resetDue(w, now)) ?? null;
}

/** The general window with the least remaining allowance, for the compact indicator. Not a combined figure. */
export function tightestWindow(snapshot: LimitsSnapshot): LimitWindow | null {
  let tightest: LimitWindow | null = null;
  for (const w of splitWindows(snapshot.windows).general) {
    const r = remainingPercent(w);
    if (r === null) continue;
    if (!tightest || r < remainingPercent(tightest)!) tightest = w;
  }
  return tightest;
}

/** Whether a passive (non-forced) refresh is worth asking the hub for. */
export function needsRefresh(view: AccountLimitsView | undefined, now: number): boolean {
  if (!view || view.status === 'signedOut' || view.status === 'refreshing') return false;
  if (view.retryAt && Date.parse(view.retryAt) > now) return false;
  if (view.attemptedAt && now - Date.parse(view.attemptedAt) < (view.status === 'unsupported' ? FRESH_MS : COOLDOWN_MS)) return false;
  const snapshot = view.snapshot;
  if (!snapshot) return view.status !== 'unsupported' || !view.attemptedAt || now - Date.parse(view.attemptedAt) >= FRESH_MS;
  if (snapshot.windows.some((w) => resetPassed(w, snapshot, now))) return true;
  return now - Date.parse(snapshot.observedAt) >= FRESH_MS;
}

/** The next moment a shown allowance resets, so the client can check it then rather than assume a refill. */
export function nextReset(views: (AccountLimitsView | undefined)[], now: number): number | null {
  let next: number | null = null;
  for (const v of views) for (const w of v?.snapshot?.windows ?? []) {
    const at = w.resetsAt ? Date.parse(w.resetsAt) : NaN;
    if (at > now && (next === null || at < next)) next = at;
  }
  return next;
}

/** Every retry respects the hub's published backoff and its short attempt cooldown. */
export function retryBlockedUntil(view: AccountLimitsView, now: number): number | null {
  const at = Math.max(view.retryAt ? Date.parse(view.retryAt) : 0, view.attemptedAt ? Date.parse(view.attemptedAt) + COOLDOWN_MS : 0);
  return at > now ? at : null;
}

/** "in 2 h 14 min", "in 3 days", "4 min ago". */
export function relativeTime(at: number, now: number): string {
  const future = at >= now;
  const minutes = Math.round(Math.abs(at - now) / 60_000);
  let text: string;
  if (minutes < 1) return future ? 'in under a minute' : 'just now';
  if (minutes < 60) text = `${minutes} min`;
  else if (minutes < 48 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    text = m && h < 10 ? `${h} h ${m} min` : `${h} h`;
  } else text = `${Math.round(minutes / 1440)} days`;
  return future ? `in ${text}` : `${text} ago`;
}

const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekdayTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const full = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

/** A short absolute time: "14:05", "Tue 14:05" within the week, else "Nov 12, 14:05". */
export function absoluteTime(at: number, now: number): string {
  const d = new Date(at);
  if (new Date(now).toDateString() === d.toDateString()) return time.format(d);
  return Math.abs(at - now) < 6 * 86_400_000 ? weekdayTime.format(d) : dateTime.format(d);
}
export const fullTime = (at: number) => full.format(new Date(at));
