import { randomUUID } from 'node:crypto';
import type { ConfirmationItem, ParamsOf } from '@accio/protocol';
import { UserError, type Router } from '../rpc/router.js';

type Outcome = Exclude<ConfirmationItem['status'], 'pending'>;
type Pending = { item: ConfirmationItem; threadId: string; resolve: (outcome: Outcome) => void; timer: NodeJS.Timeout };
export type ConfirmationRequest = { title: string; detail: string; allowLabel: string };

/**
 * GLOSSARY: Confirmation. Cards an accio tool waits on until you allow or decline its action.
 * A card ends when its turn ends or is stopped, or after `ms`, and then counts as not allowed.
 */
export class Confirmations {
  private pending = new Map<string, Pending>();
  constructor(private publish: (threadId: string, item: ConfirmationItem) => Promise<void>, private ms = 10 * 60_000) {}

  hasPending(threadId: string) { return [...this.pending.values()].some(p => p.threadId === threadId); }

  async ask(threadId: string, turnId: string, request: ConfirmationRequest, signal: AbortSignal): Promise<Outcome> {
    if (signal.aborted) return 'cancelled';
    if (this.hasPending(threadId)) throw new UserError('This thread is already waiting for a confirmation.');
    const requestId = randomUUID();
    const item: ConfirmationItem = { kind: 'confirmation', id: `${turnId}:confirm:${requestId}`, turnId, requestId, ...request, status: 'pending', expiresAt: new Date(Date.now() + this.ms).toISOString() };
    let resolve!: (outcome: Outcome) => void;
    const result = new Promise<Outcome>(done => { resolve = done; });
    const timer = setTimeout(() => { void this.finish(requestId, 'expired').catch(() => {}); }, this.ms);
    timer.unref();
    this.pending.set(requestId, { item, threadId, resolve, timer });
    const abort = () => { void this.finish(requestId, 'cancelled').catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await this.publish(threadId, item);
      return await result;
    } finally {
      signal.removeEventListener('abort', abort); clearTimeout(timer); this.pending.delete(requestId);
    }
  }

  async answer({ threadId, requestId, allow }: ParamsOf<'confirmations.answer'>) {
    const pending = this.pending.get(requestId);
    if (!pending || pending.threadId !== threadId) throw new UserError('This confirmation has ended.');
    await this.finish(requestId, allow ? 'allowed' : 'declined');
  }

  async endTurn(turnId: string) {
    for (const [id, p] of this.pending) if (p.item.turnId === turnId) await this.finish(id, 'cancelled');
  }

  register(router: Router) {
    router.on('confirmations.answer', async input => { await this.answer(input); return null; });
  }

  private async finish(id: string, status: Outcome) {
    const pending = this.pending.get(id); if (!pending) return;
    this.pending.delete(id); clearTimeout(pending.timer);
    try { await this.publish(pending.threadId, { ...pending.item, status }); }
    finally { pending.resolve(status); }
  }
}
