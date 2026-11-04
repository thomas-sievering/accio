import { randomUUID } from 'node:crypto';
import { mediaKind, mediaMimeType, normalizeMarkdownSource, type ChoicePick, type WorkspaceSkill } from '@accio/protocol';
import type { Models } from '../harnesses/models.js';
import type { Machines } from '../machine/machine.js';
import type { Profiles } from '../profiles/profiles.js';
import type { Projects } from '../projects/projects.js';
import type { ResourceManager } from '../resources/resources.js';
import { observedSkillLoads } from '../resources/workspaceSkills.js';
import { UserError } from '../rpc/router.js';
import type { SecretRequests } from '../secrets/secrets.js';
import { now } from '../time.js';
import type { AccioTools } from '../tools/tools.js';
import { isChoiceTool, parseChoice, pickPrompt } from './choice.js';
import type { ThreadContent } from './content.js';
import type { Deliveries } from './deliveries.js';
import { deliveryPrompt } from './delivery.js';
import type { Harness, HarnessTurn, TurnResources } from './harness.js';
import { providerOf, turnEnv } from './harnessEnv.js';
import type { ThreadState } from './state.js';
import { assertResumable, endTurn, retryOf, startTurn, type Thread, type TurnOutcome } from './thread.js';
import { TurnTranscript, type TranscriptChange } from './transcript.js';

export type TurnOptions = { resume?: boolean; retry?: boolean; delivery?: boolean; pick?: ChoicePick; queuedId?: string };

export type TurnDeps = {
  profiles: Profiles;
  projects: Projects;
  models: Models;
  machines: Machines;
  harnesses: Record<string, Harness>;
  secrets: SecretRequests;
  content: ThreadContent;
  deliveries: Deliveries;
  tools?: AccioTools;
  resources: () => ResourceManager | undefined;
  onRepairFinished: (toolId: string) => void;
};

/** Starting, running, steering and finishing the turns of threads on this machine. */
export class Turns {
  private liveInputs = new Map<string, { turnId: string; send?: (text: string) => Promise<void> }>();
  private queuedStarts = new Map<string, string>();
  private preparing = new Set<Promise<void>>();
  private turns = new Set<Promise<void>>();

  constructor(private state: ThreadState, private deps: TurnDeps) {}

  /** Whether a turn can take steering input right now. */
  canSteer(threadId: string) { return !!this.liveInputs.get(threadId)?.send; }

  /** The queued message whose turn is starting, if any. */
  queuedStart(threadId: string) { return this.queuedStarts.get(threadId); }

  /** Resolves once every turn being prepared or run has finished. */
  async settled() {
    await Promise.allSettled([...this.preparing]);
    await Promise.allSettled([...this.turns]);
  }

  begin(threadId: string, text: string, options: TurnOptions = {}, stored?: Promise<void>) {
    const { state } = this;
    state.assertOpen();
    const thread = state.require(threadId);
    if (state.lifecycle.has(threadId)) throw new UserError('Wait for the current thread action to finish.');
    if (thread.delivery?.status === 'queued' && !options.delivery && !options.resume && !options.retry) throw new UserError('Cancel the queued delivery before sending more work.');
    if (options.resume) assertResumable(thread);
    if (state.running.has(threadId) || thread.status === 'running') throw new UserError('This thread is already working. Stop it or wait for it to finish.');
    const controller = new AbortController();
    state.running.set(threadId, controller);
    if (options.queuedId) this.queuedStarts.set(threadId, options.queuedId);
    const preparation = this.prepare(threadId, text, options, controller, stored);
    this.preparing.add(preparation);
    void preparation.finally(() => {
      this.preparing.delete(preparation);
      this.queuedStarts.delete(threadId);
    }).catch(() => {});
    return preparation;
  }

  async steer(id: string, text: string, pick?: ChoicePick) {
    const input = this.liveInputs.get(id);
    const send = input?.send;
    if (!input || !send) throw new UserError('The agent is starting or finishing. Try sending again in a moment.');
    const prompt = pick ? pickPrompt((await this.state.transcripts.get(id)).items, pick, text) : text;
    if (prompt === undefined) throw new UserError('That option is no longer available');
    await send(prompt);
    await this.state.transcripts.add(id, { kind: 'user', id: randomUUID(), turnId: input.turnId, text, at: now(), steered: true, ...(pick ? { pick } : {}) });
    await this.state.transcripts.flush(id);
  }

  async dispatchQueued(id: string) {
    const { state } = this;
    const thread = state.require(id);
    const message = thread.queuedMessages?.[0];
    if (!message || message.editing || state.closing || state.lifecycle.has(id) || state.running.has(id) || thread.status !== 'idle') return;
    try { await this.begin(id, message.text, { pick: message.pick, queuedId: message.id }); }
    catch (error) {
      await state.transcripts.add(id, { kind: 'notice', id: randomUUID(), turnId: 'queue', tone: 'error', text: `Queued message could not start: ${(error as Error).message}` });
    }
  }

  private async prepare(threadId: string, text: string, options: TurnOptions, controller: AbortController, stored?: Promise<void>) {
    const { state, deps } = this;
    const { transcripts } = state;
    let release = () => {};
    let resources: TurnResources | undefined;
    let started = false;
    try {
      if (stored) await stored;
      let thread = state.require(threadId);
      if (thread.checkoutId) release = deps.projects.useCheckout(thread.checkoutId);
      let resume = options.resume ?? false;
      let delivering = options.delivery ?? false;
      let pick = options.pick;
      if (resume) assertResumable(thread);
      if (options.retry || resume) {
        const items = (await transcripts.get(threadId)).items;
        const last = items.findLast(item => item.kind === 'user');
        delivering = !!(last?.kind === 'user' && last.delivery && thread.delivery);
        if (options.retry) ({ text, resume, pick } = retryOf(thread, items));
      }
      if (delivering && thread.delivery?.followUpsStoppedAt) throw new UserError('Automatic delivery was stopped. Request Ship again before continuing publication.');
      const picked = pick ? pickPrompt((await transcripts.get(threadId)).items, pick, text) : text;
      if (picked === undefined) throw new UserError('That option is no longer available');
      if (!deps.profiles.get(thread.profileId)) throw new UserError('The profile this thread started with no longer exists');
      const access = await deps.profiles.hubAccess(thread.profileId, providerOf(thread.model.harnessId));
      if (controller.signal.aborted || state.closing) throw new UserError('Turn interrupted before starting');
      await deps.models.ready(thread.profileId);
      thread = state.require(threadId);
      thread = { ...thread, model: deps.models.require(thread.profileId, thread.model) };
      if (thread.workspace?.releasedAt) {
        const workspace = await deps.deliveries.git.allocate(threadId, thread.workspace.sourcePath, thread.delivery?.publishedRevision ?? 'HEAD');
        if (!workspace) throw new UserError('Could not restore an owned workspace.');
        thread = { ...thread, workspace, sessionId: null, delivery: undefined };
      }
      if (delivering) thread = { ...thread, delivery: { ...thread.delivery!, status: 'running', detail: undefined } };
      else {
        if (!options.resume && !options.retry) thread = { ...thread, workVersion: (thread.workVersion ?? 0) + 1 };
        if (thread.delivery && ['delivered', 'ready', 'waiting'].includes(thread.delivery.status)) { deps.deliveries.clearCheck(threadId); thread = { ...thread, delivery: { ...thread.delivery, status: 'blocked', detail: 'New work needs to be shipped before archiving.' } }; }
      }
      const cwd = state.cwd(thread);
      const prompt = delivering && !resume ? deliveryPrompt(thread.workspace!, thread.delivery!) : picked;
      if (delivering && !resume) text = thread.delivery!.mode === 'review' ? 'Prepare for review.' : `Ship to ${thread.delivery!.baseBranch} when ready.`;
      let next = startTurn(thread, text, now());
      const turnId = randomUUID();
      started = true;
      state.starting.delete(thread.id);
      next = await state.update(thread.id, t => ({ ...next,
        queuedMessages: options.queuedId ? t.queuedMessages?.filter(m => m.id !== options.queuedId) : t.queuedMessages,
      }));
      await transcripts.add(thread.id, { kind: 'user', id: `${turnId}:u`, turnId, text, at: now(), ...(resume ? { resume } : {}), ...(delivering ? { delivery: thread.delivery!.mode } : {}), ...(pick ? { pick } : {}) });
      const env = turnEnv(state.home, thread.profileId, thread.model.harnessId, access);
      resources = await deps.resources()?.prepare(thread.profileId, thread.projectId, env, { repair: !!thread.repairToolId, cwd });
      if (controller.signal.aborted || state.closing) throw new UserError('Turn interrupted before starting');
      const grant = deps.tools?.grant(thread.id);
      const turnResources = resources;
      this.liveInputs.set(thread.id, { turnId });
      const turn = this.run(next, turnId, { cwd, prompt, env: resources?.env ?? env, signal: controller.signal, ...(grant ? { tools: grant.access } : {}), resourceInstructions: resources?.instructions, mcps: resources?.mcps }, delivering, resources?.skills).finally(() => { turnResources?.release(); grant?.revoke(); });
      resources = undefined;
      this.turns.add(turn);
      void turn.then(() => this.turns.delete(turn), (err) => {
        this.turns.delete(turn);
        console.error('[threads] finishing turn failed', err);
      });
    } catch (err) {
      resources?.release();
      state.running.delete(threadId);
      if (started) await state.update(threadId, (t) => endTurn(t, controller.signal.aborted ? 'interrupted' : 'failed', now()));
      throw err;
    } finally {
      release();
    }
  }

  private async run(
    thread: Thread,
    turnId: string,
    run: Pick<HarnessTurn, 'cwd' | 'prompt' | 'env' | 'tools' | 'signal' | 'resourceInstructions' | 'mcps'>,
    delivering = false,
    skills: WorkspaceSkill[] = [],
  ) {
    const { state, deps } = this;
    const { transcripts } = state;
    const transcript = new TurnTranscript(turnId);
    const startedAt = Date.now();
    let outcome: TurnOutcome | null = null;
    try {
      if (run.signal.aborted) {
        outcome = 'interrupted';
        return;
      }
      const harness = deps.harnesses[thread.model.harnessId];
      if (!harness) throw new UserError('This harness is not installed on this machine');
      const requestSecret = deps.secrets.forTurn({ threadId: thread.id, turnId, profileId: thread.profileId,
        profileName: deps.profiles.require(thread.profileId).name, projectId: thread.projectId || null,
        projectName: deps.projects.state().projects.find(p => p.id === thread.projectId)?.name ?? 'No project',
        machineName: deps.machines.views().find(m => m.thisMachine)?.name ?? 'This machine', signal: run.signal });
      for await (const msg of harness.run({ ...run, sessionId: thread.sessionId, model: thread.model.modelId, effort: deps.models.effort(thread.profileId, thread.model), requestSecret, modelName: deps.models.modelName(thread.profileId, thread.model),
        registerSteer: send => { const input = this.liveInputs.get(thread.id); if (input?.turnId === turnId) input.send = send; },
        secretPurposes: deps.secrets.purposes(thread.profileId, thread.projectId || null) })) {
        for (const change of transcript.accept(msg)) {
          if (change.type === 'end') outcome = change.outcome;
          await this.apply(thread.id, change, run.cwd, skills);
        }
      }
      if (run.signal.aborted) {
        outcome = 'interrupted';
      } else if (!outcome) {
        outcome = 'failed';
        await transcripts.add(thread.id, {
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
        await transcripts.add(thread.id, { kind: 'notice', id: `${turnId}:err`, turnId, tone: 'error', text: (err as Error).message });
      }
    } finally {
      const input = this.liveInputs.get(thread.id);
      if (input) input.send = undefined;
      await state.messageOps.get(thread.id)?.catch(() => {});
      this.liveInputs.delete(thread.id);
      try {
        await deps.secrets.endTurn(turnId);
        if (delivering) {
          const current = state.require(thread.id);
          try {
            if (outcome !== 'completed') throw new UserError('Delivery paused. Check the conversation, then request Ship again.');
            await deps.deliveries.verify(current, true);
          } catch (error) {
            const detail = (error as Error).message;
            await deps.deliveries.recordWait(thread.id, error as Error);
            await transcripts.add(thread.id, { kind: 'notice', id: `${turnId}:delivery`, turnId, tone: 'info', text: detail });
          }
        }
        if (outcome === 'interrupted') {
          await transcripts.add(thread.id, { kind: 'notice', id: `${turnId}:stop`, turnId, tone: 'info', text: 'Stopped.' });
        }
        for (const item of transcript.unfinishedTools(outcome === 'interrupted' ? 'interrupted' : 'error')) await transcripts.add(thread.id, item);
        if (outcome === 'completed') await transcripts.add(thread.id, { kind: 'finished', id: `${turnId}:finished`, turnId, ms: Date.now() - startedAt });
        await transcripts.flush(thread.id);
      } catch (error) {
        if (outcome !== 'interrupted') outcome = 'failed';
        const detail = error instanceof Error ? error.message : String(error);
        await transcripts.add(thread.id, { kind: 'notice', id: `${turnId}:save`, turnId, tone: 'error', text: `Could not save this turn: ${detail}` });
        throw error;
      } finally {
        // A storage failure must never leave a finished turn holding its slot.
        state.running.delete(thread.id);
        await state.updateDurably(thread.id, t => deps.deliveries.settleDelivered(endTurn(t.delivery?.status === 'running'
          ? { ...t, delivery: { ...t.delivery, status: 'waiting' } } : t, outcome ?? 'failed', now())));
        deps.deliveries.scheduleCheck(thread.id);
        // Every turn spends the account's allowance, so a model it used up is marked as soon as possible.
        deps.profiles.refreshLimits(thread.profileId, providerOf(thread.model.harnessId));
        if (thread.repairToolId && outcome === 'completed') deps.onRepairFinished(thread.repairToolId);
        if (outcome === 'completed') {
          await this.dispatchQueued(thread.id);
          await deps.deliveries.dispatch(thread.id);
        }
      }
    }
  }

  private async apply(threadId: string, change: TranscriptChange, cwd: string, skills: WorkspaceSkill[] = []) {
    const { state, deps } = this;
    if (change.type === 'session') {
      await state.update(threadId, (t) => ({ ...t, sessionId: change.sessionId }), { quiet: true });
    } else if (change.type === 'tool' && isChoiceTool(change.item.name)) {
      await this.offerChoice(threadId, change, cwd);
    } else if (change.type === 'tool') {
      await deps.content.saveTool(threadId, change.item.id, change.input, change.content);
      const loadedSkills = change.item.status === 'done' ? observedSkillLoads(change.item.name, change.input, change.item.summary, cwd, skills) : [];
      await state.transcripts.add(threadId, loadedSkills.length ? { ...change.item, loadedSkills } : change.item);
    } else if (change.type === 'item') {
      let item = change.item;
      if (item.kind === 'assistant' && item.text) {
        const live = await state.transcripts.get(threadId);
        const previous = live.items.find((entry) => entry.id === item.id);
        const media = await deps.content.snapshotMarkdown(threadId, cwd, item.text, previous?.kind === 'assistant' ? previous.media : []);
        item = { ...item, media };
      }
      await state.transcripts.add(threadId, item);
    } else if (change.type === 'delta') {
      await state.transcripts.appendText(threadId, change.itemId, change.text);
    }
  }

  /**
   * A choice replaces its tool row once the arguments are complete and valid. Its
   * images are saved then, once. Invalid arguments fail the call, which shows as
   * an ordinary failed tool so the harness's mistake stays visible.
   */
  private async offerChoice(threadId: string, change: Extract<TranscriptChange, { type: 'tool' }>, cwd: string) {
    const { state, deps } = this;
    const live = await state.transcripts.get(threadId);
    if (live.items.some((item) => item.id === change.item.id && item.kind === 'choice')) return;
    const offer = parseChoice(change.input);
    if (offer) {
      const options = [];
      for (const { path, label } of offer.options) {
        // Tool paths are plain paths; the asset reader expects Markdown's encoded destinations.
        const source = normalizeMarkdownSource(path);
        options.push(mediaKind(mediaMimeType(source) ?? '') === 'image'
          ? { label, ...await deps.content.assets.snapshot(threadId, cwd, source) }
          : { label, source, error: 'Not a PNG, JPEG, GIF, WebP or AVIF image.' });
      }
      await state.transcripts.add(threadId, { kind: 'choice', id: change.item.id, turnId: change.item.turnId, question: offer.question, options });
    } else if (change.item.status === 'error') {
      await deps.content.saveTool(threadId, change.item.id, change.input, change.content);
      await state.transcripts.add(threadId, change.item);
    }
  }
}
