import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';
import type { TranscriptItem } from '@accio/protocol';
import { UserError, type Broadcast } from '../rpc/router.js';
import { upsertItem } from './thread.js';

type Live = { cursor: number; items: TranscriptItem[]; file: JsonFile<TranscriptItem[]>; saveTimer?: ReturnType<typeof setTimeout> };

/** Each thread's transcript, loaded once and saved shortly after it changes. */
export class TranscriptStore {
  private live = new Map<string, Live>();
  private loading = new Map<string, Promise<Live>>();

  constructor(private home: string, private broadcast: Broadcast) {}

  async get(id: string): Promise<Live> {
    const live = this.live.get(id);
    if (live) return live;
    // Share cold reads: observing while a turn starts must use the same cursor
    // and items as the writer, rather than installing two independent copies.
    let loading = this.loading.get(id);
    if (!loading) {
      const file = new JsonFile<TranscriptItem[]>(this.path(id), () => []);
      loading = file.read().then((items) => {
        if (this.loading.get(id) !== loading) throw new UserError('No such thread');
        const loaded = { items, file, cursor: 0 };
        this.live.set(id, loaded);
        return loaded;
      }).finally(() => {
        if (this.loading.get(id) === loading) this.loading.delete(id);
      });
      this.loading.set(id, loading);
    }
    return loading;
  }

  async add(threadId: string, item: TranscriptItem) {
    const live = await this.get(threadId);
    if (item.kind === 'tool') {
      const previous = live.items.find((entry) => entry.id === item.id);
      if (previous?.kind === 'tool' && previous.detailRevision !== undefined && item.detailRevision === undefined) item = { ...item, detailRevision: previous.detailRevision };
      // A sub-agent's latest step stays while its call runs, whatever else updates the row.
      if (previous?.kind === 'tool' && previous.step && !item.step && item.status === 'running') item = { ...item, step: previous.step };
    }
    live.items = upsertItem(live.items, item);
    this.scheduleSave(live);
    this.broadcast('thread.item', { threadId, cursor: ++live.cursor, item });
  }

  async appendText(threadId: string, itemId: string, text: string) {
    const live = await this.get(threadId);
    live.items = live.items.map((i) => (i.id === itemId && i.kind === 'assistant' ? { ...i, text: i.text + text } : i));
    this.scheduleSave(live);
    this.broadcast('thread.delta', { threadId, cursor: ++live.cursor, itemId, text });
  }

  async flush(threadId: string) {
    const live = this.live.get(threadId);
    if (!live) return;
    clearTimeout(live.saveTimer);
    live.saveTimer = undefined;
    await live.file.write(live.items);
  }

  async flushAll() {
    for (const id of this.live.keys()) await this.flush(id);
  }

  /** Stops tracking these transcripts. Resolves once their pending reads and writes have settled. */
  forget(ids: Iterable<string>): Promise<unknown> {
    const writes: Promise<void>[] = [];
    for (const id of ids) {
      const loading = this.loading.get(id);
      if (loading) {
        this.loading.delete(id);
        // Discard its result and let any open file handle close before removal.
        writes.push(loading.then(() => {}, () => {}));
      }
      const live = this.live.get(id);
      if (live) {
        clearTimeout(live.saveTimer);
        writes.push(live.file.idle());
      }
      this.live.delete(id);
    }
    return Promise.all(writes);
  }

  remove(id: string) {
    return rm(this.path(id), { force: true });
  }

  private path(id: string) {
    return join(this.home, 'transcripts', `${id}.json`);
  }

  private scheduleSave(live: Live) {
    if (live.saveTimer) return;
    live.saveTimer = setTimeout(() => {
      live.saveTimer = undefined;
      live.file.write(live.items).catch((err) => console.error('[threads] saving transcript failed', err));
    }, 500);
  }
}
