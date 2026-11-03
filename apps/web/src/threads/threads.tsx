import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLiveState, useLocalState } from '../app/useLive';
import { useProjects } from '../projects/projects';
import { useProfiles } from '../profiles/profiles';
import { observeTranscript, type TranscriptState } from './observeTranscript';
import { filterThreads, nextMorning, shelveThreads, type ThreadShelves } from './shelves';

type ThreadsCtx = {
  threads: ThreadView[] | undefined;
  loadError?: string;
  retryLoad: () => void;
  /** The open thread, or '' when none (or a draft) is open. */
  selectedId: string;
  select: (id: string) => void;
  /** A new thread not yet started: just the checkout it will run in. It exists on the server only once its first message is sent. */
  draft: { checkoutId: string; profileId?: string } | null;
  openDraft: (checkoutId: string, profileId?: string) => void;
  /** Counts thread and draft openings, so a view over the main pane can close on any of them, even reselecting the open thread. */
  navigation: number;
  /** The open list plus the Working, Snoozed and Settled shelves, after the project scope and search. */
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
  const { value: threads, error: loadError, retry: retryLoad } = useLiveState(() => client.call('threads.list', {}), 'threads.changed');
  const [selectedId, setSelected] = useLocalState<string>('accio.thread', '');
  const draftKey = `accio:${client.hubId}:draft`;
  const [draft, updateDraft] = useState<ThreadsCtx['draft']>(() => { try { return JSON.parse(sessionStorage.getItem(draftKey) ?? 'null'); } catch { return null; } });
  const setDraft = (value: ThreadsCtx['draft']) => { updateDraft(value); if (value) sessionStorage.setItem(draftKey, JSON.stringify(value)); else sessionStorage.removeItem(draftKey); };
  const [navigation, setNavigation] = useState(0);
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
      loadError,
      retryLoad,
      selectedId: draft ? '' : selectedId,
      select: (id) => {
        setDraft(null);
        setSelected(id);
        setNavigation((n) => n + 1);
      },
      draft,
      openDraft: (checkoutId, profileId) => {
        setDraft({ checkoutId, profileId });
        setNavigation((n) => n + 1);
      },
      navigation,
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
    [client, threads, loadError, retryLoad, selectedId, draft, navigation, now, visible, projectScope, query, filter],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThreads(): ThreadsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useThreads outside ThreadsProvider');
  return c;
}

/** A selected transcript; retry starts a fresh observation of the current connection. */
export function useTranscript(threadId: string): TranscriptState & { retry: () => void } {
  const client = useClient();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<TranscriptState & { threadId: string }>({ threadId });
  useEffect(() => observeTranscript(client, threadId, (next) => setState({ ...next, threadId })), [client, threadId, attempt]);
  return { ...(state.threadId === threadId ? state : {}), retry: () => setAttempt((n) => n + 1) };
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
