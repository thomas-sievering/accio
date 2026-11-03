import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TranscriptItem } from '@accio/protocol';
import type { Accounts } from '../accounts/accounts.js';
import { configFolderOf } from '../accounts/claudeConfigFolder.js';
import type { Projects } from '../projects/projects.js';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { JsonFile } from '../store/jsonFile.js';
import type { Agent } from './agent.js';
import { agentEnv } from './agentEnv.js';
import {
  RESUME_PROMPT,
  assertResumable,
  closeOpenTools,
  endTurn,
  newThread,
  recoverAfterRestart,
  startTurn,
  toView,
  upsertItem,
  type Thread,
  type TurnOutcome,
} from './thread.js';
import { TurnTranscript, type TranscriptChange } from './transcript.js';

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
    private accounts: Accounts,
    private projects: Projects,
    private agent: Agent,
    private broadcast: Broadcast,
  ) {
    this.file = new JsonFile(join(home, 'threads.json'), () => []);
    projects.onCheckInUse((checkoutId) => this.countUsing((t) => t.checkoutId === checkoutId));
    accounts.onCheckInUse((accountId) => this.countUsing((t) => t.accountId === accountId));
  }

  private countUsing(pred: (t: Thread) => boolean): string | undefined {
    const n = this.list.filter(pred).length;
    return n ? `${n} thread${n > 1 ? 's' : ''}` : undefined;
  }

  async load() {
    const { threads, interrupted } = recoverAfterRestart(await this.file.read());
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
    if (interrupted.length) await this.file.write(threads);
  }

  register(router: Router) {
    router
      .on('threads.list', () => this.list.map(toView))
      .on('threads.create', async ({ checkoutId }) => {
        const checkout = this.projects.checkout(checkoutId);
        const project = this.projects.projectOf(checkout);
        this.accounts.require(project.accountId);
        // GLOSSARY: a thread keeps the account it started with for its whole life.
        const thread = newThread({ checkoutId, projectId: project.id, accountId: project.accountId }, now());
        await this.commit([...this.list, thread]);
        return toView(thread);
      })
      .on('threads.transcript', async ({ threadId }) => (await this.transcript(this.require(threadId).id)).items)
      .on('threads.send', async ({ threadId, text }) => {
        await this.beginTurn(threadId, text);
        return null;
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
    if (!this.accounts.get(thread.accountId)) throw new UserError('The account this thread started with no longer exists');
    const access = await this.accounts.hubAccess(thread.accountId);
    const checkout = this.projects.checkout(thread.checkoutId);

    const started = startTurn(thread, text, now());
    const turnId = randomUUID();
    await this.update(thread.id, () => started);
    await this.addItem(thread.id, { kind: 'user', id: `${turnId}:u`, turnId, text, at: now(), ...(resume ? { resume } : {}) });

    const controller = new AbortController();
    this.running.set(thread.id, controller);
    const env = agentEnv(process.env, access, configFolderOf(this.home, thread.accountId));
    const turn = this.runTurn(started, turnId, { cwd: checkout.path, prompt: text, env, signal: controller.signal });
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
      for await (const msg of this.agent.run({ ...run, sessionId: thread.sessionId })) {
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
          text: 'The agent stopped without finishing the turn.',
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
