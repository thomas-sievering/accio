import { useRef, useState, type ReactNode } from 'react';
import { Chevron } from '../app/icons';
import { useLocalState } from '../app/useLive';
import { ThreadRow } from './ThreadRow';
import { useThreads } from './threads';

const SETTLED_PAGE = 5;

/** Working, Snoozed and Settled shelves below the thread list, as in T3 Code. Empty shelves are not shown. */
export function ThreadShelves() {
  const { shelves } = useThreads();
  const [settledShown, setSettledShown] = useState(SETTLED_PAGE);
  const hidden = shelves.settled.length - settledShown;

  return (
    <div className="shelves">
      <Shelf name="working" label="Working" count={shelves.working.length} defaultOpen>
        {shelves.working.map((t) => (
          <ThreadRow key={t.id} thread={t} place="working" />
        ))}
      </Shelf>
      <Shelf name="snoozed" label="Snoozed" count={shelves.snoozed.length}>
        {shelves.snoozed.map((t) => (
          <ThreadRow key={t.id} thread={t} place="snoozed" />
        ))}
      </Shelf>
      <Shelf name="settled" label="Settled" count={shelves.settled.length}>
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

function Shelf(props: { name: string; label: string; count: number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useLocalState<'1' | '0'>(`accio.shelf.${props.name}`, props.defaultOpen ? '1' : '0');
  const expanded = open === '1';
  const section = useRef<HTMLElement>(null);
  if (props.count === 0) return null;
  return (
    <section ref={section} className="shelf">
      <button className="shelf-head" aria-expanded={expanded} onClick={() => {
        setOpen(expanded ? '0' : '1');
        if (!expanded) requestAnimationFrame(() => section.current?.querySelector('.row')?.scrollIntoView({ block: 'nearest' }));
      }}>
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
