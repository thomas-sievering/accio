import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Close } from '../app/icons';

/** A small image grows to about 60% of the window's shorter side, never past four times its size. */
function fittedWidth(image: HTMLImageElement): number | undefined {
  const longest = Math.max(image.naturalWidth, image.naturalHeight);
  if (!longest) return undefined;
  const scale = Math.min(4, Math.max(1, Math.min(window.innerWidth, window.innerHeight) * 0.6 / longest));
  return scale > 1 ? Math.round(image.naturalWidth * scale) : undefined;
}

/** Native modal provides focus trapping, Escape handling and focus return to the image button. */
export function ImageViewer({ source, label, onClose, onOpen, onDownload, onError }: {
  source: string; label: string; onClose: () => void; onOpen: () => void; onDownload: () => void; onError: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [width, setWidth] = useState<number>();
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
      <button aria-label={`Open ${label}`} onClick={onOpen}>Open</button>
      <button aria-label={`Download ${label}`} onClick={onDownload}>Download</button>
      <button className="image-viewer-close" aria-label="Close image viewer" onClick={close} autoFocus><Close /></button>
    </header>
    <img src={source} alt={label} style={width ? { width } : undefined} onLoad={(event) => setWidth(fittedWidth(event.currentTarget))} onError={onError} />
  </dialog>, document.body);
}
