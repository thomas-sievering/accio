import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TranscriptItem } from '@accio/protocol';
import type { Profiles } from '../profiles/profiles.js';
import { configFolderOf } from '../profiles/claudeConfigFolder.js';
import type { Projects } from '../projects/projects.js';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { JsonFile } from '../store/jsonFile.js';
import type { Harness } from './harness.js';
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

type Live = { items: TranscriptItem[]; file: JsonFile<TranscriptItem[]>; saveTimer?: ReturnType<typeof setTimeout> };

/** Threads on this machine, their transcripts, and the turns running in them. */
export class Threads {
  private file: JsonFile<Thread[]>;
  private list: Thread[] = [];
  private transcripts = new Map<string, Live>();
  private running = new Map<string, AbortController>();
  private turns = new Set<Promise<void>>();

  constructor(
    private home: string,
    private profiles: Profiles,
    private projects: Projects,
    private harness: Harness,
    private broadcast: Broadcast,
    private models: Models,
    private machines: Machines,
  ) {
    this.file = new JsonFile(join(home, 'threads.json'), () => []);
    projects.onCheckInUse((checkoutId) => this.countUsing((t) => t.checkoutId === checkoutId));
    projects.onCheckProjectInUse((projectId) => this.countUsing((t) => t.projectId === projectId));
    profiles.onCheckInUse((profileId) => this.countUsing((t) => t.profileId === profileId));
  }

  private countUsing(pred: (t: Thread) => boolean): string | undefined {
    const n = this.list.filter(pred).length;
    return n ? `${n} thread${n > 1 ? 's' : ''}` : undefined;
  }

  async load() {
    const stored = (await this.file.read()).map(fromStored);
    const candidates = new Set(dropUnstarted(stored).map((t) => t.id));
    const started: Thread[] = [];
    for (const thread of stored) {
      // A title and session id alone do not prove a thread has no conversation.
      if (candidates.has(thread.id) || (await this.transcript(thread.id)).items.length > 0) started.push(thread);
    }
    const { threads, interrupted } = recoverAfterRestart(started);
    this.list = threads;
    for (const thread of interrupted) {
      const live = await this.transcript(thread.id);
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
    if (interrupted.length || started.length < stored.length) await this.file.write(threads);
  }

  register(router: Router) {
    router
      .on('threads.list', () => this.list.map(toView))
      .on('threads.start', async (input) => {
        const { text, model, machineId } = input;
        if (machineId) {
          const machine = this.machines.views().find((m) => m.id === machineId);
          if (!machine) throw new UserError('No such machine');
          if (!machine.connected) throw new UserError('This machine is offline');
          if (!machine.thisMachine) throw new UserError('Running threads on another machine is not available yet');
        }
        const checkout = 'checkoutId' in input ? this.projects.checkout(input.checkoutId) : undefined;
        const project = checkout ? this.projects.projectOf(checkout) : undefined;
        const profileId = project?.profileId ?? ('profileId' in input ? input.profileId : '');
        // Refuse before anything is stored, so a thread that cannot run never appears.
        await this.profiles.hubAccess(profileId);
        const selected = this.models.require(profileId, model);
        // GLOSSARY: a thread keeps the profile it started with for its whole life.
        const thread = newThread({ checkoutId: checkout?.id ?? '', projectId: project?.id ?? '', profileId, model: selected }, now());
        if (!checkout) await mkdir(join(this.home, 'workspaces', thread.id), { recursive: true });
        // Quiet: clients first see the thread once its turn is running, never as an idle empty thread.
        await this.commit([...this.list, thread], { quiet: true });
        await this.beginTurn(thread.id, text);
        return toView(this.require(thread.id));
      })
      .on('threads.transcript', async ({ threadId }) => (await this.transcript(this.require(threadId).id)).items)
      .on('threads.send', async ({ threadId, text }) => {
        await this.beginTurn(threadId, text);
        return null;
      })
      .on('threads.setModel', async ({ threadId, model }) => {
        const thread = this.require(threadId);
        if (thread.status === 'running') throw new UserError('Wait for this turn to finish before changing its model.');
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
        assertResumable(this.require(threadId));
        await this.beginTurn(threadId, RESUME_PROMPT, { resume: true });
        return null;
      })
      .on('threads.retry', async ({ threadId }) => {
        const thread = this.require(threadId);
        const { text, resume } = retryOf(thread, (await this.transcript(thread.id)).items);
        await this.beginTurn(thread.id, text, { resume });
        return null;
      })
      .on('threads.snooze', async ({ threadId, until }) => toView(await this.update(threadId, (t) => snooze(t, until))))
      .on('threads.settle', async ({ threadId }) => toView(await this.update(threadId, (t) => settle(t, now()))))
      .on('threads.reopen', async ({ threadId }) => toView(await this.update(threadId, reopen)))
      .on('threads.rename', async ({ threadId, title }) => {
        const updated = await this.update(threadId, (t) => ({ ...t, title }));
        return toView(updated);
      })
      .on('threads.delete', async ({ threadId }) => {
        const thread = this.require(threadId);
        if (this.running.has(thread.id)) throw new UserError('Stop the thread before deleting it');
        this.transcripts.delete(thread.id);
        await this.commit(this.list.filter((t) => t.id !== thread.id));
        await rm(this.transcriptPath(thread.id), { force: true });
        return null;
      });
  }

  // ---- turns ----

  private async beginTurn(threadId: string, text: string, { resume = false } = {}) {
    const thread = this.require(threadId);
    if (!this.profiles.get(thread.profileId)) throw new UserError('The profile this thread started with no longer exists');
    const access = await this.profiles.hubAccess(thread.profileId);
    this.models.require(thread.profileId, thread.model);
    const cwd = thread.checkoutId ? this.projects.checkout(thread.checkoutId).path : join(this.home, 'workspaces', thread.id);

    const started = startTurn(thread, text, now());
    const turnId = randomUUID();
    await this.update(thread.id, () => started);
    await this.addItem(thread.id, { kind: 'user', id: `${turnId}:u`, turnId, text, at: now(), ...(resume ? { resume } : {}) });

    const controller = new AbortController();
    this.running.set(thread.id, controller);
    const env = harnessEnv(process.env, access, configFolderOf(this.home, thread.profileId));
    const turn = this.runTurn(started, turnId, { cwd, prompt: text, env, signal: controller.signal });
    this.turns.add(turn);
    void turn.finally(() => this.turns.delete(turn));
  }

  private async runTurn(
    thread: Thread,
    turnId: string,
    run: { cwd: string; prompt: string; env: Record<string, string>; signal: AbortSignal },
  ) {
    const transcript = new TurnTranscript(turnId);
    let outcome: TurnOutcome | null = null;
    try {
      for await (const msg of this.harness.run({ ...run, sessionId: thread.sessionId, model: thread.model.modelId === 'default' ? undefined : thread.model.modelId })) {
        for (const change of transcript.accept(msg)) {
          if (change.type === 'end') outcome = change.outcome;
          await this.apply(thread.id, change);
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
          text: 'Claude Code stopped without finishing the turn.',
        });
      }
    } catch (err) {
      if (run.signal.aborted) outcome = 'interrupted';
      else {
        outcome = 'failed';
        await this.addItem(thread.id, { kind: 'notice', id: `${turnId}:err`, turnId, tone: 'error', text: (err as Error).message });
      }
    } finally {
      if (outcome === 'interrupted') {
        await this.addItem(thread.id, { kind: 'notice', id: `${turnId}:stop`, turnId, tone: 'info', text: 'Stopped.' });
      }
      for (const item of transcript.unfinishedTools()) await this.addItem(thread.id, item);
      this.running.delete(thread.id);
      await this.update(thread.id, (t) => endTurn(t, outcome ?? 'failed', now()));
      await this.flush(thread.id);
    }
  }

  private async apply(threadId: string, change: TranscriptChange) {
    if (change.type === 'session') {
      await this.update(threadId, (t) => ({ ...t, sessionId: change.sessionId }), { quiet: true });
    } else if (change.type === 'item') {
      await this.addItem(threadId, change.item);
    } else if (change.type === 'delta') {
      const live = await this.transcript(threadId);
      live.items = live.items.map((i) => (i.id === change.itemId && i.kind === 'assistant' ? { ...i, text: i.text + change.text } : i));
      this.scheduleSave(threadId, live);
      this.broadcast('thread.delta', { threadId, itemId: change.itemId, text: change.text });
    }
  }

  // ---- storage ----

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

  private async commit(next: Thread[], { quiet = false } = {}) {
    // Memory first, synchronously, so concurrent updates never start from a stale list.
    this.list = next;
    if (!quiet) this.broadcast('threads.changed', next.map(toView));
    await this.file.write(next);
  }

  private transcriptPath(id: string) {
    return join(this.home, 'transcripts', `${id}.json`);
  }

  private async transcript(id: string): Promise<Live> {
    let live = this.transcripts.get(id);
    if (!live) {
      const file = new JsonFile<TranscriptItem[]>(this.transcriptPath(id), () => []);
      live = { items: await file.read(), file };
      this.transcripts.set(id, live);
    }
    return live;
  }

  private async addItem(threadId: string, item: TranscriptItem) {
    const live = await this.transcript(threadId);
    live.items = upsertItem(live.items, item);
    this.scheduleSave(threadId, live);
    this.broadcast('thread.item', { threadId, item });
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

  /** Waits for running turns to settle and every write to land. */
  async close() {
    await Promise.allSettled([...this.turns]);
    for (const id of this.transcripts.keys()) await this.flush(id);
    await this.file.idle();
  }
}

function now() {
  return new Date().toISOString();
}
