import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThreadView, TranscriptItem } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { useLive, useLocalState } from '../app/useLive';
import { useProjects } from '../projects/projects';
import { filterThreads, nextMorning, shelveThreads, type ShelfMarks, type ThreadShelves } from './shelves';

type ThreadsCtx = {
  threads: ThreadView[] | undefined;
  selectedId: string;
  select: (id: string) => void;
  /** The open list plus the Working, Snoozed and Settled shelves, after the project scope and search. */
  shelves: ThreadShelves;
  /** The one project the sidebar is narrowed to, or '' for every visible project. */
  projectScope: string;
  setProjectScope: (projectId: string) => void;
  query: string;
  setQuery: (q: string) => void;
  marks: ShelfMarks;
  now: Date;
  settle: (id: string) => void;
  snooze: (id: string) => void;
  /** Takes a thread off the Snoozed or Settled shelf. */
  reopen: (id: string) => void;
};

const Ctx = createContext<ThreadsCtx | null>(null);

export function ThreadsProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const threads = useLive(() => client.call('threads.list', {}), 'threads.changed');
  const [selectedId, select] = useLocalState<string>('accio.thread', '');
  const [marks, setMarks] = useShelfMarks();
  const { visible } = useProjects();
  const [storedScope, setProjectScope] = useLocalState<string>('accio.projectScope', '');
  const [query, setQuery] = useState('');
  // A scope outside the selected profile (or a removed project) falls back to every project.
  const projectScope = visible.some((p) => p.id === storedScope) ? storedScope : '';
  const now = useMinuteClock();
  const mark = (id: string, next: ShelfMarks[string] | undefined) => {
    const { [id]: _, ...rest } = marks;
    setMarks(next ? { ...rest, [id]: next } : rest);
  };

  const value = useMemo<ThreadsCtx>(
    () => ({
      threads,
      selectedId,
      select,
      shelves: shelveThreads(
        filterThreads(threads ?? [], new Set(projectScope ? [projectScope] : visible.map((p) => p.id)), query),
        marks,
        now,
      ),
      projectScope,
      setProjectScope,
      query,
      setQuery,
      marks,
      now,
      settle: (id) => mark(id, { settledAt: new Date().toISOString() }),
      snooze: (id) => mark(id, { snoozedUntil: nextMorning(new Date()).toISOString() }),
      reopen: (id) => mark(id, undefined),
    }),
    // select and mark are stable in behaviour; recreate only when data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threads, selectedId, marks, now, visible, projectScope, query],
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

/**
 * Snooze and settle marks in localStorage: a stand-in so the shelves can be
 * tried before the server keeps them (GLOSSARY: Client holds no state of its own).
 */
function useShelfMarks(): [ShelfMarks, (m: ShelfMarks) => void] {
  const key = 'accio.shelfMarks';
  const [marks, setMarks] = useState<ShelfMarks>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}') as ShelfMarks;
    } catch {
      return {};
    }
  });
  return [
    marks,
    (m) => {
      localStorage.setItem(key, JSON.stringify(m));
      setMarks(m);
    },
  ];
}

/** The current time, updated every minute so snoozed threads wake on their own. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
