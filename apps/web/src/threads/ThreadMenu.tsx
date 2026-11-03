import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useThreads } from './threads';

type Open = { thread: ThreadView; x: number; y: number };
const Ctx = createContext<(thread: ThreadView, x: number, y: number) => void>(() => {});

/** Opens the thread menu at the pointer (right-click on a row). */
export function useThreadMenu() {
  return useContext(Ctx);
}

/**
 * One right-click menu for every thread row, as in T3 Code. Deleting asks twice:
 * the first click turns the item into a confirmation.
 */
export function ThreadMenuProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const { selectedId, select } = useThreads();
  const [open, setOpen] = useState<Open>();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) menu.current?.showPopover();
  }, [open]);

  const show = (thread: ThreadView, x: number, y: number) => {
    setConfirming(false);
    setError(undefined);
    setOpen({ thread, x, y });
  };
  const close = () => menu.current?.hidePopover();

  const remove = async (t: ThreadView) => {
    try {
      await client.call('threads.delete', { threadId: t.id });
      if (selectedId === t.id) select('');
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const running = open?.thread.status === 'running';
  return (
    <Ctx.Provider value={show}>
      {children}
      {open && (
        <div
          className="menu context-menu"
          popover="auto"
          ref={menu}
          role="menu"
          style={{ left: Math.min(open.x, window.innerWidth - 230), top: Math.min(open.y, window.innerHeight - 120) }}
          onToggle={(e) => e.newState === 'closed' && setOpen(undefined)}
        >
          <div className="menu-label">{open.thread.title}</div>
          {confirming ? (
            <button className="menu-item danger" role="menuitem" autoFocus onClick={() => remove(open.thread)}>
              <span className="menu-text">Delete for good</span>
            </button>
          ) : (
            <button
              className="menu-item danger"
              role="menuitem"
              disabled={running}
              title={running ? 'Stop the thread to delete it' : undefined}
              onClick={() => setConfirming(true)}
            >
              <span className="menu-text">Delete thread…</span>
            </button>
          )}
          {error && <p className="error menu-error">{error}</p>}
        </div>
      )}
    </Ctx.Provider>
  );
}
