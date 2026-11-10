import { useEffect, useState } from 'react';
import { emitAppEvent, useAppEvent } from '../app/appEvents';
import type { ThreadView } from '@accio/protocol';
import { awaitsMachine, nextMorning, wakeText } from './shelves';
import { useThreads, type ThreadActions } from './threads';

/** Snoozes a thread and tells the sidebar, which says when it will wake. */
export async function snoozeThread(act: ThreadActions, thread: Pick<ThreadView, 'id' | 'machine'>) {
  await act.snooze(thread.id);
  const untilOnline = awaitsMachine(thread) ? thread.machine!.name : undefined;
  emitAppEvent('thread.snoozed', { threadId: thread.id, until: nextMorning(new Date()).toISOString(), untilOnline });
}

/** A brief, quiet line at the foot of the sidebar after a snooze, with Undo. */
export function SnoozeNotice() {
  const { act } = useThreads();
  const [note, setNote] = useState<{ threadId: string; until: string; untilOnline?: string }>();
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
        <span>{note.untilOnline ? `Snoozed until ${note.untilOnline} is back` : `Snoozed until ${wakeText(when, new Date())}`}</span>
        <button onClick={() => { setNote(undefined); void act.reopen(note.threadId).catch((e: Error) => console.error(e.message)); }}>Undo</button>
      </>}
    </div>
  );
}
