import type { ThreadDelivery, ThreadView } from '@accio/protocol';
import { ciSummary } from './DeliveryProgress';

/**
 * One reading of a thread's turn and delivery, shared by the sidebar row and the
 * delivery row above the composer so both always say the same thing.
 *
 * Turn activity and delivery are independent facts: waiting on GitHub never
 * reads as Working, and only a running turn gets the spinner.
 */

/** The colour family a status uses; text always carries the meaning on its own. */
export type StatusTone = 'working' | 'ready' | 'waiting' | 'attention' | 'unavailable' | 'delivered' | 'interrupted' | 'failed' | 'secret';
/** The mark beside the status: a spinner for running turns only, otherwise a static glyph or dot. */
export type StatusGlyph = 'spinner' | 'dot' | 'pr' | 'merge' | 'ship' | 'push' | 'alert';

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
  /** Blocked and needs a person; `detail` says why. */
  | 'attention'
  /** Observation failed; the last known fact is kept in `detail`. */
  | 'unavailable'
  /** Verified on the target. */
  | 'delivered'
  /** Newer user work replaced this attempt; a fresh Ship is needed. */
  | 'superseded';

export type DeliveryStatus = {
  phase: DeliveryPhase;
  /** Readable status without the PR number, e.g. "Waiting for merge". */
  label: string;
  tone: StatusTone;
  glyph: StatusGlyph;
  /** Short text for one-line rows such as Settled, e.g. "Merged #123" or "main". */
  badge: string;
  target: string;
  pullRequest?: { number: number; url: string };
  /** Seven-character published or merge revision. */
  revision?: string;
  /** Supporting sentence for the delivery row. */
  detail?: string;
  checkedAt?: string;
  /** A PR exists or the target has the change, so cancelling no longer removes intent. */
  published: boolean;
  followUpsStopped: boolean;
  /** Cancel removes the unpublished request entirely. */
  canCancel: boolean;
  /** Stop agent continuations while keeping the PR link and passive observation. */
  canStopFollowUps: boolean;
  /** Observing again can change what is known: a pending wait, a published change, or a failed observation. */
  canCheck: boolean;
  /** Live CI jobs and steps while checks are the open question; never kept once the outcome is known. */
  ci?: ThreadDelivery['ci'];
  /** A fresh Ship/Prepare for review is the way forward. */
  canShip: boolean;
};

export type ThreadStatusView = {
  label: string;
  tone: StatusTone;
  glyph: StatusGlyph;
  /** False for a plain running turn, whose spinner already says Working. */
  showLabel: boolean;
  /** Present while the delivery still describes the current work. */
  delivery?: DeliveryStatus;
};

const short = (revision?: string) => revision?.slice(0, 7);

/** Structured PR identity, or the number parsed from a legacy URL. */
function pullRequestOf(d: ThreadDelivery): { number: number; url: string } | undefined {
  if (d.pullRequest) return { number: d.pullRequest.number, url: d.pullRequest.url };
  const match = d.pullRequestUrl?.match(/\/pull\/(\d+)(?:[/?#]|$)/);
  return match && d.pullRequestUrl ? { number: Number(match[1]), url: d.pullRequestUrl } : undefined;
}

/** The delivery as the composer row presents it, or undefined when nothing was requested. */
export function deliveryStatus(t: ThreadView): DeliveryStatus | undefined {
  const d = t.delivery;
  if (!d) return undefined;
  const pr = pullRequestOf(d);
  const target = d.pullRequest?.baseBranch ?? d.baseBranch;
  const revision = short(d.publishedRevision ?? d.pullRequest?.mergeRevision);
  const stopped = !!d.followUpsStoppedAt;
  const review = d.mode === 'review';
  const superseded = (t.workVersion ?? 0) > (d.workVersion ?? t.workVersion ?? 0) && d.status !== 'queued' && d.status !== 'running';
  // Matches the server: after a PR or integration exists, cancelling only stops follow-ups.
  const published = !!(pr || d.integratedAt || d.publishedRevision);
  const prSuffix = pr ? ` · #${pr.number}` : '';
  const base = {
    target, pullRequest: pr, revision, checkedAt: d.checkedAt, published, followUpsStopped: stopped,
    // A scripted ship runs without a turn and can be cancelled until it pushes.
    canCancel: !published && (d.status === 'queued' || d.status === 'waiting' || (d.status === 'running' && t.status !== 'running')),
    // Review-only requests may still continue fixes when later checks fail.
    canStopFollowUps: published && !stopped && !superseded
      && ['queued', 'waiting', 'blocked', 'ready'].includes(d.status),
    // A blocked request that never published (e.g. Nothing to ship) has nothing to observe; Ship again instead.
    canCheck: !superseded && (['waiting', 'ready'].includes(d.status) || (d.status === 'blocked' && published)),
    canShip: false,
  };

  if (superseded) {
    return { ...base, phase: 'superseded', label: 'New work', tone: 'ready', glyph: 'ship', badge: 'New work', canShip: true,
      detail: pr && d.status !== 'delivered' && d.pullRequest?.state !== 'merged' ? `New work since PR #${pr.number}; Ship again to update it` : undefined };
  }
  if (d.status === 'delivered') {
    return pr
      ? { ...base, phase: 'delivered', label: `Merged into ${target}`, tone: 'delivered', glyph: 'merge', badge: `Merged #${pr.number}` }
      : { ...base, phase: 'delivered', label: `Shipped to ${target}`, tone: 'delivered', glyph: 'push', badge: target };
  }
  if (d.status === 'queued') {
    if (t.status === 'interrupted' || t.status === 'failed') {
      const label = review ? 'Review paused' : 'Ship paused';
      return { ...base, phase: 'paused', label, tone: 'interrupted', glyph: 'dot', badge: label, detail: 'Resume the thread to continue delivery' };
    }
    const label = review ? 'Prepares review when done' : 'Ships when done';
    return { ...base, phase: 'queued', label, tone: 'working', glyph: t.status === 'running' ? 'spinner' : 'ship', badge: 'Queued' };
  }
  if (d.status === 'running') {
    const label = review ? 'Preparing review' : 'Shipping';
    return { ...base, phase: 'shipping', label, tone: 'working', glyph: 'spinner', badge: review ? 'Preparing' : 'Shipping' };
  }

  // Published, ready or blocked: what the last observation established.
  const merged = d.pullRequest?.state === 'merged';
  let known: Pick<DeliveryStatus, 'phase' | 'label' | 'tone' | 'glyph' | 'badge' | 'detail' | 'ci'>;
  if (d.pullRequest?.state === 'closed') {
    known = { phase: 'closed', label: 'Closed without merging', tone: 'attention', glyph: 'pr', badge: `Closed #${pr!.number}`, detail: 'The PR was closed without merging. Ship again to publish this work.' };
  } else if (d.status === 'blocked') {
    // A real blocker wins over a known merge; the reason is the actionable part.
    known = { phase: 'attention', label: 'Needs attention', tone: 'attention', glyph: 'alert', badge: 'Needs attention',
      detail: d.detail ?? (merged || d.integratedAt ? `Merged, but checks on ${target} need attention` : 'Delivery needs attention') };
  } else if (merged || d.integratedAt) {
    // Live CI replaces the generic label; the merge or push stays in the glyph, badge and detail.
    const progress = d.status === 'waiting' && d.waitingOn !== 'agent' ? ciSummary(d.ci) : undefined;
    known = pr
      ? { phase: 'integrated', label: progress ?? `Merged · checking ${target}`, tone: 'waiting', glyph: 'merge', badge: `Merged #${pr.number}`, detail: progress ? `Merged · waiting for checks on ${target}` : `Waiting for checks on ${target}` }
      : { phase: 'integrated', label: progress ?? `Pushed · checking ${target}`, tone: 'waiting', glyph: 'push', badge: target, detail: progress ? `Pushed · waiting for checks on ${target}` : `Waiting for checks on ${target}` };
    if (progress) known.ci = d.ci;
  } else {
    const on = d.status === 'ready' ? 'merge' : d.waitingOn ?? 'checks';
    const mergesItself = !review && d.policy === 'pull-request' && !stopped;
    const progress = d.status === 'waiting' && on === 'checks' ? ciSummary(d.ci) : undefined;
    known = {
      phase: 'waiting', label: progress ?? (on === 'agent' ? 'Continuing delivery' : `Waiting for ${on}`), tone: 'waiting', glyph: pr ? 'pr' : 'ship',
      badge: pr ? `#${pr.number}` : 'Waiting',
      detail: review && on === 'merge' ? 'Prepared for review; merge manually' : mergesItself ? 'Merges when GitHub allows' : undefined,
      ...(progress ? { ci: d.ci } : {}),
    };
  }
  if (stopped && known.phase === 'waiting') known = { ...known, detail: pr ? `Automatic fixes stopped · still tracking #${pr.number}` : 'Automatic fixes stopped' };
  const canShip = known.phase === 'attention' || known.phase === 'closed';
  if (d.observationError) {
    return { ...base, phase: 'unavailable', label: 'Status unavailable', tone: 'unavailable', glyph: pr ? 'pr' : 'alert', badge: 'Unavailable',
      detail: `Last known: ${known.label}${prSuffix}`, canShip, canCheck: true };
  }
  return { ...base, ...known, canShip };
}

const turnLabels: Record<ThreadView['status'], string> = { running: 'Working', idle: 'Ready', interrupted: 'Interrupted', failed: 'Failed' };

/** The sidebar's reading: a current delivery wins over an idle turn; a running turn always spins. */
export function threadStatus(t: ThreadView, { needsSecret = false }: { needsSecret?: boolean } = {}): ThreadStatusView {
  const own = deliveryStatus(t);
  const delivery = own?.phase === 'superseded' ? undefined : own;
  if (needsSecret) return { label: 'Needs a secret', tone: 'secret', glyph: 'dot', showLabel: true, delivery };
  if (t.status === 'running') {
    const carries = delivery?.phase === 'queued' || delivery?.phase === 'shipping';
    return { label: carries ? delivery!.label : 'Working', tone: 'working', glyph: 'spinner', showLabel: carries, delivery };
  }
  if (delivery) return { label: delivery.label, tone: delivery.tone, glyph: delivery.glyph, showLabel: true, delivery };
  return { label: turnLabels[t.status], tone: t.status === 'idle' ? 'ready' : t.status, glyph: 'dot', showLabel: true };
}

/**
 * The few words a sidebar row has room for; the full status stays in the row's title.
 * "Waiting for merge" reads as Review and live CI as its step, so a narrow row never cuts a phrase.
 */
export function shortStatus(label: string): string {
  const step = label.match(/^CI\b.* (\d+) of (\d+)$/);
  if (step) return `CI · step ${step[1]}/${step[2]}`;
  if (label.startsWith('CI')) return 'CI';
  if (label === 'Waiting for merge') return 'Review';
  if (label.startsWith('Waiting for ')) return label.slice('Waiting for '.length).replace(/^./, (c) => c.toUpperCase());
  if (label.startsWith('Shipped to ')) return 'Shipped';
  if (label.startsWith('Merged into ')) return 'Merged';
  if (label.startsWith('Merged · ') || label.startsWith('Pushed · ')) return 'Checking';
  return label;
}

/** Readable status for titles and accessible names, with the PR number when one exists. */
export function statusText(label: string, pr?: { number: number }): string {
  return pr ? `${label} · #${pr.number}` : label;
}

/** "checked just now", "checked 4m ago": a quiet observation age for the delivery row. */
export function checkedAgo(iso: string | undefined, now: Date): string | undefined {
  if (!iso) return undefined;
  const minutes = Math.floor((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'checked just now';
  if (minutes < 60) return `checked ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `checked ${hours}h ago` : `checked ${Math.floor(hours / 24)}d ago`;
}

/** Whether the server settled this thread for its delivery, as opposed to a manual or historical settle. */
export function autoSettled(t: ThreadView): boolean {
  const d = t.delivery;
  return !!t.settledAt && d?.status === 'delivered' && !!d.autoSettle && !d.keepOpen && !d.followUpsStoppedAt;
}
