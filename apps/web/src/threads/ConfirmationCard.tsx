import type { ConfirmationItem } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';
import { Check, MinusCircle, Wrench } from '../app/icons';

const ENDED: Record<Exclude<ConfirmationItem['status'], 'pending'>, string> = { allowed: 'Allowed', declined: 'Declined', expired: 'Not answered in time', cancelled: 'Ended with its turn' };

/**
 * GLOSSARY: Confirmation. An accio tool waits on this card until you allow or decline its
 * action. Answered, it collapses to a one-line record. Styled like the secret card it sits beside.
 */
export function ConfirmationCard({ threadId, item }: { threadId: string; item: ConfirmationItem }) {
  const client = useClient();
  const { busy, error, run } = useAction();
  const answer = (allow: boolean) => void run(() => client.call('confirmations.answer', { threadId, requestId: item.requestId, allow }));
  if (item.status !== 'pending') {
    const allowed = item.status === 'allowed';
    return (
      <section className="secret done confirmation" data-item-id={item.id} aria-label={item.title}>
        <div className={`secret-done${allowed ? '' : ' muted'}`} role="status">
          {allowed ? <Check /> : <MinusCircle />}
          <b>{ENDED[item.status]}</b>
          <span className="what">{item.title}</span>
        </div>
      </section>
    );
  }
  return (
    <section className="secret confirmation" data-item-id={item.id} aria-label={`Needs your answer: ${item.title}`}>
      <div className="secret-body" aria-busy={busy || undefined}>
        <div className="secret-head">
          <Wrench />
          <b>{item.title}</b>
          <span className="secret-state"><span className="secret-dot" />Needs your answer</span>
        </div>
        <p className="secret-why">{item.detail}</p>
        {error && <p className="secret-error" role="alert">{error}</p>}
        <div className="secret-foot">
          <button type="button" className="ghost" disabled={busy} onClick={() => answer(false)}>Decline</button>
          <button type="button" className="ghost primary" disabled={busy} onClick={() => answer(true)}>{item.allowLabel}</button>
        </div>
      </div>
    </section>
  );
}
