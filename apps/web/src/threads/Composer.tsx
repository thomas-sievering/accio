import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, Close, StopSquare } from '../app/icons';
import { useAppEvent } from '../app/appEvents';
import { useAction } from '../app/useAction';
import { useClient } from '../app/connection';

/**
 * T3 Code's boxed composer: the message on top, a toolbar row with Send (or Stop) below.
 * Enter sends, Shift+Enter adds a line.
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
  draftId = 'new',
}: {
  onSend: (text: string) => Promise<void>;
  /** Set while a turn runs: the send button becomes Stop. */
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
  target?: string;
  draftId?: string;
}) {
  const client = useClient();
  const storageKey = `accio:${client.hubId}:composer:${draftId}`;
  const [text, updateText] = useState(() => sessionStorage.getItem(storageKey) ?? '');
  const setText = (value: string) => { updateText(value); if (value) sessionStorage.setItem(storageKey, value); else sessionStorage.removeItem(storageKey); };
  const { busy, error, run } = useAction();
  const sending = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);

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

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const value = text.trim();
    if ((!value && !attachment) || disabled || sending.current) return;
    sending.current = true;
    try {
      await run(async () => {
        await onSend(value);
        setText('');
      });
    } finally {
      sending.current = false;
    }
  };

  return (
    <div className="composer-wrap">
      {actions}
      {error && <p className="error composer-error">{error}</p>}
      <form className="composer" onSubmit={submit}>
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
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer-bar">
          {toolbar}
          {onStop ? (
            <button
              type="button"
              className="send stop"
              title="Stop"
              aria-label="Stop"
              onClick={() => void run(onStop)}
            >
              <StopSquare />
            </button>
          ) : (
            <button type="submit" className="send" title="Send" aria-label="Send" disabled={disabled || busy || (!text.trim() && !attachment)}>
              <ArrowUp />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
