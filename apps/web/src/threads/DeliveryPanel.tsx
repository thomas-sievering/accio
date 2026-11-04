import type { ThreadView } from '@accio/protocol';
import { Check } from '../app/icons';
import { DeliveryProgress } from './DeliveryProgress';
import { deliveryTrack } from './deliveryTrack';
import { checkedAgo, deliveryStatus } from './status';
import { useThreads } from './threads';
import './delivery-panel.css';

/**
 * The side panel's Delivery tab: the open thread's delivery as a track, top to
 * bottom, with live CI under the station waiting on it. Actions stay in the
 * composer row; this is where you follow what happens after Ship.
 */
export function DeliveryPanel({ thread }: { thread: ThreadView }) {
  const { now } = useThreads();
  const track = deliveryTrack(thread, now);
  const status = deliveryStatus(thread);
  if (!track || !status) return <p className="side-panel-empty">Ship this thread to follow its delivery here.</p>;
  return <div className="delivery-panel">
    <header className="delivery-panel-head">
      <b>{track.route}</b>
      <span>{status.phase === 'superseded' ? 'New work since · Ship again' : checkedAgo(status.checkedAt, now)}</span>
    </header>
    <ol className="delivery-track" aria-label="Delivery progress">
      {track.stations.map((s) => (
        <li key={s.id} className={`station station-${s.state}`} aria-current={s.state === 'active' || s.state === 'waiting' ? 'step' : undefined}>
          <span className="station-node" aria-hidden="true">{s.state === 'done' ? <Check /> : s.state === 'failed' ? '!' : null}</span>
          <div className="station-text">
            <b>{s.label}</b>
            {s.detail && (s.link
              ? <a href={s.link} target="_blank" rel="noreferrer">{s.detail} ↗</a>
              : <span>{s.detail}</span>)}
            {s.note && <span className="station-note">{s.note}</span>}
          </div>
          {s.ci && <DeliveryProgress ci={s.ci} />}
        </li>
      ))}
    </ol>
  </div>;
}

/** Whether the Delivery tab should carry a dot: the delivery needs a person. */
export function deliveryNeedsYou(thread?: ThreadView): boolean {
  const phase = thread && deliveryStatus(thread)?.phase;
  return phase === 'attention' || phase === 'closed';
}
