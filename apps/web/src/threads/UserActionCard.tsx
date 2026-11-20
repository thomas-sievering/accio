import type { UserActionItem } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';
import { Check, MinusCircle, User } from '../app/icons';
import { Button } from '../ui/Button';

/**
 * GLOSSARY: User action. The turn goes on while this card waits; Done tells the agent by
 * steering the turn with a short message, which also ends the card. Ended, it collapses to a
 * one-line record. Styled like the secret and confirmation cards beside it.
 */
export function UserActionCard({ threadId, item }: { threadId: string; item: UserActionItem }) {
  const client = useClient();
  const { busy, error, run } = useAction();
  if (item.status !== 'pending') {
    const done = item.status === 'done';
    return (
      <section className="secret done user-action" data-item-id={item.id} aria-label={item.action}>
        <div className={`secret-done${done ? '' : ' muted'}`} role="status">
          {done ? <Check /> : <MinusCircle />}
          <b>{done ? 'Done' : 'Ended with its turn'}</b>
          <span className="what">{item.action}</span>
        </div>
      </section>
    );
  }
  const markDone = () => void run(() => client.call('threads.send', { threadId, text: `Done: ${item.action}`, images: [] }));
  return (
    <section className="secret user-action" data-item-id={item.id} aria-label={`Needs you: ${item.action}`}>
      <div className="secret-body" aria-busy={busy || undefined}>
        <div className="secret-head">
          <User />
          <b>{item.action}</b>
          <span className="secret-state"><span className="secret-dot" />Needs you</span>
        </div>
        {item.detail && <p className="secret-why">{item.detail}</p>}
        {error && <p className="secret-error" role="alert">{error}</p>}
        <div className="secret-foot">
          <Button className="ghost primary" busy={busy} busyLabel="Sending…" onClick={markDone}>Done</Button>
        </div>
      </div>
    </section>
  );
}
