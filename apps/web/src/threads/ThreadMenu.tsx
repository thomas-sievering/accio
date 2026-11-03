import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';
import { placeOf } from './shelves';
import { useThreads, type ThreadActions } from './threads';

type Open = { thread: ThreadView; x: number; y: number };
type Mode = 'menu' | 'rename' | 'confirmDelete';
const Ctx = createContext<(thread: ThreadView, x: number, y: number) => void>(() => {});

/** Opens the thread menu at the pointer (right-click on a row). */
export function useThreadMenu() {
  return useContext(Ctx);
}

/**
 * One right-click menu for every thread row, as in T3 Code, holding every thread
 * action: rename, stop, snooze or wake, settle or reopen, delete. Deleting asks
 * twice: the first click turns the item into a confirmation.
 */
export function ThreadMenuProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const { threads, selectedId, select, now, act } = useThreads();
  const [open, setOpen] = useState<Open>();
  const [mode, setMode] = useState<Mode>('menu');
  const [title, setTitle] = useState('');
  const { busy, error, run, clear } = useAction();
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) menu.current?.showPopover();
  }, [open]);

  const show = (thread: ThreadView, x: number, y: number) => {
    setMode('menu');
    setTitle(thread.title);
    clear();
    setOpen({ thread, x, y });
  };
  const close = () => menu.current?.hidePopover();
  const done = async (fn: () => Promise<unknown>) => {
    if ((await run(async () => (await fn(), true))) === true) close();
  };

  // Always the latest view, so the menu follows status changes while it is open.
  const t = open && (threads?.find((x) => x.id === open.thread.id) ?? open.thread);
  const running = t?.status === 'running';
  const place = t && placeOf(t, now);
  const item = (label: string, action: keyof ThreadActions) => (
    <button className="menu-item" role="menuitem" disabled={busy} onClick={() => t && done(() => act[action](t.id))}>
      <span className="menu-text">{label}</span>
    </button>
  );

  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (t && title.trim()) void done(() => client.call('threads.rename', { threadId: t.id, title }));
  };

  return (
    <Ctx.Provider value={show}>
      {children}
      {open && t && (
        <div
          className="menu context-menu"
          popover="auto"
          ref={menu}
          role="menu"
          style={{ left: Math.min(open.x, window.innerWidth - 230), top: Math.min(open.y, window.innerHeight - 220) }}
          onToggle={(e) => e.newState === 'closed' && setOpen(undefined)}
        >
          {mode === 'rename' ? (
            <form className="menu-form" onSubmit={rename}>
              <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Thread title" autoFocus maxLength={120} />
            </form>
          ) : (
            <>
              <div className="menu-label">{t.title}</div>
              <button className="menu-item" role="menuitem" onClick={() => setMode('rename')}>
                <span className="menu-text">Rename…</span>
              </button>
              {running && item('Stop', 'stop')}
              {place === 'snoozed' ? item('Wake now', 'reopen') : item('Snooze until morning', 'snooze')}
              {place === 'settled' ? item('Reopen', 'reopen') : item('Settle', 'settle')}
              <hr />
              {mode === 'confirmDelete' ? (
                <button
                  className="menu-item danger"
                  role="menuitem"
                  autoFocus
                  disabled={busy}
                  onClick={() =>
                    done(async () => {
                      await client.call('threads.delete', { threadId: t.id });
                      if (selectedId === t.id) select('');
                    })
                  }
                >
                  <span className="menu-text">Delete for good</span>
                </button>
              ) : (
                <button
                  className="menu-item danger"
                  role="menuitem"
                  disabled={running}
                  title={running ? 'Stop the thread to delete it' : undefined}
                  onClick={() => setMode('confirmDelete')}
                >
                  <span className="menu-text">Delete thread…</span>
                </button>
              )}
            </>
          )}
          {error && <p className="error menu-error">{error}</p>}
        </div>
      )}
    </Ctx.Provider>
  );
}
