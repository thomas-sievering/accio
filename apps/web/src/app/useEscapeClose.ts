import { useEffect } from 'react';

/**
 * Escape closes a page over the thread pane, such as a project dashboard or a space view,
 * unless a popover or modal sheet is open or you are typing: those take Escape first.
 * `first` lets something inside the page, such as the dashboard's issue reader, close
 * before the page does; `enabled: false` leaves Escape alone.
 */
export function useEscapeClose(onClose: () => void, { first = false, enabled = true }: { first?: boolean; enabled?: boolean } = {}) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector(':popover-open, dialog[open]') || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      // Handled first, in the capture phase, so the page's own listener sees it taken.
      if (first) e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, first);
    return () => window.removeEventListener('keydown', onKey, first);
  }, [onClose, first, enabled]);
}
