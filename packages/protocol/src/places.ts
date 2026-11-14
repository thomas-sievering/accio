import type { ThreadDelivery, ThreadView } from './threads.js';

/** Where a delivery stands, as both apps read it. */
export type DeliveryPhase =
  /** Requested while the agent works; starts when the turn ends. */
  | 'queued'
  /** Requested, but the turn that would carry it was interrupted or failed. */
  | 'paused'
  /** The delivery agent turn is running. */
  | 'shipping'
  /** Published; the machine observes checks, review or merge without an agent. */
  | 'waiting'
  /** The host or remote has the change; verification on the target is pending. */
  | 'integrated'
  /** The PR was closed without merging. */
  | 'closed'
  /** Blocked and needs a person. */
  | 'attention'
  /** Observation failed; the last known phase is `observedPhase`. */
  | 'unavailable'
  /** Verified on the target. */
  | 'delivered'
  /** Newer user work replaced this attempt; a fresh Ship is needed. */
  | 'superseded';

/** Newer user work than the delivery carries, while it is not queued or running. */
export function deliverySuperseded(t: Pick<ThreadView, 'workVersion' | 'delivery'>): boolean {
  const d = t.delivery;
  return !!d && (t.workVersion ?? 0) > (d.workVersion ?? t.workVersion ?? 0) && d.status !== 'queued' && d.status !== 'running';
}

/** What a waiting delivery waits on; a ready one waits for its merge. */
export function deliveryWaitsOn(d: ThreadDelivery): NonNullable<ThreadDelivery['waitingOn']> {
  return d.status === 'ready' ? 'merge' : d.waitingOn ?? 'checks';
}

/** What the last observation of a published, ready or blocked delivery established. */
export function observedPhase(d: ThreadDelivery): 'closed' | 'attention' | 'integrated' | 'waiting' {
  if (d.pullRequest?.state === 'closed') return 'closed';
  // A real blocker wins over a known merge.
  if (d.status === 'blocked') return 'attention';
  if (d.pullRequest?.state === 'merged' || d.integratedAt) return 'integrated';
  return 'waiting';
}

/** The thread's delivery phase, or undefined when nothing was requested. */
export function deliveryPhase(t: Pick<ThreadView, 'status' | 'workVersion' | 'delivery'>): DeliveryPhase | undefined {
  const d = t.delivery;
  if (!d) return undefined;
  if (deliverySuperseded(t)) return 'superseded';
  if (d.status === 'delivered') return 'delivered';
  if (d.status === 'queued') return t.status === 'interrupted' || t.status === 'failed' ? 'paused' : 'queued';
  if (d.status === 'running') return 'shipping';
  if (d.observationError) return 'unavailable';
  return observedPhase(d);
}

/**
 * A delivery that GitHub or the agent is carrying, so there is nothing for you to do:
 * checks running, a PR that merges itself, or verification on the target. A PR that waits
 * for a person's review or a manual merge comes back to you.
 */
export function deliveryInProgress(t: Pick<ThreadView, 'status' | 'workVersion' | 'delivery'>): boolean {
  const d = t.delivery;
  const phase = deliveryPhase(t);
  if (!d || !phase) return false;
  if (phase === 'queued' || phase === 'shipping' || phase === 'integrated') return true;
  if (phase !== 'waiting') return false;
  const on = deliveryWaitsOn(d);
  if (on === 'review') return false;
  if (on === 'merge') return d.mode === 'ship' && d.policy === 'pull-request' && !d.followUpsStoppedAt;
  return true;
}

/**
 * Where a thread sits for the user. Open is the inbox: threads that finished or need you.
 * Working holds threads in progress without you.
 */
export type ThreadPlace = 'open' | 'working' | 'snoozed' | 'settled';

/**
 * Settled wins over snoozed, snoozed over working; a snooze that has passed puts the thread
 * back in the open list. A running turn waiting for a secret needs you, so it is open; a
 * delivery in progress keeps the thread on Working.
 */
export function threadPlace(t: ThreadView, now: Date): ThreadPlace {
  if (t.settledAt) return 'settled';
  if (t.snoozedUntil !== null && new Date(t.snoozedUntil) > now) return 'snoozed';
  if (t.needsSecret) return 'open';
  if (t.status === 'running' || deliveryInProgress(t)) return 'working';
  return 'open';
}
