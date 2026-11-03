import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, StopSquare } from '../app/icons';
import { useAction } from '../app/useAction';

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
}: {
  onSend: (text: string) => Promise<void>;
  /** Set while a turn runs: the send button becomes Stop. */
  onStop?: () => Promise<void>;
  disabled: boolean;
  placeholder: string;
  /** Shown left of the send button. */
  toolbar?: ReactNode;
}) {
  const [text, setText] = useState('');
  const { busy, error, run } = useAction();
  const sending = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || disabled || sending.current) return;
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
      {error && <p className="error composer-error">{error}</p>}
      <form className="composer" onSubmit={submit}>
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
            <button type="submit" className="send" title="Send" aria-label="Send" disabled={disabled || busy || !text.trim()}>
              <ArrowUp />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
