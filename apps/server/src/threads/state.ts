import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';
import type { Projects } from '../projects/projects.js';
import { UserError, type Broadcast } from '../rpc/router.js';
import { toView, type Thread } from './thread.js';
import { TranscriptStore } from './transcriptStore.js';

/** The stored thread list and the in-flight work every part of Threads coordinates on. */
export class ThreadState {
  list: Thread[] = [];
  readonly file: JsonFile<Thread[]>;
  readonly transcripts: TranscriptStore;
  /** Turns preparing or running. An already-aborted controller belongs to an explicit Stop. */
  readonly running = new Map<string, AbortController>();
  /** Threads with a delivery, preview, archive or skill edit in progress. */
  readonly lifecycle = new Set<string>();
  readonly messageOps = new Map<string, Promise<unknown>>();
  /** Stored, but hidden from clients until its first turn is running. */
  readonly starting = new Set<string>();
  /** Intents close() waits for. */
  readonly starts = new Set<Promise<unknown>>();
  closing = false;

  constructor(readonly home: string, private projects: Projects, readonly broadcast: Broadcast, private needsSecret: (threadId: string) => boolean) {
    this.file = new JsonFile(join(home, 'threads.json'), () => []);
    this.transcripts = new TranscriptStore(home, broadcast);
  }

  assertOpen() {
    if (this.closing) throw new UserError('This machine is shutting down');
  }

  require(id: string): Thread {
    const t = this.list.find((x) => x.id === id);
    if (!t) throw new UserError('No such thread');
    return t;
  }

  cwd(thread: Thread) {
    return thread.workspace && !thread.workspace.releasedAt ? thread.workspace.path : thread.checkoutId ? this.projects.checkout(thread.checkoutId).path : join(this.home, 'workspaces', thread.id);
  }

  views() { return this.list.filter(t => !this.starting.has(t.id)).map(t => ({ ...toView(t), ...(this.needsSecret(t.id) ? { needsSecret: true } : {}) })); }

  announce() { this.broadcast('threads.changed', this.views()); }

  async update(id: string, fn: (t: Thread) => Thread, opts: { quiet?: boolean } = {}): Promise<Thread> {
    const updated = fn(this.require(id));
    await this.commit(this.list.map((t) => (t.id === id ? updated : t)), opts);
    return updated;
  }

  /** Completion must reach disk before its settled row is broadcast. Preserve intervening writes. */
  async updateDurably(id: string, fn: (t: Thread) => Thread): Promise<Thread> {
    const previous = this.require(id);
    let applied: Thread | undefined;
    try {
      const updated = await this.update(id, t => applied = fn(t), { quiet: true });
      this.announce();
      return updated;
    } catch (error) {
      if (this.require(id) === applied) {
        this.list = this.list.map(t => t.id === id ? previous : t);
        this.announce();
      }
      throw error;
    }
  }

  /** Puts one field back after its write failed, so a rejected change never stays in memory. */
  restore<K extends keyof Thread>(id: string, key: K, value: Thread[K]) {
    this.list = this.list.map(t => t.id === id ? { ...t, [key]: value } : t);
    this.announce();
  }

  async commit(next: Thread[], { quiet = false } = {}) {
    // Memory first, synchronously, so concurrent updates never start from a stale list.
    this.list = next;
    if (!quiet) this.announce();
    await this.file.write(next);
  }

  /** Runs an intent close() must wait for. */
  track<T>(start: () => Promise<T>): Promise<T> {
    const pending = start();
    this.starts.add(pending);
    void pending.then(() => this.starts.delete(pending), () => this.starts.delete(pending));
    return pending;
  }
}
