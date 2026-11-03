import { useEffect, useRef, type ReactNode } from 'react';
import { Close } from './icons';

/** A modal sheet (botbot's <dialog> sheet). Rendered only while open. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      className="sheet"
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current.close();
      }}
    >
      <header className="sheet-head">
        <h2>{title}</h2>
        <button type="button" className="side-icon" aria-label="Close" onClick={() => ref.current?.close()}>
          <Close />
        </button>
      </header>
      {children}
    </dialog>
  );
}
