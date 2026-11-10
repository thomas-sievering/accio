import type { ThreadView } from '@accio/protocol';
import { snoozeThread } from './SnoozeNotice';
import { threadStatus } from './status';
import { timeAgo } from './ThreadRow';
import { useThreads } from './threads';

/**
 * GLOSSARY: Relay. In place of the transcript while another machine's thread can't load because
 * that machine is offline: what this client last heard, and Snooze until it is back. Settling
 * waits until you can read the thread.
 */
export function OfflineThread({ thread, onRetry }: { thread: ThreadView & { machine: NonNullable<ThreadView['machine']> }; onRetry: () => void }) {
  const { act, now } = useThreads();
  const name = thread.machine.name;
  const snoozed = !!thread.snoozedUntilOnline;
  const ago = timeAgo(thread.updatedAt, now);
  const run = (fn: () => Promise<unknown>) => void fn().catch((e: Error) => console.error(e.message));
  return (
    <div className="empty offline-thread">
      <p><strong>{name} is offline</strong></p>
      <p className="muted">
        Last status: {threadStatus(thread).label} · {ago === 'now' ? 'just now' : `${ago} ago`}.
        {' '}The transcript loads when {name} is back.
      </p>
      <div className="offline-thread-actions">
        {snoozed
          ? <button className="ghost" onClick={() => run(() => act.reopen(thread.id))}>Wake now</button>
          : <button className="ghost primary" onClick={() => run(() => snoozeThread(act, thread))}>Snooze until back online</button>}
        <button className="ghost" onClick={onRetry}>Retry</button>
      </div>
      {snoozed && <p className="muted">Snoozed until {name} is back.</p>}
    </div>
  );
}
