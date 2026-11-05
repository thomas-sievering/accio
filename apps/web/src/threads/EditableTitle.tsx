import { useState } from 'react';
import type { ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useTooltip } from '../app/Tooltip';
import { useAction } from '../app/useAction';
import { useThreadAvailability } from './useThreadAvailability';

export function EditableTitle({ thread }: { thread: ThreadView }) {
  const client = useClient();
  const { unavailable } = useThreadAvailability(thread);
  const tip = useTooltip(thread.title);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const { busy, error, run, clear } = useAction();
  if (!editing) return <><button {...tip.props} className="editable-thread-title" disabled={!!unavailable} title={unavailable ?? "Rename thread"} aria-label={`Rename thread: ${thread.title}`} onClick={() => { setTitle(thread.title); clear(); setEditing(true); }}>{thread.title}</button>{tip.tooltip}</>;
  return <form className="thread-title-form field" onSubmit={event => {
    event.preventDefault();
    if (!unavailable && title.trim()) void run(async () => { await client.call('threads.rename', { threadId: thread.id, title }); setEditing(false); });
  }}>
    <input aria-label="Thread title" autoFocus maxLength={120} value={title} disabled={!!unavailable || busy} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setEditing(false); } }} />
    <small className="title-count" aria-live="polite">{title.length}/120</small>
    <button type="submit" className="ghost" disabled={!!unavailable || busy || !title.trim()}>Save</button>
    <button type="button" className="ghost" disabled={!!unavailable || busy} onClick={() => setEditing(false)}>Cancel</button>
    {error && <span className="error" role="alert">{error}</span>}
  </form>;
}
