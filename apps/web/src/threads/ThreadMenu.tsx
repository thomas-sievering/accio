import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { threadPlace, type ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Check, Close } from '../app/icons';
import { useAction } from '../app/useAction';
import { Button } from '../ui/Button';
import { usePopoverMenu } from '../ui/usePopoverMenu';
import { awaitsMachine } from './shelves';
import { snoozeThread } from './SnoozeNotice';
import { useThreads, type ThreadActions } from './threads';
import { releaseFirstMessage } from './sentImages';
import { useThreadAvailability } from './useThreadAvailability';

type Open = { thread: ThreadView; x: number; y: number };
type Mode = 'menu' | 'confirmDelete';
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
 * twice: the first click turns the item into Cancel and Delete thread. Rename
 * closes the menu and opens the title editor where the caller shows it.
 */
export function ThreadMenuItems({ thread, close, onRename, before }: {
  thread: ThreadView; close: () => void; onRename: () => void; before?: ReactNode;
}) {
  const client = useClient();
  const { unavailable } = useThreadAvailability(thread);
  const { selectedId, select, now, act } = useThreads();
  const [mode, setMode] = useState<Mode>('menu');
  const { busy, error, run } = useAction();
  // Which item is under way: it shows the wait, the others are only disabled.
  const [pending, setPending] = useState<string>();
  const done = async (key: string, fn: () => Promise<unknown>) => {
    setPending(key);
    const ok = (await run(async () => (await fn(), true))) === true;
    setPending(undefined);
    if (ok) close();
  };
  const running = thread.status === 'running';
  const place = threadPlace(thread, now);
  // Another machine's thread while that machine is offline: the hub keeps its snooze until the
  // machine is back; settling waits until you can read it.
  const awaiting = awaitsMachine(thread);
  const item = (label: string, action: keyof ThreadActions, { whileOffline = false, blocked }: { whileOffline?: boolean; blocked?: string } = {}) => {
    const reason = blocked ?? (whileOffline ? undefined : unavailable);
    return (
      <Button className="menu-item" role="menuitem" disabled={busy || !!reason} title={reason} busy={pending === action}
        onClick={() => done(action, () => action === 'snooze' ? snoozeThread(act, thread) : act[action](thread.id))}>
        <span className="menu-text">{label}</span>
      </Button>
    );
  };
  return (
    <>
      {before}
      <button className="menu-item" role="menuitem" disabled={!!unavailable} title={unavailable} onClick={() => { close(); onRename(); }}>
        <span className="menu-text">Rename…</span>
      </button>
      <Button className="menu-item" role="menuitem" disabled={busy || !!unavailable} title={unavailable} busy={pending === 'title'} busyLabel={<span className="menu-text">Generating…</span>} onClick={() => done('title', () => client.call('threads.regenerateTitle', { threadId: thread.id }))}>
        <span className="menu-text">Regenerate title</span>
      </Button>
      {running && item('Stop', 'stop')}
      {place === 'snoozed' ? item('Wake now', 'reopen', { whileOffline: !!thread.snoozedUntilOnline })
        : awaiting ? item('Snooze until back online', 'snooze', { whileOffline: true })
        : item('Snooze until morning', 'snooze')}
      {place === 'settled' ? item('Reopen', 'reopen')
        : item('Settle', 'settle', { blocked: awaiting ? `${thread.machine!.name} is offline. Read the thread once it is back to settle it.` : undefined })}
      <hr />
      {mode === 'confirmDelete' ? (
        <div className="menu-confirm">
          <button className="menu-item" role="menuitem" autoFocus disabled={busy || !!unavailable} title={unavailable} onClick={() => setMode('menu')}>
            <span className="menu-text">Cancel</span>
          </button>
          <Button className="menu-item danger" role="menuitem" disabled={busy || !!unavailable} title={unavailable} busy={pending === 'delete'}
            onClick={() =>
              done('delete', async () => {
                await client.call('threads.delete', { threadId: thread.id });
                releaseFirstMessage(client, thread.id);
                if (selectedId === thread.id) select('');
              })
            }>
            <span className="menu-text">Delete thread</span>
          </Button>
        </div>
      ) : (
        <button className="menu-item danger" role="menuitem" disabled={running || !!unavailable}
          title={unavailable ?? (running ? 'Stop the thread to delete it' : undefined)}
          onClick={() => setMode('confirmDelete')}>
          <span className="menu-text">Delete thread</span>
        </button>
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
  // At the pointer, opening upward when there is no room below it.
  const { props, popover: menu } = usePopoverMenu({
    placement: { width: 220, side: 'below', height: 220, gap: 0, margin: 8 },
    at: open ? { x: open.x, y: open.y } : undefined,
    onToggle: (shown) => { if (!shown) setOpen(undefined); },
  });

  useEffect(() => {
    if (open) menu.current?.showPopover();
  }, [open, menu]);

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
          {...props}
          role="menu"
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

/**
 * The one title editor, in the sidebar row and the thread header. Enter (or Save) saves the
 * trimmed title; Escape, Cancel or leaving the field keeps the old one. The header, with room
 * for them, shows Save and Cancel as small icon buttons.
 */
export function TitleEdit({ thread, className, buttons = false, onDone }: { thread: ThreadView; className: string; buttons?: boolean; onDone: () => void }) {
  const client = useClient();
  const { unavailable } = useThreadAvailability(thread);
  const [title, setTitle] = useState(thread.title);
  const { busy, error, run } = useAction();
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
    <form className={className} onSubmit={submit}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) onDone(); }}>
      <input ref={input} value={title} disabled={!!unavailable} title={unavailable} autoFocus maxLength={120} aria-label="Thread title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onDone(); }} />
      <small className="title-count" aria-live="polite">{title.length}/120</small>
      {buttons && <>
        <button type="submit" className="title-edit-button" aria-label="Save" title="Save (Enter)" disabled={!!unavailable || busy || !title.trim()}><Check /></button>
        <button type="button" className="title-edit-button" aria-label="Cancel" title="Cancel (Esc)" disabled={busy} onClick={onDone}><Close /></button>
      </>}
      {error && <span className="error" role="alert">{error}</span>}
    </form>
  );
}
