import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { Chevron } from '../app/icons';
import { useLocalState } from '../app/useLive';
import { offlineMachines, shelveThreads, type ThreadShelves as Shelves } from './shelves';
import { RowList, ShelfList, SlidingRow, SlidingShelf } from './SlidingRows';
import { ThreadRow } from './ThreadRow';
import { useThreads } from './threads';

const SETTLED_PAGE = 5;
type ShelfName = 'working' | 'offline' | 'snoozed' | 'settled';
const SHELVES = ['working', 'offline', 'snoozed', 'settled'] as const satisfies readonly ShelfName[];

/** Which shelves are expanded and how much of Settled is shown. The list owns it, so it knows which rows are on screen. */
export type ShelfView = {
  expanded: Record<ShelfName, boolean>;
  toggle: (name: ShelfName) => void;
  settledShown: number;
  showMoreSettled: () => void;
};

export function useShelfView(): ShelfView {
  const shelves = {
    working: useLocalState<'1' | '0'>('accio.shelf.working', '1'),
    offline: useLocalState<'1' | '0'>('accio.shelf.offline', '0'),
    snoozed: useLocalState<'1' | '0'>('accio.shelf.snoozed', '0'),
    settled: useLocalState<'1' | '0'>('accio.shelf.settled', '0'),
  };
  const [settledShown, setSettledShown] = useState(SETTLED_PAGE);
  return {
    expanded: { working: shelves.working[0] === '1', offline: shelves.offline[0] === '1', snoozed: shelves.snoozed[0] === '1', settled: shelves.settled[0] === '1' },
    toggle: (name) => { const [v, set] = shelves[name]; set(v === '1' ? '0' : '1'); },
    settledShown,
    showMoreSettled: () => setSettledShown((n) => n + SETTLED_PAGE),
  };
}

/** The shelved rows on screen, each with its shelf: those on expanded shelves, and the shown page of Settled. */
export function visibleShelfRows(shelves: Shelves, view: ShelfView): [id: string, shelf: ShelfName][] {
  const on = (name: ShelfName, threads: Shelves[ShelfName]) => (view.expanded[name] ? threads.map((t) => [t.id, name] as [string, ShelfName]) : []);
  return [...on('working', shelves.working), ...on('offline', shelves.offline), ...on('snoozed', shelves.snoozed), ...on('settled', shelves.settled.slice(0, view.settledShown))];
}

/**
 * Working, Offline, Snoozed and Settled shelves below the thread list, as in T3 Code. Empty shelves
 * are not shown. Offline counts its threads per machine instead of in all.
 */
export function ThreadShelves({ view }: { view: ShelfView }) {
  const { shelves } = useThreads();
  const created = useCreatedShelves();
  const hidden = shelves.settled.length - view.settledShown;
  const shelf = (name: ShelfName, label: string, children: ReactNode, counts: { name?: string; count: number }[] = [{ count: shelves[name].length }]) => shelves[name].length > 0 && (
    <Shelf key={name} name={name} label={label} counts={counts} view={view} arriving={created.has(name)}>{children}</Shelf>
  );

  return (
    <ShelfList>
      {shelf('working', 'Working', shelves.working.map((t) => (
        <SlidingRow key={t.id} id={t.id}><ThreadRow thread={t} place="working" /></SlidingRow>
      )))}
      {shelf('offline', 'Offline', shelves.offline.map((t) => (
        <SlidingRow key={t.id} id={t.id}><ThreadRow thread={t} place="offline" /></SlidingRow>
      )), offlineMachines(shelves.offline))}
      {shelf('snoozed', 'Snoozed', shelves.snoozed.map((t) => (
        <SlidingRow key={t.id} id={t.id}><ThreadRow thread={t} place="snoozed" /></SlidingRow>
      )))}
      {/* One flat list of keyed rows, so each settled row leaves on its own. */}
      {shelf('settled', 'Settled', [
        ...shelves.settled.slice(0, view.settledShown).map((t) => (
          <SlidingRow key={t.id} id={t.id}><ThreadRow thread={t} place="settled" /></SlidingRow>
        )),
        hidden > 0 && (
          <SlidingRow key="settled-more" id="settled-more">
            <button className="shelf-more" onClick={view.showMoreSettled}>
              Show {Math.min(SETTLED_PAGE, hidden)} more
            </button>
          </SlidingRow>
        ),
      ])}
    </ShelfList>
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
  if (all && before.current) for (const name of SHELVES) {
    if (before.current[name].length === 0 && all[name].length > 0) created.add(name);
  }
  return created;
}

// ShelfList's presence measures a leaving shelf through `ref`, so it reaches the section.
function Shelf(props: { name: ShelfName; label: string; counts: { name?: string; count: number }[]; view: ShelfView; arriving: boolean; children: ReactNode; ref?: Ref<HTMLElement> }) {
  const expanded = props.view.expanded[props.name];
  // Decided once, when the shelf mounts: later renders must not restart or cut its opening.
  const [arriving] = useState(props.arriving);
  return (
    <SlidingShelf ref={props.ref} className={`shelf${arriving ? ' arriving' : ''}`}>
      <button className="shelf-head" aria-expanded={expanded} onClick={(e) => {
        const section = e.currentTarget.parentElement;
        props.view.toggle(props.name);
        if (!expanded) requestAnimationFrame(() => section?.querySelector('.row')?.scrollIntoView({ block: 'nearest' }));
      }}>
        <span>{props.label}</span>
        {props.counts.map(({ name, count }, i) => name === undefined
          ? <span key={i} className="shelf-count">{count}</span>
          : <span key={i} className="shelf-machine">· {name} <span className="shelf-count">{count}</span></span>)}
        <span className="shelf-chevron">
          <Chevron />
        </span>
      </button>
      {expanded && <RowList name={props.name}>{props.children}</RowList>}
    </SlidingShelf>
  );
}
