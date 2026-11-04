import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Close } from './icons';

/**
 * A modal sheet (botbot's <dialog> sheet). Rendered only while open.
 * `guard` runs before Escape, the close button or a click outside closes it; returning true keeps the sheet open (the owner asks first).
 */
export function Sheet({ title, onClose, guard, children }: { title: string; onClose: () => void; guard?: () => boolean; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const requestClose = () => {
    if (!guard?.()) ref.current?.close();
  };
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      d.showModal();
      // React's autoFocus runs before the dialog opens, so a sheet names its first field here.
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
  }, []);
  return (
    <dialog
      className="sheet"
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        if (!guard) return;
        e.preventDefault();
        requestClose();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !guard || e.defaultPrevented) return;
        e.preventDefault();
        requestClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) requestClose();
      }}
    >
      <header className="sheet-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="side-icon" aria-label="Close" onClick={requestClose}>
          <Close />
        </button>
      </header>
      {children}
    </dialog>
  );
}
