import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLiveState, useLocalState } from '../app/useLive';
import { useProjects } from '../projects/projects';
import { useProfiles } from '../profiles/profiles';
import { observeTranscript, type TranscriptState } from './observeTranscript';
import { createPlacementTracker, filterThreads, nextAfterSend, nextMorning, shelveThreads, type Placement, type ThreadShelves } from './shelves';
import { clearFirstMessages } from './sentImages';

type ThreadsCtx = {
  threads: ThreadView[] | undefined;
  loadError?: string;
  retryLoad: () => void;
  /** The open thread, or '' when none (or a draft, or the empty page) is open. */
  selectedId: string;
  select: (id: string) => void;
  /** GLOSSARY: Move on. The page Move on opens when the inbox is empty; a landing page later. */
  emptyPage: boolean;
  /** Whether a send that starts a turn moves on: a preference of this client, on by default. */
  movesOn: boolean;
  setMovesOn: (on: boolean) => void;
  /** After a send from `sentId` that started a turn: opens the top of the inbox, or the empty page. */
  moveOn: (sentId: string) => void;
  /**
   * A new thread not yet started: just the checkout it will run in, or a hub project this machine has no
   * checkout of (`repoKey`, with its profile). It exists on the server only once its first message is sent.
   */
  draft: Draft | null;
  openDraft: (checkoutId: string, profileId?: string, repoKey?: string) => void;
  /** The open list plus the Working, Snoozed and Settled shelves, after the project scope and search. */
  shelves: ThreadShelves;
  /** Where the sidebar places a thread, so other lists of threads group them as it does. */
  placement: Placement;
  /** The one project the sidebar is narrowed to, or '' for every visible project. */
  projectScope: string;
  setProjectScope: (projectId: string) => void;
  query: string;
  setQuery: (q: string) => void;
  now: Date;
  /** Thread actions shared by the row's hover buttons and its right-click menu. */
  act: ThreadActions;
};

/** The saved selection of the empty page; thread ids never take this form. */
const EMPTY_PAGE = ':empty';
// One switch per client, not per hub. The Playwright config and tests/electron-shell.cjs set it off by this name.
const MOVES_ON_KEY = 'accio.moveOn';

type Draft = { checkoutId: string; profileId?: string; repoKey?: string };

export type ThreadActions = {
  snooze: (id: string) => Promise<unknown>;
  settle: (id: string) => Promise<unknown>;
  /** Takes a thread off the Snoozed or Settled shelf. */
  reopen: (id: string) => Promise<unknown>;
  stop: (id: string) => Promise<unknown>;
};

const Ctx = createContext<ThreadsCtx | null>(null);

/** `onNavigate` runs on every thread or draft opening, even reselecting the open thread, so the shell can show the thread surface. */
export function ThreadsProvider({ children, onNavigate }: { children: ReactNode; onNavigate: () => void }) {
  const client = useClient();
  useEffect(() => () => clearFirstMessages(client), [client]);
  const { value: threads, error: loadError, retry: retryLoad } = useLiveState(() => client.call('threads.list', {}), 'threads.changed');
  const [selectedId, setSelected] = useLocalState<string>('accio.thread', '');
  const draftKey = `accio:${client.hubId}:draft`;
  // Kept across restarts, like the selected thread, so the app reopens on the draft it closed on.
  const [draft, updateDraft] = useState<ThreadsCtx['draft']>(() => { try { return JSON.parse(localStorage.getItem(draftKey) ?? 'null'); } catch { return null; } });
  const setDraft = (value: ThreadsCtx['draft']) => { updateDraft(value); if (value) localStorage.setItem(draftKey, JSON.stringify(value)); else localStorage.removeItem(draftKey); };
  const { filter } = useProfiles();
  const { visible, state: projects } = useProjects();
  const [storedScope, setProjectScope] = useLocalState<string>('accio.projectScope', '');
  const [query, setQuery] = useState('');
  // A scope outside the selected profile (or a removed project) falls back to every project.
  const projectScope = visible.some((p) => p.id === storedScope) ? storedScope : '';
  const now = useMinuteClock();
  useMoveLegacyShelfMarks(threads);
  const placement = usePlacement(threads, now);
  const [movesOn, updateMovesOn] = useState(() => localStorage.getItem(MOVES_ON_KEY) !== '0');
  const shelves = useMemo(
    () => shelveThreads(filterThreads(threads ?? [], { project: projectScope, profileId: filter, projects: projects?.projects ?? [] }, query), now, placement),
    [threads, projectScope, filter, projects, query, now, placement],
  );
  // A send is accepted after a round trip; Move on reads the inbox and selection as they are by then.
  const latest = useRef({ shelves, selectedId, draft });
  useLayoutEffect(() => { latest.current = { shelves, selectedId, draft }; });
  const emptyPage = !draft && selectedId === EMPTY_PAGE;

  const value = useMemo<ThreadsCtx>(
    () => ({
      threads,
      loadError,
      retryLoad,
      selectedId: draft || emptyPage ? '' : selectedId,
      select: (id) => {
        setDraft(null);
        setSelected(id);
        onNavigate();
      },
      emptyPage,
      movesOn,
      setMovesOn: (on) => { localStorage.setItem(MOVES_ON_KEY, on ? '1' : '0'); updateMovesOn(on); },
      moveOn: (sentId) => {
        const current = latest.current;
        // Only from the thread still open: a send accepted after you went elsewhere leaves you there.
        if (current.draft || current.selectedId !== sentId) return;
        const next = nextAfterSend(current.shelves.open, sentId);
        setSelected(next.kind === 'thread' ? next.id : EMPTY_PAGE);
        onNavigate();
      },
      draft,
      openDraft: (checkoutId, profileId, repoKey) => {
        setDraft({ checkoutId, profileId, ...(repoKey ? { repoKey } : {}) });
        onNavigate();
      },
      placement,
      shelves,
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
    // setDraft, setSelected and setProjectScope are rebuilt each render, but they only close over
    // keys derived from client, which is listed; recreate only when data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, threads, placement, shelves, loadError, retryLoad, selectedId, emptyPage, movesOn, draft, onNavigate, now, projectScope, query],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Observes every thread (before scope and search) so a thread that just finished is held on
 * Working briefly and a return is timed once, then re-places when a hold runs out.
 */
function usePlacement(threads: ThreadView[] | undefined, now: Date) {
  const [observe] = useState(createPlacementTracker);
  const [expired, setExpired] = useState(0);
  // now and expired are not read: they re-observe the threads as time passes and holds run out.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const placement = useMemo(() => observe(threads ?? [], Date.now()), [observe, threads, now, expired]);
  useEffect(() => {
    if (placement.nextDeadline === undefined) return;
    const timer = setTimeout(() => setExpired((n) => n + 1), Math.max(0, placement.nextDeadline - Date.now()));
    return () => clearTimeout(timer);
  }, [placement]);
  return placement;
}

export function useThreads(): ThreadsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useThreads outside ThreadsProvider');
  return c;
}

/** Keep the selected transcript painted while a fresh observation or retry catches up. */
export function useTranscript(threadId: string): TranscriptState & { retry: () => void } {
  const client = useClient();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<TranscriptState & { threadId: string; client: typeof client }>({ threadId, client });
  useEffect(() => observeTranscript(client, threadId, (next) => setState(previous => ({
    ...next, threadId, client,
    items: next.items ?? (previous.threadId === threadId && previous.client === client ? previous.items : undefined),
  }))), [client, threadId, attempt]);
  const current = state.threadId === threadId && state.client === client ? state : undefined;
  return { items: current?.items, error: current?.error, retry: () => setAttempt((n) => n + 1) };
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
