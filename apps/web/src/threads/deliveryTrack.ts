import type { DeliveryCI, DeliveryStepName, ThreadView } from '@accio/protocol';
import { deliveryStatus } from './status';

/**
 * A delivery read as a track of stations, top to bottom, for the side panel's
 * Delivery tab. It reads the same facts as the composer row (`deliveryStatus`),
 * only spread out: which steps are behind, which one is open, and what is left.
 */

/** done: behind us. active: work is happening now. waiting: on a person or GitHub. failed: needs attention. todo: not reached. */
export type StationState = 'done' | 'active' | 'waiting' | 'failed' | 'todo';

export type Station = {
  id: 'prepare' | 'publish' | 'checks' | 'merge' | 'target';
  label: string;
  state: StationState;
  detail?: string;
  /** A second line: what the agent says it is doing. */
  note?: string;
  link?: string;
  /** Live CI jobs, on the station whose checks are the open question. */
  ci?: DeliveryCI;
};

export type DeliveryTrack = { route: string; stations: Station[] };

export function deliveryTrack(t: ThreadView, now = new Date()): DeliveryTrack | undefined {
  const d = t.delivery;
  const status = deliveryStatus(t);
  if (!d || !status) return undefined;
  const pr = status.pullRequest;
  const target = status.target;
  const viaPr = d.policy === 'pull-request';
  const review = d.mode === 'review';
  const closed = d.pullRequest?.state === 'closed';
  const merged = d.pullRequest?.state === 'merged';
  const integrated = merged || !!d.integratedAt || d.status === 'delivered';
  const blocked = d.status === 'blocked';
  const waitingOn = d.status === 'ready' ? 'merge' : d.status === 'waiting' ? d.waitingOn ?? 'checks' : undefined;
  // Pushing straight to the target ends the agent's turn; waiting after it means the push is out, observed or not.
  const pushed = status.published || (!viaPr && (waitingOn === 'checks' || d.status === 'delivered'));

  const prepare: Station = { id: 'prepare', label: review ? 'Prepare for review' : 'Rebase and test', state: 'done' };
  if (d.status === 'queued') {
    prepare.state = t.status === 'running' ? 'waiting' : 'todo';
    prepare.detail = status.phase === 'paused' ? 'Paused · resume the thread' : 'Starts when the turn ends';
  } else if (d.status === 'running' && d.step?.name !== 'publish') {
    const elapsed = d.startedAt ? since(d.startedAt, now) : undefined;
    const step = d.step && PREPARE_STEPS.indexOf(d.step.name);
    prepare.state = 'active';
    // A scripted ship runs without a turn, so no agent is involved.
    prepare.detail = [d.step ? `${stepLabel(d.step.name, d.baseBranch)} · ${step! + 1} of ${PREPARE_STEPS.length}` : t.status === 'running' ? 'Agent is working' : 'Starting', elapsed].filter(Boolean).join(' · ');
    prepare.note = d.step?.note;
  } else if (blocked && !status.published) {
    prepare.state = 'failed';
    prepare.detail = d.detail ?? 'Needs attention';
  }

  const publish: Station = viaPr
    ? { id: 'publish', label: 'Pull request', state: pr ? 'done' : 'todo', ...(pr ? { detail: `#${pr.number}`, link: pr.url } : {}) }
    : { id: 'publish', label: `Push to ${target}`, state: pushed ? 'done' : 'todo', ...(status.revision ? { detail: status.revision } : {}) };

  // The agent said it is publishing: preparation is behind it.
  if (d.status === 'running' && d.step?.name === 'publish' && !pushed && !pr) {
    publish.state = 'active';
    publish.detail = t.status === 'running' ? 'Agent is publishing' : 'Pushing';
    publish.note = d.step.note;
  }

  const stations = [prepare, publish];
  if (viaPr) {
    const checks: Station = { id: 'checks', label: 'Checks', state: 'todo' };
    if (integrated || waitingOn === 'review' || waitingOn === 'merge') checks.state = 'done';
    else if (waitingOn === 'agent') { checks.state = 'active'; checks.detail = 'Agent is fixing checks'; }
    else if (waitingOn === 'checks') { checks.state = 'waiting'; checks.ci = status.ci; }
    else if (blocked && pr) { checks.state = 'failed'; checks.detail = d.detail ?? 'Needs attention'; }
    stations.push(checks);

    const merge: Station = { id: 'merge', label: review ? 'Review and merge' : 'Merge', state: merged || integrated ? 'done' : 'todo' };
    if (closed) { merge.state = 'failed'; merge.detail = 'Closed without merging'; }
    else if (!integrated && waitingOn === 'review') { merge.state = 'waiting'; merge.detail = 'Waiting for review'; }
    else if (!integrated && waitingOn === 'merge') {
      merge.state = 'waiting';
      merge.detail = review || d.followUpsStoppedAt ? 'Merge it on GitHub' : 'Merges when GitHub allows';
    }
    stations.push(merge);
  }

  const verify: Station = { id: 'target', label: `Checks on ${target}`, state: d.status === 'delivered' ? 'done' : 'todo' };
  if (d.status !== 'delivered' && (integrated || (!viaPr && pushed))) {
    if (blocked) { verify.state = 'failed'; verify.detail = d.detail ?? 'Needs attention'; }
    else { verify.state = 'waiting'; verify.ci = status.ci; }
  }
  if (d.status === 'delivered' && status.revision) verify.detail = status.revision;
  stations.push(verify);

  // An observation failure keeps the last known track; say so on the open station.
  if (d.observationError) {
    const open = stations.find((s) => s.state !== 'done');
    if (open) open.detail = 'Status unavailable · last known';
  }
  return { route: viaPr ? `To ${target} via PR` : `To ${target}`, stations };
}

/** The reported steps that make up Prepare; publish moves the track to its own station. */
const PREPARE_STEPS: DeliveryStepName[] = ['commit', 'integrate', 'verify'];

function stepLabel(step: DeliveryStepName, target: string): string {
  return step === 'commit' ? 'Commit' : step === 'integrate' ? `Integrate ${target}` : 'Verify';
}

function since(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'under 1m';
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
