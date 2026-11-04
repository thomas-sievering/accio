import type { ThreadView } from '@accio/protocol';
import { deliveryStatus } from './status';

/**
 * Where a thread sits in the sidebar. The open list is the inbox: threads that
 * finished or need you. Threads in progress without you sit on Working below it.
 */
export type ThreadShelves = {
  /** Threads that came back to you, most recently returned first (as in T3 Code). */
  open: ThreadView[];
  /** A turn is running, or a delivery waits on GitHub with nothing for you to do. Most recently active first. */
  working: ThreadView[];
  /** Soonest to wake first. */
  snoozed: ThreadView[];
  /** Most recently settled first. */
  settled: ThreadView[];
};

export type ShelfPlace = 'open' | 'working' | 'snoozed' | 'settled';

function isSnoozed(t: ThreadView, now: Date): boolean {
  return t.snoozedUntil !== null && new Date(t.snoozedUntil) > now;
}

/**
 * A delivery that GitHub or the agent is carrying, so there is nothing for you to do:
 * checks running, a PR that merges itself, or verification on the target. A PR that waits
 * for a person's review or a manual merge comes back to you.
 */
export function deliveryInProgress(t: ThreadView): boolean {
  const d = t.delivery;
  const phase = deliveryStatus(t)?.phase;
  if (!d || !phase) return false;
  if (phase === 'queued' || phase === 'shipping' || phase === 'integrated') return true;
  if (phase !== 'waiting') return false;
  const on = d.status === 'ready' ? 'merge' : d.waitingOn ?? 'checks';
  if (on === 'review') return false;
  if (on === 'merge') return d.mode === 'ship' && d.policy === 'pull-request' && !d.followUpsStoppedAt;
  return true;
}

/**
 * Settled wins over snoozed, snoozed over working; a snooze that has passed puts the thread
 * back in the open list. A running turn waiting for a secret needs you, so it is open.
 */
export function placeOf(t: ThreadView, now: Date): ShelfPlace {
  if (t.settledAt) return 'settled';
  if (isSnoozed(t, now)) return 'snoozed';
  if (t.needsSecret) return 'open';
  if (t.status === 'running' || deliveryInProgress(t)) return 'working';
  return 'open';
}

/**
 * How long a thread that stopped working stays on Working: a goal, queued message or
 * delivery follow-up can start the next turn moments after one ends (T3 Code waits as long).
 */
export const WORKING_GRACE_MS = 2_000;

/** Placement as one client observed it over time, so the list can hold and order returns. */
export type Placement = {
  place: (t: ThreadView) => ShelfPlace;
  /** When this client saw the thread come back to the open list, in ms. */
  returnedAt: (id: string) => number | undefined;
  /** The next moment a held thread leaves Working, if any. */
  nextDeadline?: number;
};

/** Only a plain finish is held; a failure, interruption or delivery problem comes back at once. */
function quietlyDone(t: ThreadView): boolean {
  if (t.status !== 'idle' || t.needsSecret) return false;
  const phase = deliveryStatus(t)?.phase;
  return phase !== 'attention' && phase !== 'closed' && phase !== 'unavailable';
}

/**
 * Observes every thread on each change. A thread that stops working stays on Working for
 * WORKING_GRACE_MS unless it needs you; a thread that arrives in the open list from
 * Working, Snoozed or Settled counts as returned then. The first observation records no returns.
 */
export function createPlacementTracker() {
  const states = new Map<string, { place: ShelfPlace; deadline: number | null }>();
  const returns = new Map<string, number>();
  return function observe(threads: readonly ThreadView[], at: number): Placement {
    const now = new Date(at);
    const places = new Map<string, ShelfPlace>();
    const present = new Set<string>();
    let nextDeadline: number | undefined;
    for (const t of threads) {
      present.add(t.id);
      const actual = placeOf(t, now);
      const previous = states.get(t.id);
      const deadline = actual === 'open' && previous?.place === 'working' && quietlyDone(t) ? (previous.deadline ?? at + WORKING_GRACE_MS) : null;
      const held = deadline !== null && deadline > at;
      const place = held ? 'working' : actual;
      if (place === 'open' && previous && previous.place !== 'open') returns.set(t.id, at);
      states.set(t.id, { place, deadline: held ? deadline : null });
      places.set(t.id, place);
      if (held) nextDeadline = Math.min(nextDeadline ?? Infinity, deadline);
    }
    for (const id of states.keys()) if (!present.has(id)) { states.delete(id); returns.delete(id); }
    const seen = new Map(returns);
    return { place: (t) => places.get(t.id) ?? placeOf(t, now), returnedAt: (id) => seen.get(id), nextDeadline };
  };
}

export function shelveThreads(threads: ThreadView[], now: Date, placement?: Placement): ThreadShelves {
  const shelves: ThreadShelves = { open: [], working: [], snoozed: [], settled: [] };
  for (const t of threads) shelves[placement?.place(t) ?? placeOf(t, now)].push(t);
  const returned = (t: ThreadView) => Math.max(Date.parse(t.updatedAt), placement?.returnedAt(t.id) ?? 0);
  shelves.open.sort((a, b) => returned(b) - returned(a));
  shelves.working.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  shelves.snoozed.sort((a, b) => a.snoozedUntil!.localeCompare(b.snoozedUntil!));
  shelves.settled.sort((a, b) => b.settledAt!.localeCompare(a.settledAt!));
  return shelves;
}

/** The threads the sidebar lists: those of the given projects whose title matches the search. */
export function filterThreads(threads: ThreadView[], projectIds: ReadonlySet<string>, query: string): ThreadView[] {
  const q = query.trim().toLowerCase();
  return threads.filter((t) => projectIds.has(t.projectId) && (!q || t.title.toLowerCase().includes(q)));
}

/** Next 9:00 that is at least an hour away: "snooze until tomorrow morning". */
export function nextMorning(now: Date): Date {
  const d = new Date(now);
  d.setHours(9, 0, 0, 0);
  if (d.getTime() - now.getTime() < 3_600_000) d.setDate(d.getDate() + 1);
  return d;
}

/** "tomorrow 09:00", "Thu 09:00", or just the time when it is later today. */
export function wakeText(when: Date, now: Date): string {
  const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (when.toDateString() === now.toDateString()) return time;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return `${when.toDateString() === tomorrow.toDateString() ? 'tomorrow' : when.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}
