import { useEffect } from 'react';

/**
 * Escape closes a page over the thread pane, such as a project dashboard or a space view,
 * unless a popover is open or you are typing: those take Escape first.
 */
export function useEscapeClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector(':popover-open') && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}
