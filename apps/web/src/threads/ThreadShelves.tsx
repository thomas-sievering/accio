import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ThreadView } from '@accio/protocol';
import { Chevron } from '../app/icons';
import { useLocalState } from '../app/useLive';
import { ThreadRow } from './ThreadRow';
import { autoSettled } from './status';
import { useThreads } from './threads';

const SETTLED_PAGE = 5;

/** Snoozed and Settled shelves below the thread list, as in T3 Code. Empty shelves are not shown. */
export function ThreadShelves() {
  const { shelves, threads, selectedId } = useThreads();
  const [settledShown, setSettledShown] = useState(SETTLED_PAGE);
  const hidden = shelves.settled.length - settledShown;
  const revealSettled = useRevealAutoSettled(threads?.find((t) => t.id === selectedId), selectedId);

  return (
    <div className="shelves">
      <Shelf name="snoozed" label="Snoozed" count={shelves.snoozed.length}>
        {shelves.snoozed.map((t) => (
          <ThreadRow key={t.id} thread={t} place="snoozed" />
        ))}
      </Shelf>
      <Shelf name="settled" label="Settled" count={shelves.settled.length} reveal={revealSettled}>
        {shelves.settled.slice(0, settledShown).map((t) => (
          <ThreadRow key={t.id} thread={t} place="settled" />
        ))}
        {hidden > 0 && (
          <button className="shelf-more" onClick={() => setSettledShown((n) => n + SETTLED_PAGE)}>
            Show {Math.min(SETTLED_PAGE, hidden)} more
          </button>
        )}
      </Shelf>
    </div>
  );
}

/**
 * Counts the times the open conversation was settled for its delivery while on screen,
 * so its shelf can show it once. A later collapse by the user stays collapsed.
 */
function useRevealAutoSettled(selected: ThreadView | undefined, selectedId: string): number {
  const [reveals, setReveals] = useState(0);
  const seen = useRef<{ id: string; settled: boolean }>(undefined);
  const known = !!selected;
  const settled = !!selected && autoSettled(selected);
  useEffect(() => {
    if (!known) return;
    const before = seen.current;
    seen.current = { id: selectedId, settled };
    if (settled && before?.id === selectedId && !before.settled) setReveals((n) => n + 1);
  }, [known, selectedId, settled]);
  return reveals;
}

function Shelf(props: { name: string; label: string; count: number; defaultOpen?: boolean; reveal?: number; children: ReactNode }) {
  const [open, setOpen] = useLocalState<'1' | '0'>(`accio.shelf.${props.name}`, props.defaultOpen ? '1' : '0');
  const expanded = open === '1';
  const revealed = useRef(props.reveal ?? 0);
  useEffect(() => {
    if (!props.reveal || props.reveal === revealed.current) return;
    revealed.current = props.reveal;
    setOpen('1');
  }, [props.reveal, setOpen]);
  if (props.count === 0) return null;
  return (
    <section className="shelf">
      <button className="shelf-head" aria-expanded={expanded} onClick={() => setOpen(expanded ? '0' : '1')}>
        <span>{props.label}</span>
        <span className="shelf-count">{props.count}</span>
        <span className="shelf-chevron">
          <Chevron />
        </span>
      </button>
      {expanded && <div className="rows">{props.children}</div>}
    </section>
  );
}
