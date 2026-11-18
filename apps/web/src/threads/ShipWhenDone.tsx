import { createContext, useContext } from 'react';
import type { DeliveryMode } from '@accio/protocol';
import { Close, Ship } from '../app/icons';
import './ship-when-done.css';

/**
 * GLOSSARY: Ship when done. What the thread's Ship offers the composer: the mode chosen beside it,
 * why it can't ship now (Ship's own reason), and the request it makes once the message is sent.
 */
export type ShipOffer = { mode: DeliveryMode; reason?: string; deliver: () => void };

/** The composer's side: whether it holds a message, the armed chip, and where Ship offers itself. */
type ShipSlot = { composing: boolean; armed: boolean; toggle: () => void; offer: (offer: ShipOffer | undefined) => void };

export const ShipWhenDoneSlot = createContext<ShipSlot | undefined>(undefined);
export const useShipWhenDone = () => useContext(ShipWhenDoneSlot);

export const shipWhenDoneLabel = (mode: DeliveryMode) => mode === 'review' ? 'Review when done' : 'Ship when done';

/** The armed chip; clicking it removes it, also while Ship can't run, so it never gets stuck. */
export function ShipChip({ offer, onRemove }: { offer: ShipOffer; onRemove: () => void }) {
  const label = shipWhenDoneLabel(offer.mode);
  return <span className={`composer-chip composer-ship${offer.reason ? ' unavailable' : ''}`}>
    <button type="button" aria-label={`Remove ${label}`} onClick={onRemove}
      title={offer.reason ?? `Sends your message, then ${offer.mode === 'review' ? 'prepares a PR' : 'ships'} once the turn finishes. Alt+S removes it.`}>
      <Ship /><span>{label}</span><Close />
    </button>
  </span>;
}
