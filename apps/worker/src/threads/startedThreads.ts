import { z } from 'zod';
import { findMentionedThread, shipBlockedReason, shipOffered, threadHandle, type DeliveryMode, type DeliverySummary, type ThreadView } from '@accio/protocol';
import { UserError } from '../rpc/router.js';
import { accioTool } from '../tools/tools.js';

const DELIVER_THREAD_TOOL = 'deliver_thread';
const SETTLE_THREAD_TOOL = 'settle_thread';

export type StartedThreadsDeps = {
  /** This machine's id: a started thread records it with its starter's. */
  here: string;
  /** Every thread this machine knows, other machines' included. */
  threads: () => readonly ThreadView[];
  /** The composer's and sidebar's calls, through the relay when another machine has the thread. */
  summary: (threadId: string) => Promise<DeliverySummary>;
  deliver: (threadId: string, mode: DeliveryMode) => Promise<ThreadView>;
  settle: (threadId: string) => Promise<ThreadView>;
};

const threadInput = z.string().trim().min(1).max(200).describe("The thread, by the id start_thread returned or its handle, such as '@fix-login-redirect-3f2a9c'.");

/**
 * GLOSSARY: Started thread. The thread `handle` names, when the caller started it with
 * start_thread; any other thread is refused, as are threads on a machine that is offline.
 */
function startedThread(deps: StartedThreadsDeps, callerId: string, handle: string): ThreadView {
  const all = deps.threads();
  const caller = all.find((t) => t.id === callerId && !t.machine);
  if (!caller) throw new Error('This thread is not on this machine.');
  const readable = all.filter((t) => t.profileId === caller.profileId || (t.startedBy?.threadId === callerId));
  const found = findMentionedThread(readable, handle);
  if (!found) throw new UserError(`No thread ${handle}. Use the id start_thread returned, or the thread's handle.`);
  if (found.startedBy?.threadId !== callerId || found.startedBy.machineId !== deps.here)
    throw new UserError(`"${found.title || 'Untitled'}" (@${threadHandle(found)}) was not started by this thread. You can deliver or settle only threads you started with start_thread; the user can act on it in Accio.`);
  if (found.machine && !found.machine.online) throw new UserError(`${found.machine.name} is offline, so "${found.title || 'Untitled'}" can't be changed until it is back.`);
  return found;
}

const name = (t: ThreadView) => `"${t.title || 'Untitled'}" (@${threadHandle(t)})`;

/** Why a fresh delivery can't be requested now, in the composer's words; undefined when it can. */
function deliverRefusal(t: ThreadView, summary: DeliverySummary): string | undefined {
  const blocked = shipBlockedReason(t, summary);
  if (blocked) return blocked;
  const d = t.delivery;
  if (!shipOffered(t)) {
    if (d?.status === 'delivered') return `It is already delivered to ${d.baseBranch}${d.pullRequest ? ` (PR ${d.pullRequest.url})` : ''}. There is nothing new to ship.`;
    if (d?.status === 'queued' || d?.status === 'running') return 'Delivery is already requested.';
    return `Its delivery is still under way${d?.pullRequest ? ` with PR ${d.pullRequest.url}` : ''}. Wait for it with wait_for (thread_state "delivered").`;
  }
  if (summary.onBase) return `Its commits are already on ${summary.baseBranch ?? 'the target branch'} and nothing is uncommitted. There is nothing to ship.`;
  return undefined;
}

/** What a delivery request did, from the thread it returned. */
function delivered(t: ThreadView, mode: DeliveryMode): string {
  const d = t.delivery;
  const what = mode === 'review' ? 'Prepare for review' : 'Ship';
  const pr = d?.pullRequest ? ` Its PR: ${d.pullRequest.url} (${d.pullRequest.state}).` : '';
  const state = d?.status === 'queued' && t.status === 'running' ? `${what} is queued: it starts when the thread's running turn finishes.`
    : d?.status === 'queued' || d?.status === 'running' ? `${what} started.`
    : `${what} was requested; its delivery is ${d?.status ?? 'not recorded'}.`;
  return `${state}${pr} It targets ${d?.baseBranch ?? 'the default branch'} under the project's ${d?.policy === 'pull-request' ? 'pull-request' : 'direct'} policy. `
    + `Accio verifies the delivery and settles ${name(t)} once it is ${mode === 'review' ? 'merged' : 'delivered'}. To be woken when it is delivered or needs attention, call wait_for with thread_state "delivered" and end your turn.`;
}

/**
 * GLOSSARY: Ship, Prepare for review, Settle. A coordinating thread delivers and settles the threads
 * it started, through the same calls as the composer's Ship button and the sidebar's Settle, so
 * delivery policy, Git proof and availability stay with their owners.
 */
export function startedThreadTools(deps: StartedThreadsDeps) {
  // Listed only to a thread that has started threads, such as on the turn after start_thread.
  const available = (threadId: string) => deps.threads().some((t) => t.startedBy?.threadId === threadId && t.startedBy.machineId === deps.here);
  return [
    accioTool({
      name: DELIVER_THREAD_TOOL,
      description: "Deliver a thread you started with start_thread, like pressing Ship in its composer: mode \"ship\" finishes, verifies and publishes its work under the project's direct or pull-request policy; \"review\" (Prepare for review) opens a verified PR without merging it. "
        + 'A request made while the thread works waits for its turn to finish. Accio checks the Git proof and settles the thread once its delivery is verified. '
        + 'Use it instead of asking a thread to run `gh pr create`, which bypasses this. Returns what happened and the PR once there is one, or why Ship is unavailable.',
      available,
      input: {
        thread: threadInput,
        mode: z.enum(['ship', 'review']).describe('"ship" (publish under the project\'s policy) or "review" (Prepare for review: a PR, no merge).'),
      },
      call: async ({ thread: handle, mode }, { threadId }) => {
        const target = startedThread(deps, threadId, handle);
        const refusal = deliverRefusal(target, await deps.summary(target.id));
        if (refusal) throw new UserError(`Can't deliver ${name(target)}: ${refusal}`);
        return delivered(await deps.deliver(target.id, mode), mode);
      },
    }),
    accioTool({
      name: SETTLE_THREAD_TOOL,
      description: 'Settle a thread you started with start_thread, as the sidebar does: it is marked done and leaves the inbox, stays readable, and reopens when someone writes to it. Its Wait stops. '
        + 'Its worktree is released only when it holds no work; one with commits, changes, a delivery or a running preview stays allocated. '
        + 'A thread you delivered with deliver_thread settles by itself once its delivery is verified.',
      available,
      input: { thread: threadInput },
      call: async ({ thread: handle }, { threadId }) => {
        const target = startedThread(deps, threadId, handle);
        if (target.settledAt) throw new UserError(`${name(target)} is already settled.`);
        const settled = await deps.settle(target.id);
        const worktree = settled.workspace && !settled.workspace.releasedAt
          ? ' Its worktree is released if it holds no work; otherwise it stays allocated.' : '';
        return `Settled ${name(settled)}.${worktree}${settled.status === 'running' ? ' Its running turn continues; settling does not stop it.' : ''}`;
      },
    }),
  ];
}
