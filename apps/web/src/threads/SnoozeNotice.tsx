import { useEffect, useState } from 'react';
import { emitAppEvent, useAppEvent } from '../app/appEvents';
import { nextMorning } from './shelves';
import { useThreads, type ThreadActions } from './threads';

/** Snoozes a thread and tells the sidebar, which says when it will wake. */
export async function snoozeThread(act: ThreadActions, threadId: string) {
  await act.snooze(threadId);
  emitAppEvent('thread.snoozed', { threadId, until: nextMorning(new Date()).toISOString() });
}

/** A brief, quiet line at the foot of the sidebar after a snooze, with Undo. */
export function SnoozeNotice() {
  const { act } = useThreads();
  const [note, setNote] = useState<{ threadId: string; until: string }>();
  useAppEvent('thread.snoozed', setNote);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(undefined), 6000);
    return () => clearTimeout(timer);
  }, [note]);
  const when = note && new Date(note.until);
  return (
    <div className="snooze-notice" role="status">
      {note && when && <>
        <span>Snoozed until {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <button onClick={() => { setNote(undefined); void act.reopen(note.threadId).catch((e: Error) => console.error(e.message)); }}>Undo</button>
      </>}
    </div>
  );
}
