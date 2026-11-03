import { z } from 'zod';
import { method } from './rpc.js';
import { ModelSelection } from './models.js';

/**
 * GLOSSARY: Thread. A durable conversation with a harness inside one checkout.
 * It keeps the profile it started with for its whole life.
 */
export type ThreadView = {
  id: string;
  checkoutId: string;
  projectId: string;
  profileId: string;
  model: ModelSelection;
  title: string;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
  /** GLOSSARY: Snooze. Hidden until this time; null when not snoozed. */
  snoozedUntil: string | null;
  /** GLOSSARY: Settle. When it was marked done; null while open. */
  settledAt: string | null;
};

/**
 * idle: no turn running. running: a turn is in progress. interrupted: the last
 * turn stopped before finishing (you stopped it, or the machine restarted) and
 * continues only when you resume it. failed: the last turn ended in an error.
 */
export type ThreadStatus = 'idle' | 'running' | 'interrupted' | 'failed';

/** One entry of a thread's transcript. */
export type TranscriptItem =
  | { kind: 'user'; id: string; turnId: string; text: string; at: string; resume?: boolean }
  | { kind: 'assistant'; id: string; turnId: string; text: string }
  | { kind: 'tool'; id: string; turnId: string; name: string; summary: string; status: 'running' | 'done' | 'error'; output?: string }
  | { kind: 'notice'; id: string; turnId: string; tone: 'info' | 'error'; text: string };

const ThreadId = z.object({ threadId: z.string() });
const Start = z.object({ checkoutId: z.string(), text: z.string().trim().min(1), model: ModelSelection.optional() });
const SetModel = z.object({ threadId: z.string(), model: ModelSelection });
const Snooze = z.object({ threadId: z.string(), until: z.iso.datetime({ offset: true }) });
const Send = z.object({ threadId: z.string(), text: z.string().trim().min(1) });
const Rename = z.object({ threadId: z.string(), title: z.string().trim().min(1).max(120) });

export const threadMethods = {
  'threads.list': method<z.ZodObject<{}>, ThreadView[]>(z.object({})),
  /** Creates a thread in a checkout and sends its first message: a thread exists only once something was said. */
  'threads.start': method<typeof Start, ThreadView>(Start),
  'threads.transcript': method<typeof ThreadId, TranscriptItem[]>(ThreadId),
  'threads.send': method<typeof Send, null>(Send),
  'threads.setModel': method<typeof SetModel, ThreadView>(SetModel),
  /** Stops the running turn; the thread becomes interrupted. */
  'threads.stop': method<typeof ThreadId, null>(ThreadId),
  /** Continues an interrupted turn on the same Claude session. */
  'threads.resume': method<typeof ThreadId, null>(ThreadId),
  /** Sends the failed turn's message again (or resumes again, if that turn was a resume). */
  'threads.retry': method<typeof ThreadId, null>(ThreadId),
  'threads.snooze': method<typeof Snooze, ThreadView>(Snooze),
  'threads.settle': method<typeof ThreadId, ThreadView>(ThreadId),
  /** Takes a thread off the Snoozed or Settled shelf. Sending a message does the same. */
  'threads.reopen': method<typeof ThreadId, ThreadView>(ThreadId),
  'threads.rename': method<typeof Rename, ThreadView>(Rename),
  'threads.delete': method<typeof ThreadId, null>(ThreadId),
};

export type ThreadEvents = {
  'threads.changed': ThreadView[];
  /** A transcript item was added or replaced. */
  'thread.item': { threadId: string; item: TranscriptItem };
  /** Streamed text appended to an assistant item. */
  'thread.delta': { threadId: string; itemId: string; text: string };
};
