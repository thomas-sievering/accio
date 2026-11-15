import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Chevron } from '../app/icons';
import { useLocalState } from '../app/useLive';
import { shelveThreads, type ThreadShelves as Shelves } from './shelves';
import { RowList, SlidingRow, SlidingShelf } from './SlidingRows';
import { ThreadRow } from './ThreadRow';
import { useThreads } from './threads';

const SETTLED_PAGE = 5;
type ShelfName = 'working' | 'snoozed' | 'settled';

/** Which shelves are expanded and how much of Settled is shown. The list owns it, so it knows which rows are on screen. */
export type ShelfView = {
  expanded: Record<ShelfName, boolean>;
  toggle: (name: ShelfName) => void;
  settledShown: number;
  showMoreSettled: () => void;
};

export function useShelfView(): ShelfView {
  const [working, setWorking] = useLocalState<'1' | '0'>('accio.shelf.working', '1');
  const [snoozed, setSnoozed] = useLocalState<'1' | '0'>('accio.shelf.snoozed', '0');
  const [settled, setSettled] = useLocalState<'1' | '0'>('accio.shelf.settled', '0');
  const [settledShown, setSettledShown] = useState(SETTLED_PAGE);
  const flip = (v: '1' | '0') => (v === '1' ? '0' : '1');
  return {
    expanded: { working: working === '1', snoozed: snoozed === '1', settled: settled === '1' },
    toggle: (name) => (name === 'working' ? setWorking(flip(working)) : name === 'snoozed' ? setSnoozed(flip(snoozed)) : setSettled(flip(settled))),
    settledShown,
    showMoreSettled: () => setSettledShown((n) => n + SETTLED_PAGE),
  };
}

/** The shelved rows on screen, each with its shelf: those on expanded shelves, and the shown page of Settled. */
export function visibleShelfRows(shelves: Shelves, view: ShelfView): [id: string, shelf: ShelfName][] {
  const on = (name: ShelfName, threads: Shelves[ShelfName]) => (view.expanded[name] ? threads.map((t) => [t.id, name] as [string, ShelfName]) : []);
  return [...on('working', shelves.working), ...on('snoozed', shelves.snoozed), ...on('settled', shelves.settled.slice(0, view.settledShown))];
}

/** Working, Snoozed and Settled shelves below the thread list, as in T3 Code. Empty shelves are not shown. */
export function ThreadShelves({ view }: { view: ShelfView }) {
  const { shelves } = useThreads();
  const created = useCreatedShelves();
  const hidden = shelves.settled.length - view.settledShown;
  const shelf = (name: ShelfName, label: string, children: ReactNode) => shelves[name].length > 0 && (
    <Shelf key={name} name={name} label={label} count={shelves[name].length} view={view} arriving={created.has(name)}>{children}</Shelf>
  );

  return (
    <div className="shelves">
      {shelf('working', 'Working', shelves.working.map((t) => (
        <SlidingRow key={t.id} id={t.id}><ThreadRow thread={t} place="working" /></SlidingRow>
      )))}
      {shelf('snoozed', 'Snoozed', shelves.snoozed.map((t) => (
        <SlidingRow key={t.id} id={t.id}><ThreadRow thread={t} place="snoozed" /></SlidingRow>
      )))}
      {shelf('settled', 'Settled', <>
        {shelves.settled.slice(0, view.settledShown).map((t) => (
          <SlidingRow key={t.id} id={t.id}><ThreadRow thread={t} place="settled" /></SlidingRow>
        ))}
        {hidden > 0 && (
          <SlidingRow key="settled-more" id="settled-more">
            <button className="shelf-more" onClick={view.showMoreSettled}>
              Show {Math.min(SETTLED_PAGE, hidden)} more
            </button>
          </SlidingRow>
        )}
      </>)}
    </div>
  );
}

/**
 * Shelves that a status change just created: empty across every thread before this render, not
 * empty now. A shelf that only reappears because the search or scope widened was there all along,
 * so it comes back without opening into place.
 */
function useCreatedShelves(): Set<ShelfName> {
  const { threads, now, placement } = useThreads();
  const all = useMemo(() => threads && shelveThreads(threads, now, placement), [threads, now, placement]);
  const before = useRef<Shelves | undefined>(undefined);
  useEffect(() => { if (all) before.current = all; }, [all]);
  const created = new Set<ShelfName>();
  if (all && before.current) for (const name of ['working', 'snoozed', 'settled'] as const) {
    if (before.current[name].length === 0 && all[name].length > 0) created.add(name);
  }
  return created;
}

function Shelf(props: { name: ShelfName; label: string; count: number; view: ShelfView; arriving: boolean; children: ReactNode }) {
  const expanded = props.view.expanded[props.name];
  // Decided once, when the shelf mounts: later renders must not restart or cut its opening.
  const [arriving] = useState(props.arriving);
  const section = useRef<HTMLElement>(null);
  return (
    <SlidingShelf ref={section} className={`shelf${arriving ? ' arriving' : ''}`}>
      <button className="shelf-head" aria-expanded={expanded} onClick={() => {
        props.view.toggle(props.name);
        if (!expanded) requestAnimationFrame(() => section.current?.querySelector('.row')?.scrollIntoView({ block: 'nearest' }));
      }}>
        <span>{props.label}</span>
        <span className="shelf-count">{props.count}</span>
        <span className="shelf-chevron">
          <Chevron />
        </span>
      </button>
      {expanded && <RowList name={props.name}>{props.children}</RowList>}
    </SlidingShelf>
  );
}
