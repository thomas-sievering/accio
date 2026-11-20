import { z } from 'zod';
import type { PromptMeasurement } from './models.js';
import { method } from './rpc.js';
import { ModelSelection } from './models.js';
import { IMAGE_ATTACHMENT_BYTES, IMAGE_TYPES, IMAGES_PER_MESSAGE, type AssetUrl, type MediaBinding, type RelayMedia, type ThreadAsset, type ToolDetails } from './media.js';
import type { LoadedSkill } from './workspaceSkills.js';
import type { SecretRequestItem } from './secrets.js';
import type { ConfirmationItem } from './confirmations.js';
import type { NeedsYou, UserActionItem } from './userActions.js';
import type { RemoteMachine } from './relay.js';
import type { OfferedIssue } from './issues.js';

/**
 * GLOSSARY: Thread. A durable conversation, optionally attached to a checkout
 * and owned worktree. Its starting hub and profile stay fixed; choosing another harness hands off the next turn.
 */
export type ThreadView = {
  repairToolId?: string;
  /** The hub that owns this thread's profile; immutable across view switches. */
  hubId?: string;
  /** GLOSSARY: Relay. Set only on threads another machine owns; actions go to that machine. */
  machine?: RemoteMachine;
  /** On a relayed thread whose project has no checkout on this machine, that project's name. */
  projectName?: string;
  id: string;
  /** Empty for a thread started with No project. */
  checkoutId: string;
  /** Empty for a thread started with No project. */
  projectId: string;
  profileId: string;
  /**
   * GLOSSARY: Borrowing. Another profile whose accounts this thread's turns spend, chosen in the model picker;
   * absent while it uses its own profile's. Skills, MCPs and GitHub stay the thread's profile's.
   */
  borrowFrom?: string;
  model: ModelSelection;
  title: string;
  status: ThreadStatus;
  /** Live metadata only: what a running turn waits on you for; the turn stays running meanwhile. */
  needsYou?: NeedsYou;
  createdAt: string;
  updatedAt: string;
  /** When the running turn started. */
  runningSince?: string;
  /** Time this run already spent running before accio restarted, so its running time excludes the downtime. */
  ranMs?: number;
  /** GLOSSARY: Snooze. Hidden until this time; null when not snoozed. */
  snoozedUntil: string | null;
  /** GLOSSARY: Settle. When it was marked done; null while open. */
  settledAt: string | null;
  /** Absent on older threads that still use their original, shared checkout. */
  workspace?: ThreadWorkspace;
  delivery?: ThreadDelivery;
  /** Increases for new user work, never for an automatic delivery continuation. */
  workVersion?: number;
  queuedMessages?: QueuedMessage[];
  /** GLOSSARY: Goal. Absent until `/goal` sets one; cleared with `/goal clear`. */
  goal?: ThreadGoal;
  /** GLOSSARY: Issue. The issue it works on, by its `ref` as `threads.issues` lists it: picked, or named first in its first message's first line. */
  issue?: string;
  /** GLOSSARY: Wait. Absent unless the harness set one with wait_for; cleared once it is met or cancelled. */
  wait?: ThreadWait;
  /** GLOSSARY: Started thread. The thread that started this one through start_thread, and its machine. */
  startedBy?: { threadId: string; machineId: string };
};

/** GLOSSARY: Borrowing. The profile whose accounts and models a thread's turns use. */
export const accountsProfile = (thread: { profileId: string; borrowFrom?: string }) => thread.borrowFrom ?? thread.profileId;

/** GLOSSARY: Wait. What a started thread must reach: no turn left to run, a pull request open, or delivered. */
export type WaitThreadState = 'stopped' | 'pr_open' | 'delivered';
/** GLOSSARY: Wait. What a pull request must reach: merged (or closed without merging), or its checks finished. */
export type WaitPullRequestState = 'merged' | 'checks_done';

/** GLOSSARY: Wait. One thing a Wait waits for; `metAt` and `detail` say when and how it was met. */
export type WaitCondition = (
  | { kind: 'thread'; threadId: string; title: string; until: WaitThreadState }
  /** A pull request URL, or a number in the thread's repository. */
  | { kind: 'pullRequest'; ref: string; until: WaitPullRequestState }
  | { kind: 'after'; at: string }
  /** A shell command accio runs in the thread's working folder; it is stopped at `timeoutAt`. */
  | { kind: 'command'; command: string; timeoutAt: string }
) & { metAt?: string; detail?: string };

/**
 * GLOSSARY: Wait. What a thread waits for between turns, set by its harness through the
 * wait_for accio tool. accio starts the next turn once any (or all) of its conditions are met.
 */
export type ThreadWait = {
  id: string;
  setAt: string;
  wakeWhen: 'any' | 'all';
  /** What the harness told itself to do when it wakes. */
  note: string;
  conditions: WaitCondition[];
};

/**
 * GLOSSARY: Goal. What the thread keeps working toward across turns. accio starts
 * the next turn itself until the harness reports it achieved or blocked, a turn
 * stops, fails or uses no tools. There is no turn limit.
 */
export type ThreadGoal = {
  objective: string;
  status: 'active' | 'paused' | 'achieved';
  /** Turns worked on it since it was set; for information only. */
  turns: number;
  setAt: string;
  /** Why it paused, or what the harness reported when it finished. */
  detail?: string;
};

/** `wake`: GLOSSARY: Wait. accio queued it because the thread's Wait was met. */
export type QueuedMessage = { id: string; text: string; pick?: ChoicePick; images?: ThreadAsset[]; editing?: boolean; wake?: boolean };

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
/** GLOSSARY: Delivery step. The parts of a delivery turn, in order; the agent reports each through the delivery_step accio tool. */
export const DELIVERY_STEPS = ['commit', 'integrate', 'verify', 'publish'] as const;
export type DeliveryStepName = typeof DELIVERY_STEPS[number];
export type DeliveryStep = { name: DeliveryStepName; at: string; note?: string };
export type DeliveryPullRequest = {
  host: 'github.com';
  repository: string;
  number: number;
  url: string;
  state: 'open' | 'closed' | 'merged';
  headRevision: string;
  baseBranch: string;
  mergeRevision?: string;
  mergedAt?: string;
};
export type ThreadDelivery = {
  /** Stable identity for this publication grant and its completion receipt. */
  id?: string;
  workVersion?: number;
  mode: DeliveryMode;
  policy: 'direct' | 'pull-request';
  status: 'queued' | 'running' | 'waiting' | 'blocked' | 'ready' | 'delivered';
  baseBranch: string;
  requestedAt: string;
  revision?: string;
  publishedRevision?: string;
  pullRequest?: DeliveryPullRequest;
  detail?: string;
  continuationAttempts?: number;
  waitingOn?: 'checks' | 'review' | 'agent' | 'merge';
  checkedAt?: string;
  observationError?: string;
  observationFailures?: number;
  /** A delivery turn ended on an API or harness error (a rate limit, say); a new one starts after a backoff. */
  turnError?: string;
  turnFailures?: number;
  /** Publication is recorded even while checks on the target are pending. */
  integratedAt?: string;
  completedAt?: string;
  autoSettle?: boolean;
  /** Manual Reopen or stopping follow-ups wins over automatic settlement. */
  keepOpen?: boolean;
  followUpsStoppedAt?: string;
  ci?: DeliveryCI;
  /** Why a delivered revision has no checks: the repository has no active workflows, or none of their filters cover the change. */
  noChecks?: 'no-workflows' | 'filtered';
  /** When the current delivery turn started; reset by each delivery turn. */
  startedAt?: string;
  /** What the current delivery turn last reported doing; cleared when one starts. */
  step?: DeliveryStep;
  /** GLOSSARY: Shipped note. What the delivery turn says changed and what to try, through the shipped_note accio tool. */
  note?: ShippedNote;
};

/** GLOSSARY: Shipped note. Written for the person who will try the change, not for reviewers. */
export type ShippedNote = {
  /** One line on what changed for the user, e.g. "Running threads sit on Working below the inbox". */
  summary: string;
  /** Short things to try, each one sentence. */
  test: string[];
};

/** GLOSSARY: Changelog. One delivered change, kept after its thread moves on or is deleted. */
export type ChangelogEntry = {
  /** The delivery's id, so each delivery is logged once. */
  id: string;
  threadId: string;
  /** Empty for a No project thread. */
  projectId: string;
  profileId: string;
  /** The thread's title when it was delivered. */
  title: string;
  /** Absent when the delivery turn wrote no note, as for changes delivered before notes existed. */
  note?: ShippedNote;
  target: string;
  pullRequest?: { number: number; url: string };
  revision?: string;
  deliveredAt: string;
};

export type DeliveryCI = {
  revision: string;
  updatedAt: string;
  checks: {
    name: string;
    status: string;
    url?: string;
    step?: { name: string; current: number; total: number };
  }[];
};

export type DeliverySummary = {
  available: boolean;
  reason?: string;
  baseBranch?: string;
  /** Git's line totals; `modified` of each are paired edits, counted in both. */
  added: number;
  removed: number;
  modified: number;
  files: number;
  previewAvailable: boolean;
  /** The thread committed work and it is already on the target (pushed outside Ship), with nothing uncommitted: nothing left to ship. */
  onBase?: boolean;
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

/** A, B, C…: how the harness and the user name a choice's options. */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** One entry of a thread's transcript. */
/** GLOSSARY: Sub-agent. The latest tool call of the sub-agent a running tool started. */
export type ToolStep = { name: string; summary: string };

/** Anthropic input accounting: fresh input excludes cache reads and writes. */
export type PromptCacheUsage = {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWrite1hTokens?: number;
};

export type TranscriptItem =
  | SecretRequestItem
  | ConfirmationItem
  | UserActionItem
  | { kind: 'usage'; id: string; turnId: string; provider: 'anthropic'; usage: PromptCacheUsage }
  /** GLOSSARY: Context window. How full it was at the turn's latest request, as the harness reported; one per turn. */
  | { kind: 'context'; id: string; turnId: string; usedTokens: number; windowTokens: number; compactAtTokens?: number }
  | { kind: 'promptSize'; id: string; turnId: string; harnessId: string; measurement: PromptMeasurement }
  | { kind: 'user'; id: string; turnId: string; text: string; at: string; images?: ThreadAsset[]; resume?: boolean; delivery?: DeliveryMode; pick?: ChoicePick; steered?: boolean; goal?: 'continue'; wake?: boolean }
  | { kind: 'assistant'; id: string; turnId: string; text: string; media?: MediaBinding[] }
  | { kind: 'tool'; id: string; turnId: string; name: string; summary: string; status: 'running' | 'done' | 'error' | 'interrupted'; output?: string; detailRevision?: number; loadedSkills?: LoadedSkill[]; step?: ToolStep }
  /** GLOSSARY: Choice. Screenshots the harness offers; you pick one in your next message. */
  | { kind: 'choice'; id: string; turnId: string; question: string; options: ChoiceOption[] }
  /** GLOSSARY: Issue offer. Issues the harness published, each startable as a thread of its own. */
  | { kind: 'issueOffer'; id: string; turnId: string; issues: OfferedIssue[] }
  | { kind: 'notice'; id: string; turnId: string; tone: 'info' | 'error'; text: string }
  /** GLOSSARY: Shipped note. Added once a delivery is verified on its target; it stands as its own turn. */
  | { kind: 'shipped'; id: string; turnId: string; at: string; entry: ChangelogEntry }
  /** Closes a completed turn; `ms` is how long the harness worked on it. */
  | { kind: 'finished'; id: string; turnId: string; ms: number };

/**
 * Cursor increases per thread within one machine process. Start a fresh
 * observation on reconnect; never persist/reuse it across connections.
 * Transcript files remain arrays of TranscriptItem.
 */
export type TranscriptSnapshot = { items: TranscriptItem[]; cursor: number };

const ThreadId = z.object({ threadId: z.string() });
/** GLOSSARY: Image attachment. Uploads from `threads.upload` on this machine, sent with a message. */
const Images = z.array(z.string().uuid()).max(IMAGES_PER_MESSAGE).optional();
/** A picked issue, claimed for the thread once it starts: its reference as `threads.issues` lists it, and its title for the thread's. */
const StartIssue = z.object({ ref: z.string().min(1).max(4096), title: z.string().trim().max(500) });
/** GLOSSARY: Started thread. Set by start_thread, so the starting thread can wait for it. */
const StartedBy = z.object({ threadId: z.string().min(1).max(200), machineId: z.string().min(1).max(200) });
const BorrowFrom = z.string().min(1).max(200);
const StartCommon = { text: z.string().trim(), images: Images, model: ModelSelection.optional(), borrowFrom: BorrowFrom.optional(), machineId: z.string().optional(), issue: StartIssue.optional(), startedBy: StartedBy.optional() };
const said = (start: { text: string; images?: string[] }) => start.text.length > 0 || !!start.images?.length;
const Start = z.union([
  z.object({ checkoutId: z.string().min(1), ...StartCommon }).refine(said, { message: 'Write a message' }),
  z.object({ profileId: z.string().min(1), ...StartCommon }).refine(said, { message: 'Write a message' }),
  /** GLOSSARY: Project. A hub project this machine has no checkout of: it clones one first, under the hub's profile for it. */
  z.object({ repoKey: z.string().min(1).max(300), ...StartCommon }).refine(said, { message: 'Write a message' }),
]);
/** Base64 bytes of one pasted image, which the client has already shrunk to the attachment limit. */
const Upload = z.object({ name: z.string().max(180), mimeType: z.enum(IMAGE_TYPES), data: z.string().min(1).max(Math.ceil(IMAGE_ATTACHMENT_BYTES / 3) * 4 + 4) });
/** GLOSSARY: Borrowing. `borrowFrom` names the profile whose model it is: null for the thread's own, left out to keep the current one. */
const SetModel = z.object({ threadId: z.string(), model: ModelSelection, borrowFrom: BorrowFrom.nullable().optional() });
/** GLOSSARY: Goal. The status bar's controls; setting one goes through `/goal` in a message. */
const GoalAction = z.object({ threadId: z.string(), action: z.enum(['pause', 'resume', 'clear']) });
const Snooze = z.object({ threadId: z.string(), until: z.iso.datetime({ offset: true }) });
const PickInput = z.object({ choiceId: z.string().min(1).max(512), option: z.int().min(0).max(63) });
const Send = z.object({ threadId: z.string(), text: z.string().trim(), pick: PickInput.optional(), images: Images, mode: z.enum(['steer', 'queue']).optional() })
  .refine((send) => send.text.length > 0 || send.pick || send.images?.length, { message: 'Write a message or pick an option' });
const Rename = z.object({ threadId: z.string(), title: z.string().trim().min(1).max(120) });
const PreviewTitle = z.object({ threadId: z.string(), instructions: z.string().trim().max(2000), model: ModelSelection.nullable() });
const ToolDetailRequest = z.object({ threadId: z.string(), itemId: z.string().min(1).max(512) });
const AssetRequest = z.object({ threadId: z.string(), assetId: z.string().uuid(), download: z.boolean().optional() });
const FileRequest = z.object({ threadId: z.string(), path: z.string().min(1).max(4096) });
const MediaRequest = z.union([AssetRequest.pick({ threadId: true, assetId: true }), FileRequest]);
const Deliver = z.object({ threadId: z.string(), mode: z.enum(['ship', 'review']) });
const Queued = z.object({ threadId: z.string(), messageId: z.string(), action: z.enum(['steer', 'remove', 'edit', 'save', 'cancel']), text: z.string().trim().min(1).optional() });

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
  /** The bytes behind `threads.assetUrl` or `threads.fileUrl`, base64, for another machine showing this thread. */
  'threads.media': method<typeof MediaRequest, RelayMedia>(MediaRequest),
  /** GLOSSARY: Image attachment. Keeps a pasted image on this machine until a message sends it. */
  'threads.upload': method<typeof Upload, { uploadId: string }>(Upload),
  'threads.send': method<typeof Send, null>(Send),
  'threads.queued': method<typeof Queued, null>(Queued),
  'threads.deliverySummary': method<typeof ThreadId, DeliverySummary>(ThreadId),
  /** Durable intent: a running work turn completes before the delivery turn starts. */
  'threads.deliver': method<typeof Deliver, ThreadView>(Deliver),
  'threads.cancelDelivery': method<typeof ThreadId, ThreadView>(ThreadId),
  'threads.checkDelivery': method<typeof ThreadId, ThreadView>(ThreadId),
  /** Recheck delivery, stop owned previews, release only this thread's worktree, retain history. */
  'threads.archive': method<typeof ThreadId, ThreadView>(ThreadId),
  'threads.openPreview': method<typeof ThreadId, { url: string }>(ThreadId),
  'threads.goal': method<typeof GoalAction, ThreadView>(GoalAction),
  /** GLOSSARY: Wait. Cancels the thread's Wait, stopping any command it runs; no turn starts. */
  'threads.cancelWait': method<typeof ThreadId, ThreadView>(ThreadId),
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
  'threads.regenerateTitle': method<typeof ThreadId, ThreadView>(ThreadId),
  'threads.previewTitle': method<typeof PreviewTitle, { title: string }>(PreviewTitle),
  'threads.delete': method<typeof ThreadId, null>(ThreadId),
  /** Records that you saw a delivered thread's shipped note; the thread then settles as usual. */
  /** GLOSSARY: Changelog. Every delivered change on this machine, newest first. */
  'changelog.list': method<z.ZodObject<{}>, ChangelogEntry[]>(z.object({})),
};

export type ThreadEvents = {
  'threads.changed': ThreadView[];
  'changelog.changed': ChangelogEntry[];
  /** A transcript item was added or replaced. */
  'thread.item': { threadId: string; cursor: number; item: TranscriptItem };
  /** Streamed text appended to an assistant item. */
  'thread.delta': { threadId: string; cursor: number; itemId: string; text: string };
  /** Observe the thread again: its relayed stream may have missed changes, such as after its machine reconnected. */
  'thread.resync': { threadId: string };
};
