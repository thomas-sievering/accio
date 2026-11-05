import { randomUUID } from 'node:crypto';
import { mediaKind, mediaMimeType, normalizeMarkdownSource, type ChoicePick, type ModelSelection, type ThreadAsset, type WorkspaceSkill } from '@accio/protocol';
import { mentionedModel, type Models } from '../harnesses/models.js';
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
import type { Harness, HarnessImage, HarnessTurn, SteerInput, TurnResources } from './harness.js';
import { providerOf, turnEnv } from './harnessEnv.js';
import type { ThreadState } from './state.js';
import { AGENT_TOOL_LABEL, isAgentTool, runSubagent, type AgentInput, type SubagentTurn } from './subagents.js';
import { assertResumable, endTurn, RESTART_NOTICE, retryOf, startTurn, type Thread, type TurnOutcome } from './thread.js';
import { TurnTranscript, type TranscriptChange } from './transcript.js';
import { handoffContext, withHandoff } from './handoff.js';
import type { BuiltinTool } from '../harnesses/builtinTools.js';
import { afterGoalTurn, CONTINUE_PROMPT, goalInstructions, goalTurnStarted, newGoalPrompt, parseGoalCommand } from '../goals/goal.js';

export type TurnOptions = { resume?: boolean; retry?: boolean; delivery?: boolean; pick?: ChoicePick; queuedId?: string;
  /** GLOSSARY: Image attachment. Images already in the thread's assets, such as a queued message's. */
  images?: ThreadAsset[];
  /** Uploads to claim into the thread's assets as the turn starts, such as a new thread's. */
  uploads?: string[];
  /** GLOSSARY: Goal. A turn accio starts itself to keep working toward the goal. */
  goalContinue?: boolean };

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
  /** GLOSSARY: Built-in tools. Read as each turn starts, so a change applies from the next turn. */
  toolsOff: (harnessId: string) => BuiltinTool[];
  onRepairFinished: (toolId: string) => void;
  onWorkFinished?: (threadId: string) => void;
  /** GLOSSARY: Image attachment. */
  images: { claim: (threadId: string, uploadIds: string[]) => Promise<ThreadAsset[]>; file: (threadId: string, asset: ThreadAsset) => Promise<string> };
};

/** Starting, running, steering and finishing the turns of threads on this machine. */
export class Turns {
  private liveInputs = new Map<string, { turnId: string; send?: SteerInput }>();
  private queuedStarts = new Map<string, string>();
  private preparing = new Set<Promise<void>>();
  private turns = new Set<Promise<void>>();
  /** The running turn of each thread, which its sub-agents inherit. */
  private subagentTurns = new Map<string, { turnId: string; turn: SubagentTurn; profileId: string; model: ModelSelection }>();
  /** Parent tool rows already showing a running sub-agent. */
  private subagentRows = new Set<string>();

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

  /** `prompt` replaces what the harness reads, such as for a `/goal` message; the transcript keeps `text`. */
  async steer(id: string, text: string, pick?: ChoicePick, prompt?: string, images: ThreadAsset[] = []) {
    const input = this.liveInputs.get(id);
    const send = input?.send;
    if (!input || !send) throw new UserError('The agent is starting or finishing. Try sending again in a moment.');
    const harnessText = prompt ?? (pick ? pickPrompt((await this.state.transcripts.get(id)).items, pick, text) : text);
    if (harnessText === undefined) throw new UserError('That option is no longer available');
    const thread = this.state.require(id);
    this.deps.models.assertReadsImages(thread.profileId, thread.model, images);
    const files = await this.imageFiles(id, images);
    await send(withImageFiles(harnessText, files), files);
    await this.state.transcripts.add(id, { kind: 'user', id: randomUUID(), turnId: input.turnId, text, at: now(), steered: true, ...(images.length ? { images } : {}), ...(pick ? { pick } : {}) });
    await this.state.transcripts.flush(id);
  }

  async dispatchQueued(id: string) {
    const { state } = this;
    const thread = state.require(id);
    const message = thread.queuedMessages?.[0];
    if (!message || message.editing || state.closing || state.lifecycle.has(id) || state.running.has(id) || thread.status !== 'idle') return;
    try { await this.begin(id, message.text, { pick: message.pick, images: message.images, queuedId: message.id }); }
    catch (error) {
      await state.transcripts.add(id, { kind: 'notice', id: randomUUID(), turnId: 'queue', tone: 'error', text: `Queued message could not start: ${(error as Error).message}` });
    }
  }

  /** A released thread takes queued messages, then its goal, then any queued delivery. */
  async dispatchPending(threadId: string) {
    await this.dispatchQueued(threadId);
    await this.continueGoal(threadId);
    await this.deps.deliveries.dispatch(threadId);
  }

  private async imageFiles(threadId: string, images: readonly ThreadAsset[]): Promise<HarnessImage[]> {
    return Promise.all(images.map(async (image) => ({ path: await this.deps.images.file(threadId, image), mimeType: image.mimeType })));
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
      let images = options.images ?? [];
      if (resume) assertResumable(thread);
      if (options.retry || resume) {
        const items = (await transcripts.get(threadId)).items;
        const last = items.findLast(item => item.kind === 'user');
        delivering = !!(last?.kind === 'user' && last.delivery && thread.delivery);
        if (options.retry) ({ text, resume, pick, images = [] } = retryOf(thread, items));
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
      if (options.uploads?.length) images = await deps.images.claim(threadId, options.uploads);
      deps.models.assertReadsImages(thread.profileId, thread.model, images);
      const files = await this.imageFiles(threadId, images);
      if (thread.workspace?.releasedAt) {
        // An archived delivery restores its published revision with a fresh session.
        // A worktree released unchanged on Settle held no work: start from the latest default branch and keep the conversation.
        const archived = !!thread.delivery;
        const workspace = await deps.deliveries.git.allocate(threadId, thread.workspace.sourcePath, archived ? thread.delivery!.publishedRevision ?? 'HEAD' : undefined);
        if (!workspace) throw new UserError('Could not restore an owned workspace.');
        thread = { ...thread, workspace, sessionId: archived ? null : thread.sessionId, delivery: undefined };
      }
      // A follow-up or a scripted ship's handover says why in `detail`; the prompt carries it before the turn clears it.
      const requested = thread.delivery;
      if (delivering) {
        const { step: _previous, ...delivery } = thread.delivery!;
        thread = { ...thread, delivery: { ...delivery, status: 'running', startedAt: now() } };
      }
      const cwd = state.cwd(thread);
      const goalCommand = parseGoalCommand(picked);
      // A /goal message never reaches the harness as typed: Claude Code would run its own /goal.
      const ownPrompt = delivering && !resume ? deliveryPrompt(thread.workspace!, requested!) : withImageFiles(goalCommand?.type === 'set' ? newGoalPrompt(goalCommand.objective) : picked, files);
      // ADR 0017: after a change of harness, the first turn on the new one carries what it missed.
      const prompt = thread.handoff ? withHandoff(handoffContext((await transcripts.get(threadId)).items, thread.handoff), ownPrompt) : ownPrompt;
      if (delivering && !resume) text = thread.delivery!.mode === 'review' ? 'Prepare for review.' : `Ship to ${thread.delivery!.baseBranch} when ready.`;
      // A refused resource preparation is not a sent message or a failed turn.
      // Reserve the turn above, but publish it only after its tools are ready.
      // GLOSSARY: GitHub account. The agent's gh commands act as the profile's account, like Accio's own reads.
      const env = { ...turnEnv(state.home, thread.profileId, thread.model.harnessId, access), ...await deps.machines.github.env(thread.profileId, cwd).catch(() => ({})) };
      resources = await deps.resources()?.prepare(thread.profileId, thread.projectId, env, { repair: !!thread.repairToolId, cwd });
      if (controller.signal.aborted || state.closing) throw new UserError('Turn interrupted before starting');
      if (!delivering) {
        if (!options.resume && !options.retry) thread = { ...thread, workVersion: (thread.workVersion ?? 0) + 1 };
        if (thread.delivery && ['delivered', 'ready', 'waiting'].includes(thread.delivery.status)) { deps.deliveries.clearCheck(threadId); thread = { ...thread, delivery: { ...thread.delivery, status: 'blocked', detail: 'New work needs to be shipped before archiving.' } }; }
      }
      let next = startTurn(thread, text, now());
      const turnId = randomUUID();
      started = true;
      state.starting.delete(thread.id);
      next = await state.update(thread.id, t => ({ ...next,
        title: t.title === 'New thread' && !t.titleManual ? next.title : t.title,
        titleManual: t.titleManual, titleNeedsRefinement: t.titleNeedsRefinement,
        queuedMessages: options.queuedId ? t.queuedMessages?.filter(m => m.id !== options.queuedId) : t.queuedMessages,
        goal: goalTurnStarted(t.goal),
      }));
      await transcripts.add(thread.id, { kind: 'user', id: `${turnId}:u`, turnId, text, at: now(), ...(images.length ? { images } : {}), ...(resume ? { resume } : {}), ...(delivering ? { delivery: thread.delivery!.mode } : {}), ...(pick ? { pick } : {}), ...(options.goalContinue ? { goal: 'continue' as const } : {}) });
      const grant = deps.tools?.grant(thread.id);
      const turnResources = resources;
      this.liveInputs.set(thread.id, { turnId });
      const instructions = [resources?.instructions, goalInstructions(next.goal)].filter(Boolean).join('\n\n') || undefined;
      const turn = this.run(next, turnId, { cwd, prompt, ...(files.length ? { images: files } : {}), env: resources?.env ?? env, signal: controller.signal, ...(grant ? { tools: grant.access } : {}), resourceInstructions: instructions, mcps: resources?.mcps }, delivering, resources?.skills).finally(() => { turnResources?.release(); grant?.revoke(); });
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
    run: Pick<HarnessTurn, 'cwd' | 'prompt' | 'images' | 'env' | 'tools' | 'signal' | 'resourceInstructions' | 'mcps'>,
    delivering = false,
    skills: WorkspaceSkill[] = [],
  ) {
    const { state, deps } = this;
    const { transcripts } = state;
    const transcript = new TurnTranscript(turnId);
    const startedAt = Date.now();
    let outcome: TurnOutcome | null = null;
    /** GLOSSARY: Goal. A turn on a goal that used no tools pauses it. */
    let usedTools = false;
    let promptMeasurement: import('@accio/protocol').PromptMeasurement | undefined;
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
      const model = { model: thread.model.modelId, effort: deps.models.effort(thread.profileId, thread.model), modelName: deps.models.modelName(thread.profileId, thread.model), toolsOff: deps.toolsOff(thread.model.harnessId) };
      this.subagentTurns.set(thread.id, { turnId, profileId: thread.profileId, model: { ...thread.model, effort: model.effort }, turn: { harness, signal: run.signal, run: { cwd: run.cwd, env: run.env, resourceInstructions: run.resourceInstructions, mcps: run.mcps, ...model } } });
      for await (const msg of harness.run({ ...run, sessionId: thread.sessionId, ...model, requestSecret,
        onPromptSize: measurement => { promptMeasurement = measurement; },
        registerSteer: send => { const input = this.liveInputs.get(thread.id); if (input?.turnId === turnId) input.send = send; },
        secretPurposes: deps.secrets.purposes(thread.profileId, thread.projectId || null) })) {
        for (const change of transcript.accept(msg)) {
          if (change.type === 'end') outcome = change.outcome;
          if (change.type === 'tool') usedTools = true;
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
      if (this.subagentTurns.get(thread.id)?.turnId === turnId) this.subagentTurns.delete(thread.id);
      const input = this.liveInputs.get(thread.id);
      if (input) input.send = undefined;
      await state.messageOps.get(thread.id)?.catch(() => {});
      this.liveInputs.delete(thread.id);
      try {
        await deps.secrets.endTurn(turnId);
        // Shutdown, not Stop: the turn continues when accio starts again (see `Threads.close`).
        const restarting = outcome === 'interrupted' && state.closing && !!state.require(thread.id).resumeAfterRestart;
        if (delivering && restarting) {
          // The request stays authorized; its resumed turn checks what already happened before repeating it.
          await state.update(thread.id, t => t.delivery?.status === 'running' ? { ...t, delivery: { ...t.delivery, status: 'queued' } } : t);
        } else if (delivering) {
          const current = state.require(thread.id);
          try {
            // Only a Stop pauses delivery; a failed turn (a rate limit, say) is retried after a wait.
            if (outcome === 'failed' && await deps.deliveries.retryTurn(thread.id)) {
              await transcripts.add(thread.id, { kind: 'notice', id: `${turnId}:delivery`, turnId, tone: 'info', text: 'Delivery continues after a short wait.' });
            } else {
              if (outcome !== 'completed') throw new UserError('Delivery paused. Check the conversation, then request Ship again.');
              await deps.deliveries.verify(current, true);
            }
          } catch (error) {
            const detail = (error as Error).message;
            await deps.deliveries.recordWait(thread.id, error as Error);
            await transcripts.add(thread.id, { kind: 'notice', id: `${turnId}:delivery`, turnId, tone: 'info', text: detail });
          }
        }
        if (outcome === 'interrupted') {
          await transcripts.add(thread.id, restarting
            ? { kind: 'notice', id: `${turnId}:restart`, turnId, tone: 'info', text: RESTART_NOTICE }
            : { kind: 'notice', id: `${turnId}:stop`, turnId, tone: 'info', text: 'Stopped.' });
        }
        for (const item of transcript.unfinishedTools(outcome === 'interrupted' ? 'interrupted' : 'error')) await transcripts.add(thread.id, item);
        if (outcome === 'completed') await transcripts.add(thread.id, { kind: 'finished', id: `${turnId}:finished`, turnId, ms: Date.now() - startedAt });
        if (promptMeasurement) await transcripts.add(thread.id, { kind: 'promptSize', id: `${turnId}:promptSize`, turnId, harnessId: thread.model.harnessId, measurement: promptMeasurement });
        await transcripts.flush(thread.id);
      } catch (error) {
        if (outcome !== 'interrupted') outcome = 'failed';
        const detail = error instanceof Error ? error.message : String(error);
        await transcripts.add(thread.id, { kind: 'notice', id: `${turnId}:save`, turnId, tone: 'error', text: `Could not save this turn: ${detail}` });
        throw error;
      } finally {
        // A storage failure must never leave a finished turn holding its slot.
        state.running.delete(thread.id);
        await state.updateDurably(thread.id, t => {
          const goal = afterGoalTurn(t.goal, outcome ?? 'failed', usedTools);
          const ended = { ...t, goal };
          return deps.deliveries.settleDelivered(endTurn(ended.delivery?.status === 'running'
            ? { ...ended, delivery: { ...ended.delivery, status: 'waiting' } } : ended, outcome ?? 'failed', now()));
        });
        deps.deliveries.scheduleCheck(thread.id);
        // Every turn spends the account's allowance, so a model it used up is marked as soon as possible.
        deps.profiles.refreshLimits(thread.profileId, providerOf(thread.model.harnessId));
        if (thread.repairToolId && outcome === 'completed') deps.onRepairFinished(thread.repairToolId);
        if (outcome === 'completed') {
          if (!delivering) deps.onWorkFinished?.(thread.id);
          await this.dispatchPending(thread.id);
        }
      }
    }
  }

  /** GLOSSARY: Goal. Starts the next turn unless something else already did or the thread cannot take one. */
  async continueGoal(threadId: string) {
    const { state } = this;
    const thread = state.get(threadId);
    if (!thread || thread.goal?.status !== 'active' || state.closing || state.running.has(threadId) || state.lifecycle.has(threadId)
      || thread.status === 'running' || thread.queuedMessages?.length || thread.delivery?.status === 'queued') return;
    try { await this.begin(threadId, CONTINUE_PROMPT, { goalContinue: true }); }
    catch (error) {
      await state.update(threadId, t => t.goal?.status === 'active' ? { ...t, goal: { ...t.goal, status: 'paused', detail: (error as Error).message } } : t);
    }
  }

  /**
   * GLOSSARY: Sub-agent. Runs one for the thread's current turn. Its steps go to
   * the parent's running Agent row with the same description, once that row exists.
   */
  async startSubagent(threadId: string, input: AgentInput, signal: AbortSignal, progress: (message: string) => void = () => {}): Promise<string> {
    const live = this.subagentTurns.get(threadId);
    if (!live) throw new Error('A sub-agent can only start while its thread is working.');
    const { transcripts } = this.state;
    let rowId: string | undefined;
    const showStep = async (step: { name: string; summary: string }) => {
      // Tells the parent's harness the sub-agent is still working, before the row update that may be skipped.
      progress(step.summary ? `${step.name}: ${step.summary}` : step.name);
      const items = (await transcripts.get(threadId)).items;
      const row = rowId ? items.find(item => item.id === rowId) : items.find(item => item.kind === 'tool' && item.turnId === live.turnId
        && item.name === AGENT_TOOL_LABEL && item.status === 'running' && item.summary.trim() === input.description && !this.subagentRows.has(item.id));
      if (row?.kind !== 'tool' || row.status !== 'running') return;
      if (!rowId) this.subagentRows.add(rowId = row.id);
      await transcripts.add(threadId, { ...row, step });
    };
    const turn = input.model ? await this.subagentOn(live, input.model) : live.turn;
    try { return await runSubagent(turn, input, signal, showStep); }
    finally { if (rowId) this.subagentRows.delete(rowId); }
  }

  /**
   * GLOSSARY: Model mention. The parent's turn moved to the model the user mentioned:
   * the thread's effort when it accepts it, and on another harness that harness's own
   * account and settings, with the same tools on PATH.
   */
  private async subagentOn(live: { turn: SubagentTurn; profileId: string; model: ModelSelection }, handle: string): Promise<SubagentTurn> {
    const { deps, state } = this;
    const models = deps.models.list(live.profileId).models;
    const { model, selection } = mentionedModel(models, handle, live.model.effort);
    if (model.harnessId === live.model.harnessId && model.id === live.model.modelId) return live.turn;
    const harness = deps.harnesses[model.harnessId];
    if (!harness) throw new Error(`${model.harnessName} is not installed on this machine.`);
    let env = live.turn.run.env;
    if (model.harnessId !== live.model.harnessId) {
      const access = await deps.profiles.hubAccess(live.profileId, providerOf(model.harnessId));
      const path = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1];
      env = Object.fromEntries(Object.entries(turnEnv(state.home, live.profileId, model.harnessId, access)).filter(([key]) => key.toLowerCase() !== 'path'));
      if (path) env.PATH = path;
      if (live.turn.run.env.GH_TOKEN) env.GH_TOKEN = live.turn.run.env.GH_TOKEN;
    }
    return { ...live.turn, harness, run: { ...live.turn.run, env, model: model.id, effort: selection.effort, modelName: model.name, toolsOff: deps.toolsOff(model.harnessId) } };
  }

  private async apply(threadId: string, change: TranscriptChange, cwd: string, skills: WorkspaceSkill[] = []) {
    const { state, deps } = this;
    if (change.type === 'tool' && isAgentTool(change.item.name)) change = { ...change, item: { ...change.item, name: AGENT_TOOL_LABEL } };
    if (change.type === 'session') {
      // A harness that reports its session has taken the prompt, and with it any handoff.
      await state.update(threadId, (t) => ({ ...t, sessionId: change.sessionId, handoff: undefined }), { quiet: true });
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

/** GLOSSARY: Image attachment. The harness sees each image and is told where its file is, so its tools can open it. */
export function withImageFiles(text: string, files: readonly HarnessImage[]): string {
  if (!files.length) return text;
  const notes = files.map((file, i) => `[Image ${i + 1} is saved at: ${file.path}]`).join('\n');
  return text ? `${text}\n\n${notes}` : notes;
}
