import { useEffect, useState } from 'react';
import type { ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';
import { Close, Queue } from '../app/icons';

/** Editing holds the message on the server, so it cannot start under the cursor. */
export function QueueTray({ thread }: { thread: ThreadView }) {
  const client = useClient();
  const { busy, error, run } = useAction();
  const [edit, setEdit] = useState<{ id: string; text: string }>();
  const action = (messageId: string, action: 'steer' | 'remove' | 'edit' | 'save' | 'cancel', text?: string) =>
    client.call('threads.queued', { threadId: thread.id, messageId, action, text });
  // The edit tray belongs to its turn: when the turn ends or stops, release the held message and close it.
  const editing = edit?.id;
  useEffect(() => {
    if (thread.status === 'running' || !editing) return;
    setEdit(undefined);
    void action(editing, 'cancel').catch(() => {});
  }, [thread.status]);
  if (!thread.queuedMessages?.length) return null;
  return <section className="queue-tray" aria-label="Queued messages">
    {error && <p className="error" role="alert">{error}</p>}
    {thread.queuedMessages.map(message => <div className="queued-message" key={message.id}>
      <Queue />
      {edit?.id === message.id ? <form onSubmit={e => {
        e.preventDefault();
        if (!busy) void run(async () => { await action(message.id, 'save', edit.text); setEdit(undefined); });
      }}>
        <input aria-label="Edit queued message" autoFocus value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} />
        <button className="queue-save" disabled={busy || !edit.text.trim()}>Save</button>
        <button type="button" disabled={busy} onClick={() => void run(async () => { await action(message.id, 'cancel'); setEdit(undefined); })}>Cancel</button>
      </form> : <>
        <span className="queued-text" title={message.text}>{message.text || 'Picked option'}</span>
        <span className="queued-when">{message.editing ? 'Editing' : thread.status === 'running' ? 'after this turn' : 'paused'}</span>
        <button disabled={busy || message.editing} onClick={() => void run(() => action(message.id, 'steer'))}>{thread.status === 'running' ? 'Steer now' : 'Send now'}</button>
        <button disabled={busy} onClick={() => void run(async () => { await action(message.id, 'edit'); setEdit({ id: message.id, text: message.text }); })}>Edit</button>
        <button aria-label="Remove queued message" title="Remove queued message" disabled={busy} onClick={() => void run(() => action(message.id, 'remove'))}><Close /></button>
      </>}
    </div>)}
  </section>;
}
