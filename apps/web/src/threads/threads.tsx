import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ThreadView, TranscriptItem } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { useLive, useLocalState } from '../app/useLive';
import { useProjects } from '../projects/projects';
import { useProfiles } from '../profiles/profiles';
import { filterThreads, nextMorning, shelveThreads, type ThreadShelves } from './shelves';

type ThreadsCtx = {
  threads: ThreadView[] | undefined;
  /** The open thread, or '' when none (or a draft) is open. */
  selectedId: string;
  select: (id: string) => void;
  /** A new thread not yet started: just the checkout it will run in. It exists on the server only once its first message is sent. */
  draft: { checkoutId: string; profileId?: string } | null;
  openDraft: (checkoutId: string, profileId?: string) => void;
  /** The open list plus the Snoozed and Settled shelves, after the project scope and search. */
  shelves: ThreadShelves;
  /** The one project the sidebar is narrowed to, or '' for every visible project. */
  projectScope: string;
  setProjectScope: (projectId: string) => void;
  query: string;
  setQuery: (q: string) => void;
  now: Date;
  /** Thread actions shared by the row's hover buttons and its right-click menu. */
  act: ThreadActions;
};

export type ThreadActions = {
  snooze: (id: string) => Promise<unknown>;
  settle: (id: string) => Promise<unknown>;
  /** Takes a thread off the Snoozed or Settled shelf. */
  reopen: (id: string) => Promise<unknown>;
  stop: (id: string) => Promise<unknown>;
};

const Ctx = createContext<ThreadsCtx | null>(null);

export function ThreadsProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const threads = useLive(() => client.call('threads.list', {}), 'threads.changed');
  const [selectedId, setSelected] = useLocalState<string>('accio.thread', '');
  const [draft, setDraft] = useState<ThreadsCtx['draft']>(null);
  const { filter } = useProfiles();
  const { visible } = useProjects();
  const [storedScope, setProjectScope] = useLocalState<string>('accio.projectScope', '');
  const [query, setQuery] = useState('');
  // A scope outside the selected profile (or a removed project) falls back to every project.
  const projectScope = visible.some((p) => p.id === storedScope) ? storedScope : '';
  const now = useMinuteClock();
  useMoveLegacyShelfMarks(threads);

  const value = useMemo<ThreadsCtx>(
    () => ({
      threads,
      selectedId: draft ? '' : selectedId,
      select: (id) => {
        setDraft(null);
        setSelected(id);
      },
      draft,
      openDraft: (checkoutId, profileId) => setDraft({ checkoutId, profileId }),
      shelves: shelveThreads(filterThreads(
        (threads ?? []).filter((t) => t.projectId || filter === 'all' || t.profileId === filter),
        new Set(projectScope ? [projectScope] : ['', ...visible.map((p) => p.id)]), query,
      ), now),
      projectScope,
      setProjectScope,
      query,
      setQuery,
      now,
      act: {
        snooze: (id) => client.call('threads.snooze', { threadId: id, until: nextMorning(new Date()).toISOString() }),
        settle: (id) => client.call('threads.settle', { threadId: id }),
        reopen: (id) => client.call('threads.reopen', { threadId: id }),
        stop: (id) => client.call('threads.stop', { threadId: id }),
      },
    }),
    // The setters are stable in behaviour; recreate only when data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, threads, selectedId, draft, now, visible, projectScope, query, filter],
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
 * Snooze and settle marks used to live in this browser's localStorage. They now
 * live on the server with the thread; move any left here once, then forget them.
 */
function useMoveLegacyShelfMarks(threads: ThreadView[] | undefined) {
  const client = useClient();
  const migrating = useRef(false);
  useEffect(() => {
    const key = 'accio.shelfMarks';
    const raw = localStorage.getItem(key);
    if (!threads || !raw || migrating.current) return;
    let marks: Record<string, { snoozedUntil?: string; settledAt?: string }> = {};
    try {
      marks = JSON.parse(raw);
    } catch {
      localStorage.removeItem(key);
      return;
    }
    if (!marks || typeof marks !== 'object' || Array.isArray(marks)) {
      localStorage.removeItem(key);
      return;
    }
    migrating.current = true;
    void Promise.allSettled(
      threads.map(async (t) => {
        const m = marks[t.id];
        if (!m || t.settledAt || t.snoozedUntil) return;
        if (m.settledAt) await client.call('threads.settle', { threadId: t.id });
        else if (m.snoozedUntil && new Date(m.snoozedUntil) > new Date())
          await client.call('threads.snooze', { threadId: t.id, until: m.snoozedUntil });
      }),
    ).then((results) => {
      if (results.every((r) => r.status === 'fulfilled') && localStorage.getItem(key) === raw) localStorage.removeItem(key);
      migrating.current = false;
    });
  }, [client, threads]);
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
