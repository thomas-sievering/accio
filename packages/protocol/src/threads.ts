import { z } from 'zod';
import { method } from './rpc.js';
import { ModelSelection } from './models.js';
import type { AssetUrl, MediaBinding, ThreadAsset, ToolDetails } from './media.js';
import type { LoadedSkill } from './workspaceSkills.js';

/**
 * GLOSSARY: Thread. A durable conversation with a harness inside one checkout.
 * It keeps the profile it started with for its whole life.
 */
export type ThreadView = {
  repairToolId?: string;
  id: string;
  /** Empty for a thread started with No project. */
  checkoutId: string;
  /** Empty for a thread started with No project. */
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
  /** Absent on older threads that still use their original, shared checkout. */
  workspace?: ThreadWorkspace;
  delivery?: ThreadDelivery;
};

export type ThreadWorkspace = {
  path: string;
  sourcePath: string;
  branch: string;
  startRevision: string;
  releasedAt: string | null;
  /** Durable cleanup intent, written before any worktree removal. */
  releaseRequestedAt?: string;
};

export type DeliveryMode = 'ship' | 'review';
export type ThreadDelivery = {
  mode: DeliveryMode;
  policy: 'direct' | 'pull-request';
  status: 'queued' | 'running' | 'waiting' | 'blocked' | 'ready' | 'delivered';
  baseBranch: string;
  requestedAt: string;
  revision?: string;
  publishedRevision?: string;
  pullRequestUrl?: string;
  detail?: string;
  continuationAttempts?: number;
  waitingOn?: 'checks' | 'review' | 'agent';
};

export type DeliverySummary = {
  available: boolean;
  reason?: string;
  baseBranch?: string;
  added: number;
  removed: number;
  files: number;
  previewAvailable: boolean;
};

/**
 * idle: no turn running. running: a turn is in progress. interrupted: the last
 * turn stopped before finishing (you stopped it, or the machine restarted) and
 * continues only when you resume it. failed: the last turn ended in an error.
 */
export type ThreadStatus = 'idle' | 'running' | 'interrupted' | 'failed';

/** One screenshot in a choice; its image is saved with the thread when the choice arrives. */
export type ChoiceOption = { label: string; source: string; asset?: ThreadAsset; error?: string };

/** Which option of which choice a message picked. */
export type ChoicePick = { choiceId: string; option: number };

/** One entry of a thread's transcript. */
export type TranscriptItem =
  | { kind: 'user'; id: string; turnId: string; text: string; at: string; resume?: boolean; delivery?: DeliveryMode; pick?: ChoicePick }
  | { kind: 'assistant'; id: string; turnId: string; text: string; media?: MediaBinding[] }
  | { kind: 'tool'; id: string; turnId: string; name: string; summary: string; status: 'running' | 'done' | 'error' | 'interrupted'; output?: string; detailRevision?: number; loadedSkills?: LoadedSkill[] }
  /** GLOSSARY: Choice. Screenshots the harness offers; you pick one in your next message. */
  | { kind: 'choice'; id: string; turnId: string; question: string; options: ChoiceOption[] }
  | { kind: 'notice'; id: string; turnId: string; tone: 'info' | 'error'; text: string }
  /** Closes a completed turn; `ms` is how long the harness worked on it. */
  | { kind: 'finished'; id: string; turnId: string; ms: number };

/**
 * Cursor increases per thread within one machine process. Start a fresh
 * observation on reconnect; never persist/reuse it across connections.
 * Transcript files remain arrays of TranscriptItem.
 */
export type TranscriptSnapshot = { items: TranscriptItem[]; cursor: number };

const ThreadId = z.object({ threadId: z.string() });
const StartCommon = { text: z.string().trim().min(1), model: ModelSelection.optional(), machineId: z.string().optional() };
const Start = z.union([
  z.object({ checkoutId: z.string().min(1), ...StartCommon }),
  z.object({ profileId: z.string().min(1), ...StartCommon }),
]);
const SetModel = z.object({ threadId: z.string(), model: ModelSelection });
const Snooze = z.object({ threadId: z.string(), until: z.iso.datetime({ offset: true }) });
const PickInput = z.object({ choiceId: z.string().min(1).max(512), option: z.int().min(0).max(63) });
const Send = z.object({ threadId: z.string(), text: z.string().trim(), pick: PickInput.optional() })
  .refine((send) => send.text.length > 0 || send.pick, { message: 'Write a message or pick an option' });
const Rename = z.object({ threadId: z.string(), title: z.string().trim().min(1).max(120) });
const ToolDetailRequest = z.object({ threadId: z.string(), itemId: z.string().min(1).max(512) });
const AssetRequest = z.object({ threadId: z.string(), assetId: z.string().uuid(), download: z.boolean().optional() });
const FileRequest = z.object({ threadId: z.string(), path: z.string().min(1).max(4096) });
const Deliver = z.object({ threadId: z.string(), mode: z.enum(['ship', 'review']) });

export const threadMethods = {
  'threads.list': method<z.ZodObject<{}>, ThreadView[]>(z.object({})),
  /** Creates a thread in a checkout and sends its first message: a thread exists only once something was said. */
  'threads.start': method<typeof Start, ThreadView>(Start),
  'threads.transcript': method<typeof ThreadId, TranscriptItem[]>(ThreadId),
  /** Items and cursor captured together; subscribe before requesting, then ignore events through this cursor. */
  'threads.observe': method<typeof ThreadId, TranscriptSnapshot>(ThreadId),
  'threads.toolDetails': method<typeof ToolDetailRequest, ToolDetails>(ToolDetailRequest),
  'threads.assetUrl': method<typeof AssetRequest, AssetUrl>(AssetRequest),
  /** A download grant for a current file explicitly linked in the thread. */
  'threads.fileUrl': method<typeof FileRequest, AssetUrl>(FileRequest),
  'threads.send': method<typeof Send, null>(Send),
  'threads.deliverySummary': method<typeof ThreadId, DeliverySummary>(ThreadId),
  /** Durable intent: a running work turn completes before the delivery turn starts. */
  'threads.deliver': method<typeof Deliver, ThreadView>(Deliver),
  'threads.cancelDelivery': method<typeof ThreadId, ThreadView>(ThreadId),
  'threads.checkDelivery': method<typeof ThreadId, ThreadView>(ThreadId),
  /** Recheck delivery, stop owned previews, release only this thread's worktree, retain history. */
  'threads.archive': method<typeof ThreadId, ThreadView>(ThreadId),
  'threads.openPreview': method<typeof ThreadId, { url: string }>(ThreadId),
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
  'thread.item': { threadId: string; cursor: number; item: TranscriptItem };
  /** Streamed text appended to an assistant item. */
  'thread.delta': { threadId: string; cursor: number; itemId: string; text: string };
};
