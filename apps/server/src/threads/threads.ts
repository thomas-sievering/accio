import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaKind, mediaMimeType, normalizeMarkdownSource, type ChoicePick, type DeliveryMode, type ThreadDelivery, type ParamsOf, type TranscriptItem } from '@accio/protocol';
import type { Profiles } from '../profiles/profiles.js';
import { configFolderOf } from '../profiles/claudeConfigFolder.js';
import type { Projects } from '../projects/projects.js';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { JsonFile } from '@accio/persistence';
import type { Harness, TurnResources } from './harness.js';
import type { ResourceManager } from '../resources/resources.js';
import type { Models } from '../harnesses/models.js';
import { harnessEnv } from './harnessEnv.js';
import {
  RESUME_PROMPT,
  assertResumable,
  closeOpenTools,
  dropUnstarted,
  endTurn,
  fromStored,
  newThread,
  reopen,
  retryOf,
  settle,
  snooze,
  recoverAfterRestart,
  startTurn,
  toView,
  upsertItem,
  type Thread,
  type TurnOutcome,
} from './thread.js';
import { TurnTranscript, type TranscriptChange } from './transcript.js';
import type { Machines } from '../machine/machine.js';
import { ThreadAssets } from './assets.js';
import { ThreadContent } from './content.js';
import { markdownReferences } from './markdown.js';
import { SecretRequests } from '../secrets/secrets.js';
import type { SecretsAccess } from '@accio/hub';
import { isChoiceTool, parseChoice, pickPrompt } from './choice.js';
import type { AccioTools, ToolAccess } from '../tools/tools.js';
import { DeliveryGit, DeliveryPending, DeliveryUnavailable, deliveryPrompt, type DeliveryHosting } from './delivery.js';
import { Previews } from './previews.js';
import { samePath } from '../projects/project.js';

type TurnOptions = { resume?: boolean; retry?: boolean; delivery?: boolean; pick?: ChoicePick };
type Live = { cursor: number; items: TranscriptItem[]; file: JsonFile<TranscriptItem[]>; saveTimer?: ReturnType<typeof setTimeout> };

/** Threads on this machine, their transcripts, and the turns running in them. */
export class Threads {
  get runningCount() { return this.running.size; }
  profileReferences() { return this.list.map((thread) => thread.profileId); }
  private file: JsonFile<Thread[]>;
  private list: Thread[] = [];
  private transcripts = new Map<string, Live>();
  private loadingTranscripts = new Map<string, Promise<Live>>();
  private running = new Map<string, AbortController>();
  private closing = false;
  private starts = new Set<Promise<unknown>>();
  private startingThreads = new Set<string>();
  private preparing = new Set<Promise<void>>();
  private turns = new Set<Promise<void>>();
  resources?: ResourceManager;
  onRepairFinished?: (toolId: string) => void;
  private lifecycle = new Set<string>();
  private deliveryStarting = new Set<string>();
  private deliveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private deliveryChecks = new Map<string, Promise<void>>();
  private deliveryGit: DeliveryGit;
  private previews: Previews;
  readonly assets: ThreadAssets;
  private content: ThreadContent;
  readonly secrets: SecretRequests;

  constructor(
    private home: string,
    private profiles: Profiles,
    private projects: Projects,
    private harnesses: Record<string, Harness>,
    private broadcast: Broadcast,
    private models: Models,
    private machines: Machines,
    vault: SecretsAccess,
    private tools?: AccioTools,
    deliveryHosting?: DeliveryHosting,
  ) {
    this.file = new JsonFile(join(home, 'threads.json'), () => []);
    this.deliveryGit = new DeliveryGit(home, deliveryHosting);
    this.previews = new Previews(home);
    this.assets = new ThreadAssets(home, (threadId) => this.list.some((thread) => thread.id === threadId));
    this.content = new ThreadContent(home, this.assets);
    this.secrets = new SecretRequests(home, vault, async (threadId, item) => {
      await this.addItem(threadId, item);
      this.broadcast('threads.changed', this.views());
    });
    projects.onRemoveThreads((id) => this.deleteThreads(this.list.filter((t) => t.checkoutId === id)));
    projects.onCheckInUse((checkoutId) => this.countUsing((t) => t.checkoutId === checkoutId));
    projects.onCheckProjectInUse((projectId) => this.countUsing((t) => t.projectId === projectId));
    profiles.onCheckInUse((profileId) => this.countUsing((t) => t.profileId === profileId));
  }

  private countUsing(pred: (t: Thread) => boolean): string | undefined {
    const n = this.list.filter(pred).length;
    return n ? `${n} thread${n > 1 ? 's' : ''}` : undefined;
  }

  async load() {
    await this.secrets.load();
    await this.previews.load();
    const stored = (await this.file.read()).map(fromStored);
    let bound = false;
    for (const thread of stored) {
      if (thread.hubId && thread.hubId !== this.profiles.client.id) throw new UserError('Thread storage belongs to a different hub');
      if (!thread.hubId) { thread.hubId = this.profiles.client.id; bound = true; }
    }
    const candidates = new Set(dropUnstarted(stored).map((t) => t.id));
    const started: Thread[] = [];
    for (const thread of stored) {
      // A title and session id alone do not prove a thread has no conversation.
      if (candidates.has(thread.id) || (await this.transcript(thread.id)).items.length > 0) started.push(thread);
    }
    const { threads, interrupted } = recoverAfterRestart(started);
    this.list = threads.map(t => t.delivery?.status === 'delivered' && t.delivery.completedAt && t.status === 'interrupted' ? { ...t, status: 'idle' } : t.delivery?.status === 'running' ? { ...t, delivery: { ...t.delivery, status: 'blocked', detail: 'Delivery was interrupted. Check the conversation and request Ship again to continue safely.' } } : t.delivery?.status === 'queued' && t.status === 'idle' ? { ...t, status: 'interrupted' } : t);
    let recoveredRelease = false;
    for (const thread of this.list) {
      if (!thread.workspace?.releaseRequestedAt || thread.workspace.releasedAt || !thread.delivery?.revision) continue;
      try {
        this.assertWorkspaceUnused(thread);
        await this.previews.stop(thread.id);
        await this.deliveryGit.release(thread.id, thread.workspace, thread.delivery.revision);
        thread.workspace = { ...thread.workspace, releasedAt: now() };
        thread.settledAt = now();
        recoveredRelease = true;
      } catch { /* Preserve the journal and workspace for an explicit Archive retry. */ }
    }
    for (const thread of interrupted) {
      const live = await this.transcript(thread.id);
      live.items = live.items.map(item => item.kind === 'secret' && item.status === 'pending' ? { ...item, status: 'cancelled', candidates: [] } : item);
      const turnId = [...live.items].reverse().find((i) => i.kind === 'user')?.turnId ?? 'restart';
      live.items = upsertItem(closeOpenTools(live.items), {
        kind: 'notice',
        id: `${turnId}:restart`,
        turnId,
        tone: 'info',
        text: 'Interrupted: accio stopped while this turn was running.',
      });
      await live.file.write(live.items);
    }
    if (bound || recoveredRelease || interrupted.length || started.length < stored.length || this.list.some(t => t.delivery?.status === 'blocked')) await this.file.write(this.list);
    for (const thread of this.list) {
      if (thread.delivery?.status === 'delivered' && thread.delivery.completedAt) {
        await this.updateDurably(thread.id, t => this.settleDelivered(t));
        await this.deliveryReceipt(thread.id);
      }
      this.scheduleDeliveryCheck(thread.id);
    }
  }

  register(router: Router) {
    this.secrets.register(router, this.profiles, this.projects, this.broadcast);
    router
      .on('threads.list', () => this.views())
      .on('threads.start', input => this.start(input))
      .on('threads.transcript', async ({ threadId }) => {
        const live = await this.transcript(this.require(threadId).id);
        this.require(threadId);
        return live.items;
      })
      .on('threads.observe', async ({ threadId }) => {
        const live = await this.transcript(this.require(threadId).id);
        this.require(threadId);
        // No await between reading items and cursor. All mutations replace the
        // array/items, so this snapshot stays fixed even before RPC serialization.
        return { items: live.items, cursor: live.cursor };
      })
      .on('threads.toolDetails', async ({ threadId, itemId }) => {
        this.require(threadId);
        const live = await this.transcript(threadId);
        const item = live.items.find((entry) => entry.id === itemId);
        if (item?.kind !== 'tool') throw new UserError('No such tool call');
        const details = await this.content.details(threadId, itemId);
        this.require(threadId);
        if (details) return details;
        if (item.detailRevision !== undefined) throw new UserError('Tool details are unavailable');
        return { input: null, parts: item.output ? [{ type: 'text' as const, text: item.output }] : [] };
      })
      .on('threads.assetUrl', ({ threadId, assetId, download }) => {
        this.require(threadId);
        return this.assets.assetUrl(threadId, assetId, download);
      })
      .on('threads.fileUrl', async ({ threadId, path }) => {
        const thread = this.require(threadId);
        if (thread.workspace?.releasedAt) throw new UserError('This workspace was archived. Saved media remains in the conversation; send a follow-up to restore a working copy.');
        const live = await this.transcript(threadId);
        this.require(threadId);
        const linked = live.items.some((item) => item.kind === 'assistant' && markdownReferences(item.text).files.includes(path));
        if (!linked) throw new UserError('This file is not linked in the thread');
        return this.assets.fileUrl(threadId, this.cwd(thread), path);
      })
      .on('threads.send', async ({ threadId, text, pick }) => {
        await this.beginTurn(threadId, text, { pick });
        return null;
      })
      .on('threads.deliverySummary', async ({ threadId }) => {
        const thread = this.require(threadId);
        const summary = await this.deliveryGit.summary(thread.workspace);
        const project = thread.checkoutId ? this.projects.projectOf(this.projects.checkout(thread.checkoutId)) : undefined;
        return { ...summary, previewAvailable: !!(project?.previewCommand && thread.workspace && !thread.workspace.releasedAt) };
      })
      .on('threads.deliver', ({ threadId, mode }) => this.requestDelivery(threadId, mode))
      .on('threads.cancelDelivery', async ({ threadId }) => {
        if (this.lifecycle.has(threadId) || this.deliveryStarting.has(threadId)) throw new UserError('Wait for the current thread action to finish.');
        const thread = this.require(threadId);
        if (!thread.delivery || !['queued', 'waiting', 'blocked', 'ready'].includes(thread.delivery.status)) throw new UserError('Only a queued or paused delivery can be cancelled.');
        this.clearDeliveryCheck(threadId);
        const published = !!(thread.delivery.pullRequest || thread.delivery.pullRequestUrl || thread.delivery.integratedAt);
        const updated = await this.update(threadId, t => ({ ...t, organizationVersion: (t.organizationVersion ?? 0) + 1,
          delivery: published ? { ...t.delivery!, status: t.delivery!.status === 'queued' ? 'waiting' : t.delivery!.status,
            followUpsStoppedAt: now(), keepOpen: true } : undefined }));
        this.scheduleDeliveryCheck(threadId);
        return toView(updated);
      })
      .on('threads.checkDelivery', async ({ threadId }) => { await this.checkDelivery(threadId, true); return toView(this.require(threadId)); })
      .on('threads.openPreview', ({ threadId }) => this.withLifecycle(threadId, async () => {
        const thread = this.require(threadId);
        const command = thread.checkoutId ? this.projects.projectOf(this.projects.checkout(thread.checkoutId)).previewCommand : undefined;
        if (!command || !thread.workspace || thread.workspace.releasedAt) throw new UserError('Set a preview command in project settings first.');
        return { url: await this.previews.open(threadId, thread.workspace.path, command) };
      }))
      .on('threads.archive', ({ threadId }) => this.withLifecycle(threadId, async () => {
        let thread = this.require(threadId);
        if (this.running.has(threadId) || thread.status === 'running') throw new UserError('Wait for the thread to finish before archiving.');
        if (!thread.workspace || thread.workspace.releasedAt || !thread.delivery || !['delivered', 'ready'].includes(thread.delivery.status)) throw new UserError('Ship the change successfully before archiving its workspace.');
        this.assertWorkspaceUnused(thread);
        const verified = await this.deliveryGit.verify(thread.workspace, thread.delivery);
        if (verified.status !== 'delivered' || verified.revision !== thread.delivery.revision) throw new UserError('This change has not been delivered. The workspace has been kept.');
        await this.previews.stop(threadId);
        // Journal the verified revision and release intent before touching files.
        thread = await this.update(threadId, t => ({ ...t, delivery: verified, workspace: { ...t.workspace!, releaseRequestedAt: now() } }));
        await this.deliveryGit.release(threadId, thread.workspace!, verified.revision!);
        thread = await this.update(threadId, t => settle({ ...t, workspace: { ...t.workspace!, releasedAt: now() }, delivery: verified }, now()));
        return toView(thread);
      }))
      .on('threads.setModel', async ({ threadId, model }) => {
        const thread = this.require(threadId);
        if (this.running.has(threadId) || thread.status === 'running') throw new UserError('Wait for this turn to finish before changing its model.');
        const selected = this.models.require(thread.profileId, model);
        if (selected.harnessId !== thread.model.harnessId) throw new UserError('Start a new thread to change its harness.');
        return toView(await this.update(threadId, (t) => ({ ...t, model: selected })));
      })
      .on('threads.stop', ({ threadId }) => {
        const controller = this.running.get(this.require(threadId).id);
        if (!controller) throw new UserError('This thread is not working');
        controller.abort();
        return null;
      })
      .on('threads.resume', async ({ threadId }) => {
        await this.beginTurn(threadId, RESUME_PROMPT, { resume: true });
        return null;
      })
      .on('threads.retry', async ({ threadId }) => {
        await this.beginTurn(threadId, '', { retry: true });
        return null;
      })
      .on('threads.snooze', async ({ threadId, until }) => toView(await this.update(threadId, t => snooze({ ...t, organizationVersion: (t.organizationVersion ?? 0) + 1 }, until))))
      .on('threads.settle', async ({ threadId }) => toView(await this.update(threadId, t => settle({ ...t, organizationVersion: (t.organizationVersion ?? 0) + 1 }, now()))))
      .on('threads.reopen', async ({ threadId }) => toView(await this.update(threadId, t => reopen({ ...t,
        organizationVersion: (t.organizationVersion ?? 0) + 1, ...(t.delivery ? { delivery: { ...t.delivery, keepOpen: true } } : {}) }))))
      .on('threads.rename', async ({ threadId, title }) => {
        const updated = await this.update(threadId, (t) => ({ ...t, title }));
        return toView(updated);
      })
      .on('threads.delete', async ({ threadId }) => {
        await this.deleteThreads([this.require(threadId)]);
        return null;
      });
  }

  start(input: ParamsOf<'threads.start'>, options: { repairToolId?: string } = {}) {
    return this.trackStart(async () => {
        const { text, model, machineId } = input;
        if (machineId) {
          await this.machines.refresh();
          const machine = this.machines.views().find((m) => m.id === machineId);
          if (!machine) throw new UserError('No such machine');
          if (!machine.connected) throw new UserError('This machine is offline');
          if (!machine.thisMachine) throw new UserError('Running threads on another machine is not available yet');
        }
        if (this.closing) throw new UserError('This machine is shutting down');
        const checkout = 'checkoutId' in input ? this.projects.checkout(input.checkoutId) : undefined;
        const project = checkout ? this.projects.projectOf(checkout) : undefined;
        const profileId = project?.profileId ?? ('profileId' in input ? input.profileId : '');
        const releaseProfile = this.profiles.useProfile(profileId);
        let release = () => {};
        try {
          if (checkout) release = this.projects.useCheckout(checkout.id);
          // Refuse before anything is stored, so a thread that cannot run never appears.
          const choice = model ?? this.models.default(profileId);
          await this.profiles.hubAccess(profileId, choice.harnessId === 'codex' ? 'openai' : 'anthropic');
          if (this.closing) throw new UserError('This machine is shutting down');
          const selected = this.models.require(profileId, choice);
          // GLOSSARY: a thread keeps the profile it started with for its whole life.
          const thread = newThread({ checkoutId: checkout?.id ?? '', projectId: project?.id ?? '', profileId, hubId: this.profiles.client.id, model: selected }, now());
          if (options.repairToolId) { thread.repairToolId = options.repairToolId; thread.title = `Repair ${options.repairToolId}`; }
          if (checkout) thread.workspace = await this.deliveryGit.allocate(thread.id, checkout.path);
          if (!checkout) await mkdir(join(this.home, 'workspaces', thread.id), { recursive: true });
          // Quiet: clients first see the thread once its turn is running, never as an idle empty thread.
          this.startingThreads.add(thread.id);
          const stored = this.commit([...this.list, thread], { quiet: true });
          try {
            // Reserve synchronously with insertion, before persistence yields to another intent.
            await this.beginTurn(thread.id, text, {}, stored);
          } catch (err) {
            this.startingThreads.delete(thread.id);
            if (thread.workspace) {
              // A failed start must leave a recoverable owner for its allocated worktree.
              const live = await this.transcript(thread.id);
              if (!live.items.some(item => item.kind === 'user')) {
                const turnId = randomUUID();
                await this.addItem(thread.id, { kind: 'user', id: `${turnId}:u`, turnId, text, at: now() });
                await this.addItem(thread.id, { kind: 'notice', id: `${turnId}:err`, turnId, tone: 'error', text: (err as Error).message });
              }
              await this.update(thread.id, t => ({ ...t, title: text.split('\n')[0]!.slice(0, 60), status: 'failed' }));
              await this.flush(thread.id);
            } else await this.deleteThreads([this.require(thread.id)]);
            throw err;
          }
          return toView(this.require(thread.id));
        } finally {
          release();
          releaseProfile();
        }
    });
  }

  // ---- turns ----

  private assertWorkspaceUnused(thread: Thread) {
    const path = thread.workspace!.path;
    if (this.projects.state().checkouts.some(c => samePath(c.path, path)) || this.list.some(t => t.id !== thread.id && t.workspace && !t.workspace.releasedAt && (samePath(t.workspace.path, path) || samePath(t.workspace.sourcePath, path)))) throw new UserError('Another checkout or thread still uses this workspace.');
  }

  private async withLifecycle<T>(id: string, action: () => Promise<T>): Promise<T> {
    if (this.closing) throw new UserError('This machine is shutting down');
    this.require(id);
    if (this.lifecycle.has(id)) throw new UserError('Wait for the current thread action to finish.');
    this.lifecycle.add(id);
    const pending = action();
    this.starts.add(pending);
    try { return await pending; }
    finally {
      this.lifecycle.delete(id); this.starts.delete(pending);
      // Preview startup can overlap the end of work. Release its reservation
      // before dispatching a queued delivery that waited behind it.
      if (this.list.find(t => t.id === id)?.status === 'idle') await this.dispatchDelivery(id);
    }
  }

  private async requestDelivery(threadId: string, mode: DeliveryMode) {
    await this.withLifecycle(threadId, async () => {
      const thread = this.require(threadId);
      if (!thread.workspace || thread.workspace.releasedAt) throw new UserError('Start a new thread in a committed Git project to use an owned worktree.');
      if (thread.delivery && ['queued', 'running', 'waiting'].includes(thread.delivery.status)) throw new UserError('Delivery is already requested.');
      const baseBranch = await this.deliveryGit.target(thread.workspace);
      const project = this.projects.projectOf(this.projects.checkout(thread.checkoutId));
      const openPr = thread.delivery?.pullRequest?.state === 'open' || !!(thread.delivery?.pullRequestUrl && !thread.delivery.pullRequest && thread.delivery.status !== 'delivered');
      const delivery: ThreadDelivery = { id: randomUUID(), workVersion: thread.workVersion ?? 0, autoSettle: true,
        mode, policy: openPr ? 'pull-request' : project.deliveryPolicy ?? 'direct', baseBranch, requestedAt: now(), status: 'queued',
        ...(openPr ? { pullRequest: thread.delivery?.pullRequest, pullRequestUrl: thread.delivery?.pullRequestUrl } : {}) };
      try { await this.update(threadId, t => ({ ...t, delivery })); }
      catch (error) {
        // A rejected request must never become an in-memory publication grant.
        this.list = this.list.map(t => t.id === threadId ? { ...t, delivery: thread.delivery } : t);
        this.broadcast('threads.changed', this.views());
        throw error;
      }
    });
    await this.dispatchDelivery(threadId);
    return toView(this.require(threadId));
  }

  private async dispatchDelivery(threadId: string) {
    const thread = this.require(threadId);
    if (this.closing || this.lifecycle.has(threadId) || this.running.has(threadId) || thread.status === 'running' || thread.delivery?.status !== 'queued' || thread.delivery.followUpsStoppedAt) return;
    this.deliveryStarting.add(threadId);
    try { await this.beginTurn(threadId, '', { delivery: true }); }
    catch (error) {
      await this.update(threadId, t => t.delivery ? { ...t, delivery: { ...t.delivery, status: 'blocked', detail: (error as Error).message } } : t);
    }
    finally { this.deliveryStarting.delete(threadId); }
  }

  private clearDeliveryCheck(threadId: string) {
    clearTimeout(this.deliveryTimers.get(threadId)); this.deliveryTimers.delete(threadId);
  }

  private scheduleDeliveryCheck(threadId: string) {
    this.clearDeliveryCheck(threadId);
    const thread = this.require(threadId);
    if (this.closing || !this.observesDelivery(thread)) return;
    const delivery = thread.delivery!;
    const quiet = delivery.status === 'ready' || (delivery.waitingOn === 'merge' && !delivery.integratedAt);
    const delay = delivery.observationError ? Math.min(15 * 60_000, 30_000 * 2 ** Math.min(delivery.observationFailures ?? 0, 5)) : quiet ? 2 * 60_000 : 30_000;
    const timer = setTimeout(() => {
      this.deliveryTimers.delete(threadId);
      void this.checkDelivery(threadId).catch(error => console.error('[delivery] checking delivery failed', error));
    }, delay);
    timer.unref(); this.deliveryTimers.set(threadId, timer);
  }

  private observesDelivery(thread: Thread) {
    const d = thread.delivery;
    if (!d || !thread.workspace || thread.workspace.releasedAt || (d.workVersion ?? 0) !== (thread.workVersion ?? 0)) return false;
    if (d.status === 'delivered') return !!(d.autoSettle && !d.keepOpen && !thread.settledAt);
    if (d.status === 'queued' || d.status === 'running' || d.pullRequest?.state === 'closed') return false;
    return d.status === 'waiting' || d.status === 'ready' || !!(d.pullRequest || d.pullRequestUrl || d.integratedAt || d.observationError);
  }

  private matchesDelivery(thread: Thread, expected: Thread, ownTurn = false) {
    return !!thread.delivery && thread.delivery.id === expected.delivery?.id && thread.delivery.requestedAt === expected.delivery?.requestedAt
      && (thread.workVersion ?? 0) === (expected.workVersion ?? 0) && (thread.delivery.workVersion ?? 0) === (thread.workVersion ?? 0)
      && (thread.organizationVersion ?? 0) === (expected.organizationVersion ?? 0)
      && (ownTurn || (!this.running.has(thread.id) && !this.lifecycle.has(thread.id)));
  }

  private settleDelivered(thread: Thread) {
    const d = thread.delivery;
    if (d?.status !== 'delivered' || !d.autoSettle || d.keepOpen || d.followUpsStoppedAt || thread.settledAt || thread.status !== 'idle'
      || (d.workVersion ?? 0) !== (thread.workVersion ?? 0) || this.running.has(thread.id) || this.lifecycle.has(thread.id)
      || (thread.snoozedUntil && Date.parse(thread.snoozedUntil) > Date.now())) return thread;
    return settle(thread, now());
  }

  private async deliveryReceipt(threadId: string) {
    const thread = this.require(threadId);
    const d = thread.delivery;
    if (d?.status !== 'delivered' || !d.completedAt || !d.id) return;
    const id = `delivery:${d.id}:completed`;
    const live = await this.transcript(threadId);
    if (live.items.some(item => item.id === id)) return;
    const result = d.pullRequestUrl ? `PR #${d.pullRequest?.number ?? d.pullRequestUrl.split('/').at(-1)} merged into ${d.baseBranch} (${d.pullRequestUrl})`
      : `Shipped to ${d.baseBranch}`;
    await this.addItem(threadId, { kind: 'notice', id, turnId: `delivery:${d.id}`, tone: 'info',
      text: `${result} · ${d.publishedRevision?.slice(0, 7)} · ${d.completedAt}. ${thread.settledAt ? 'Thread settled' : 'Thread stays open'}; workspace retained.` });
    await this.flush(threadId);
  }

  private async recordDeliveryWait(threadId: string, error: Error) {
    await this.update(threadId, t => {
      const d = t.delivery!;
      if (error instanceof DeliveryUnavailable) return { ...t, delivery: { ...d, status: d.status === 'running' ? 'waiting' : d.status,
        observationError: error.message, observationFailures: (d.observationFailures ?? 0) + 1 } };
      const pending = error instanceof DeliveryPending;
      const budget = (d.continuationAttempts ?? 0) < 3 && Date.now() - Date.parse(d.requestedAt) < 60 * 60_000;
      const exhausted = pending && error.continueAgent && (!budget || !!d.followUpsStoppedAt || !!d.integratedAt);
      return { ...t, delivery: { ...d, status: pending && !exhausted ? 'waiting' : 'blocked',
        detail: exhausted ? d.followUpsStoppedAt ? 'Automatic follow-ups stopped. PR observation continues.' : d.integratedAt ? 'Checks on the published revision need attention. Observation continues; the workspace has been kept.' : 'Delivery needs attention after its automatic follow-up budget. The workspace has been kept.' : error.message,
        waitingOn: pending ? error.waitingOn : undefined, observationError: undefined, observationFailures: 0 } };
    });
    this.scheduleDeliveryCheck(threadId);
  }

  private async verifyDelivery(expected: Thread, ownTurn = false, continueAgent = false) {
    const threadId = expected.id;
    const matches = () => this.matchesDelivery(this.require(threadId), expected, ownTurn);
    let verified: ThreadDelivery;
    try {
      verified = await this.deliveryGit.verify(expected.workspace!, expected.delivery!, async patch => {
        if (matches()) await this.update(threadId, t => ({ ...t, delivery: { ...t.delivery!, ...patch } }));
      });
    } catch (error) {
      if (!matches()) return;
      const current = this.require(threadId);
      const d = current.delivery!;
      const pending = error instanceof DeliveryPending;
      const canContinue = continueAgent && pending && error.continueAgent && !d.followUpsStoppedAt && !d.integratedAt
        && current.status === 'idle' && (d.continuationAttempts ?? 0) < 3 && Date.now() - Date.parse(d.requestedAt) < 60 * 60_000;
      if (canContinue) await this.update(threadId, t => ({ ...t, delivery: { ...t.delivery!, status: 'queued', continuationAttempts: (d.continuationAttempts ?? 0) + 1, detail: (error as Error).message } }));
      else await this.recordDeliveryWait(threadId, error as Error);
      return;
    }
    if (!matches()) return;
    await this.updateDurably(threadId, t => this.settleDelivered({ ...t, delivery: { ...t.delivery!, ...verified } }));
    if (!ownTurn) await this.deliveryReceipt(threadId);
  }

  private async checkDelivery(threadId: string, force = false) {
    const existing = this.deliveryChecks.get(threadId);
    if (existing) return existing;
    const thread = this.require(threadId);
    if (!thread.delivery || !thread.workspace || thread.workspace.releasedAt) return;
    if (this.running.has(threadId) || this.lifecycle.has(threadId) || this.deliveryChecks.size >= 2) { this.scheduleDeliveryCheck(threadId); return; }
    const check = this.trackStart(async () => {
      if (thread.delivery?.status === 'delivered') {
        await this.updateDurably(threadId, t => this.settleDelivered(t));
        await this.deliveryReceipt(threadId);
      } else if (this.observesDelivery(thread) || (force && !['queued', 'running'].includes(thread.delivery!.status)
        && (thread.workVersion ?? 0) === (thread.delivery!.workVersion ?? 0))) await this.verifyDelivery(thread, false, true);
    });
    this.deliveryChecks.set(threadId, check);
    try { await check; }
    finally { this.deliveryChecks.delete(threadId); this.scheduleDeliveryCheck(threadId); }
    // No model is held open while the host is waiting. Only actionable work gets a new turn.
    if (this.require(threadId).delivery?.status === 'queued') await this.dispatchDelivery(threadId);
  }

  private trackStart<T>(start: () => Promise<T>): Promise<T> {
    const pending = start();
    this.starts.add(pending);
    void pending.then(() => this.starts.delete(pending), () => this.starts.delete(pending));
    return pending;
  }

  private async deleteThreads(threads: Thread[]) {
    // Validate the entire current membership before any effect.
    if (threads.some((t) => this.running.has(t.id) || t.status === 'running')) {
      throw new UserError('Stop the thread before deleting it');
    }
    if (threads.some(t => this.lifecycle.has(t.id) || t.delivery?.status === 'queued' || t.delivery?.status === 'waiting' || (t.workspace && !t.workspace.releasedAt))) throw new UserError('Archive the delivered workspace before deleting this thread. Unpublished work has been kept.');
    const ids = new Set(threads.map((t) => t.id));
    const saved = this.commit(this.list.filter((t) => !ids.has(t.id)));
    const writes: Promise<void>[] = [];
    for (const id of ids) {
      const loading = this.loadingTranscripts.get(id);
      if (loading) {
        this.loadingTranscripts.delete(id);
        // Discard its result and let any open file handle close before removal.
        writes.push(loading.then(() => {}, () => {}));
      }
      const live = this.transcripts.get(id);
      if (live) {
        clearTimeout(live.saveTimer);
        writes.push(live.file.idle());
      }
      this.transcripts.delete(id);
      this.startingThreads.delete(id);
      this.clearDeliveryCheck(id);
    }
    await saved;
    await Promise.all(writes);
    for (const id of ids) {
      await rm(this.transcriptPath(id), { force: true });
      await this.content.delete(id);
    }
  }

  private beginTurn(threadId: string, text: string, options: TurnOptions = {}, stored?: Promise<void>) {
    if (this.closing) throw new UserError('This machine is shutting down');
    const thread = this.require(threadId);
    if (this.lifecycle.has(threadId)) throw new UserError('Wait for the current thread action to finish.');
    if (thread.delivery?.status === 'queued' && !options.delivery && !options.resume && !options.retry) throw new UserError('Cancel the queued delivery before sending more work.');
    if (options.resume) assertResumable(thread);
    if (this.running.has(threadId) || thread.status === 'running') throw new UserError('This thread is already working. Stop it or wait for it to finish.');
    const controller = new AbortController();
    this.running.set(threadId, controller);
    const preparation = this.prepareTurn(threadId, text, options, controller, stored);
    this.preparing.add(preparation);
    void preparation.then(() => this.preparing.delete(preparation), () => this.preparing.delete(preparation));
    return preparation;
  }

  private async prepareTurn(threadId: string, text: string, options: TurnOptions, controller: AbortController, stored?: Promise<void>) {
    let release = () => {};
    let resources: TurnResources | undefined;
    let started = false;
    try {
      if (stored) await stored;
      let thread = this.require(threadId);
      if (thread.checkoutId) release = this.projects.useCheckout(thread.checkoutId);
      let resume = options.resume ?? false;
      let delivering = options.delivery ?? false;
      let pick = options.pick;
      if (resume) assertResumable(thread);
      if (options.retry || resume) {
        const items = (await this.transcript(threadId)).items;
        const last = items.findLast(item => item.kind === 'user');
        delivering = !!(last?.kind === 'user' && last.delivery && thread.delivery);
        if (options.retry) ({ text, resume, pick } = retryOf(thread, items));
      }
      if (delivering && thread.delivery?.followUpsStoppedAt) throw new UserError('Automatic delivery was stopped. Request Ship again before continuing publication.');
      const picked = pick ? pickPrompt((await this.transcript(threadId)).items, pick, text) : text;
      if (picked === undefined) throw new UserError('That option is no longer available');
      if (!this.profiles.get(thread.profileId)) throw new UserError('The profile this thread started with no longer exists');
      const access = await this.profiles.hubAccess(thread.profileId, thread.model.harnessId === 'codex' ? 'openai' : 'anthropic');
      if (controller.signal.aborted || this.closing) throw new UserError('Turn interrupted before starting');
      thread = this.require(threadId);
      thread = { ...thread, model: this.models.require(thread.profileId, thread.model) };
      if (thread.workspace?.releasedAt) {
        const workspace = await this.deliveryGit.allocate(threadId, thread.workspace.sourcePath, thread.delivery?.publishedRevision ?? 'HEAD');
        if (!workspace) throw new UserError('Could not restore an owned workspace.');
        thread = { ...thread, workspace, sessionId: null, delivery: undefined };
      }
      if (delivering) thread = { ...thread, delivery: { ...thread.delivery!, status: 'running', detail: undefined } };
      else {
        if (!options.resume && !options.retry) thread = { ...thread, workVersion: (thread.workVersion ?? 0) + 1 };
        if (thread.delivery && ['delivered', 'ready', 'waiting'].includes(thread.delivery.status)) { this.clearDeliveryCheck(threadId); thread = { ...thread, delivery: { ...thread.delivery, status: 'blocked', detail: 'New work needs to be shipped before archiving.' } }; }
      }
      const cwd = this.cwd(thread);
      const prompt = delivering && !resume ? deliveryPrompt(thread.workspace!, thread.delivery!) : picked;
      if (delivering && !resume) text = thread.delivery!.mode === 'review' ? 'Prepare for review.' : `Ship to ${thread.delivery!.baseBranch} when ready.`;
      const next = startTurn(thread, text, now());
      const turnId = randomUUID();
      started = true;
      this.startingThreads.delete(thread.id);
      await this.update(thread.id, () => next);
      await this.addItem(thread.id, { kind: 'user', id: `${turnId}:u`, turnId, text, at: now(), ...(resume ? { resume } : {}), ...(delivering ? { delivery: thread.delivery!.mode } : {}), ...(pick ? { pick } : {}) });
      const env = harnessEnv(process.env, access, configFolderOf(this.home, thread.profileId));
      if (thread.model.harnessId === 'codex') {
        delete env.ANTHROPIC_AUTH_TOKEN; delete env.ANTHROPIC_BASE_URL; delete env.CLAUDE_CONFIG_DIR;
        env.CODEX_HOME = join(this.home, 'profiles', thread.profileId, 'codex');
        env.ACCIO_OPENAI_URL = `${access.baseUrl}/openai`;
        env.ACCIO_OPENAI_KEY = access.accessKey;
      }
      resources = await this.resources?.prepare(thread.profileId, thread.projectId, env, { repair: !!thread.repairToolId, cwd });
      if (controller.signal.aborted || this.closing) throw new UserError('Turn interrupted before starting');
      if (resources && (resources.snapshot.tools.length || resources.snapshot.skills.length || resources.snapshot.mcps.length)) {
        await this.addItem(thread.id, { kind: 'notice', id: `${turnId}:resources`, turnId, tone: 'info', text: `Resources for this turn: ${JSON.stringify(resources.snapshot)}` });
      }
      const grant = this.tools?.grant(thread.id);
      const turnResources = resources;
      const turn = this.runTurn(next, turnId, { cwd, prompt, env: resources?.env ?? env, signal: controller.signal, ...(grant ? { tools: grant.access } : {}), resourceInstructions: resources?.instructions, mcps: resources?.mcps }, delivering).finally(() => { turnResources?.release(); grant?.revoke(); });
      resources = undefined;
      this.turns.add(turn);
      void turn.then(() => this.turns.delete(turn), (err) => {
        this.turns.delete(turn);
        console.error('[threads] finishing turn failed', err);
      });
    } catch (err) {
      resources?.release();
      this.running.delete(threadId);
      if (started) await this.update(threadId, (t) => endTurn(t, controller.signal.aborted ? 'interrupted' : 'failed', now()));
      throw err;
    } finally {
      release();
    }
  }

  private async runTurn(
    thread: Thread,
    turnId: string,
    run: { cwd: string; prompt: string; env: Record<string, string>; tools?: ToolAccess; signal: AbortSignal; resourceInstructions?: string; mcps?: import('./harness.js').HarnessTurn['mcps'] },
    delivering = false,
  ) {
    const transcript = new TurnTranscript(turnId);
    const startedAt = Date.now();
    let outcome: TurnOutcome | null = null;
    try {
      if (run.signal.aborted) {
        outcome = 'interrupted';
        return;
      }
      const harness = this.harnesses[thread.model.harnessId];
      if (!harness) throw new UserError('This harness is not installed on this machine');
      const requestSecret = this.secrets.forTurn({ threadId: thread.id, turnId, profileId: thread.profileId,
        profileName: this.profiles.require(thread.profileId).name, projectId: thread.projectId || null,
        projectName: this.projects.state().projects.find(p => p.id === thread.projectId)?.name ?? 'No project',
        machineName: this.machines.views().find(m => m.thisMachine)?.name ?? 'This machine', signal: run.signal });
      for await (const msg of harness.run({ ...run, sessionId: thread.sessionId, model: thread.model.modelId, requestSecret, modelName: this.models.modelName(thread.profileId, thread.model),
        secretPurposes: this.secrets.purposes(thread.profileId, thread.projectId || null) })) {
        for (const change of transcript.accept(msg)) {
          if (change.type === 'end') outcome = change.outcome;
          await this.apply(thread.id, change, run.cwd);
        }
      }
      if (run.signal.aborted) {
        outcome = 'interrupted';
      } else if (!outcome) {
        outcome = 'failed';
        await this.addItem(thread.id, {
          kind: 'notice',
          id: `${turnId}:end`,
          turnId,
          tone: 'error',
          text: `${thread.model.harnessId === 'codex' ? 'Codex' : 'Claude Code'} stopped without finishing the turn.`,
        });
      }
    } catch (err) {
      if (run.signal.aborted) outcome = 'interrupted';
      else {
        outcome = 'failed';
        await this.addItem(thread.id, { kind: 'notice', id: `${turnId}:err`, turnId, tone: 'error', text: (err as Error).message });
      }
    } finally {
      try {
        await this.secrets.endTurn(turnId);
        if (delivering) {
          const current = this.require(thread.id);
          try {
            if (outcome !== 'completed') throw new UserError('Delivery paused. Check the conversation, then request Ship again.');
            await this.verifyDelivery(current, true);
          } catch (error) {
            const detail = (error as Error).message;
            await this.recordDeliveryWait(thread.id, error as Error);
            await this.addItem(thread.id, { kind: 'notice', id: `${turnId}:delivery`, turnId, tone: 'info', text: detail });
          }
        }
        if (outcome === 'interrupted') {
          await this.addItem(thread.id, { kind: 'notice', id: `${turnId}:stop`, turnId, tone: 'info', text: 'Stopped.' });
        }
        for (const item of transcript.unfinishedTools(outcome === 'interrupted' ? 'interrupted' : 'error')) await this.addItem(thread.id, item);
        if (outcome === 'completed') await this.addItem(thread.id, { kind: 'finished', id: `${turnId}:finished`, turnId, ms: Date.now() - startedAt });
        await this.flush(thread.id);
      } catch (error) {
        if (outcome !== 'interrupted') outcome = 'failed';
        const detail = error instanceof Error ? error.message : String(error);
        await this.addItem(thread.id, { kind: 'notice', id: `${turnId}:save`, turnId, tone: 'error', text: `Could not save this turn: ${detail}` });
        throw error;
      } finally {
        // A storage failure must never leave a finished turn holding its slot.
        this.running.delete(thread.id);
        await this.updateDurably(thread.id, t => this.settleDelivered(endTurn(t.delivery?.status === 'running'
          ? { ...t, delivery: { ...t.delivery, status: 'waiting' } } : t, outcome ?? 'failed', now())));
        await this.deliveryReceipt(thread.id);
        this.scheduleDeliveryCheck(thread.id);
        if (thread.repairToolId && outcome === 'completed') this.onRepairFinished?.(thread.repairToolId);
        if (outcome === 'completed') await this.dispatchDelivery(thread.id);
      }
    }
  }

  private async apply(threadId: string, change: TranscriptChange, cwd: string) {
    if (change.type === 'session') {
      await this.update(threadId, (t) => ({ ...t, sessionId: change.sessionId }), { quiet: true });
    } else if (change.type === 'tool' && isChoiceTool(change.item.name)) {
      await this.offerChoice(threadId, change, cwd);
    } else if (change.type === 'tool') {
      await this.content.saveTool(threadId, change.item.id, change.input, change.content);
      await this.addItem(threadId, change.item);
    } else if (change.type === 'item') {
      let item = change.item;
      if (item.kind === 'assistant' && item.text) {
        const live = await this.transcript(threadId);
        const previous = live.items.find((entry) => entry.id === item.id);
        const media = await this.content.snapshotMarkdown(threadId, cwd, item.text, previous?.kind === 'assistant' ? previous.media : []);
        item = { ...item, media };
      }
      await this.addItem(threadId, item);
    } else if (change.type === 'delta') {
      const live = await this.transcript(threadId);
      live.items = live.items.map((i) => (i.id === change.itemId && i.kind === 'assistant' ? { ...i, text: i.text + change.text } : i));
      this.scheduleSave(threadId, live);
      this.broadcast('thread.delta', { threadId, cursor: ++live.cursor, itemId: change.itemId, text: change.text });
    }
  }

  /**
   * A choice replaces its tool row once the arguments are complete and valid. Its
   * images are saved then, once. Invalid arguments fail the call, which shows as
   * an ordinary failed tool so the harness's mistake stays visible.
   */
  private async offerChoice(threadId: string, change: Extract<TranscriptChange, { type: 'tool' }>, cwd: string) {
    const live = await this.transcript(threadId);
    if (live.items.some((item) => item.id === change.item.id && item.kind === 'choice')) return;
    const offer = parseChoice(change.input);
    if (offer) {
      const options = [];
      for (const { path, label } of offer.options) {
        // Tool paths are plain paths; the asset reader expects Markdown's encoded destinations.
        const source = normalizeMarkdownSource(path);
        options.push(mediaKind(mediaMimeType(source) ?? '') === 'image'
          ? { label, ...await this.content.assets.snapshot(threadId, cwd, source) }
          : { label, source, error: 'Not a PNG, JPEG, GIF, WebP or AVIF image.' });
      }
      await this.addItem(threadId, { kind: 'choice', id: change.item.id, turnId: change.item.turnId, question: offer.question, options });
    } else if (change.item.status === 'error') {
      await this.content.saveTool(threadId, change.item.id, change.input, change.content);
      await this.addItem(threadId, change.item);
    }
  }

  // ---- storage ----

  private cwd(thread: Thread) {
    return thread.workspace && !thread.workspace.releasedAt ? thread.workspace.path : thread.checkoutId ? this.projects.checkout(thread.checkoutId).path : join(this.home, 'workspaces', thread.id);
  }

  private require(id: string): Thread {
    const t = this.list.find((x) => x.id === id);
    if (!t) throw new UserError('No such thread');
    return t;
  }

  private async update(id: string, fn: (t: Thread) => Thread, opts: { quiet?: boolean } = {}): Promise<Thread> {
    const updated = fn(this.require(id));
    await this.commit(
      this.list.map((t) => (t.id === id ? updated : t)),
      opts,
    );
    return updated;
  }

  /** Completion must reach disk before its settled row is broadcast. Preserve intervening writes. */
  private async updateDurably(id: string, fn: (t: Thread) => Thread): Promise<Thread> {
    const previous = this.require(id);
    let applied: Thread | undefined;
    try {
      const updated = await this.update(id, t => applied = fn(t), { quiet: true });
      this.broadcast('threads.changed', this.views());
      return updated;
    } catch (error) {
      if (this.require(id) === applied) {
        this.list = this.list.map(t => t.id === id ? previous : t);
        this.broadcast('threads.changed', this.views());
      }
      throw error;
    }
  }

  private async commit(next: Thread[], { quiet = false } = {}) {
    // Memory first, synchronously, so concurrent updates never start from a stale list.
    this.list = next;
    if (!quiet) this.broadcast('threads.changed', this.views());
    await this.file.write(next);
  }

  private views() { return this.list.filter(t => !this.startingThreads.has(t.id)).map(t => this.view(t)); }

  private transcriptPath(id: string) {
    return join(this.home, 'transcripts', `${id}.json`);
  }
  private view(thread: Thread) { return { ...toView(thread), ...(this.secrets.hasPending(thread.id) ? { needsSecret: true } : {}) }; }

  private async transcript(id: string): Promise<Live> {
    const live = this.transcripts.get(id);
    if (live) return live;
    // Share cold reads: observing while a turn starts must use the same cursor
    // and items as the writer, rather than installing two independent copies.
    let loading = this.loadingTranscripts.get(id);
    if (!loading) {
      const file = new JsonFile<TranscriptItem[]>(this.transcriptPath(id), () => []);
      loading = file.read().then((items) => {
        if (this.loadingTranscripts.get(id) !== loading) throw new UserError('No such thread');
        const loaded = { items, file, cursor: 0 };
        this.transcripts.set(id, loaded);
        return loaded;
      }).finally(() => {
        if (this.loadingTranscripts.get(id) === loading) this.loadingTranscripts.delete(id);
      });
      this.loadingTranscripts.set(id, loading);
    }
    return loading;
  }

  private async addItem(threadId: string, item: TranscriptItem) {
    const live = await this.transcript(threadId);
    if (item.kind === 'tool' && item.detailRevision === undefined) {
      const previous = live.items.find((entry) => entry.id === item.id);
      if (previous?.kind === 'tool' && previous.detailRevision !== undefined) item = { ...item, detailRevision: previous.detailRevision };
    }
    live.items = upsertItem(live.items, item);
    this.scheduleSave(threadId, live);
    this.broadcast('thread.item', { threadId, cursor: ++live.cursor, item });
  }

  private scheduleSave(_threadId: string, live: Live) {
    if (live.saveTimer) return;
    live.saveTimer = setTimeout(() => {
      live.saveTimer = undefined;
      live.file.write(live.items).catch((err) => console.error('[threads] saving transcript failed', err));
    }, 500);
  }

  private async flush(threadId: string) {
    const live = this.transcripts.get(threadId);
    if (!live) return;
    clearTimeout(live.saveTimer);
    live.saveTimer = undefined;
    await live.file.write(live.items);
  }

  /** Interrupts turns and flushes their resumable state before the machine exits. */
  async close() {
    this.closing = true;
    for (const id of this.deliveryTimers.keys()) this.clearDeliveryCheck(id);
    for (const controller of this.running.values()) controller.abort();
    await Promise.allSettled([...this.starts]);
    await Promise.allSettled([...this.preparing]);
    await Promise.allSettled([...this.turns]);
    await this.previews.close();
    for (const id of this.transcripts.keys()) await this.flush(id);
    await this.file.idle();
  }
}

function now() {
  return new Date().toISOString();
}
