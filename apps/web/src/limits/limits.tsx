import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AccountLimitsView } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { observeLive } from '../app/observeLive';
import type { ConnectionStatus } from '../app/rpcClient';
import { CHECK_MS, needsRefresh, nextReset } from './limitsModel';

type LimitsState = {
  /** Every named account's limits by account id; undefined until the first load. */
  views: Map<string, AccountLimitsView> | undefined;
  /** The hub could not list limits at all; distinct from a provider's per-account problem. */
  loadError?: string;
  retryLoad: () => void;
  /** The last explicit or scheduled refresh request failed to reach the hub. */
  refreshError?: string;
  /** Explicit refreshes are forced; the hub still honours provider throttling. */
  refresh: (accountIds: string[], force?: boolean) => Promise<void>;
  /** Registers accounts on screen so the one scheduler keeps them current. Returns the release. */
  watch: (accountIds: string[]) => () => void;
  status: ConnectionStatus;
  /** Keeps short retry cooldowns and reset labels current. */
  now: number;
};

const Ctx = createContext<LimitsState | null>(null);

/**
 * One client-wide limits cache and refresh schedule. Views and cards only say
 * which accounts are visible; requests are made here: on first sight, on focus,
 * when a snapshot is five minutes old while the window is visible, and when a shown reset
 * passes. Only an explicit credential invalidation (idle), not pushed usage
 * values, starts another read.
 */
export function LimitsProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const status = useConnectionStatus();
  const [views, setViews] = useState<Map<string, AccountLimitsView>>();
  const [loadError, setLoadError] = useState<string>();
  const [refreshError, setRefreshError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [interest, setInterest] = useState<Map<string, number>>(new Map());
  const now = useClock(1_000);
  const latest = useRef(views);
  latest.current = views;
  // Bumped by every pushed or loaded list so an older refresh response cannot overwrite it.
  const revision = useRef(0);
  // Accounts a passive refresh is already asking about.
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    setLoadError(undefined);
    return observeLive(client, 'accounts.limitsChanged', () => client.call('accounts.limits', {}), (list) => {
      revision.current++;
      setViews(new Map(list.map((v) => [v.accountId, v])));
      setLoadError(undefined);
    }, (error) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, [client, attempt]);

  const refresh = useCallback(async (accountIds: string[], force = false) => {
    const ids = force ? accountIds : accountIds.filter((id) => !inFlight.current.has(id));
    if (!ids.length || client.status !== 'open') return;
    if (!force) for (const id of ids) inFlight.current.add(id);
    const before = revision.current;
    try {
      const list = await client.call('accounts.refreshLimits', { accountIds: ids, force });
      setRefreshError(undefined);
      if (revision.current === before) {
        revision.current++;
        setViews(new Map(list.map((v) => [v.accountId, v])));
      }
    } catch (error) {
      // A lost connection has its own notice.
      if (client.status === 'open') setRefreshError((error as Error).message);
    } finally {
      if (!force) for (const id of ids) inFlight.current.delete(id);
    }
  }, [client]);

  const watch = useCallback((accountIds: string[]) => {
    setInterest((previous) => {
      const next = new Map(previous);
      for (const id of accountIds) next.set(id, (next.get(id) ?? 0) + 1);
      return next;
    });
    return () => setInterest((previous) => {
      const next = new Map(previous);
      for (const id of accountIds) {
        const n = (next.get(id) ?? 0) - 1;
        if (n > 0) next.set(id, n); else next.delete(id);
      }
      return next;
    });
  }, []);

  const watched = useMemo(() => [...interest.keys()].sort(), [interest]);
  const watchedKey = watched.join('\n');
  const loaded = views !== undefined;
  const idleKey = watched.filter((id) => views?.get(id)?.status === 'idle').join('\n');

  // Ordinary pushed values use the existing schedule; a new sign-in is read immediately.
  useEffect(() => {
    if (!loaded || status !== 'open' || !watched.length) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      const at = Date.now();
      const stale = watched.filter((id) => needsRefresh(latest.current?.get(id), at));
      void refresh(stale);
    };
    tick();
    const timer = setInterval(tick, CHECK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // watchedKey stands for watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, status, watchedKey, idleKey, refresh]);

  // Check again just after the next shown reset instead of assuming the allowance returned.
  // Keep the target until its timer fires; the display clock crossing the reset
  // must not cancel the two-second confirmation check.
  const resetAt = useMemo(() => views ? nextReset(watched.map((id) => views.get(id)), Date.now()) : null, [views, watchedKey]);
  useEffect(() => {
    if (resetAt === null || status !== 'open') return;
    const delay = Math.min(resetAt - Date.now() + 2_000, 2 ** 31 - 1);
    const timer = setTimeout(() => {
      if (document.visibilityState !== 'visible') return;
      const at = Date.now();
      void refresh(watched.filter((id) => needsRefresh(latest.current?.get(id), at)));
    }, Math.max(delay, 0));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetAt, status, watchedKey, refresh]);

  const retryLoad = useCallback(() => setAttempt((n) => n + 1), []);
  const value = useMemo<LimitsState>(() => ({ views, loadError, retryLoad, refreshError, refresh, watch, status, now }),
    [views, loadError, retryLoad, refreshError, refresh, watch, status, now]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLimits(): LimitsState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useLimits outside LimitsProvider');
  return s;
}

/** Keeps these accounts' limits current while the calling component is mounted. */
export function useWatchLimits(accountIds: string[]) {
  const { watch } = useLimits();
  const key = [...new Set(accountIds)].sort().join('\n');
  useEffect(() => (key ? watch(key.split('\n')) : undefined), [key, watch]);
}

function useClock(ms: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') setNow(Date.now()); }, ms);
    const onVisible = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [ms]);
  return now;
}
