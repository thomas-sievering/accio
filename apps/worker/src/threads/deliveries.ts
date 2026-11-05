import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DeliveryMode, ShippedNote, ThreadDelivery } from '@accio/protocol';
import { samePath } from '../paths.js';
import type { Projects } from '../projects/projects.js';
import { UserError } from '../rpc/router.js';
import { now } from '../time.js';
import { DeliveryGit, DeliveryPending, DeliveryUnavailable, type DeliveryHosting } from './delivery.js';
import { reportDeliveryStep } from './deliveryStep.js';
import { cleanExecutionEnv } from './harnessEnv.js';
import type { Previews } from './previews.js';
import { scriptedShip } from './scriptedShip.js';
import { recordShippedNote } from './shippedNote.js';
import type { ThreadState } from './state.js';
import { settle, toView, type Thread } from './thread.js';

/** What deliveries need from the rest of Threads. */
export type DeliveryHost = {
  beginTurn(threadId: string, text: string, options: { delivery: true }): Promise<void>;
  withLifecycle<T>(threadId: string, action: () => Promise<T>): Promise<T>;
  /** A delivery was verified, or was found verified at startup (`backfill`, which adds no shipped note to the thread). */
  delivered(threadId: string, backfill: boolean): Promise<void>;
  /** A commit message and shipped note from the lightweight naming model. */
  describeShip(threadId: string, files: string, signal: AbortSignal): Promise<{ message: string; note?: ShippedNote }>;
};

/** Ship requests, their delivery turns, host observation, auto-settle and workspace archiving (ADR 0015). */
export class Deliveries {
  readonly git: DeliveryGit;
  private starting = new Set<string>();
  /** Scripted ships in progress, and those cancelled rather than stopped. */
  private scripts = new Map<string, AbortController>();
  private cancelled = new Set<string>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private checks = new Map<string, Promise<void>>();

  constructor(private state: ThreadState, private projects: Projects, private previews: Previews, private host: DeliveryHost, hosting?: DeliveryHosting) {
    this.git = new DeliveryGit(state.home, hosting);
  }

  /** Startup: finish journaled archives and resume observation. Returns whether the list changed. */
  async recoverReleases(): Promise<boolean> {
    let recovered = false;
    for (const thread of this.state.list) {
      // An Archive releases its delivered revision; an unchanged settled worktree, its start revision.
      const revision = thread.delivery ? thread.delivery.revision : thread.workspace?.startRevision;
      if (!thread.workspace?.releaseRequestedAt || thread.workspace.releasedAt || !revision) continue;
      try {
        this.assertWorkspaceUnused(thread);
        await this.previews.stop(thread.id);
        await this.git.release(thread.id, thread.workspace, revision);
        thread.workspace = { ...thread.workspace, releasedAt: now() };
        thread.settledAt = now();
        recovered = true;
      } catch { /* Preserve the journal and workspace for an explicit Archive retry. */ }
    }
    return recovered;
  }

  async resumeObservation() {
    for (const thread of this.state.list) {
      if (thread.delivery?.status === 'delivered' && thread.delivery.completedAt) {
        await this.state.updateDurably(thread.id, t => this.settleDelivered(t));
        await this.host.delivered(thread.id, true);
      }
      this.scheduleCheck(thread.id);
    }
  }

  async summary(threadId: string) {
    const thread = this.state.require(threadId);
    const summary = await this.git.summary(thread.workspace);
    const project = thread.checkoutId ? this.projects.projectOf(this.projects.checkout(thread.checkoutId)) : undefined;
    return { ...summary, previewAvailable: !!(project?.previewCommand && thread.workspace && !thread.workspace.releasedAt) };
  }

  async request(threadId: string, mode: DeliveryMode) {
    await this.host.withLifecycle(threadId, async () => {
      const thread = this.state.require(threadId);
      if (thread.queuedMessages?.length) throw new UserError('Send or remove queued messages before requesting delivery.');
      if (!thread.workspace || thread.workspace.releasedAt) throw new UserError('Start a new thread in a committed Git project to use an owned worktree.');
      if (thread.delivery && ['queued', 'running', 'waiting'].includes(thread.delivery.status)) throw new UserError('Delivery is already requested.');
      const baseBranch = await this.git.target(thread.workspace);
      const project = this.projects.projectOf(this.projects.checkout(thread.checkoutId));
      const openPr = thread.delivery?.pullRequest?.state === 'open' || !!(thread.delivery?.pullRequestUrl && !thread.delivery.pullRequest && thread.delivery.status !== 'delivered');
      const delivery: ThreadDelivery = { id: randomUUID(), workVersion: thread.workVersion ?? 0, autoSettle: true,
        mode, policy: openPr ? 'pull-request' : project.deliveryPolicy ?? 'direct', baseBranch, requestedAt: now(), status: 'queued',
        ...(openPr ? { pullRequest: thread.delivery?.pullRequest, pullRequestUrl: thread.delivery?.pullRequestUrl } : {}) };
      try { await this.state.update(threadId, t => ({ ...t, delivery })); }
      catch (error) {
        // A rejected request must never become an in-memory publication grant.
        this.state.restore(threadId, 'delivery', thread.delivery);
        throw error;
      }
    });
    await this.dispatch(threadId);
    return toView(this.state.require(threadId));
  }

  async cancel(threadId: string) {
    const script = this.scripts.get(threadId);
    if (script) {
      if (this.state.require(threadId).delivery?.step?.name === 'publish') throw new UserError('Already pushing. The delivery finishes on its own.');
      // Nothing is published until its push succeeds; the runner aborts its rebase and clears the request.
      this.cancelled.add(threadId);
      script.abort();
      return toView(this.state.require(threadId));
    }
    if (this.state.lifecycle.has(threadId) || this.starting.has(threadId)) throw new UserError('Wait for the current thread action to finish.');
    const thread = this.state.require(threadId);
    if (!thread.delivery || !['queued', 'waiting', 'blocked', 'ready'].includes(thread.delivery.status)) throw new UserError('Only a queued or paused delivery can be cancelled.');
    this.clearCheck(threadId);
    const published = !!(thread.delivery.pullRequest || thread.delivery.pullRequestUrl || thread.delivery.integratedAt);
    const updated = await this.state.update(threadId, t => ({ ...t, organizationVersion: (t.organizationVersion ?? 0) + 1,
      delivery: published ? { ...t.delivery!, status: t.delivery!.status === 'queued' ? 'waiting' : t.delivery!.status,
        followUpsStoppedAt: now(), keepOpen: true } : undefined }));
    this.scheduleCheck(threadId);
    return toView(updated);
  }

  archive(threadId: string) {
    return this.host.withLifecycle(threadId, async () => {
      let thread = this.state.require(threadId);
      if (this.state.running.has(threadId) || thread.status === 'running') throw new UserError('Wait for the thread to finish before archiving.');
      if (!thread.workspace || thread.workspace.releasedAt || !thread.delivery || !['delivered', 'ready'].includes(thread.delivery.status)) throw new UserError('Ship the change successfully before archiving its workspace.');
      this.assertWorkspaceUnused(thread);
      const verified = await this.git.verify(thread.workspace, thread.delivery);
      if (verified.status !== 'delivered' || verified.revision !== thread.delivery.revision) throw new UserError('This change has not been delivered. The workspace has been kept.');
      await this.previews.stop(threadId);
      // Journal the verified revision and release intent before touching files.
      thread = await this.state.update(threadId, t => ({ ...t, delivery: verified, workspace: { ...t.workspace!, releaseRequestedAt: now() } }));
      await this.git.release(threadId, thread.workspace!, verified.revision!);
      thread = await this.state.update(threadId, t => settle({ ...t, workspace: { ...t.workspace!, releasedAt: now() }, delivery: verified }, now()));
      return toView(thread);
    });
  }

  /** GLOSSARY: Settle. Releases a settled worktree that holds no work. Commits, changes, a delivery or a running preview keep it. */
  releaseIfUnchanged(threadId: string) {
    return this.host.withLifecycle(threadId, async () => {
      const thread = this.state.require(threadId);
      const workspace = thread.workspace;
      if (!thread.settledAt || !workspace || workspace.releasedAt || thread.delivery || thread.status === 'running' || this.state.running.has(threadId)
        || thread.queuedMessages?.length || this.state.messageOps.has(threadId) || this.previews.has(threadId)) return;
      this.assertWorkspaceUnused(thread);
      if (!await this.git.unchanged(workspace)) return;
      // Journal before touching files, as Archive does.
      await this.state.update(threadId, t => ({ ...t, workspace: { ...t.workspace!, releaseRequestedAt: now() } }), { quiet: true });
      try { await this.git.release(threadId, workspace, workspace.startRevision); }
      catch (error) {
        await this.state.update(threadId, t => ({ ...t, workspace: { ...t.workspace!, releaseRequestedAt: undefined } }), { quiet: true });
        throw error;
      }
      await this.state.update(threadId, t => ({ ...t, workspace: { ...t.workspace!, releasedAt: now() } }));
    }).catch(() => { /* Busy, or git refused: the worktree stays for a later Settle or Archive. */ });
  }

  async dispatch(threadId: string) {
    const thread = this.state.require(threadId);
    if (this.state.closing || this.state.lifecycle.has(threadId) || this.state.running.has(threadId) || thread.status === 'running' || thread.delivery?.status !== 'queued' || thread.delivery.followUpsStoppedAt) return;
    const testCommand = this.scriptable(thread);
    // Like a turn, the run holds its slot once this returns; the request does not wait for it.
    if (testCommand) { void this.ship(threadId, testCommand).catch(error => console.error('[delivery] scripted ship failed', error)); return; }
    this.starting.add(threadId);
    try { await this.host.beginTurn(threadId, '', { delivery: true }); }
    catch (error) {
      await this.state.update(threadId, t => t.delivery ? { ...t, delivery: { ...t.delivery, status: 'blocked', detail: (error as Error).message } } : t);
    }
    finally { this.starting.delete(threadId); }
  }

  /**
   * GLOSSARY: Scripted ship. A fresh direct Ship in a project with a test command runs
   * without a model turn. Anything after a handover or for a PR goes to the delivery turn.
   */
  private scriptable(thread: Thread): string | undefined {
    const d = thread.delivery!;
    if (d.mode !== 'ship' || d.policy !== 'direct' || d.startedAt || !thread.checkoutId || !thread.workspace) return;
    return this.projects.projectOf(this.projects.checkout(thread.checkoutId)).testCommand?.trim() || undefined;
  }

  private async ship(threadId: string, testCommand: string) {
    const { state } = this;
    // Holding the running slot keeps turns and messages out; Stop and shutdown abort it.
    const controller = new AbortController();
    state.running.set(threadId, controller);
    this.scripts.set(threadId, controller);
    let handover: string | undefined;
    try {
      await state.track(async () => {
        const started = await state.update(threadId, t => ({ ...t, resumeAfterRestart: undefined, delivery: { ...t.delivery!, status: 'running', detail: undefined, step: undefined, startedAt: now() } }));
        try {
          const result = await scriptedShip({
            workspace: started.workspace!, baseBranch: started.delivery!.baseBranch, testCommand, signal: controller.signal,
            env: { ...cleanExecutionEnv(process.env), ACCIO_HOME: join(state.home, 'ship-state', threadId), ACCIO_PORT: '0', ACCIO_HUB_PORT: '0' },
            report: async (step, note) => { await state.update(threadId, t => ({ ...t, delivery: reportDeliveryStep(t.delivery, step, note, now()) })); },
            describe: files => this.host.describeShip(threadId, files, controller.signal),
            fallbackMessage: started.title,
            note: async (note) => { await state.update(threadId, t => ({ ...t, delivery: recordShippedNote(t.delivery, note) })); },
          });
          if (result.kind === 'handover') handover = result.detail;
          else await this.verify(state.require(threadId), true);
        } catch (error) {
          if (controller.signal.aborted) {
            if (this.cancelled.has(threadId)) await state.update(threadId, t => ({ ...t, delivery: undefined }));
            // Shutdown, not Stop: run the script again when accio starts. Nothing was published unless its push finished.
            else if (state.closing && state.require(threadId).resumeAfterRestart) await state.update(threadId, t => ({ ...t, resumeAfterRestart: undefined,
              delivery: { ...t.delivery!, status: 'queued', startedAt: undefined, step: undefined } }));
            else await state.update(threadId, t => ({ ...t, delivery: { ...t.delivery!, status: 'blocked', detail: 'Shipping stopped. Request Ship again to continue.' } }));
          } else await this.recordWait(threadId, error instanceof UserError ? error : new UserError((error as Error).message));
        }
        if (handover !== undefined) await state.update(threadId, t => ({ ...t, delivery: { ...t.delivery!, status: 'queued', step: undefined, detail: handover } }));
        else if (state.require(threadId).delivery?.status === 'running') await state.update(threadId, t => ({ ...t, delivery: { ...t.delivery!, status: 'waiting' } }));
      });
    } finally {
      if (state.running.get(threadId) === controller) state.running.delete(threadId);
      this.scripts.delete(threadId);
      this.cancelled.delete(threadId);
      if (state.get(threadId)) await state.updateDurably(threadId, t => this.settleDelivered(t)).catch(() => {});
      this.scheduleCheck(threadId);
    }
    if (handover !== undefined) await this.dispatch(threadId);
  }

  clearCheck(threadId: string) {
    clearTimeout(this.timers.get(threadId)); this.timers.delete(threadId);
  }

  close() {
    for (const id of this.timers.keys()) this.clearCheck(id);
  }

  scheduleCheck(threadId: string) {
    this.clearCheck(threadId);
    const thread = this.state.require(threadId);
    if (this.state.closing || !this.observes(thread)) return;
    const delivery = thread.delivery!;
    const quiet = delivery.status === 'ready' || (delivery.waitingOn === 'merge' && !delivery.integratedAt);
    const failures = delivery.turnError ? delivery.turnFailures : delivery.observationError ? delivery.observationFailures : undefined;
    const delay = failures !== undefined ? Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures, 5)) : quiet ? 2 * 60_000 : 30_000;
    const timer = setTimeout(() => {
      this.timers.delete(threadId);
      void this.check(threadId).catch(error => console.error('[delivery] checking delivery failed', error));
    }, delay);
    timer.unref(); this.timers.set(threadId, timer);
  }

  private observes(thread: Thread) {
    const d = thread.delivery;
    if (!d || !thread.workspace || thread.workspace.releasedAt || (d.workVersion ?? 0) !== (thread.workVersion ?? 0)) return false;
    if (d.status === 'delivered') return !!(d.autoSettle && !d.keepOpen && !thread.settledAt);
    if (d.status === 'queued' || d.status === 'running' || d.pullRequest?.state === 'closed') return false;
    return d.status === 'waiting' || d.status === 'ready' || !!(d.pullRequest || d.pullRequestUrl || d.integratedAt || d.observationError);
  }

  private matches(thread: Thread, expected: Thread, ownTurn = false) {
    return !!thread.delivery && thread.delivery.id === expected.delivery?.id && thread.delivery.requestedAt === expected.delivery?.requestedAt
      && (thread.workVersion ?? 0) === (expected.workVersion ?? 0) && (thread.delivery.workVersion ?? 0) === (thread.workVersion ?? 0)
      && (thread.organizationVersion ?? 0) === (expected.organizationVersion ?? 0)
      && (ownTurn || (!this.state.running.has(thread.id) && !this.state.lifecycle.has(thread.id)));
  }

  settleDelivered(thread: Thread) {
    const d = thread.delivery;
    if (d?.status !== 'delivered' || !d.autoSettle || d.keepOpen || d.followUpsStoppedAt || thread.settledAt || thread.status !== 'idle'
      || (d.workVersion ?? 0) !== (thread.workVersion ?? 0) || this.state.running.has(thread.id) || this.state.lifecycle.has(thread.id) || !!thread.queuedMessages?.length || this.state.messageOps.has(thread.id)
      || (thread.snoozedUntil && Date.parse(thread.snoozedUntil) > Date.now())) return thread;
    return settle(thread, now());
  }

  /**
   * A delivery turn failed without being stopped, usually on a rate limit or API error.
   * Within the hour of automatic work, wait with backoff and start another delivery turn.
   * Returns false when the budget is spent, so the caller pauses the delivery instead.
   */
  async retryTurn(threadId: string): Promise<boolean> {
    const d = this.state.require(threadId).delivery;
    if (!d || d.followUpsStoppedAt || Date.now() - Date.parse(d.requestedAt) >= 60 * 60_000) return false;
    await this.state.update(threadId, t => ({ ...t, delivery: { ...t.delivery!, status: 'waiting', waitingOn: 'agent', ci: undefined,
      turnError: 'The last delivery turn stopped on an error.', turnFailures: (t.delivery!.turnFailures ?? 0) + 1,
      detail: 'The last delivery turn stopped on an error, such as a rate limit. Check what already happened before repeating it.' } }));
    this.scheduleCheck(threadId);
    return true;
  }

  async recordWait(threadId: string, error: Error) {
    await this.state.update(threadId, t => {
      const d = t.delivery!;
      if (error instanceof DeliveryUnavailable) return { ...t, delivery: { ...d, status: d.status === 'running' ? 'waiting' : d.status,
        observationError: error.message, observationFailures: (d.observationFailures ?? 0) + 1 } };
      const pending = error instanceof DeliveryPending;
      const budget = (d.continuationAttempts ?? 0) < 3 && Date.now() - Date.parse(d.requestedAt) < 60 * 60_000;
      const reviewMerged = !!d.integratedAt && d.mode === 'review';
      const exhausted = pending && error.continueAgent && (!budget || !!d.followUpsStoppedAt || reviewMerged);
      const reason = d.followUpsStoppedAt ? 'Automatic fixes are stopped.' : reviewMerged
        ? 'The review-only request does not authorize publishing fixes after merge. Request Ship to continue.'
        : 'Automatic fixes reached the limit of 3 attempts or 1 hour. Request Ship to retry.';
      return { ...t, delivery: { ...d, status: pending && !exhausted ? 'waiting' : 'blocked',
        detail: exhausted ? `${error.message} ${reason}` : error.message,
        waitingOn: pending ? error.waitingOn : undefined, ci: pending ? error.ci : undefined, observationError: undefined, observationFailures: 0 } };
    });
    this.scheduleCheck(threadId);
  }

  async verify(expected: Thread, ownTurn = false, continueAgent = false) {
    const threadId = expected.id;
    const matches = () => this.matches(this.state.require(threadId), expected, ownTurn);
    let verified: ThreadDelivery;
    try {
      verified = await this.git.verify(expected.workspace!, expected.delivery!, async patch => {
        if (matches()) await this.state.update(threadId, t => ({ ...t, delivery: { ...t.delivery!, ...patch } }));
      });
    } catch (error) {
      if (!matches()) return;
      const current = this.state.require(threadId);
      const d = current.delivery!;
      const pending = error instanceof DeliveryPending;
      const canContinue = continueAgent && pending && error.continueAgent && !d.followUpsStoppedAt && (!d.integratedAt || d.mode === 'ship')
        && !current.queuedMessages?.length && !this.state.messageOps.has(threadId)
        && current.status === 'idle' && (d.continuationAttempts ?? 0) < 3 && Date.now() - Date.parse(d.requestedAt) < 60 * 60_000;
      if (canContinue) await this.state.update(threadId, t => ({ ...t, delivery: { ...t.delivery!, ci: undefined, status: 'queued',
        continuationAttempts: (d.continuationAttempts ?? 0) + 1,
        // A published failure needs a new revision (and a new PR under PR policy).
        ...(d.integratedAt ? { integratedAt: undefined, publishedRevision: undefined, revision: undefined,
          pullRequest: undefined, pullRequestUrl: undefined, completedAt: undefined } : {}),
        detail: d.integratedAt ? `Checks failed on published revision ${d.publishedRevision}. ${error.message} Fix the failure and publish a follow-up using the original delivery policy. If a PR already merged, open a new PR for the fix.` : (error as Error).message } }));
      else await this.recordWait(threadId, error as Error);
      return;
    }
    if (!matches()) return;
    await this.state.updateDurably(threadId, t => this.settleDelivered({ ...t, delivery: { ...t.delivery!, ...verified } }));
    if (verified.status === 'delivered') await this.host.delivered(threadId, false);
  }

  async check(threadId: string, force = false) {
    const existing = this.checks.get(threadId);
    if (existing) return existing;
    const thread = this.state.require(threadId);
    if (!thread.delivery || !thread.workspace || thread.workspace.releasedAt) return;
    if (this.state.running.has(threadId) || this.state.lifecycle.has(threadId) || this.checks.size >= 2) { this.scheduleCheck(threadId); return; }
    const check = this.state.track(async () => {
      if (thread.delivery?.status === 'waiting' && thread.delivery.turnError) {
        // Nothing to observe: the failed turn's work is unfinished. Start another.
        await this.state.update(threadId, t => t.delivery?.turnError ? { ...t, delivery: { ...t.delivery, status: 'queued', turnError: undefined } } : t);
      } else if (thread.delivery?.status === 'delivered') {
        await this.state.updateDurably(threadId, t => this.settleDelivered(t));
      } else if (this.observes(thread) || (force && !['queued', 'running'].includes(thread.delivery!.status)
        && (thread.workVersion ?? 0) === (thread.delivery!.workVersion ?? 0))) await this.verify(thread, false, true);
    });
    this.checks.set(threadId, check);
    try { await check; }
    finally { this.checks.delete(threadId); this.scheduleCheck(threadId); }
    // No model is held open while the host is waiting. Only actionable work gets a new turn.
    if (this.state.require(threadId).delivery?.status === 'queued') await this.dispatch(threadId);
  }

  private assertWorkspaceUnused(thread: Thread) {
    const path = thread.workspace!.path;
    if (this.projects.state().checkouts.some(c => samePath(c.path, path)) || this.state.list.some(t => t.id !== thread.id && t.workspace && !t.workspace.releasedAt && (samePath(t.workspace.path, path) || samePath(t.workspace.sourcePath, path)))) throw new UserError('Another checkout or thread still uses this workspace.');
  }
}
