import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, Close, Queue, StopSquare } from '../app/icons';
import { useAppEvent } from '../app/appEvents';
import { useAction } from '../app/useAction';
import { useClient } from '../app/connection';
import { useThreads } from './threads';

/**
 * Enter steers the running turn; Ctrl+Enter queues. Shift+Enter adds a line.
 */
export function Composer({
  onSend,
  onStop,
  disabled,
  placeholder,
  toolbar,
  attachment,
  actions,
  target,
  draftId,
}: {
  onSend: (text: string, mode?: 'steer' | 'queue') => Promise<void>;
  /** Set while a turn runs; Stop stays beside Send. */
  onStop?: () => Promise<void>;
  disabled: boolean;
  placeholder: string;
  /** Shown left of the send button. */
  toolbar?: ReactNode;
  /** A chip above the message, such as a picked option; with one, the message may be empty. */
  attachment?: { label: string; onRemove: () => void };
  /** Compact thread delivery controls, outside the message input. */
  actions?: ReactNode;
  /** Which `composer.insert` requests this composer accepts: its thread id, or 'draft'. */
  target: string;
  draftId: string;
}) {
  const client = useClient();
  const { threads, select } = useThreads();
  const storageKey = `accio:${client.hubId}:composer:${draftId}`;
  const [text, updateText] = useState(() => sessionStorage.getItem(storageKey) ?? '');
  const setText = (value: string) => { updateText(value); if (value) sessionStorage.setItem(storageKey, value); else sessionStorage.removeItem(storageKey); };
  const [controlHeld, setControlHeld] = useState(false);
  const { busy, error, run } = useAction();
  const sending = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const queuing = !!onStop && controlHeld;
  const sendable = !!text.trim() || !!attachment;
  const repairThread = error?.includes('A repair thread was started')
    ? threads?.filter((t) => t.repairToolId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;

  useEffect(() => {
    const modifier = (e: KeyboardEvent) => setControlHeld(e.ctrlKey || e.metaKey);
    const reset = () => setControlHeld(false);
    window.addEventListener('keydown', modifier);
    window.addEventListener('keyup', modifier);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.removeEventListener('keydown', modifier);
      window.removeEventListener('keyup', modifier);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, []);

  // Text another pane hands over (such as a skill reference) goes in at the cursor, without replacing the message.
  useAppEvent('composer.insert', ({ target: to, text: insert }) => {
    const el = input.current;
    if (!target || to !== target || !el) return;
    // A textarea keeps its selection while unfocused.
    const before = text.slice(0, el.selectionStart);
    const after = text.slice(el.selectionEnd);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const trail = after && !/^\s/.test(after) ? ' ' : '';
    const next = before + lead + insert + trail + after;
    const end = (before + lead + insert + trail).length;
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(end, end); });
  });

  // Picking an option is the start of a message: put the cursor there.
  useEffect(() => { if (attachment) input.current?.focus(); }, [attachment?.label]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const submit = async (mode: 'steer' | 'queue' = 'steer') => {
    const value = text.trim();
    if ((!value && !attachment) || disabled || sending.current) return;
    sending.current = true;
    try {
      await run(async () => {
        await onSend(value, mode);
        if (input.current?.value === text) setText('');
      });
    } finally {
      sending.current = false;
    }
  };

  return (
    <div className="composer-wrap">
      {actions}
      {error && <p className="error composer-error">{error}
        {/* A send refused for a broken tool points at the repair already under way. */}
        {repairThread && <button type="button" className="link" onClick={() => select(repairThread.id)}>Open repair thread</button>}
      </p>}
      <form className="composer" onSubmit={(e: FormEvent) => { e.preventDefault(); void submit(queuing ? 'queue' : 'steer'); }}>
        {attachment && <div className="composer-chips">
          <span className="composer-chip">
            {attachment.label}
            <button type="button" aria-label={`Remove ${attachment.label}`} onClick={attachment.onRemove}><Close /></button>
          </span>
        </div>}
        <textarea
          ref={input}
          rows={1}
          value={text}
          placeholder={placeholder}
          spellCheck={false}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              if (!e.repeat) void submit(onStop && (e.ctrlKey || e.metaKey) ? 'queue' : 'steer');
            }
          }}
        />
        <div className="composer-bar">
          {toolbar}
          {onStop && sendable && <button type="button" className="composer-queue" title="Queue for after this turn (Ctrl+Enter)" disabled={disabled || busy} onClick={() => void submit('queue')}>Queue <kbd>Ctrl ↵</kbd></button>}
          {onStop && (
            <button
              type="button"
              className="send stop"
              title="Stop"
              aria-label="Stop"
              onClick={() => void run(onStop)}
            >
              <StopSquare />
            </button>
          )}
          <button type="submit" className={`send${queuing ? ' queue' : ''}`} title={queuing ? 'Queue message (Ctrl+Enter)' : onStop ? 'Send into current turn (Enter). Ctrl+Enter to queue.' : 'Send'} aria-label={queuing ? 'Queue message' : 'Send'} disabled={disabled || busy || !sendable}
            onClick={e => { e.preventDefault(); void submit(onStop && (e.ctrlKey || e.metaKey) ? 'queue' : 'steer'); }}>
            {queuing ? <Queue /> : <ArrowUp />}
          </button>
        </div>
      </form>
    </div>
  );
}
