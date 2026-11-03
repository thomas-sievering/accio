import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThreadView, TranscriptItem } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { useLive, useLocalState } from '../app/useLive';

type ThreadsCtx = {
  threads: ThreadView[] | undefined;
  /** Newest first. */
  threadsOf: (projectId: string) => ThreadView[];
  selectedId: string;
  select: (id: string) => void;
};

const Ctx = createContext<ThreadsCtx | null>(null);

export function ThreadsProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const threads = useLive(() => client.call('threads.list', {}), 'threads.changed');
  const [selectedId, select] = useLocalState<string>('accio.thread', '');

  const value = useMemo<ThreadsCtx>(
    () => ({
      threads,
      threadsOf: (projectId) =>
        (threads ?? []).filter((t) => t.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      selectedId,
      select,
    }),
    // select is stable in behaviour; recreate only when data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threads, selectedId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThreads(): ThreadsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useThreads outside ThreadsProvider');
  return c;
}

/** A thread's transcript, loaded once and kept current from pushed items and deltas. */
export function useTranscript(threadId: string): TranscriptItem[] | undefined {
  const client = useClient();
  const status = useConnectionStatus();
  const [items, setItems] = useState<TranscriptItem[]>();

  useEffect(() => {
    setItems(undefined);
    if (status !== 'open') return;
    let live = true;
    // Events that arrive while the transcript loads are applied on top of it.
    const early: ((list: TranscriptItem[]) => TranscriptItem[])[] = [];
    let loaded = false;
    const apply = (fn: (list: TranscriptItem[]) => TranscriptItem[]) => {
      if (!loaded) early.push(fn);
      else setItems((list) => fn(list ?? []));
    };
    const offItem = client.onEvent('thread.item', ({ threadId: id, item }) => {
      if (id !== threadId) return;
      apply((list) => {
        const i = list.findIndex((x) => x.id === item.id);
        if (i === -1) return [...list, item];
        const next = list.slice();
        next[i] = item;
        return next;
      });
    });
    const offDelta = client.onEvent('thread.delta', ({ threadId: id, itemId, text }) => {
      if (id !== threadId) return;
      apply((list) => list.map((x) => (x.id === itemId && x.kind === 'assistant' ? { ...x, text: x.text + text } : x)));
    });
    client.call('threads.transcript', { threadId }).then(
      (list) => {
        if (!live) return;
        loaded = true;
        setItems(early.reduce((acc, fn) => fn(acc), list));
      },
      () => {},
    );
    return () => {
      live = false;
      offItem();
      offDelta();
    };
  }, [client, status, threadId]);

  return items;
}
