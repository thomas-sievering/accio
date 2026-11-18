import { deliveryPhase, threadPlace, type ThreadPlace, type ThreadView } from '@accio/protocol';

/**
 * Where a thread sits in the sidebar. The open list is the inbox: threads that
 * finished or need you. Threads in progress without you sit on Working below it.
 */
export type ThreadShelves = {
  /** Threads that came back to you, most recently returned first (as in T3 Code). */
  open: ThreadView[];
  /** A turn is running, or a delivery waits on GitHub with nothing for you to do. Most recently active first. */
  working: ThreadView[];
  /** Another machine's threads while it is offline, by machine, most recently active first within each. */
  offline: ThreadView[];
  /** Soonest to wake first. */
  snoozed: ThreadView[];
  /** Most recently settled first. */
  settled: ThreadView[];
};

/**
 * How long a thread that stopped working stays on Working: a goal, queued message or
 * delivery follow-up can start the next turn moments after one ends (T3 Code waits as long).
 */
export const WORKING_GRACE_MS = 2_000;

/**
 * How long a thread stays where it was after its machine goes offline or comes back, so a short
 * drop or a brief return doesn't move rows back and forth. A dropped machine reconnects within
 * a few seconds; a dark wake doesn't show the machine online at all.
 */
export const OFFLINE_GRACE_MS = 10_000;

/** Placement as one client observed it over time, so the list can hold and order returns. */
export type Placement = {
  place: (t: ThreadView) => ThreadPlace;
  /** When this client saw the thread come back to the open list, in ms. */
  returnedAt: (id: string) => number | undefined;
  /** The next moment a held thread moves to the place it belongs in, if any. */
  nextDeadline?: number;
};

/** Only a plain finish is held; a failure, interruption or delivery problem comes back at once. */
function quietlyDone(t: ThreadView): boolean {
  if (t.status !== 'idle' || t.needsSecret) return false;
  const phase = deliveryPhase(t);
  return phase !== 'attention' && phase !== 'closed' && phase !== 'unavailable';
}

const inPlay = (p: ThreadPlace) => p === 'open' || p === 'working';

/** How long a thread stays in `from` on its way to `to`; 0 moves it at once. */
function grace(from: ThreadPlace, to: ThreadPlace, t: ThreadView): number {
  if (from === 'working' && to === 'open' && quietlyDone(t)) return WORKING_GRACE_MS;
  if ((from === 'offline' && inPlay(to)) || (inPlay(from) && to === 'offline')) return OFFLINE_GRACE_MS;
  return 0;
}

/**
 * Observes every thread on each change. A thread that stops working stays on Working for
 * WORKING_GRACE_MS unless it needs you; a thread whose machine goes offline or comes back stays
 * where it was for OFFLINE_GRACE_MS. A thread that arrives in the inbox from another place
 * counts as returned then. The first observation records no returns.
 */
export function createPlacementTracker() {
  const states = new Map<string, { place: ThreadPlace; hold: { toward: ThreadPlace; deadline: number } | null }>();
  const returns = new Map<string, number>();
  return function observe(threads: readonly ThreadView[], at: number): Placement {
    const now = new Date(at);
    const places = new Map<string, ThreadPlace>();
    const present = new Set<string>();
    let nextDeadline: number | undefined;
    for (const t of threads) {
      present.add(t.id);
      const actual = threadPlace(t, now);
      const previous = states.get(t.id);
      const wait = previous && previous.place !== actual ? grace(previous.place, actual, t) : 0;
      // A hold keeps its deadline while the thread still heads to the same place.
      const deadline = wait ? (previous!.hold?.toward === actual ? previous!.hold.deadline : at + wait) : null;
      const held = deadline !== null && deadline > at;
      const place = held ? previous!.place : actual;
      if (place === 'open' && previous && previous.place !== 'open') returns.set(t.id, at);
      states.set(t.id, { place, hold: held ? { toward: actual, deadline } : null });
      places.set(t.id, place);
      if (held) nextDeadline = Math.min(nextDeadline ?? Infinity, deadline);
    }
    for (const id of states.keys()) if (!present.has(id)) { states.delete(id); returns.delete(id); }
    const seen = new Map(returns);
    return { place: (t) => places.get(t.id) ?? threadPlace(t, now), returnedAt: (id) => seen.get(id), nextDeadline };
  };
}

export function shelveThreads(threads: ThreadView[], now: Date, placement?: Placement): ThreadShelves {
  const shelves: ThreadShelves = { open: [], working: [], offline: [], snoozed: [], settled: [] };
  for (const t of threads) shelves[placement?.place(t) ?? threadPlace(t, now)].push(t);
  const returned = (t: ThreadView) => Math.max(Date.parse(t.updatedAt), placement?.returnedAt(t.id) ?? 0);
  shelves.open.sort((a, b) => returned(b) - returned(a));
  shelves.working.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  shelves.offline.sort((a, b) => a.machine!.name.localeCompare(b.machine!.name) || a.machine!.id.localeCompare(b.machine!.id) || b.updatedAt.localeCompare(a.updatedAt));
  shelves.snoozed.sort((a, b) => a.snoozedUntil!.localeCompare(b.snoozedUntil!));
  shelves.settled.sort((a, b) => b.settledAt!.localeCompare(a.settledAt!));
  return shelves;
}

/** The machines on the Offline shelf, each with how many of its threads are there, in shelf order. */
export function offlineMachines(offline: readonly ThreadView[]): { id: string; name: string; count: number }[] {
  const machines = new Map<string, { id: string; name: string; count: number }>();
  for (const { machine } of offline) {
    if (!machine) continue;
    const m = machines.get(machine.id) ?? { id: machine.id, name: machine.name, count: 0 };
    m.count++;
    machines.set(machine.id, m);
  }
  return [...machines.values()];
}

/** What the main pane shows after Move on: a thread, or the empty page. */
export type NextSelection = { kind: 'thread'; id: string } | { kind: 'empty' };

/**
 * GLOSSARY: Move on. After a send that starts a turn, the top of the inbox other than the thread
 * just sent (it can still sit there until its turn shows as Working), else the empty page.
 */
export function nextAfterSend(inbox: readonly Pick<ThreadView, 'id'>[], sentId: string): NextSelection {
  const next = inbox.find((t) => t.id !== sentId);
  return next ? { kind: 'thread', id: next.id } : { kind: 'empty' };
}

/** What the sidebar is narrowed to: one project, or every project of the selected profile. */
export type ThreadScope = {
  /** The one project the sidebar shows, or '' for all. */
  project: string;
  /** The selected profile, or 'all'. */
  profileId: string;
  /** This machine's projects, each with the profile it belongs to. */
  projects: readonly { id: string; profileId: string }[];
};

/**
 * The threads the sidebar lists: those in scope whose title matches the search. A thread whose
 * project this machine doesn't have, such as another machine's thread in a repository with no
 * checkout here, or a No project thread, is placed by its own profile.
 */
export function filterThreads(threads: ThreadView[], scope: ThreadScope, query: string): ThreadView[] {
  const q = query.trim().toLowerCase();
  const owners = new Map(scope.projects.map((p) => [p.id, p.profileId]));
  const inScope = (t: ThreadView) => scope.project
    ? t.projectId === scope.project
    : scope.profileId === 'all' || (owners.get(t.projectId) ?? t.profileId) === scope.profileId;
  return threads.filter((t) => inScope(t) && (!q || t.title.toLowerCase().includes(q)));
}

/** Another machine's thread while that machine is offline: it can only be snoozed until it is back. */
export function awaitsMachine(t: Pick<ThreadView, 'machine'>): boolean {
  return !!t.machine && !t.machine.online;
}

/** Next 9:00 that is at least an hour away: "snooze until tomorrow morning". */
export function nextMorning(now: Date): Date {
  const d = new Date(now);
  d.setHours(9, 0, 0, 0);
  if (d.getTime() - now.getTime() < 3_600_000) d.setDate(d.getDate() + 1);
  return d;
}
