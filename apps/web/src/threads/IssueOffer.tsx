import { useCallback, useEffect, useState } from 'react';
import type { IssueOfferStatus, TranscriptItem } from '@accio/protocol';
import { useClient } from '../app/connection';
import { emitAppEvent } from '../app/appEvents';
import { Issue } from '../app/icons';
import { offerRow } from './offerRows';

type OfferItem = Extract<TranscriptItem, { kind: 'issueOffer' }>;

/**
 * GLOSSARY: Issue offer. The issues a harness published, each with Implement while it
 * is ready: that starts a thread on it, claimed as from the issue picker, and the row
 * then opens that thread. Status is read from the tracker as the offer shows.
 */
export function IssueOffer({ threadId, item }: { threadId: string; item: OfferItem }) {
  const client = useClient();
  const [status, setStatus] = useState<IssueOfferStatus>();
  const [starting, setStarting] = useState<string>();
  const [error, setError] = useState<string>();
  const read = useCallback(() => {
    client.call('threads.offeredIssues', { threadId, offerId: item.id }).then(setStatus, (err: Error) => setError(err.message));
  }, [client, threadId, item.id]);
  // Read again whenever the offer changes, such as once a started thread is recorded.
  useEffect(read, [read, item]);

  const implement = async (ref: string) => {
    setStarting(ref);
    setError(undefined);
    try {
      await client.call('threads.implementIssue', { threadId, offerId: item.id, ref });
    } catch (err) {
      setError((err as Error).message);
      read();
    } finally {
      setStarting(undefined);
    }
  };

  return <section className="issue-offer" data-item-id={item.id} aria-label="Issues to implement">
    <p className="issue-offer-title"><span className="issue-offer-mark"><Issue /></span>Issues to implement</p>
    <ul className="issue-offer-list">
      {item.issues.map((offered) => {
        const now = status?.issues.find((entry) => entry.ref === offered.ref);
        const row = offerRow(offered, now?.issue, !!now && !status?.unavailable);
        return <li key={offered.ref} className={`issue-offer-row ${row.state}`}>
          {offered.url
            ? <a className="issue-option-label" href={offered.url} target="_blank" rel="noreferrer">{offered.label}</a>
            : <span className="issue-option-label">{offered.label}</span>}
          <span className="issue-option-title" title={offered.title}>{offered.title}</span>
          {row.pill && <span className={`issue-pill${row.state === 'blocked' ? ' blocked' : row.state === 'ready' ? ' ready' : ''}`}>{row.pill}</span>}
          {row.state === 'started' && offered.threadId
            ? <button type="button" className="issue-offer-action" onClick={() => emitAppEvent('thread.open', { id: offered.threadId! })}>Open thread</button>
            : row.state === 'ready' && <button type="button" className="issue-offer-action primary" disabled={!!starting}
              aria-label={`Implement ${offered.label} in a new thread`} onClick={() => void implement(offered.ref)}>{starting === offered.ref ? 'Starting…' : 'Implement'}</button>}
        </li>;
      })}
    </ul>
    {status?.unavailable && <p className="issue-offer-note">{status.unavailable}</p>}
    {error && <p className="issue-offer-note error" role="alert">{error}</p>}
  </section>;
}
