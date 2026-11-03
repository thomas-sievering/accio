import { useId, type ReactNode } from 'react';

type Props = { id: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string };

/**
 * A labelled input whose error and hint describe it without becoming part of
 * its accessible name.
 */
export function Field({ label, error, hint, className = '', children }: { label: string; error?: string | false; hint?: ReactNode; className?: string; children: (props: Props) => ReactNode }) {
  const id = useId();
  const described = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': described })}
      {error && <small className="error" id={`${id}-error`}>{error}</small>}
      {hint && <small className="hint" id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
