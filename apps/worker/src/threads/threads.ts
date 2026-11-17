import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { implementMessage, issueNamedIn, threadHandle, type DeliveryStepName, type OfferedIssue, type ParamsOf, type ShippedNote, type ThreadView, type TranscriptItem } from '@accio/protocol';
import type { SecretsAccess } from '@accio/hub';
import { now } from '../time.js';
import type { Profiles } from '../profiles/profiles.js';
import type { Projects } from '../projects/projects.js';
import { UserError, type Broadcast, type Router } from '../rpc/router.js';
import type { Harness } from './harness.js';
import type { ResourceManager } from '../resources/resources.js';
import { builtinToolsOff, type BuiltinToolOverrides } from '../harnesses/builtinTools.js';
import { finishGoal, newGoal, newGoalPrompt, parseGoalCommand, pauseGoal, resumeGoal, type GoalCommand } from '../goals/goal.js';
import type { Models } from '../harnesses/models.js';
import { providerOf } from './harnessEnv.js';
import {
  RESUME_PROMPT,
  closeOpenTools,
  dropUnstarted,
  fromStored,
  newThread,
  reopen,
  settle,
  snooze,
  recoverAfterRestart,
  titleFrom,
  toView,
  upsertItem,
  type Thread,
} from './thread.js';
import type { Machines } from '../machine/machine.js';
import { ThreadAssets } from './assets.js';
import { Uploads } from './uploads.js';
import { ThreadContent } from './content.js';
import { markdownReferences } from './markdown.js';
import { SecretRequests } from '../secrets/secrets.js';
import type { AccioTools } from '../tools/tools.js';
import type { DeliveryHosting } from './delivery.js';
import { Deliveries } from './deliveries.js';
import { reportDeliveryStep } from './deliveryStep.js';
import { recordShippedNote } from './shippedNote.js';
import { Changelog, changelogEntry } from './changelog.js';
import { Previews } from './previews.js';
import { ThreadState } from './state.js';
import { agentTool } from './subagents.js';
import { Turns } from './turns.js';
import { registerThreadSkills } from './threadSkills.js';
import { ThreadNaming } from './naming.js';
import { changeHarness, readThreadPage } from './handoff.js';
import { Issues } from '../issues/issues.js';
import { findIssue, implementable, issueOfferTool, offeredIssues } from './issueOffer.js';
import type { SpaceContext } from '../spaces/spaceContext.js';
import { cleanExecutionEnv, harnessHomeEnv } from './harnessEnv.js';
import { Waits, waitForTool } from './waits.js';
import { Confirmations } from './confirmations.js';

/** Threads on this machine, their transcripts, and the turns running in them. */
export class Threads {
  get runningCount() { return this.state.running.size; }
  /** This machine's threads, as clients see them. */
  views() { return this.state.views(); }
  /** The turn running in a thread on this machine, for an accio tool that records items in it. */
  runningTurn(threadId: string) { return this.turns.runningTurn(threadId); }
  profileReferences() { return this.state.list.map((thread) => thread.profileId); }
  resources?: ResourceManager;
  onRepairFinished?: (toolId: string) => void;
  /** GLOSSARY: Space. What each turn of a thread in a space is told about it; none until it is set. */
  spaceContext?: SpaceContext;
  /** The hub's built-in tool overrides; accio's defaults apply until it is set. */
  toolOverrides?: () => BuiltinToolOverrides;
  readonly assets: ThreadAssets;
  private readonly uploads: Uploads;
  readonly secrets: SecretRequests;
  /** GLOSSARY: Confirmation. */
  readonly confirmations: Confirmations;
  private state: ThreadState;
  private content: ThreadContent;
  private previews: Previews;
  private deliveries: Deliveries;
  private waits: Waits;
  private turns: Turns;
  private naming: ThreadNaming;
  private issues: Issues;
  private changelog: Changelog;
  /** GLOSSARY: Issue offer. Changes to offers run one at a time, so two starts both stay recorded. */
  private offerWrites: Promise<unknown> = Promise.resolve();
  private implementing = new Set<string>();
  private restartCandidates = new Set<string>();
  private restartDeliveries = new Set<string>();

  constructor(
    home: string,
    private profiles: Profiles,
    private projects: Projects,
    private harnesses: Record<string, Harness>,
    private broadcast: Broadcast,
    private models: Models,
    private machines: Machines,
    vault: SecretsAccess,
    /** GLOSSARY: Thread mention. Every thread this machine knows, other machines' included: the relay's merged list. */
    knownThreads: () => readonly ThreadView[],
    tools?: AccioTools,
    deliveryHosting?: DeliveryHosting,
  ) {
    this.state = new ThreadState(home, projects, broadcast, (threadId) => this.secrets.hasPending(threadId));
    this.naming = new ThreadNaming(this.state, profiles, models, harnesses);
    this.issues = new Issues((profileId, cwd, args) => machines.github.run(profileId, cwd, args));
    this.previews = new Previews(home);
    this.assets = new ThreadAssets(home, (threadId) => this.state.list.some((thread) => thread.id === threadId));
    this.uploads = new Uploads(home);
    this.content = new ThreadContent(home, this.assets);
    this.changelog = new Changelog(home, broadcast);
    this.secrets = new SecretRequests(home, vault, async (threadId, item) => {
      await this.state.transcripts.add(threadId, item);
      this.state.announce();
    });
    this.confirmations = new Confirmations(async (threadId, item) => {
      await this.state.transcripts.add(threadId, item);
      this.state.announce();
    });
    this.deliveries = new Deliveries(this.state, projects, this.previews, {
      beginTurn: (threadId, text, options) => this.turns.begin(threadId, text, options),
      withLifecycle: (threadId, action) => this.withLifecycle(threadId, action),
      delivered: (threadId, backfill) => this.recordShipped(threadId, backfill),
      describeShip: (threadId, files, signal) => this.naming.describeShip(threadId, files, signal),
      githubEnv: (profileId, cwd) => machines.github.env(profileId, cwd),
    }, deliveryHosting);
    this.turns = new Turns(this.state, { profiles, projects, models, machines, harnesses, secrets: this.secrets, confirmations: this.confirmations, content: this.content, deliveries: this.deliveries, tools,
      images: { claim: (threadId, ids) => this.uploads.claim(threadId, ids, this.assets), file: (threadId, asset) => this.assets.harnessFile(threadId, asset) },
      resources: () => this.resources, spaceContext: () => this.spaceContext, toolsOff: (harnessId) => builtinToolsOff(harnessId, this.toolOverrides?.()[harnessId]), onWorkFinished: id => this.naming.refine(id), onRepairFinished: (toolId) => this.onRepairFinished?.(toolId), knownThreads,
      offeredIssues: (threadId, refs) => this.offeredIssues(threadId, refs) });
    tools?.add(issueOfferTool((threadId, refs) => this.offeredIssues(threadId, refs, true), (threadId) => !!this.state.get(threadId)?.checkoutId));
    this.waits = new Waits(this.state, {
      threads: knownThreads,
      wake: (threadId, text) => this.wake(threadId, text),
      pullRequest: async (thread, ref) => {
        const cwd = this.state.cwd(thread);
        return this.deliveries.git.pullRequest(cwd, ref, await machines.github.env(thread.profileId, cwd).catch(() => undefined));
      },
      command: async (thread) => {
        const cwd = this.state.cwd(thread);
        return { cwd, env: { ...cleanExecutionEnv(process.env), ...await machines.github.env(thread.profileId, cwd).catch(() => ({})) } };
      },
    });
    tools?.add(waitForTool((threadId, request) => this.waits.set(threadId, request)));
    tools?.add(agentTool((threadId, input, { signal, progress }) => this.turns.startSubagent(threadId, input, signal, progress)));
    projects.onRemoveThreads((id) => this.deleteThreads(this.state.list.filter((t) => t.checkoutId === id)));
    projects.onCheckInUse((checkoutId) => this.countUsing((t) => t.checkoutId === checkoutId));
    projects.onCheckProjectInUse((projectId) => this.countUsing((t) => t.projectId === projectId));
    profiles.onCheckInUse((profileId) => this.countUsing((t) => t.profileId === profileId));
  }

  private countUsing(pred: (t: Thread) => boolean): string | undefined {
    const n = this.state.list.filter(pred).length;
    return n ? `${n} thread${n > 1 ? 's' : ''}` : undefined;
  }

  async load() {
    const { state } = this;
    await this.secrets.load();
    await this.previews.load();
    await this.changelog.load();
    const stored = (await state.file.read()).map(fromStored).map(t => ({ ...t,
      queuedMessages: t.queuedMessages?.map(m => ({ ...m, editing: undefined })),
    }));
    if (stored.some(t => t.hubId && t.hubId !== this.profiles.client.id)) throw new UserError('Thread storage belongs to a different hub');
    const candidates = new Set(dropUnstarted(stored).map((t) => t.id));
    const started: Thread[] = [];
    for (const thread of stored) {
      // A title and session id alone do not prove a thread has no conversation.
      if (candidates.has(thread.id) || (await state.transcripts.get(thread.id)).items.length > 0) started.push(thread);
    }
    const savedAt = new Map<string, string | undefined>();
    for (const t of started) if (t.status === 'running') savedAt.set(t.id, await state.transcripts.savedAt(t.id));
    const { threads, interrupted } = recoverAfterRestart(started, t => savedAt.get(t.id));
    state.list = threads.map(t => t.delivery?.status === 'delivered' && t.delivery.completedAt && t.status === 'interrupted' ? { ...t, status: 'idle' } : t);
    const recoveredRelease = await this.deliveries.recoverReleases();
    for (const thread of interrupted) {
      const live = await state.transcripts.get(thread.id);
      live.items = live.items.map(item => item.kind === 'secret' && item.status === 'pending' ? { ...item, status: 'cancelled', candidates: [] } : item);
      const turnId = [...live.items].reverse().find((i) => i.kind === 'user')?.turnId ?? 'restart';
      live.items = upsertItem(closeOpenTools(live.items), {
        kind: 'notice',
        id: `${turnId}:restart`,
        turnId,
        tone: 'info',
        text: 'Interrupted: accio stopped while this turn was running.',
      });
      await state.transcripts.flush(thread.id);
    }
    if (recoveredRelease || interrupted.length || started.length < stored.length || state.list.some(t => t.delivery?.status === 'blocked')) await state.file.write(state.list);
    await this.deliveries.resumeObservation();
    this.restartCandidates = new Set(state.list.filter(t => t.status === 'interrupted' && t.resumeAfterRestart && t.sessionId).map(t => t.id));
    // A Ship requested while no turn was left to finish, such as a scripted ship cut off by the restart.
    this.restartDeliveries = new Set(state.list.filter(t => t.status === 'idle' && t.delivery?.status === 'queued').map(t => t.id));
  }

  /** Called once tools are listening, and again when an offline hub reconnects. */
  async continueAfterRestart() {
    const { state } = this;
    if (state.closing || this.profiles.client.status !== 'connected') return;
    for (const id of this.restartCandidates) {
      if (state.closing) return;
      this.restartCandidates.delete(id);
      const thread = state.list.find(t => t.id === id);
      // Asks what the resume below would, so a thread something else holds is left to it.
      if (!thread || thread.status !== 'interrupted' || state.busy(thread, { delivering: true, allow: ['queued', 'messages'] })) continue;
      try {
        await this.turns.begin(id, RESUME_PROMPT, { resume: true });
      } catch (error) {
        if (state.closing) continue;
        await state.update(id, t => ({ ...t, resumeAfterRestart: undefined }));
        await state.transcripts.add(id, { kind: 'notice', id: `${randomUUID()}:restart`, turnId: 'restart', tone: 'error',
          text: `Could not automatically resume this thread: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
    for (const id of this.restartDeliveries) {
      if (state.closing) return;
      this.restartDeliveries.delete(id);
      if (state.get(id)) await this.deliveries.dispatch(id).catch(error => console.error('[delivery] continuing after restart failed', error));
    }
    if (!state.closing) await this.waits.resume().catch(error => console.error('[waits] resuming after restart failed', error));
  }

  /** GLOSSARY: Wait. Threads changed here or on another machine, which may meet a Wait. */
  threadsChanged() { this.waits.changed(); }

  /**
   * GLOSSARY: Wait. Its Wait was met: start the next turn, or queue the message behind
   * whatever holds the thread now, so dispatchPending starts it once the thread is free.
   */
  private wake(threadId: string, text: string) {
    const { state, turns } = this;
    return this.withMessages(threadId, async () => {
      const thread = state.get(threadId);
      if (!thread) return;
      // This runs as the thread's message operation.
      const busy = state.busy(thread, { allow: ['messages'] });
      if (busy === 'closing') return;
      if (!busy) {
        try { await turns.begin(threadId, text, { wake: true }); return; }
        catch (error) { console.error('[waits] waking the thread failed; queued its message instead', error); }
      }
      await this.changeQueue(threadId, queue => [...queue, { id: randomUUID(), text, wake: true }]);
    });
  }

  register(router: Router) {
    const { state, turns, deliveries } = this;
    const { transcripts } = state;
    this.secrets.register(router, this.profiles, this.projects, this.broadcast);
    this.confirmations.register(router);
    registerThreadSkills(router, { state, profiles: this.profiles, projects: this.projects, resources: () => this.resources,
      harnessSkills: async (profileId, harnessId, cwd) => {
        const harness = this.harnesses[harnessId];
        return harness?.skills ? harness.skills({ cwd, env: harnessHomeEnv(state.home, profileId, harnessId) }) : undefined;
      },
      withLifecycle: (threadId, action) => this.withLifecycle(threadId, action) });
    const organize = (threadId: string, change: (t: Thread) => Thread) =>
      state.update(threadId, t => change({ ...t, organizationVersion: (t.organizationVersion ?? 0) + 1 })).then(toView);
    /** The thread's working folder, once `path` is a file explicitly linked in it. */
    const linkedCwd = async (threadId: string, path: string) => {
      const thread = state.require(threadId);
      if (thread.workspace?.releasedAt) throw new UserError('This thread’s worktree was released. Saved media remains in the conversation; send a follow-up to restore a working copy.');
      const live = await transcripts.get(threadId);
      state.require(threadId);
      const linked = live.items.some((item) => item.kind === 'assistant' && markdownReferences(item.text).files.includes(path));
      if (!linked) throw new UserError('This file is not linked in the thread');
      return state.cwd(thread);
    };
    router
      .on('threads.start', input => this.start(input))
      .on('threads.issues', ({ checkoutId }) => {
        const checkout = this.projects.checkout(checkoutId);
        return this.issues.list(this.projects.projectOf(checkout).profileId, checkout.path);
      })
      .on('threads.issueBody', ({ checkoutId, ref }) => {
        const checkout = this.projects.checkout(checkoutId);
        return this.issues.body(this.projects.projectOf(checkout).profileId, checkout.path, ref);
      })
      .on('threads.offeredIssues', async ({ threadId, offerId }) => {
        const { offer, profileId, checkoutPath } = await this.issueOffer(threadId, offerId);
        const list = await this.issues.list(profileId, checkoutPath);
        return { issues: offer.issues.map(({ ref }) => { const issue = findIssue(list.issues, ref); return issue ? { ref, issue } : { ref }; }),
          ...(list.unavailable ? { unavailable: list.unavailable } : {}) };
      })
      .on('threads.implementIssue', ({ threadId, offerId, ref }) => this.implementIssue(threadId, offerId, ref))
      .on('threads.transcript', async ({ threadId }) => {
        const live = await transcripts.get(state.require(threadId).id);
        state.require(threadId);
        return live.items;
      })
      .on('threads.observe', async ({ threadId }) => {
        const live = await transcripts.get(state.require(threadId).id);
        state.require(threadId);
        // No await between reading items and cursor. All mutations replace the
        // array/items, so this snapshot stays fixed even before RPC serialization.
        return { items: live.items, cursor: live.cursor };
      })
      .on('threads.toolDetails', async ({ threadId, itemId }) => {
        state.require(threadId);
        const live = await transcripts.get(threadId);
        const item = live.items.find((entry) => entry.id === itemId);
        if (item?.kind !== 'tool') throw new UserError('No such tool call');
        const details = await this.content.details(threadId, itemId);
        state.require(threadId);
        if (details) return details;
        if (item.detailRevision !== undefined) throw new UserError('Tool details are unavailable');
        return { input: null, parts: item.output ? [{ type: 'text' as const, text: item.output }] : [] };
      })
      .on('threads.assetUrl', ({ threadId, assetId, download }) => {
        state.require(threadId);
        return this.assets.assetUrl(threadId, assetId, download);
      })
      .on('threads.fileUrl', async ({ threadId, path }) => this.assets.fileUrl(threadId, await linkedCwd(threadId, path), path))
      .on('threads.media', async (input) => {
        state.require(input.threadId);
        if ('assetId' in input) return this.assets.read(input.threadId, { assetId: input.assetId });
        return this.assets.read(input.threadId, { cwd: await linkedCwd(input.threadId, input.path), source: input.path });
      })
      .on('threads.upload', (input) => this.uploads.add(input))
      .on('threads.send', ({ threadId, text, pick, images: uploads = [], mode }) => {
        // Never wait behind a starting turn for steering: it may be blocked on
        // authentication, and the caller must keep its unsent draft immediately.
        // A scripted ship holds the slot with no turn to steer.
        if (state.running.has(threadId) && !turns.canSteer(threadId)) {
          this.assertMessageAllowed(threadId);
          if (mode !== 'queue') throw new UserError('The agent is starting or finishing. Try sending again in a moment.');
        }
        const goal = parseGoalCommand(text);
        if (goal && !pick && !uploads.length) return this.withMessages(threadId, () => this.goalCommand(threadId, goal, text));
        return this.withMessages(threadId, async () => {
          this.assertMessageAllowed(threadId);
          const thread = state.require(threadId);
          const images = await this.uploads.claim(threadId, uploads, this.assets);
          if (!state.running.has(threadId)) await turns.begin(threadId, text, { pick, images });
          else if (mode === 'queue') {
            this.models.assertReadsImages(thread.profileId, thread.model, images);
            await this.changeQueue(threadId, queue => [...queue, { id: randomUUID(), text, ...(pick ? { pick } : {}), ...(images.length ? { images } : {}) }]);
          } else await turns.steer(threadId, text, pick, undefined, images);
          await this.uploads.release(uploads);
          return null;
        });
      })
      .on('threads.queued', ({ threadId, messageId, action, text }) => this.withMessages(threadId, async () => {
        if (turns.queuedStart(threadId) === messageId) throw new UserError('This queued message is already starting.');
        const message = state.require(threadId).queuedMessages?.find(m => m.id === messageId);
        if (!message) throw new UserError('This message is no longer queued.');
        if (action === 'steer') {
          this.assertMessageAllowed(threadId);
          if (message.editing) throw new UserError('Finish editing this message first.');
          if (state.running.has(threadId)) {
            await turns.steer(threadId, message.text, message.pick, undefined, message.images);
            await this.changeQueue(threadId, queue => queue.filter(m => m.id !== messageId));
          } else await turns.begin(threadId, message.text, { pick: message.pick, images: message.images, queuedId: messageId });
        } else {
          if (action === 'save' && !text && !message.images?.length) throw new UserError('Write a message before saving.');
          await this.changeQueue(threadId, queue => action === 'remove' ? queue.filter(m => m.id !== messageId)
            : queue.map(m => m.id !== messageId ? m : { ...m, text: action === 'save' ? text! : m.text, editing: action === 'edit' }));
          await turns.dispatchPending(threadId);
        }
        return null;
      }))
      .on('threads.goal', ({ threadId, action }) => this.withMessages(threadId, async () => {
        await this.goalCommand(threadId, { type: action }, `/goal ${action}`);
        return toView(state.require(threadId));
      }))
      .on('threads.cancelWait', ({ threadId }) => this.withMessages(threadId, async () => {
        await this.waits.cancel(threadId);
        // A goal the Wait held back continues now.
        if (!state.running.has(threadId)) await turns.dispatchPending(threadId);
        return toView(state.require(threadId));
      }))
      .on('threads.deliverySummary', ({ threadId }) => deliveries.summary(threadId))
      .on('threads.deliver', ({ threadId, mode }) => deliveries.request(threadId, mode))
      .on('threads.cancelDelivery', ({ threadId }) => deliveries.cancel(threadId))
      .on('threads.checkDelivery', async ({ threadId }) => { await deliveries.check(threadId, true); return toView(state.require(threadId)); })
      .on('threads.openPreview', ({ threadId }) => this.withLifecycle(threadId, async () => {
        const thread = state.require(threadId);
        const command = thread.checkoutId ? this.projects.projectOf(this.projects.checkout(thread.checkoutId)).previewCommand : undefined;
        if (!command || !thread.workspace || thread.workspace.releasedAt) throw new UserError('Set a preview command in project settings first.');
        return { url: await this.previews.open(threadId, thread.workspace.path, command) };
      }))
      .on('threads.archive', ({ threadId }) => deliveries.archive(threadId))
      .on('changelog.list', () => this.changelog.list())
      .on('threads.setModel', async ({ threadId, model }) => {
        await this.models.ready(state.require(threadId).profileId);
        const thread = state.require(threadId);
        if (state.running.has(threadId) || thread.status === 'running') throw new UserError('Wait for this turn to finish before changing its model.');
        const selected = this.models.requireExact(thread.profileId, model);
        // ADR 0017: another harness continues the thread with the history it missed.
        const lastItemId = selected.harnessId === thread.model.harnessId ? null : (await state.transcripts.get(threadId)).items.at(-1)?.id ?? null;
        return toView(await state.update(threadId, (t) => ({ ...changeHarness(t, selected.harnessId, lastItemId), model: selected })));
      })
      .on('threads.stop', async ({ threadId }) => {
        const controller = state.running.get(state.require(threadId).id);
        if (!controller) throw new UserError('This thread is not working');
        try { await state.update(threadId, t => ({ ...t, resumeAfterRestart: false }), { quiet: true }); }
        finally { controller.abort(); }
        return null;
      })
      .on('threads.resume', async ({ threadId }) => {
        await turns.begin(threadId, RESUME_PROMPT, { resume: true });
        return null;
      })
      .on('threads.retry', async ({ threadId }) => {
        await turns.begin(threadId, '', { retry: true });
        return null;
      })
      .on('threads.snooze', ({ threadId, until }) => organize(threadId, t => snooze(t, until)))
      .on('threads.settle', async ({ threadId }) => {
        // GLOSSARY: Wait. A settled thread is done: its Wait, and any command it runs, stop.
        if (state.require(threadId).wait) await this.waits.cancel(threadId);
        const view = await organize(threadId, t => settle(t, now()));
        void deliveries.releaseIfUnchanged(threadId);
        return view;
      })
      .on('threads.reopen', ({ threadId }) => organize(threadId, t => reopen({ ...t, ...(t.delivery ? { delivery: { ...t.delivery, keepOpen: true } } : {}) })))
      .on('threads.rename', async ({ threadId, title }) => {
        this.naming.cancel(threadId);
        return toView(await state.updateDurably(threadId, t => ({ ...t, title, titleManual: true, titleNeedsRefinement: false })));
      })
      .on('threads.regenerateTitle', async ({ threadId }) => {
        await this.naming.regenerate(threadId);
        return toView(state.require(threadId));
      })
      .on('threads.previewTitle', async ({ threadId, instructions, model }) => {
        const result = await this.naming.preview(threadId, { automatic: true, instructions, model });
        return { title: result.title };
      })
      .on('threads.delete', async ({ threadId }) => {
        await this.deleteThreads([state.require(threadId)]);
        return null;
      });
  }

  start(input: ParamsOf<'threads.start'>, options: { repairToolId?: string } = {}) {
    const { state } = this;
    return state.track(async () => {
      const { text, model, machineId, images: uploads = [] } = input;
      if (machineId) {
        await this.machines.refresh();
        const machine = this.machines.views().find((m) => m.id === machineId);
        if (!machine) throw new UserError('No such machine');
        if (!machine.connected) throw new UserError('This machine is offline');
        if (!machine.thisMachine) throw new UserError(`Update accio on ${machine.name} to start threads there.`);
      }
      state.assertOpen();
      const checkout = 'checkoutId' in input ? this.projects.checkout(input.checkoutId) : undefined;
      const project = checkout ? this.projects.projectOf(checkout) : undefined;
      const profileId = project?.profileId ?? ('profileId' in input ? input.profileId : '');
      const releaseProfile = this.profiles.useProfile(profileId);
      let release = () => {};
      try {
        if (checkout) release = this.projects.useCheckout(checkout.id);
        // Refuse before anything is stored, so a thread that cannot run never appears.
        await this.models.ready(profileId);
        const choice = model ?? this.models.default(profileId);
        await this.profiles.hubAccess(profileId, providerOf(choice.harnessId));
        state.assertOpen();
        const selected = model ? this.models.requireExact(profileId, choice) : this.models.require(profileId, choice);
        // GLOSSARY: a thread keeps the profile it started with for its whole life.
        const thread = newThread({ checkoutId: checkout?.id ?? '', projectId: project?.id ?? '', profileId, hubId: this.profiles.client.id, model: selected }, now());
        const goal = parseGoalCommand(text);
        if (goal && goal.type !== 'set') throw new UserError('Start a thread with /goal <objective>.');
        if (goal?.type === 'set') thread.goal = newGoal(goal.objective, now());
        // GLOSSARY: Issue. A thread from an issue starts with the issue's title, not its reference.
        const issue = checkout ? input.issue?.ref ?? issueNamedIn(text) : undefined;
        if (issue) thread.issue = issue;
        if (checkout && input.issue?.title) thread.title = titleFrom(input.issue.ref.startsWith('#') ? `${input.issue.ref} ${input.issue.title}` : input.issue.title);
        if (input.startedBy) thread.startedBy = input.startedBy;
        if (options.repairToolId) { thread.repairToolId = options.repairToolId; thread.title = `Repair ${this.resources?.state().tools.find(tool => tool.id === options.repairToolId)?.name ?? options.repairToolId}`; }
        if (checkout) thread.workspace = await this.deliveries.git.allocate(thread.id, checkout.path);
        if (!checkout) await mkdir(join(state.home, 'workspaces', thread.id), { recursive: true });
        // Quiet: clients first see the thread once its turn is running, never as an idle empty thread.
        state.starting.add(thread.id);
        const stored = state.commit([...state.list, thread], { quiet: true });
        try {
          // Reserve synchronously with insertion, before persistence yields to another intent.
          await this.turns.begin(thread.id, text, { uploads }, stored);
        } catch (err) {
          state.starting.delete(thread.id);
          if (thread.workspace) {
            // A failed start must leave a recoverable owner for its allocated worktree.
            const live = await state.transcripts.get(thread.id);
            if (!live.items.some(item => item.kind === 'user')) {
              const turnId = randomUUID();
              await state.transcripts.add(thread.id, { kind: 'user', id: `${turnId}:u`, turnId, text, at: now() });
              await state.transcripts.add(thread.id, { kind: 'notice', id: `${turnId}:err`, turnId, tone: 'error', text: (err as Error).message });
            }
            await state.update(thread.id, t => ({ ...t, title: titleFrom(text), status: 'failed' }));
            await state.transcripts.flush(thread.id);
          } else await this.deleteThreads([state.require(thread.id)]);
          throw err;
        }
        await this.uploads.release(uploads);
        this.naming.initial(thread.id);
        if (checkout && input.issue) void this.claimIssue(thread.id, checkout.path, input.issue.ref);
        return toView(state.require(thread.id));
      } finally {
        release();
        releaseProfile();
      }
    });
  }

  /** GLOSSARY: Issue offer. The offered references as the thread's tracker lists them; throws for any it doesn't. */
  private async offeredIssues(threadId: string, refs: string[], fresh = false): Promise<OfferedIssue[]> {
    const thread = this.state.require(threadId);
    if (!thread.checkoutId) throw new UserError('Only a thread in a project can offer issues.');
    const checkout = this.projects.checkout(thread.checkoutId);
    return offeredIssues(await this.issues.list(thread.profileId, checkout.path, fresh), refs);
  }

  private async issueOffer(threadId: string, offerId: string) {
    const thread = this.state.require(threadId);
    const live = await this.state.transcripts.get(threadId);
    const offer = live.items.find((item): item is Extract<TranscriptItem, { kind: 'issueOffer' }> => item.kind === 'issueOffer' && item.id === offerId);
    if (!offer) throw new UserError('No such issue offer');
    if (!thread.checkoutId) throw new UserError('This thread has no project checkout.');
    return { thread, offer, profileId: thread.profileId, checkoutPath: this.projects.checkout(thread.checkoutId).path };
  }

  /**
   * GLOSSARY: Issue offer. Starts a thread on one offered issue, through the issue
   * picker's path so it is claimed the same way, once the tracker shows it open,
   * unblocked and unclaimed. The offer records the thread.
   */
  private async implementIssue(threadId: string, offerId: string, ref: string): Promise<ThreadView> {
    const key = JSON.stringify([threadId, offerId, ref]);
    if (this.implementing.has(key)) throw new UserError('Already starting a thread for this issue.');
    this.implementing.add(key);
    try {
      const { thread, offer, profileId, checkoutPath } = await this.issueOffer(threadId, offerId);
      const offered = offer.issues.find((issue) => issue.ref === ref);
      if (!offered) throw new UserError(`${ref} is not in this offer.`);
      if (offered.threadId && this.state.get(offered.threadId)) throw new UserError(`${offered.label} already has a thread.`);
      const issue = findIssue((await this.issues.list(profileId, checkoutPath, true)).issues, ref);
      const can = implementable(issue);
      if (!can.ok) throw new UserError(can.reason === 'closed' ? `${offered.label} is no longer open.` : can.reason === 'claimed' ? `${offered.label} is already claimed.` : `${offered.label} ${can.reason}.`);
      const started = await this.start({ checkoutId: thread.checkoutId, text: implementMessage(issue!, threadHandle(thread)), model: thread.model, issue: { ref: issue!.ref, title: issue!.title } });
      const write = this.offerWrites.then(async () => {
        const live = await this.state.transcripts.get(threadId);
        const current = live.items.find((item) => item.kind === 'issueOffer' && item.id === offerId);
        if (current?.kind !== 'issueOffer') return;
        await this.state.transcripts.add(threadId, { ...current, issues: current.issues.map((i) => i.ref === ref ? { ...i, threadId: started.id } : i) });
      });
      this.offerWrites = write.catch(() => {});
      await write;
      return started;
    } finally {
      this.implementing.delete(key);
    }
  }

  /** GLOSSARY: Issue. Claims the issue a thread started from; a failure is noted in the thread, never undoing the start. */
  private async claimIssue(threadId: string, checkoutPath: string, ref: string) {
    const { state } = this;
    const thread = state.get(threadId);
    if (!thread) return;
    try {
      await this.issues.claim(thread.profileId, checkoutPath, state.cwd(thread), ref);
    } catch (error) {
      if (!state.get(threadId)) return;
      await state.transcripts.add(threadId, { kind: 'notice', id: `${randomUUID()}:issue`, turnId: 'issue', tone: 'error',
        text: `Could not claim ${ref}: ${(error as { stderr?: string }).stderr?.trim() || (error as Error).message}` });
      state.announce();
    }
  }

  /**
   * GLOSSARY: Goal. `/goal <objective>` sets it and starts (or steers) work toward it;
   * pause, resume and clear change it without a message to the harness. Pausing lets
   * a running turn finish; only the automatic next turn is skipped.
   */
  private async goalCommand(threadId: string, command: GoalCommand, text: string) {
    const { state, turns } = this;
    const thread = state.require(threadId);
    if (command.type === 'set') {
      this.assertMessageAllowed(threadId);
      const goal = newGoal(command.objective, now());
      await state.update(threadId, t => ({ ...t, goal }));
      if (!state.running.has(threadId)) await turns.begin(threadId, text);
      else await turns.steer(threadId, text, undefined, newGoalPrompt(command.objective));
    } else if (command.type === 'clear') {
      if (!thread.goal) throw new UserError('This thread has no goal.');
      await state.update(threadId, ({ goal: _, ...t }) => t);
    } else if (command.type === 'pause') {
      const goal = pauseGoal(thread.goal);
      await state.update(threadId, t => ({ ...t, goal }));
    } else {
      const goal = resumeGoal(thread.goal);
      await state.update(threadId, t => ({ ...t, goal }));
      if (!state.running.has(threadId)) { this.assertMessageAllowed(threadId); await turns.continueGoal(threadId); }
    }
    return null;
  }

  /** The `finish_goal` tool, called by the harness during a turn of this thread. */
  async finishGoal(threadId: string, outcome: 'achieved' | 'blocked', summary: string) {
    await this.state.update(threadId, t => ({ ...t, goal: finishGoal(t.goal, outcome, summary) }));
  }

  /** The `delivery_step` tool, called by the harness during this thread's delivery turn. */
  async reportDeliveryStep(threadId: string, step: DeliveryStepName, note: string | undefined) {
    await this.state.update(threadId, t => ({ ...t, delivery: reportDeliveryStep(t.delivery, step, note, now()) }));
  }

  async recordShippedNote(threadId: string, note: ShippedNote) {
    await this.state.update(threadId, t => ({ ...t, delivery: recordShippedNote(t.delivery, note) }));
  }

  /**
   * Logs a verified delivery once in the Changelog and, unless it was only found at startup,
   * adds its shipped note to the thread as a turn of its own.
   */
  private async recordShipped(threadId: string, backfill: boolean) {
    const thread = this.state.get(threadId);
    const entry = thread && changelogEntry(thread);
    if (!entry || !await this.changelog.add(entry) || backfill) return;
    const id = `shipped:${entry.id}`;
    await this.state.transcripts.add(threadId, { kind: 'shipped', id, turnId: id, at: entry.deliveredAt, entry });
  }

  deliveryRunning(threadId: string) {
    return this.state.get(threadId)?.delivery?.status === 'running';
  }

  async readThread(threadId: string, offset: number | undefined, limit: number) {
    return readThreadPage((await this.state.transcripts.get(threadId)).items, offset, limit);
  }

  /** The thread's profile and working folder, for an accio tool acting for it; undefined once it is gone. */
  toolContext(threadId: string): { profileId: string; cwd: string } | undefined {
    const thread = this.state.get(threadId);
    return thread && { profileId: thread.profileId, cwd: this.state.cwd(thread) };
  }

  goalActive(threadId: string) {
    return this.state.get(threadId)?.goal?.status === 'active';
  }

  private withMessages<T>(id: string, action: () => Promise<T>): Promise<T> {
    const { state } = this;
    const pending = (state.messageOps.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
    state.messageOps.set(id, pending);
    state.starts.add(pending);
    void pending.finally(() => {
      if (state.messageOps.get(id) === pending) state.messageOps.delete(id);
      state.starts.delete(pending);
    }).catch(() => {});
    return pending;
  }

  /** A message starts a turn, or steers or queues behind the running one. Callers run as the thread's message operation. */
  private assertMessageAllowed(id: string) {
    this.state.assertFree(this.state.require(id), { allow: ['running', 'queued', 'messages'] });
  }

  private async changeQueue(id: string, change: (queue: NonNullable<Thread['queuedMessages']>) => NonNullable<Thread['queuedMessages']>) {
    const { state } = this;
    state.assertOpen();
    const previous = state.require(id).queuedMessages;
    try { await state.update(id, t => ({ ...t, queuedMessages: change(t.queuedMessages ?? []) })); }
    catch (error) {
      state.restore(id, 'queuedMessages', previous);
      throw error;
    }
  }

  private async withLifecycle<T>(id: string, action: () => Promise<T>): Promise<T> {
    const { state } = this;
    // An action may overlap a turn and its messages, such as a preview opening as work ends.
    // Each action checks the rest of the rule itself.
    state.assertFree(state.require(id), { allow: ['delivery', 'stopping', 'running', 'queued', 'messages'] });
    state.lifecycle.add(id);
    const pending = action();
    state.starts.add(pending);
    try { return await pending; }
    finally {
      state.lifecycle.delete(id); state.starts.delete(pending);
      // Preview startup can overlap the end of work. Release its reservation
      // before dispatching work that waited behind it.
      if (state.list.find(t => t.id === id)?.status === 'idle') {
        await this.turns.dispatchPending(id);
      }
    }
  }

  private async deleteThreads(threads: Thread[]) {
    const { state } = this;
    // Validate the entire current membership before any effect.
    if (threads.some((t) => state.running.has(t.id) || t.status === 'running')) {
      throw new UserError('Stop the thread before deleting it');
    }
    if (threads.some(t => state.lifecycle.has(t.id) || t.delivery?.status === 'queued' || t.delivery?.status === 'waiting' || (t.workspace && !t.workspace.releasedAt))) throw new UserError('Archive the delivered workspace before deleting this thread. Unpublished work has been kept.');
    const ids = new Set(threads.map((t) => t.id));
    const saved = state.commit(state.list.filter((t) => !ids.has(t.id)));
    const writes = state.transcripts.forget(ids);
    for (const id of ids) {
      this.naming.cancel(id);
      state.starting.delete(id);
      this.deliveries.clearCheck(id);
      this.waits.forget(id);
    }
    await saved;
    await writes;
    for (const id of ids) {
      await state.transcripts.remove(id);
      await this.content.delete(id);
    }
  }

  /** Interrupts turns and flushes their resumable state before the machine exits. */
  async close() {
    const { state } = this;
    state.closing = true;
    await this.naming.close();
    this.deliveries.close();
    this.waits.close();
    // Persist intent before aborting. An already-aborted controller belongs to an explicit Stop.
    state.list = state.list.map(t => t.resumeAfterRestart !== false && state.running.has(t.id) && !state.running.get(t.id)!.signal.aborted && (t.sessionId || t.delivery?.status === 'running')
      ? { ...t, resumeAfterRestart: true } : t);
    try { await state.file.write(state.list); }
    finally { for (const controller of state.running.values()) controller.abort(); }
    await Promise.allSettled([...state.starts]);
    await this.turns.settled();
    await this.previews.close();
    await state.transcripts.flushAll();
    await state.file.idle();
  }
}
