import { useEffect, useState } from 'react';
import { pastesIn, reactionsIn, retypeMessage, summarizePastes, typedText, type ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';
import { Close, Queue } from '../app/icons';
import { useThreadAvailability } from './useThreadAvailability';

/**
 * Editing holds the message on the server, so it cannot start under the cursor.
 * Only the typed text is edited; its Pasted text stays as it was (GLOSSARY: Pasted text).
 */
export function QueueTray({ thread }: { thread: ThreadView }) {
  const client = useClient();
  const { unavailable } = useThreadAvailability(thread);
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
  return <section className="queue-tray" aria-label="Queued messages" title={unavailable}>
    {error && <p className="error" role="alert">{error}</p>}
    {thread.queuedMessages.map(message => <div className="queued-message" key={message.id}>
      <Queue />
      {edit?.id === message.id ? <form onSubmit={e => {
        e.preventDefault();
        if (!unavailable && !busy) void run(async () => { await action(message.id, 'save', retypeMessage(message.text, edit.text)); setEdit(undefined); });
      }}>
        <input aria-label="Edit queued message" autoFocus disabled={!!unavailable} value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} />
        <button className="queue-save" disabled={!!unavailable || busy || (!edit.text.trim() && !pastesIn(message.text).length && !reactionsIn(message.text).length)}>Save</button>
        <button type="button" disabled={!!unavailable || busy} onClick={() => void run(async () => { await action(message.id, 'cancel'); setEdit(undefined); })}>Cancel</button>
      </form> : <>
        <span className="queued-text" title={summarizePastes(message.text)}>{summarizePastes(message.text).replace(/\s*\n+\s*/g, ' · ') || (message.images?.length ? imageCount(message.images.length) : 'Picked option')}{message.text && message.images?.length ? ` · ${imageCount(message.images.length)}` : ''}</span>
        <span className="queued-when">{message.editing ? 'Editing' : thread.status === 'running' ? 'after this turn' : 'paused'}</span>
        <button disabled={!!unavailable || busy || message.editing} onClick={() => void run(() => action(message.id, 'steer'))}>{thread.status === 'running' ? 'Steer now' : 'Send now'}</button>
        <button disabled={!!unavailable || busy} onClick={() => void run(async () => { await action(message.id, 'edit'); setEdit({ id: message.id, text: typedText(message.text) }); })}>Edit</button>
        <button aria-label="Remove queued message" title="Remove queued message" disabled={!!unavailable || busy} onClick={() => void run(() => action(message.id, 'remove'))}><Close /></button>
      </>}
    </div>)}
  </section>;
}

const imageCount = (n: number) => n === 1 ? '1 image' : `${n} images`;
