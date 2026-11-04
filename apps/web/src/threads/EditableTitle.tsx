import { useState } from 'react';
import type { ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';

export function EditableTitle({ thread }: { thread: ThreadView }) {
  const client = useClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const { busy, error, run, clear } = useAction();
  if (!editing) return <button className="editable-thread-title" title="Rename thread" aria-label={`Rename thread: ${thread.title}`} onClick={() => { setTitle(thread.title); clear(); setEditing(true); }}>{thread.title}</button>;
  return <form className="thread-title-form field" onSubmit={event => {
    event.preventDefault();
    if (title.trim()) void run(async () => { await client.call('threads.rename', { threadId: thread.id, title }); setEditing(false); });
  }}>
    <input aria-label="Thread title" autoFocus maxLength={120} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setEditing(false); } }} />
    <button type="submit" className="ghost" disabled={busy || !title.trim()}>Save</button>
    <button type="button" className="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
    {error && <span className="error" role="alert">{error}</span>}
  </form>;
}
