import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, StopSquare } from '../app/icons';

/** botbot's pill composer. Enter sends, Shift+Enter adds a line. */
export function Composer({
  onSend,
  onStop,
  disabled,
  placeholder,
}: {
  onSend: (text: string) => Promise<void>;
  /** Set while a turn runs: the send button becomes Stop. */
  onStop?: () => Promise<void>;
  disabled: boolean;
  placeholder: string;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
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
    if (!value || disabled) return;
    setError(undefined);
    try {
      await onSend(value);
      setText('');
    } catch (err) {
      setError((err as Error).message);
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
        {onStop ? (
          <button
            type="button"
            className="send stop"
            title="Stop"
            aria-label="Stop"
            onClick={() => onStop().catch((e: Error) => setError(e.message))}
          >
            <StopSquare />
          </button>
        ) : (
          <button type="submit" className="send" title="Send" aria-label="Send" disabled={disabled || !text.trim()}>
            <ArrowUp />
          </button>
        )}
      </form>
    </div>
  );
}
