import type { ThreadView } from '@accio/protocol';
import { threadStatus } from './status';
import { timeAgo } from './ThreadRow';
import { useThreads } from './threads';

/**
 * GLOSSARY: Relay. In place of the transcript while another machine's thread can't load because
 * that machine is offline: what this client last heard, and Retry.
 */
export function OfflineThread({ thread, onRetry }: { thread: ThreadView & { machine: NonNullable<ThreadView['machine']> }; onRetry: () => void }) {
  const { now } = useThreads();
  const name = thread.machine.name;
  const ago = timeAgo(thread.updatedAt, now);
  return (
    <div className="empty offline-thread">
      <p><strong>{name} is offline</strong></p>
      <p className="muted">
        Last status: {threadStatus(thread).label} · {ago === 'now' ? 'just now' : `${ago} ago`}.
        {' '}The transcript loads when {name} is back.
      </p>
      <div className="offline-thread-actions">
        <button className="ghost" onClick={onRetry}>Retry</button>
      </div>
    </div>
  );
}
