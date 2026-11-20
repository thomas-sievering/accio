import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { UserActionItem } from '@accio/protocol';
import { UserError } from '../rpc/router.js';
import { accioTool } from '../tools/tools.js';

const NEEDS_YOU_TOOL = 'needs_you';

/**
 * GLOSSARY: User action. At most one pending per thread; asking again replaces its wording.
 * Nothing waits on it: the turn goes on, and the card only moves the thread to the inbox.
 */
export class UserActions {
  private pending = new Map<string, UserActionItem>();
  constructor(private publish: (threadId: string, item: UserActionItem) => Promise<void>) {}

  hasPending(threadId: string) { return this.pending.has(threadId); }

  async ask(threadId: string, turnId: string, action: string, detail?: string) {
    const current = this.pending.get(threadId);
    const item: UserActionItem = current?.turnId === turnId
      ? { ...current, action, ...(detail ? { detail } : { detail: undefined }) }
      : { kind: 'userAction', id: `${turnId}:action:${randomUUID()}`, turnId, requestId: randomUUID(), action, ...(detail ? { detail } : {}), status: 'pending' };
    if (current && current.turnId !== turnId) await this.finish(threadId, 'ended');
    this.pending.set(threadId, item);
    await this.publish(threadId, item);
  }

  /** The agent or you marked it done, or you wrote to the thread. */
  async done(threadId: string) { await this.finish(threadId, 'done'); }

  async endTurn(turnId: string) {
    for (const [threadId, item] of this.pending) if (item.turnId === turnId) await this.finish(threadId, 'ended');
  }

  private async finish(threadId: string, status: Exclude<UserActionItem['status'], 'pending'>) {
    const item = this.pending.get(threadId); if (!item) return;
    this.pending.delete(threadId);
    await this.publish(threadId, { ...item, status });
  }
}

const input = {
  action: z.string().trim().min(1).max(120).optional().describe('What the user must do, in a few words they can act on, such as "Approve the sign-in in Microsoft Authenticator (number 14)". Required unless done is true.'),
  detail: z.string().trim().min(1).max(1000).optional().describe('Anything else they need to do it, such as where to find the prompt.'),
  done: z.boolean().optional().describe('True once the step is done, such as when the sign-in went through, to take the thread off the inbox.'),
};

/** The accio tool, bound to this machine's running turns. */
export function needsYouTool(deps: { actions: UserActions; runningTurn: (threadId: string) => string | undefined }) {
  return accioTool({
    name: NEEDS_YOU_TOOL,
    description: 'Tell the user there is a step only they can do outside Accio, such as approving a sign-in or MFA prompt on their phone, signing in in a browser window, or plugging in a device. '
      + 'The thread moves to their inbox as needing them, with a card showing the action, so they notice it even while this turn keeps working. It returns at once: go on, such as polling for the result. '
      + 'Call it before you start waiting, instead of only saying it in chat, which nobody may be watching. Call it again with done: true as soon as you see the step is done; '
      + 'it also ends when the user replies or this turn ends. Never use it for secrets (use request_secret) or for questions you can ask in your reply.',
    input,
    call: async ({ action, detail, done }, { threadId }) => {
      if (done) { await deps.actions.done(threadId); return 'Marked done; the thread is back on Working.'; }
      if (!action) throw new UserError('Say what the user must do in action, or pass done: true.');
      const turnId = deps.runningTurn(threadId);
      if (!turnId) throw new UserError('This thread has no running turn.');
      await deps.actions.ask(threadId, turnId, action, detail);
      return 'The user sees it in their inbox. Carry on; call needs_you with done: true once the step is done.';
    },
  });
}
