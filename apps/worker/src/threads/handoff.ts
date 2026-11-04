import type { TranscriptItem } from '@accio/protocol';
import { HARNESSES } from '@accio/hub';
import { z } from 'zod';
import { accioTool } from '../tools/tools.js';

/**
 * GLOSSARY: Handoff (ADR 0017). A harness change waiting for the next turn: that turn's
 * prompt carries the transcript after `after`, the last item the new harness saw, or the
 * whole thread when it has never run it. Cleared once the new harness reports its session.
 */
export type PendingHandoff = { from: string; after: string | null };

/** A harness the thread has left: its session to resume and the last transcript item it saw. */
export type LeftHarness = { sessionId: string | null; seenThrough: string | null };

/** About 12k tokens of history: enough for the gist of a long thread, small beside any context window. */
export const HANDOFF_BUDGET = 48_000;
const ITEM_CAP = 6_000;
const OUTPUT_CAP = 600;

export const READ_THREAD_TOOL = 'read_thread';

const harnessName = (id: string) => HARNESSES.find((h) => h.id === id)?.name ?? id;

function clip(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** One transcript item as plain text, or null for items that carry no conversation. */
export function renderItem(item: TranscriptItem): string | null {
  switch (item.kind) {
    case 'user': return `[User]\n${item.text}`;
    case 'assistant': return item.text ? `[Assistant]\n${item.text}` : null;
    case 'tool': {
      const output = item.output?.trim() ? `\n${clip(item.output.trim(), OUTPUT_CAP)}` : '';
      return `[Tool ${item.name}; ${item.status}] ${item.summary}${output}`;
    }
    case 'choice': return `[Assistant offered a choice] ${item.question}`;
    case 'notice': return `[${item.tone === 'error' ? 'Error' : 'Note'}] ${item.text}`;
    default: return null;
  }
}

/**
 * The items that fit `budget` characters: the first and last user message and the last
 * reply first, as T3 Code does, then the rest newest first. Returned in transcript order.
 */
function select(rendered: { item: TranscriptItem; text: string }[], budget: number) {
  const chosen = new Set<number>();
  let left = budget;
  const take = (i: number) => {
    const entry = rendered[i];
    if (!entry || chosen.has(i) || entry.text.length + 2 > left) return;
    chosen.add(i);
    left -= entry.text.length + 2;
  };
  take(rendered.findLastIndex((r) => r.item.kind === 'user'));
  take(rendered.findLastIndex((r) => r.item.kind === 'assistant'));
  take(rendered.findIndex((r) => r.item.kind === 'user'));
  for (let i = rendered.length - 1; i >= 0; i--) take(i);
  return { texts: rendered.filter((_, i) => chosen.has(i)).map((r) => r.text), omitted: rendered.length - chosen.size };
}

/** The history the new harness has not seen, as it precedes the user's message. Empty when there is none. */
export function handoffContext(items: readonly TranscriptItem[], handoff: PendingHandoff, budget = HANDOFF_BUDGET): string {
  const start = handoff.after === null ? 0 : items.findIndex((i) => i.id === handoff.after) + 1;
  const rendered = items.slice(start).flatMap((item) => {
    const text = renderItem(item);
    return text ? [{ item, text: clip(text, ITEM_CAP) }] : [];
  });
  if (rendered.length === 0) return '';
  const { texts, omitted } = select(rendered, budget);
  const from = harnessName(handoff.from);
  const intro = handoff.after === null
    ? `Context handoff: earlier turns of this thread ran on ${from}. This is the conversation so far, from accio's transcript.`
    : `Context handoff: since you last worked on this thread it ran on ${from}. This is what happened meanwhile, from accio's transcript.`;
  const gaps = omitted > 0 ? ` ${omitted} of ${rendered.length} items are left out; read the whole thread with the accio ${READ_THREAD_TOOL} tool.` : '';
  return `${intro} It is history, not a new request.${gaps} Files may have changed; check before relying on them.\n\n${texts.join('\n\n')}`;
}

type HarnessState = { model: { harnessId: string }; sessionId: string | null; leftHarnesses?: Record<string, LeftHarness>; handoff?: PendingHandoff };

/**
 * Moves a thread to `harnessId`. The harness it leaves keeps its session and what it saw:
 * everything up to `lastItemId`, or only what its own undelivered handoff would have shown.
 * The harness it moves to resumes its old session, if any, and is handed what it missed.
 */
export function changeHarness<T extends HarnessState>(thread: T, harnessId: string, lastItemId: string | null): T {
  const from = thread.model.harnessId;
  if (from === harnessId) return thread;
  const leaving: LeftHarness = thread.handoff ? { sessionId: thread.sessionId, seenThrough: thread.handoff.after } : { sessionId: thread.sessionId, seenThrough: lastItemId };
  const { [harnessId]: returning, ...others } = thread.leftHarnesses ?? {};
  const after = returning?.sessionId ? returning.seenThrough : null;
  return { ...thread, sessionId: returning?.sessionId ?? null, leftHarnesses: { ...others, [from]: leaving }, handoff: { from: thread.handoff?.from ?? from, after } };
}

/** The prompt a turn sends when it carries a handoff. */
export function withHandoff(context: string, prompt: string) {
  return context ? `${context}\n\nUser message:\n${prompt}` : prompt;
}

/** The accio tool, listed only on threads that have changed harness. */
export function readThreadTool(read: (threadId: string, offset: number, limit: number) => Promise<string>, handedOff: (threadId: string) => boolean) {
  return accioTool({
    name: READ_THREAD_TOOL,
    description: 'Read this thread\'s whole conversation from accio\'s transcript, including turns that ran on another harness or were left out of a context handoff. Items are numbered from 0, oldest first.',
    input: {
      offset: z.number().int().min(0).default(0).describe('The first item to read'),
      limit: z.number().int().min(1).max(200).default(50).describe('How many items to read'),
    },
    available: handedOff,
    call: ({ offset, limit }, { threadId }) => read(threadId, offset, limit),
  });
}

/** A page of the whole transcript for the read_thread tool. */
export function readThreadPage(items: readonly TranscriptItem[], offset: number, limit: number): string {
  const rendered = items.flatMap((item) => { const text = renderItem(item); return text ? [text] : []; });
  const page = rendered.slice(offset, offset + limit).map((text, i) => `#${offset + i}\n${text}`);
  const next = offset + limit < rendered.length ? `\n\nMore items follow; call again with offset ${offset + limit}.` : '';
  return `${rendered.length} items in this thread.\n\n${page.join('\n\n')}${next}`;
}
