import type { ThreadView } from '@accio/protocol';

/**
 * Snooze and settle marks, kept per thread. For now the client keeps them
 * (visual pass only); they move to the server once threads carry them.
 */
export type ShelfMark = { snoozedUntil?: string; settledAt?: string };
export type ShelfMarks = Record<string, ShelfMark>;

/** Where a thread sits in the sidebar: under its project, or on a shelf at the bottom. */
export type ThreadShelves = {
  /** Open threads by project id, newest first. */
  open: Map<string, ThreadView[]>;
  /** Threads with a running turn. */
  working: ThreadView[];
  /** Soonest to wake first. */
  snoozed: ThreadView[];
  /** Most recently settled first. */
  settled: ThreadView[];
};

export function isSnoozed(mark: ShelfMark | undefined, now: Date): boolean {
  return mark?.snoozedUntil !== undefined && new Date(mark.snoozedUntil) > now;
}

/**
 * Settled wins over everything, then snoozed, then a running turn puts the
 * thread on the Working shelf. Everything else stays open under its project.
 */
export function shelveThreads(threads: ThreadView[], marks: ShelfMarks, now: Date): ThreadShelves {
  const shelves: ThreadShelves = { open: new Map(), working: [], snoozed: [], settled: [] };
  for (const t of [...threads].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const mark = marks[t.id];
    if (mark?.settledAt) shelves.settled.push(t);
    else if (isSnoozed(mark, now)) shelves.snoozed.push(t);
    else if (t.status === 'running') shelves.working.push(t);
    else shelves.open.set(t.projectId, [...(shelves.open.get(t.projectId) ?? []), t]);
  }
  shelves.snoozed.sort((a, b) => marks[a.id]!.snoozedUntil!.localeCompare(marks[b.id]!.snoozedUntil!));
  shelves.settled.sort((a, b) => marks[b.id]!.settledAt!.localeCompare(marks[a.id]!.settledAt!));
  return shelves;
}

/** Next 9:00 that is at least an hour away: "snooze until tomorrow morning". */
export function nextMorning(now: Date): Date {
  const d = new Date(now);
  d.setHours(9, 0, 0, 0);
  if (d.getTime() - now.getTime() < 3_600_000) d.setDate(d.getDate() + 1);
  return d;
}
