import { z } from 'zod';
import { method } from './rpc.js';

/**
 * GLOSSARY: Thread. A durable conversation with a harness inside one checkout.
 * It keeps the profile it started with for its whole life.
 */
export type ThreadView = {
  id: string;
  checkoutId: string;
  projectId: string;
  profileId: string;
  title: string;
  status: ThreadStatus;
  createdAt: string;
  updatedAt: string;
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
const Create = z.object({ checkoutId: z.string() });
const Send = z.object({ threadId: z.string(), text: z.string().trim().min(1) });
const Rename = z.object({ threadId: z.string(), title: z.string().trim().min(1).max(120) });

export const threadMethods = {
  'threads.list': method<z.ZodObject<{}>, ThreadView[]>(z.object({})),
  'threads.create': method<typeof Create, ThreadView>(Create),
  'threads.transcript': method<typeof ThreadId, TranscriptItem[]>(ThreadId),
  'threads.send': method<typeof Send, null>(Send),
  /** Stops the running turn; the thread becomes interrupted. */
  'threads.stop': method<typeof ThreadId, null>(ThreadId),
  /** Continues an interrupted turn on the same Claude session. */
  'threads.resume': method<typeof ThreadId, null>(ThreadId),
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
