import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Close } from '../app/icons';

/** Native modal provides focus trapping, Escape handling and focus return to the image button. */
export function ImageViewer({ source, label, onClose, onOpen, onDownload, onError }: {
  source: string; label: string; onClose: () => void; onOpen: () => void; onDownload: () => void; onError: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const close = () => {
    // Close while connected so the browser restores the opener before React removes the modal.
    dialog.current?.close();
    onClose();
  };
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return createPortal(<dialog ref={dialog} className="image-viewer" aria-labelledby={title}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <header>
      <h2 id={title}>{label}</h2>
      <button onClick={onOpen}>Open</button>
      <button onClick={onDownload}>Download</button>
      <button className="image-viewer-close" aria-label="Close image viewer" onClick={close} autoFocus><Close /></button>
    </header>
    <img src={source} alt={label} onError={onError} />
  </dialog>, document.body);
}
