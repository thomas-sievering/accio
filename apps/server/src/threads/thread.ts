import { randomUUID } from 'node:crypto';
import type { ChoicePick, ThreadView, TranscriptItem } from '@accio/protocol';
import { DEFAULT_MODEL } from '@accio/protocol';
import { UserError } from '../rpc/router.js';

/** A thread as stored: what clients see, plus the harness session it continues. */
export type Thread = ThreadView & { sessionId: string | null; resumeAfterRestart?: boolean };

export const NEW_THREAD_TITLE = 'New thread';

export function toView({ sessionId: _s, resumeAfterRestart: _r, ...view }: Thread): ThreadView {
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
  return { ...t, model, snoozedUntil: t.snoozedUntil ?? null, settledAt: t.settledAt ?? null };
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

/** A turn may start only when none is running. Talking to a snoozed or settled thread reopens it. */
export function startTurn(thread: Thread, firstText: string, now: string): Thread {
  if (thread.status === 'running') throw new UserError('This thread is already working. Stop it or wait for it to finish.');
  return {
    ...reopen(thread),
    status: 'running',
    resumeAfterRestart: undefined,
    title: thread.title === NEW_THREAD_TITLE ? titleFrom(firstText) : thread.title,
    updatedAt: now,
  };
}

export function titleFrom(text: string): string {
  const line = text.trim().split('\n')[0]!.trim();
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
  return { ...thread, status, updatedAt: now, resumeAfterRestart: outcome === 'interrupted' ? thread.resumeAfterRestart : undefined };
}

/**
 * On startup no turn can still be running: the process that ran it is gone.
 * Recover their status before starting a fresh turn on the saved session.
 * Delivery remains an explicit action, including queued publishing intent.
 */
export function recoverAfterRestart(threads: readonly Thread[]): { threads: Thread[]; interrupted: Thread[] } {
  const interrupted = threads.filter((t) => t.status === 'running');
  const next = threads.map((t) => (t.status === 'running' ? { ...t, status: 'interrupted' as const,
    resumeAfterRestart: t.resumeAfterRestart !== false && !!t.sessionId && !t.delivery,
  } : t));
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
export function retryOf(thread: Thread, items: readonly TranscriptItem[]): { text: string; resume: boolean; pick?: ChoicePick } {
  if (thread.status !== 'failed') throw new UserError('Only a failed thread can be retried');
  const last = [...items].reverse().find((i) => i.kind === 'user');
  if (!last || last.kind !== 'user') throw new UserError('There is no message to retry');
  return last.resume ? { text: RESUME_PROMPT, resume: true } : { text: last.text, resume: false, ...(last.pick ? { pick: last.pick } : {}) };
}
