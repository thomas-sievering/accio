import { useState, type KeyboardEvent, type PointerEvent } from 'react';

type Column = { key: string; cssVar: string; label: string; initial: number; min: number; max: number; side: 'left' | 'right' };

/**
 * A resizable column. Its width lives in one CSS variable on the root, so every
 * layout that shows the column shares it. Returns the column's drag handle:
 * double-click resets it, arrow keys nudge it.
 */
function resizable(column: Column) {
  const clamp = (w: number) => Math.round(Math.min(column.max, Math.max(column.min, w)));
  const stored = Number(localStorage.getItem(column.key));
  let current = Number.isFinite(stored) && stored > 0 ? clamp(stored) : column.initial;
  const apply = (width: number, save: boolean) => {
    current = clamp(width);
    document.documentElement.style.setProperty(column.cssVar, `${current}px`);
    if (save) localStorage.setItem(column.key, String(current));
  };
  apply(current, false);
  // A right-hand column grows as its handle moves left.
  const sign = column.side === 'left' ? 1 : -1;

  return function Resizer() {
    const [width, setWidth] = useState(current);
    const set = (w: number, save: boolean) => { apply(w, save); setWidth(current); };

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startW = current;
      document.body.classList.add('resizing');
      const move = (e: globalThis.PointerEvent) => set(startW + sign * (e.clientX - startX), false);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing');
        set(current, true);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      const step = (event.shiftKey ? 48 : 16) * sign;
      const next = event.key === 'ArrowLeft' ? current - step : event.key === 'ArrowRight' ? current + step
        : event.key === 'Home' ? column.min : event.key === 'End' ? column.max : undefined;
      if (next === undefined) return;
      event.preventDefault();
      set(next, true);
    };

    return (
      <div className={`resizer resizer-${column.side}`} role="separator" aria-orientation="vertical" aria-label={column.label}
        aria-valuemin={column.min} aria-valuemax={column.max} aria-valuenow={width} tabIndex={0} title="Drag to resize · double-click to reset"
        onPointerDown={onPointerDown} onKeyDown={onKeyDown} onDoubleClick={() => set(column.initial, true)} />
    );
  };
}

export const SidebarResizer = resizable({ key: 'accio.sidebarWidth', cssVar: '--sidebar-w', label: 'Resize sidebar', initial: 272, min: 200, max: 480, side: 'left' });
export const PanelResizer = resizable({ key: 'accio.panelWidth', cssVar: '--panel-w', label: 'Resize side panel', initial: 320, min: 240, max: 640, side: 'right' });
