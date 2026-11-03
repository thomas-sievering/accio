import type { ThreadView } from '@accio/protocol';

/** Where a thread sits in the sidebar: in the one open list, or on a shelf below it. */
export type ThreadShelves = {
  /** Open threads of every project in one list, most recently active first (as in T3 Code). */
  open: ThreadView[];
  /** Threads with a running turn, most recently active first. */
  working: ThreadView[];
  /** Soonest to wake first. */
  snoozed: ThreadView[];
  /** Most recently settled first. */
  settled: ThreadView[];
};

export type ShelfPlace = 'open' | 'working' | 'snoozed' | 'settled';

export function isSnoozed(t: ThreadView, now: Date): boolean {
  return t.snoozedUntil !== null && new Date(t.snoozedUntil) > now;
}

/** Settled wins over snoozed, snoozed over working; a snooze that has passed puts the thread back in the open list. */
export function placeOf(t: ThreadView, now: Date): ShelfPlace {
  if (t.settledAt) return 'settled';
  if (isSnoozed(t, now)) return 'snoozed';
  if (t.status === 'running') return 'working';
  return 'open';
}

export function shelveThreads(threads: ThreadView[], now: Date): ThreadShelves {
  const shelves: ThreadShelves = { open: [], working: [], snoozed: [], settled: [] };
  for (const t of threads) shelves[placeOf(t, now)].push(t);
  shelves.open.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
