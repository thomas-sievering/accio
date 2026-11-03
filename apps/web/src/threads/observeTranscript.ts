import type { Events, TranscriptItem } from '@accio/protocol';
import type { RpcClient } from '../app/rpcClient';

type Client = Pick<RpcClient, 'call' | 'onEvent' | 'onStatus' | 'status'>;
export type TranscriptState = { items?: TranscriptItem[]; error?: string };
type Change = Events['thread.item'] | Events['thread.delta'];

/** One selected transcript. Owns the snapshot boundary and connection lifetime. */
export function observeTranscript(client: Client, threadId: string, publish: (state: TranscriptState) => void): () => void {
  let generation = 0;
  let active = true;
  let accepting = false;
  let items: TranscriptItem[] | undefined;
  let cursor = 0;
  let early: Change[] = [];

  const apply = (change: Change) => {
    if (change.cursor <= cursor) return;
    cursor = change.cursor;
    if ('item' in change) {
      const index = items!.findIndex((item) => item.id === change.item.id);
      items = index < 0 ? [...items!, change.item] : items!.map((item, i) => i === index ? change.item : item);
    } else {
      items = items!.map((item) => item.id === change.itemId && item.kind === 'assistant'
        ? { ...item, text: item.text + change.text } : item);
    }
  };
  const receive = (change: Change) => {
    if (!active || !accepting || client.status !== 'open' || change.threadId !== threadId) return;
    if (!items) early.push(change);
    else {
      apply(change);
      publish({ items });
    }
  };
  const offItem = client.onEvent('thread.item', receive);
  const offDelta = client.onEvent('thread.delta', receive);
  const connect = () => {
    const current = ++generation;
    accepting = false;
    items = undefined;
    early = [];
    publish({});
    if (client.status !== 'open' || !threadId) return;
    accepting = true;
    void client.call('threads.observe', { threadId }).then((snapshot) => {
      if (!active || current !== generation || client.status !== 'open') return;
      items = snapshot.items;
      cursor = snapshot.cursor;
      for (const change of early) apply(change);
      early = [];
      publish({ items });
    }, (error: unknown) => {
      if (!active || current !== generation || client.status !== 'open') return;
      accepting = false;
      early = [];
      publish({ error: error instanceof Error ? error.message : String(error) });
    });
  };
  const offStatus = client.onStatus(connect);
  connect();
  return () => {
    active = false;
    ++generation;
    early = [];
    offStatus();
    offItem();
    offDelta();
  };
}
