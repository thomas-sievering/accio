import { randomUUID } from 'node:crypto';
import type { ChoicePick, ThreadAsset, ThreadView, TranscriptItem } from '@accio/protocol';
import { DEFAULT_MODEL, pasteGist, pastesIn, typedText } from '@accio/protocol';
import { UserError } from '../rpc/router.js';
import type { LeftHarness, PendingHandoff } from './handoff.js';

/**
 * A thread as stored: what clients see, plus the harness session it continues, the
 * sessions of harnesses it has left and a handoff waiting for the next turn (ADR 0017).
 */
export type Thread = ThreadView & { sessionId: string | null; leftHarnesses?: Record<string, LeftHarness>; handoff?: PendingHandoff; organizationVersion?: number; resumeAfterRestart?: boolean; titleManual?: boolean; titleNeedsRefinement?: boolean };

export const NEW_THREAD_TITLE = 'New thread';

export function toView({ sessionId: _s, leftHarnesses: _l, handoff: _h, organizationVersion: _o, resumeAfterRestart: _r, titleManual: _m, titleNeedsRefinement: _n, ...view }: Thread): ThreadView {
  return view;
}

export function newThread(input: { checkoutId: string; projectId: string; profileId: string; hubId?: string; model?: ThreadView['model'] }, now: string): Thread {
  return {
    id: randomUUID(),
    ...input,
    model: input.model ?? { ...DEFAULT_MODEL },
    title: NEW_THREAD_TITLE,
    status: 'idle',
    sessionId: null,
    createdAt: now,
    updatedAt: now,
    snoozedUntil: null,
    settledAt: null,
  };
}

/**
 * Threads stored before snooze and settle moved to the server have neither field.
 * Threads stored before model selection have no model, and ones stored while
 * Claude Code's account default was a choice have modelId 'default'; both get DEFAULT_MODEL.
 */
export function fromStored(t: Omit<Thread, 'snoozedUntil' | 'settledAt' | 'model'> & Partial<Pick<Thread, 'snoozedUntil' | 'settledAt' | 'model'>>): Thread {
  const model = !t.model || (t.model.harnessId === 'claudeCode' && t.model.modelId === 'default') ? { ...DEFAULT_MODEL } : t.model;
  const workVersion = t.workVersion ?? 0;
  const delivery = t.delivery && { ...t.delivery,
    id: t.delivery.id ?? `${t.id}:${t.delivery.requestedAt}`,
    workVersion: t.delivery.workVersion ?? workVersion,
    // Historical completed deliveries have no record of a later manual Reopen.
    autoSettle: t.delivery.autoSettle ?? t.delivery.status !== 'delivered',
  };
  return { ...t, model, workVersion, delivery, organizationVersion: t.organizationVersion ?? 0, snoozedUntil: t.snoozedUntil ?? null, settledAt: t.settledAt ?? null };
}

/**
 * Threads made by an earlier accio before anything was said in them. A thread
 * now exists only once its first message is sent, so these are dropped on load.
 */
export function dropUnstarted(threads: readonly Thread[]): Thread[] {
  return threads.filter((t) => t.workspace || !(t.status === 'idle' && t.sessionId === null && t.title === NEW_THREAD_TITLE));
}

/** GLOSSARY: Snooze. A thread hides until `until`; snoozing a settled thread reopens it first. */
export function snooze(thread: Thread, until: string): Thread {
  return { ...thread, snoozedUntil: until, settledAt: null };
}

/** GLOSSARY: Settle. */
export function settle(thread: Thread, now: string): Thread {
  return { ...thread, settledAt: now, snoozedUntil: null };
}

/** Back in the open list. */
export function reopen(thread: Thread): Thread {
  return { ...thread, snoozedUntil: null, settledAt: null };
}

/**
 * A turn may start only when none is running. Talking to a snoozed or settled thread reopens it.
 * The turn that continues work cut off by a restart keeps the time already run, so downtime never counts.
 */
export function startTurn(thread: Thread, firstText: string, now: string): Thread {
  if (thread.status === 'running') throw new UserError('This thread is already working. Stop it or wait for it to finish.');
  const continuing = thread.status === 'interrupted' && thread.resumeAfterRestart;
  return {
    ...reopen(thread),
    status: 'running',
    runningSince: now,
    ranMs: continuing ? thread.ranMs : undefined,
    resumeAfterRestart: undefined,
    title: thread.title === NEW_THREAD_TITLE && !thread.titleManual ? titleFrom(firstText) : thread.title,
    updatedAt: now,
  };
}

/** The first typed line; a message of only Pasted text is named by the paste's first line. */
export function titleFrom(text: string): string {
  const line = typedText(text).trim().split('\n')[0]!.trim() || pasteGist(pastesIn(text)[0] ?? '');
  return line.length > 60 ? `${line.slice(0, 59)}…` : line || NEW_THREAD_TITLE;
}

/** Replaces an item with the same id, or appends it. */
export function upsertItem(items: TranscriptItem[], item: TranscriptItem): TranscriptItem[] {
  const i = items.findIndex((x) => x.id === item.id);
  if (i === -1) return [...items, item];
  const next = items.slice();
  next[i] = item;
  return next;
}

export type TurnOutcome = 'completed' | 'failed' | 'interrupted';

/** Where a thread stands once its turn has ended. */
export function endTurn(thread: Thread, outcome: TurnOutcome, now: string): Thread {
  const status = outcome === 'completed' ? 'idle' : outcome;
  return { ...thread, status, updatedAt: now, resumeAfterRestart: outcome === 'interrupted' ? thread.resumeAfterRestart : undefined,
    runningSince: undefined, ranMs: outcome === 'interrupted' ? ranUntil(thread, now) : undefined };
}

/** The time a run has spent running, banked when its turn stops at `end`. Unknown ends add nothing. */
function ranUntil(thread: Thread, end: string | undefined): number | undefined {
  const ran = thread.runningSince && end ? Math.max(0, Date.parse(end) - Date.parse(thread.runningSince)) : 0;
  return (thread.ranMs ?? 0) + ran || undefined;
}

/** What a turn cut off by accio shutting down says, so it does not read as an explicit Stop. */
export const RESTART_NOTICE = 'Interrupted: accio stopped while this turn was running. It continues when accio starts again.';

/**
 * On startup no turn can still be running: the process that ran it is gone.
 * Recover their status before starting a fresh turn on the saved session.
 * A Ship cut off this way stays requested and continues too: a delivery turn
 * resumes with the rest, and a scripted ship, which ran without a turn, runs again.
 */
export function recoverAfterRestart(threads: readonly Thread[], lastActive: (t: Thread) => string | undefined = () => undefined): { threads: Thread[]; interrupted: Thread[] } {
  const interrupted = threads.filter((t) => t.status === 'running');
  const next = threads.map((t): Thread => {
    if (t.status === 'running') {
      const resumeAfterRestart = t.resumeAfterRestart !== false && !!t.sessionId;
      const delivery = t.delivery?.status === 'running' ? resumeAfterRestart
        ? { ...t.delivery, status: 'queued' as const }
        : { ...t.delivery, status: 'blocked' as const, detail: 'Delivery was interrupted. Check the conversation and request Ship again to continue safely.' }
        : t.delivery;
      // The process died without ending the turn: its last activity stands in for when it stopped running.
      return { ...t, status: 'interrupted', resumeAfterRestart, delivery, runningSince: undefined, ranMs: ranUntil(t, lastActive(t)) };
    }
    // Running without a turn is a scripted ship. Clearing its start runs the script again.
    if (t.delivery?.status === 'running') return { ...t, delivery: { ...t.delivery, status: 'queued', startedAt: undefined, step: undefined } };
    return t;
  });
  return { threads: next, interrupted };
}

/** Tool calls that were in flight when a turn died did not report back. */
export function closeOpenTools(items: readonly TranscriptItem[]): TranscriptItem[] {
  return items.map((i) => (i.kind === 'tool' && i.status === 'running' ? { ...i, status: 'interrupted' as const } : i));
}

/**
 * What Resume sends, on the same Claude session. Modelled on T3's restart
 * continuation: the harness must check before repeating anything with effects.
 */
export const RESUME_PROMPT =
  'Continue where you left off. Your previous turn was interrupted before it finished. ' +
  'Before you repeat any action that changes state (editing files, running commands with side effects, ' +
  'calling external services), first check whether it already took effect, and do not repeat it if it did.';

export function assertResumable(thread: Thread) {
  if (thread.status !== 'interrupted') throw new UserError('Only an interrupted thread can be resumed');
}

/** What Retry sends: the failed turn's own message, or another resume if that turn was one. */
export function retryOf(thread: Thread, items: readonly TranscriptItem[]): { text: string; resume: boolean; pick?: ChoicePick; images?: ThreadAsset[] } {
  if (thread.status !== 'failed') throw new UserError('Only a failed thread can be retried');
  const last = [...items].reverse().find((i) => i.kind === 'user');
  if (!last || last.kind !== 'user') throw new UserError('There is no message to retry');
  return last.resume ? { text: RESUME_PROMPT, resume: true } : { text: last.text, resume: false, ...(last.pick ? { pick: last.pick } : {}), ...(last.images ? { images: last.images } : {}) };
}
