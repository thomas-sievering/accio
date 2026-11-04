import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './tooltip.css';

/** A visible label for keyboard focus as well as pointer hover, outside scroll clipping. */
let closeCurrent: (() => void) | undefined;
export function useTooltip(text: string, clippedSelector?: string) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const tip = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cancelLeave = () => clearTimeout(leaveTimer.current);
  const hide = useCallback(() => { clearTimeout(leaveTimer.current); setAnchor(null); if (closeCurrent === hide) closeCurrent = undefined; }, []);
  const show = (element: HTMLElement) => {
    const label = clippedSelector ? element.querySelector<HTMLElement>(clippedSelector) : undefined;
    if (clippedSelector && (!label || label.scrollWidth <= label.clientWidth)) return;
    cancelLeave();
    if (closeCurrent !== hide) closeCurrent?.();
    closeCurrent = hide;
    setAnchor(element);
  };
  useEffect(() => () => { clearTimeout(leaveTimer.current); if (closeCurrent === hide) closeCurrent = undefined; }, [hide]);
  useEffect(() => {
    if (!anchor) return;
    const place = () => {
      const box = anchor.getBoundingClientRect();
      const width = tip.current?.offsetWidth ?? 320;
      const height = tip.current?.offsetHeight ?? 48;
      setPosition({
        left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
        top: box.bottom + height + 16 <= window.innerHeight ? box.bottom + 6 : Math.max(8, box.top - height - 6),
      });
    };
    place();
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      hide();
    };
    const scroll = (e: Event) => {
      // Inputs can emit a delayed scroll when blur resets their text offset.
      // Only scrolling an ancestor can move this tooltip's anchor.
      if (e.target === document || e.target === window || (e.target instanceof Element && e.target.contains(anchor))) hide();
    };
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', hide);
    window.addEventListener('scroll', scroll, true);
    return () => {
      cancelLeave();
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [anchor, text]);
  return {
    props: {
      onFocus: (e: React.FocusEvent<HTMLElement>) => show(e.currentTarget),
      onBlur: hide,
      onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(e.currentTarget),
      onMouseLeave: () => {
        if (anchor !== document.activeElement) leaveTimer.current = setTimeout(hide, 100);
      },
      onPointerDown: hide,
    },
    tooltip: anchor && createPortal(
      <div ref={tip} id={id} role="tooltip" className="focus-tooltip" style={position}
        onMouseEnter={cancelLeave} onMouseLeave={hide}>{text}</div>, document.body),
  };
}
