import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';
import { focusMenuItem, onMenuKeyDown } from '../ui/menuKeys';
import { placeOf } from './shelves';
import { snoozeThread } from './SnoozeNotice';
import { useThreads, type ThreadActions } from './threads';
import { releaseFirstMessage } from './sentImages';
import { useThreadAvailability } from './useThreadAvailability';

type Open = { thread: ThreadView; x: number; y: number };
type Mode = 'menu' | 'rename' | 'confirmDelete';
type MenuCtx = { show: (thread: ThreadView, x: number, y: number) => void; renaming: string | undefined; setRenaming: (id: string | undefined) => void };
const Ctx = createContext<MenuCtx>({ show: () => {}, renaming: undefined, setRenaming: () => {} });

/** Opens the thread menu at the pointer (right-click on a row). */
export function useThreadMenu() {
  return useContext(Ctx).show;
}

/** The thread whose title is being edited inside its sidebar row, if any. */
export function useRenaming() {
  const { renaming, setRenaming } = useContext(Ctx);
  return [renaming, setRenaming] as const;
}

/**
 * Every thread action as menu items, shared by the sidebar row menu and the thread
 * header menu: rename, stop, snooze or wake, settle or reopen, delete. Deleting asks
 * twice: the first click turns the item into Cancel and Delete thread. With
 * `onRename` the title is edited elsewhere (in its sidebar row); without it the
 * menu shows a title field.
 */
export function ThreadMenuItems({ thread, close, onRename, before }: {
  thread: ThreadView; close: () => void; onRename?: () => void; before?: ReactNode;
}) {
  const client = useClient();
  const { unavailable } = useThreadAvailability(thread);
  const { selectedId, select, now, act } = useThreads();
  const [mode, setMode] = useState<Mode>('menu');
  const [title, setTitle] = useState(thread.title);
  const { busy, error, run } = useAction();
  const done = async (fn: () => Promise<unknown>) => {
    if ((await run(async () => (await fn(), true))) === true) close();
  };
  const running = thread.status === 'running';
  const place = placeOf(thread, now);
  const item = (label: string, action: keyof ThreadActions) => (
    <button className="menu-item" role="menuitem" disabled={busy || !!unavailable} title={unavailable}
      onClick={() => done(() => action === 'snooze' ? snoozeThread(act, thread.id) : act[action](thread.id))}>
      <span className="menu-text">{label}</span>
    </button>
  );
  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (!unavailable && title.trim()) void done(() => client.call('threads.rename', { threadId: thread.id, title }));
  };

  return (
    <>
      {mode === 'rename' ? (
        <form className="menu-form" onSubmit={rename}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Thread title" autoFocus maxLength={120} />
        </form>
      ) : (
        <>
          {before}
          <button className="menu-item" role="menuitem" disabled={!!unavailable} title={unavailable} onClick={() => onRename ? (close(), onRename()) : setMode('rename')}>
            <span className="menu-text">Rename…</span>
          </button>
          <button className="menu-item" role="menuitem" disabled={busy || !!unavailable} title={unavailable} onClick={() => done(() => client.call('threads.regenerateTitle', { threadId: thread.id }))}>
            <span className="menu-text">{busy ? 'Generating?' : 'Regenerate title'}</span>
          </button>
          {running && item('Stop', 'stop')}
          {place === 'snoozed' ? item('Wake now', 'reopen') : item('Snooze until morning', 'snooze')}
          {place === 'settled' ? item('Reopen', 'reopen') : item('Settle', 'settle')}
          <hr />
          {mode === 'confirmDelete' ? (
            <div className="menu-confirm">
              <button className="menu-item" role="menuitem" autoFocus disabled={busy || !!unavailable} title={unavailable} onClick={() => setMode('menu')}>
                <span className="menu-text">Cancel</span>
              </button>
              <button className="menu-item danger" role="menuitem" disabled={busy || !!unavailable} title={unavailable}
                onClick={() =>
                  done(async () => {
                    await client.call('threads.delete', { threadId: thread.id });
                    releaseFirstMessage(client, thread.id);
                    if (selectedId === thread.id) select('');
                  })
                }>
                <span className="menu-text">Delete thread</span>
              </button>
            </div>
          ) : (
            <button className="menu-item danger" role="menuitem" disabled={running || !!unavailable}
              title={unavailable ?? (running ? 'Stop the thread to delete it' : undefined)}
              onClick={() => setMode('confirmDelete')}>
              <span className="menu-text">Delete thread</span>
            </button>
          )}
        </>
      )}
      {error && <p className="error menu-error">{error}</p>}
    </>
  );
}

/** One right-click menu for every thread row, as in T3 Code. */
export function ThreadMenuProvider({ children }: { children: ReactNode }) {
  const { threads } = useThreads();
  const [open, setOpen] = useState<Open>();
  const [renaming, setRenaming] = useState<string>();
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.showPopover();
    focusMenuItem(menu.current);
  }, [open]);

  const show = (thread: ThreadView, x: number, y: number) => setOpen({ thread, x, y });
  // Always the latest view, so the menu follows status changes while it is open.
  const t = open && (threads?.find((x) => x.id === open.thread.id) ?? open.thread);

  return (
    <Ctx.Provider value={{ show, renaming, setRenaming }}>
      {children}
      {open && t && (
        <div
          className="menu context-menu"
          popover="auto"
          ref={menu}
          role="menu"
          style={{ left: Math.min(open.x, window.innerWidth - 230), top: Math.min(open.y, window.innerHeight - 220) }}
          onToggle={(e) => e.newState === 'closed' && setOpen(undefined)}
          onKeyDown={onMenuKeyDown}
        >
          <ThreadMenuItems key={open.thread.id} thread={t} close={() => menu.current?.hidePopover()}
            onRename={() => setRenaming(t.id)} before={<div className="menu-label">{t.title}</div>} />
        </div>
      )}
    </Ctx.Provider>
  );
}

/** The row's title line while renaming: Enter saves, Escape or leaving the field keeps the old title. */
export function RowRename({ thread }: { thread: ThreadView }) {
  const [, setRenaming] = useRenaming();
  return <TitleEdit thread={thread} className="row-rename" onDone={() => setRenaming(undefined)} />;
}

/** An in-place title field, shared by the sidebar row and the thread header. */
export function TitleEdit({ thread, className, onDone }: { thread: ThreadView; className: string; onDone: () => void }) {
  const client = useClient();
  const { unavailable } = useThreadAvailability(thread);
  const [title, setTitle] = useState(thread.title);
  const { run } = useAction();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.select(), []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (unavailable) return;
    const next = title.trim();
    if (!next || next === thread.title) return onDone();
    if ((await run(async () => (await client.call('threads.rename', { threadId: thread.id, title: next }), true))) === true) onDone();
  };
  return (
    <form className={className} onSubmit={submit}>
      <input ref={input} value={title} disabled={!!unavailable} title={unavailable} autoFocus maxLength={120} aria-label="Thread title"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={onDone}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onDone(); }} />
      <small className="title-count" aria-live="polite">{title.length}/120</small>
    </form>
  );
}
