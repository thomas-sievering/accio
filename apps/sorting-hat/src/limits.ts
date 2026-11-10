import type { AccountLimitsView, AccountView, LimitsProblem, LimitWindow } from './types.js';

export class LimitsReadError extends Error {
  constructor(readonly code: LimitsProblem['code'], message: string, readonly retryAfterMs?: number) { super(message); }
}
export type LimitsRead = { windows: LimitWindow[]; unsupported?: false } | { unsupported: true; windows?: never };
type Entry = { view: AccountLimitsView; failures: number; controller?: AbortController; pending?: Promise<void> };
const FRESH_MS = 60_000;
const COOLDOWN_MS = 5_000;

/** Coalesces account reads across houses and callers. */
export class AccountLimits {
  private entries = new Map<string, Entry>();
  private pending = new Set<Promise<void>>();
  private closed = false;
  private reading = 0;
  private waiters = new Set<() => void>();

  constructor(
    private accounts: () => AccountView[],
    private read: (id: string, signal: AbortSignal) => Promise<LimitsRead>,
    private now = Date.now,
  ) {}

  views(): AccountLimitsView[] {
    return this.accounts().map((a) => structuredClone(this.entry(a).view));
  }

  /** The account's last known allowance, without copying every view. */
  snapshot(id: string) {
    return this.entries.get(id)?.view.snapshot ?? null;
  }

  /** Called only when credential ownership changes, not on ordinary token refresh. */
  invalidate(id: string) {
    this.entries.get(id)?.controller?.abort();
    this.entries.delete(id);
  }

  async refresh(ids: string[], force = false): Promise<AccountLimitsView[]> {
    const remaining = [...new Set(ids)];
    // A busy client cannot spawn an unbounded number of provider processes/requests.
    await Promise.all(Array.from({ length: Math.min(4, remaining.length) }, async () => {
      for (let id; (id = remaining.shift()) !== undefined;) await this.refreshOne(id, force);
    }));
    return this.views();
  }

  private entry(account: AccountView): Entry {
    let e = this.entries.get(account.id);
    if (!e) {
      e = { failures: 0, view: {
        accountId: account.id, providerId: account.providerId,
        status: account.signedIn ? 'idle' : 'signedOut', snapshot: null,
        attemptedAt: null, retryAt: null, problem: null,
      } };
      this.entries.set(account.id, e);
    }
    return e;
  }

  private async refreshOne(id: string, force: boolean) {
    const account = this.accounts().find((a) => a.id === id);
    if (this.closed || !account?.signedIn) return;
    const entry = this.entry(account);
    if (entry.pending) return entry.pending;
    const { view } = entry;
    const now = this.now();
    if (view.attemptedAt && now - Date.parse(view.attemptedAt) < COOLDOWN_MS) return;
    if (view.retryAt && Date.parse(view.retryAt) > now) return;
    const snapshot = view.snapshot;
    const resetPassed = snapshot?.windows.some((w) => w.resetsAt && Date.parse(w.resetsAt) > Date.parse(snapshot.observedAt) && Date.parse(w.resetsAt) <= now);
    if (!force && snapshot && now - Date.parse(snapshot.observedAt) < FRESH_MS && !resetPassed) return;
    if (!force && view.status === 'unsupported' && view.attemptedAt && now - Date.parse(view.attemptedAt) < FRESH_MS) return;
    const controller = new AbortController();
    entry.controller = controller;
    entry.view = { ...view, status: 'refreshing', attemptedAt: new Date(now).toISOString(), retryAt: null, problem: null };
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    const run = Promise.resolve().then(async () => {
      try {
        const result = await this.readWithSlot(id, signal);
        signal.throwIfAborted();
        if (!this.current(id, entry)) return;
        entry.failures = 0;
        entry.view = { ...entry.view, status: result.unsupported ? 'unsupported' : 'ready',
          snapshot: result.unsupported ? null : { observedAt: new Date(this.now()).toISOString(), windows: result.windows },
        };
      } catch (error) {
        if (!this.current(id, entry)) return;
        entry.failures++;
        const problem: LimitsProblem = error instanceof LimitsReadError
          ? { code: error.code, message: error.message }
          : { code: 'unavailable', message: 'The Sorting Hat could not read this account’s limits. Try again.' };
        const delay = error instanceof LimitsReadError && error.retryAfterMs !== undefined ? error.retryAfterMs : Math.min(15 * 60_000, 30_000 * 2 ** Math.min(entry.failures - 1, 5));
        entry.view = { ...entry.view, status: 'error', problem, retryAt: new Date(this.now() + Math.max(COOLDOWN_MS, delay)).toISOString() };
      } finally {
        if (this.current(id, entry)) { entry.pending = undefined; entry.controller = undefined; }
      }
    });
    entry.pending = run;
    this.pending.add(run);
    try { await run; } finally { this.pending.delete(run); }
  }

  /** Bound total upstream work even when several clients refresh different accounts. */
  private async readWithSlot(id: string, signal: AbortSignal): Promise<LimitsRead> {
    while (this.reading >= 4) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { this.waiters.delete(wake); signal.removeEventListener('abort', abort); };
        const wake = () => { cleanup(); resolve(); };
        const abort = () => { cleanup(); reject(signal.reason); };
        this.waiters.add(wake);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    signal.throwIfAborted();
    this.reading++;
    try { return await this.read(id, signal); }
    finally { this.reading--; for (const wake of [...this.waiters]) wake(); }
  }

  private current(id: string, entry: Entry) { return !this.closed && this.entries.get(id) === entry; }

  async close() {
    this.closed = true;
    for (const entry of this.entries.values()) entry.controller?.abort();
    await Promise.allSettled(this.pending);
  }
}
