import type { LimitWindow, LimitsSnapshot } from './types.js';

/** An account is set aside once any general window has this much allowance left or less. */
export const SWITCH_AT_REMAINING_PERCENT = 5;

export type Candidate = { id: string; snapshot: LimitsSnapshot | null };

/**
 * GLOSSARY: Account in use. Among a house's signed-in accounts at one provider,
 * in the house's order, the one its next request should use:
 *
 * 1. Skip accounts with a general window at 5% or less that has not reset yet.
 * 2. Of the rest, prefer the account whose weekly or monthly allowance resets
 *    soonest, since what it has left is lost at that reset. Accounts whose
 *    limits are unknown come after those with a known reset.
 * 3. When every account is low, take the one that becomes available first.
 *
 * Ties keep the house's order. Null when there is no candidate.
 */
export function chooseAccount(candidates: Candidate[], now: number): string | null {
  let best: { id: string; rank: [number, number] } | null = null;
  for (const c of candidates) {
    const until = availableAt(c.snapshot, now);
    const rank: [number, number] = until === null ? [0, longReset(c.snapshot, now)] : [1, until];
    if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) best = { id: c.id, rank };
  }
  return best?.id ?? null;
}

/** When a low account becomes usable again; null when it is usable now. Infinity when no reset is known. */
function availableAt(snapshot: LimitsSnapshot | null, now: number): number | null {
  let at: number | null = null;
  for (const w of general(snapshot, now)) {
    if (w.usedPercent === null || 100 - w.usedPercent > SWITCH_AT_REMAINING_PERCENT) continue;
    at = Math.max(at ?? 0, w.resetsAt ? Date.parse(w.resetsAt) : Infinity);
  }
  return at;
}

/** The soonest weekly or monthly reset still ahead; Infinity when none is known. */
function longReset(snapshot: LimitsSnapshot | null, now: number): number {
  let at = Infinity;
  for (const w of general(snapshot, now)) if ((w.kind === 'weekly' || w.kind === 'monthly') && w.resetsAt) at = Math.min(at, Date.parse(w.resetsAt));
  return at;
}

/** General windows whose reset is still ahead; one that has passed has probably refilled. */
function general(snapshot: LimitsSnapshot | null, now: number): LimitWindow[] {
  return snapshot?.windows.filter((w) => w.scope === null && !(w.resetsAt && Date.parse(w.resetsAt) <= now)) ?? [];
}
