import { describe, expect, it, vi } from 'vitest';
import type { AccountView, LimitWindow } from './types.js';
import { AccountLimits, LimitsReadError, type LimitsRead } from './limits.js';

const account = (id = 'shared', signedIn = true): AccountView => ({ id, name: id, providerId: 'anthropic', signedIn, email: 'same@example.com', organization: null });
const window = (usedPercent = 40, resetsAt: string | null = null): LimitWindow => ({ id: 'weekly', label: 'Weekly', kind: 'weekly', scope: null, usedPercent, resetsAt, durationMinutes: 10080 });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }

describe('hub account limits', () => {
  it('does no upstream work for cache reads or signed-out accounts', async () => {
    const read = vi.fn();
    const limits = new AccountLimits(() => [account(), account('out', false)], read);
    expect(limits.views().map((v) => v.status)).toEqual(['idle', 'signedOut']);
    await limits.refresh(['out']);
    expect(read).not.toHaveBeenCalled();
    expect(limits.views()[1]?.snapshot).toBeNull();
    await limits.close();
  });

  it('coalesces concurrent client/profile requests and caches each named account independently', async () => {
    let now = Date.parse('2026-11-03T12:00:00Z');
    const gate = deferred<LimitsRead>();
    const read = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue({ windows: [window(25)] });
    // Same email is not proof that two provider/workspace accounts share a quota.
    const limits = new AccountLimits(() => [account(), account('other')], read, () => now);
    const a = limits.refresh(['shared', 'shared']);
    const b = limits.refresh(['shared']);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(limits.views()[0]?.status).toBe('refreshing');
    gate.resolve({ windows: [window()] });
    await Promise.all([a, b]);
    await limits.refresh(['shared', 'other']);
    expect(read).toHaveBeenCalledTimes(2);
    expect(limits.views().map((v) => v.snapshot?.windows[0]?.usedPercent)).toEqual([40, 25]);
    const copy = limits.views();
    copy[0]!.snapshot!.windows[0]!.usedPercent = 99;
    expect(limits.views()[0]?.snapshot?.windows[0]?.usedPercent).toBe(40);
    now += 60_001;
    await limits.refresh(['shared']);
    expect(read).toHaveBeenCalledTimes(3);
    await limits.close();
  });

  it('preserves the successful observation on failure and gives a usable retry deadline', async () => {
    let now = Date.parse('2026-11-03T12:00:00Z');
    const read = vi.fn().mockResolvedValueOnce({ windows: [window()] }).mockRejectedValueOnce(new Error('private bearer token'))
      .mockResolvedValue({ windows: [window(60)] });
    const limits = new AccountLimits(() => [account()], read, () => now);
    await limits.refresh(['shared']);
    const observed = limits.views()[0]!.snapshot!.observedAt;
    now += 60_000;
    await limits.refresh(['shared']);
    const failed = limits.views()[0]!;
    expect(failed).toMatchObject({ status: 'error', snapshot: { observedAt: observed }, attemptedAt: new Date(now).toISOString() });
    expect(failed.retryAt).toBe(new Date(now + 30_000).toISOString());
    expect(JSON.stringify(failed)).not.toContain('private');
    now += 6_000;
    await limits.refresh(['shared'], true);
    expect(read).toHaveBeenCalledTimes(2);
    now += 24_001;
    await limits.refresh(['shared'], true);
    expect(limits.views()[0]).toMatchObject({ status: 'ready', problem: null, retryAt: null, snapshot: { windows: [window(60)] } });
    await limits.close();
  });

  it.each(['rateLimited', 'unavailable'] as const)('honours Retry-After for %s even on explicit refresh', async (code) => {
    let now = Date.parse('2026-11-03T12:00:00Z');
    const read = vi.fn().mockRejectedValueOnce(new LimitsReadError(code, 'Wait before retrying.', 120_000)).mockResolvedValue({ windows: [] });
    const limits = new AccountLimits(() => [account()], read, () => now);
    await limits.refresh(['shared']);
    now += 60_000;
    await limits.refresh(['shared'], true);
    expect(read).toHaveBeenCalledTimes(1);
    now += 60_001;
    await limits.refresh(['shared'], true);
    expect(read).toHaveBeenCalledTimes(2);
    await limits.close();
  });

  it('keeps unsupported, empty and unknown allowances distinct', async () => {
    const unknown = { ...window(), usedPercent: null };
    const read = vi.fn().mockResolvedValueOnce({ unsupported: true }).mockResolvedValueOnce({ windows: [] }).mockResolvedValueOnce({ windows: [unknown] });
    const limits = new AccountLimits(() => [account('a'), account('b'), account('c')], read);
    await limits.refresh(['a', 'b', 'c']);
    expect(limits.views()).toMatchObject([
      { status: 'unsupported', snapshot: null }, { status: 'ready', snapshot: { windows: [] } },
      { status: 'ready', snapshot: { windows: [{ usedPercent: null }] } },
    ]);
    await limits.refresh(['a']);
    expect(read).toHaveBeenCalledTimes(3);
    await limits.close();
  });

  it('rechecks a passed reset without manufacturing a full allowance', async () => {
    let now = Date.parse('2026-11-03T12:00:00Z');
    const reset = new Date(now + 10_000).toISOString();
    const read = vi.fn().mockResolvedValue({ windows: [window(100, reset)] });
    const limits = new AccountLimits(() => [account()], read, () => now);
    await limits.refresh(['shared']);
    now += 10_001;
    await limits.refresh(['shared']);
    expect(read).toHaveBeenCalledTimes(2);
    expect(limits.views()[0]?.snapshot?.windows[0]?.usedPercent).toBe(100);
    await limits.close();
  });

  it('discards a late response after sign-out or deletion', async () => {
    let accounts = [account()];
    const gate = deferred<LimitsRead>();
    let signal!: AbortSignal;
    const limits = new AccountLimits(() => accounts, async (_id, s) => { signal = s; return gate.promise; });
    const reading = limits.refresh(['shared']);
    await vi.waitFor(() => expect(signal).toBeDefined());
    accounts = [account('shared', false)];
    limits.invalidate('shared');
    expect(signal.aborted).toBe(true);
    expect(limits.views()[0]).toMatchObject({ status: 'signedOut', snapshot: null });
    accounts = [];
    limits.invalidate('shared');
    gate.resolve({ windows: [window()] });
    await reading;
    expect(limits.views()).toEqual([]);
    await limits.close();
  });

  it('does not coalesce with or publish a response from a previous sign-in', async () => {
    const old = deferred<LimitsRead>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue({ windows: [window(12)] });
    const limits = new AccountLimits(() => [account()], read);
    const first = limits.refresh(['shared']);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    limits.invalidate('shared');
    await limits.refresh(['shared']);
    old.resolve({ windows: [window(99)] });
    await first;
    expect(limits.views()[0]?.snapshot?.windows[0]?.usedPercent).toBe(12);
    await limits.close();
  });

  it('bounds upstream concurrency across different clients, not just within a request', async () => {
    const accounts = Array.from({ length: 8 }, (_, i) => account(String(i)));
    const gates: ReturnType<typeof deferred<LimitsRead>>[] = [];
    let active = 0, peak = 0;
    const limits = new AccountLimits(() => accounts, async () => {
      active++; peak = Math.max(active, peak);
      const gate = deferred<LimitsRead>(); gates.push(gate);
      try { return await gate.promise; } finally { active--; }
    });
    const a = limits.refresh(['0', '1', '2', '3']);
    const b = limits.refresh(['4', '5', '6', '7']);
    await vi.waitFor(() => expect(gates).toHaveLength(4));
    for (const gate of gates) gate.resolve({ windows: [] });
    await vi.waitFor(() => expect(gates).toHaveLength(8));
    for (const gate of gates.slice(4)) gate.resolve({ windows: [] });
    await Promise.all([a, b]);
    expect(peak).toBe(4);
    await limits.close();
  });

  it('cancels active and queued reads on shutdown', async () => {
    const accounts = Array.from({ length: 6 }, (_, i) => account(String(i)));
    const signals: AbortSignal[] = [];
    const limits = new AccountLimits(() => accounts, (_id, signal) => new Promise((_resolve, reject) => {
      signals.push(signal);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const reading = limits.refresh(accounts.map((a) => a.id));
    await vi.waitFor(() => expect(signals).toHaveLength(4));
    await limits.close();
    await reading;
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
});
