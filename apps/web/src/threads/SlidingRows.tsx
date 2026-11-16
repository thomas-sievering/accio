import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion, type Transition } from 'motion/react';

/**
 * Sidebar rows slide into place when a status change moves them (snooze, settle, reopen,
 * delete, a turn starting or finishing), and removed rows fade out. A row that moves between
 * two visible lists travels there, above the rows it passes; one that leaves for a closed shelf
 * fades. A render that narrows or widens the lists (search, project scope, profile filter, the
 * first load) is instant, so filtering never animates. Reduced motion keeps the fades and drops
 * the travel.
 */
type Slide = {
  /** The list (inbox or shelf) of every row on screen after this render, and before it. */
  visible: Map<string, string>;
  previous: Map<string, string>;
  reduce: boolean;
};

const SlideCtx = createContext<Slide>({ visible: new Map(), previous: new Map(), reduce: false });
const ListCtx = createContext('');

// The house curve (--ease-settle in ui/motion.css): rows travel as one group. The fade is short, so a
// leaving row is nearly gone before the rows below slide over its place.
const SETTLE = [0.22, 1, 0.36, 1] as const;
const TRAVEL: Transition = { layout: { duration: 0.32, ease: SETTLE }, opacity: { duration: 0.12, ease: 'easeOut' } };
const INSTANT: Transition = { duration: 0 };

export function SlidingRows({ visible, filters, ready, children }: {
  /** Every row the sidebar shows after this render, by key, with the list it is in. */
  visible: [key: string, list: string][];
  /** Changes whenever the search, project scope or profile filter does. */
  filters: string;
  /** False until the threads have loaded. */
  ready: boolean;
  children: ReactNode;
}) {
  const reduce = useReducedMotion() ?? false;
  const last = useRef<{ visible: Map<string, string>; filters: string; ready: boolean } | null>(null);
  const now = new Map(visible);
  const before = last.current;
  const instant = !before || !before.ready || before.filters !== filters;
  useEffect(() => { last.current = { visible: now, filters, ready }; });
  return (
    <SlideCtx.Provider value={{ visible: now, previous: before?.visible ?? now, reduce }}>
      <MotionConfig transition={instant ? INSTANT : TRAVEL}>{children}</MotionConfig>
    </SlideCtx.Provider>
  );
}

/** One list of rows (the inbox or a shelf). Leaving rows step out of the flow at once, so the rest close up while they fade. */
export function RowList({ name, children }: { name: string; children: ReactNode }) {
  const { visible } = useContext(SlideCtx);
  return (
    <ListCtx.Provider value={name}>
      <div className="rows">
        <AnimatePresence initial={false} mode="popLayout" custom={visible}>{children}</AnimatePresence>
      </div>
    </ListCtx.Provider>
  );
}

export function SlidingRow({ id, children }: { id: string; children: ReactNode }) {
  const { previous, reduce } = useContext(SlideCtx);
  const list = useContext(ListCtx);
  const from = previous.get(id);
  // A row that was already showing travels in from there instead of fading in; one crossing
  // from another list passes over the rows between, so it rides above them while it travels.
  const crossing = from !== undefined && from !== list;
  // Set on the element, not in state: a render mid-travel must not restart it.
  const node = useRef<HTMLDivElement>(null);
  return (
    <motion.div
      ref={node}
      className="row-slot"
      layout={reduce ? false : 'position'}
      layoutId={reduce ? undefined : `row-${id}`}
      variants={{
        hidden: { opacity: 0 },
        shown: { opacity: 1 },
        // Still visible elsewhere: the row there carries it, so this copy goes at once.
        gone: (visible: Map<string, string>) => (visible.has(id) ? { opacity: 0, transition: INSTANT } : { opacity: 0 }),
      }}
      initial={from !== undefined ? false : 'hidden'}
      animate="shown"
      exit="gone"
      onLayoutAnimationStart={() => { if (crossing) node.current?.setAttribute('data-travelling', ''); }}
      onLayoutAnimationComplete={() => node.current?.removeAttribute('data-travelling')}
    >
      {children}
    </motion.div>
  );
}

/** The shelves below the inbox. A shelf that empties fades out with its last row rather than vanishing. */
export function ShelfList({ children }: { children: ReactNode }) {
  return (
    <div className="shelves">
      <AnimatePresence initial={false} mode="popLayout">{children}</AnimatePresence>
    </div>
  );
}

/** A shelf keeps its place in the group: it slides when the rows above it come or go. It opens through CSS (shelf-in). */
export function SlidingShelf({ className, children, ref }: { className: string; children: ReactNode; ref?: React.Ref<HTMLElement> }) {
  const { reduce } = useContext(SlideCtx);
  return (
    <motion.section ref={ref} className={className} layout={reduce ? false : 'position'} initial={false} exit={{ opacity: 0 }}>
      {children}
    </motion.section>
  );
}
