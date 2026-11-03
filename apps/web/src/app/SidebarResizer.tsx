import { useState, type KeyboardEvent, type PointerEvent } from 'react';

const KEY = 'accio.sidebarWidth';
const DEFAULT = 272;
const MIN = 200;
const MAX = 480;

const clamp = (w: number) => Math.round(Math.min(MAX, Math.max(MIN, w)));
const stored = Number(localStorage.getItem(KEY));
let current = Number.isFinite(stored) && stored > 0 ? clamp(stored) : DEFAULT;

/** The width lives in one CSS variable on the root, so the threads and Settings layouts share it. */
function apply(width: number, save: boolean) {
  current = clamp(width);
  document.documentElement.style.setProperty('--sidebar-w', `${current}px`);
  if (save) localStorage.setItem(KEY, String(current));
}
apply(current, false);

/** A drag handle on the sidebar's right edge. Double-click resets; arrow keys nudge. */
export function SidebarResizer() {
  const [width, setWidth] = useState(current);
  const set = (w: number, save: boolean) => { apply(w, save); setWidth(current); };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startW = current;
    document.body.classList.add('resizing-sidebar');
    const move = (e: globalThis.PointerEvent) => set(startW + e.clientX - startX, false);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing-sidebar');
      set(current, true);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const next = event.key === 'ArrowLeft' ? current - step : event.key === 'ArrowRight' ? current + step
      : event.key === 'Home' ? MIN : event.key === 'End' ? MAX : undefined;
    if (next === undefined) return;
    event.preventDefault();
    set(next, true);
  };

  return (
    <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar"
      aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={width} tabIndex={0} title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown} onKeyDown={onKeyDown} onDoubleClick={() => set(DEFAULT, true)} />
  );
}
