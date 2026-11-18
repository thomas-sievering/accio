import type { ComponentProps, ReactNode } from 'react';

type ButtonProps = ComponentProps<'button'> & {
  /** Its own action is under way: a spinner and `busyLabel`, solid rather than greyed, and no clicks. */
  busy?: boolean;
  /** What it says while busy, as "Saving…". It replaces the children, icon included; without it the children stay. */
  busyLabel?: ReactNode;
};

/**
 * A button whose click waits on something shows that wait itself, as AGENTS.md's "Waiting on an action"
 * asks: with `busy` it keeps its colour, shows a spinner and `busyLabel`, and is disabled. A hand-made
 * `busy ? 'Saving…' : 'Save'` with `disabled` instead fades it, which reads as unavailable rather than
 * working; the lint rule `accio/busy-button` points here. Styles in ui/busy.css.
 */
export function Button({ busy = false, busyLabel, disabled, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button type={type} {...rest} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy && <span className="button-spinner" aria-hidden="true" />}
      {busy && busyLabel !== undefined ? busyLabel : children}
    </button>
  );
}
