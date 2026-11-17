import { useRef, type KeyboardEvent, type ToggleEvent } from 'react';
import { focusMenuItem, MENU_ITEMS, menuItemToFocus, onMenuKeyDown } from './menuKeys';

/** Where a popover opens against its trigger (or a point, for a right-click menu). */
export type Placement = {
  /** Its width, narrowed to fit the window. */
  width: number;
  /** The side it opens on while it fits there, or while that side has the more room. */
  side: 'above' | 'below';
  /** About the height it needs on its side: with less room there, it flips to a roomier side. */
  height: number;
  /** Space between the trigger and the popover. */
  gap?: number;
  /** The closest it comes to the window's edges. */
  margin?: number;
  /** How far its left edge sits from the trigger's. */
  shift?: number;
  /** Its own height from the room on its side; without it, the room caps its height. */
  fill?: (room: number) => number;
};

export type Box = { left: number; top: number; bottom: number };
export type Placed = { left: number; width: number; top?: number; bottom?: number; height?: number; maxHeight?: number };

/** The popover's fixed position for a trigger's box in a window of the given size. */
export function placePopover(box: Box, placement: Placement, view: { width: number; height: number }): Placed {
  const { side, height, gap = 6, margin = 12, shift = 0, fill } = placement;
  const space = { above: box.top, below: view.height - box.bottom };
  const other = side === 'above' ? 'below' : 'above';
  const stays = space[side] - gap - margin >= height || space[side] >= space[other];
  const on = stays ? side : other;
  const room = Math.max(0, space[on] - gap - margin);
  const width = Math.min(placement.width, view.width - 2 * margin);
  const left = Math.max(margin, Math.min(box.left + shift, view.width - width - margin));
  return {
    left, width,
    ...(on === 'below' ? { top: box.bottom + gap } : { bottom: view.height - box.top + gap }),
    ...(fill ? { height: fill(room) } : { maxHeight: room }),
  };
}

type Point = { x: number; y: number };

/**
 * One popover menu or picker: where it opens, where focus goes as it opens, and the arrow,
 * Home and End keys between its items. Spread `props` on the popover and put `trigger` on the
 * button that opens it. Without `placement`, CSS anchor positioning places it (`ui/menu.css`).
 * CSS owns how it opens and closes (`ui/motion.css`).
 */
export function usePopoverMenu<P extends HTMLElement = HTMLDivElement>({ placement, at, items = MENU_ITEMS, focus, escapeToTrigger, onToggle, onKeyDown }: {
  placement?: Placement;
  /** Opens at this point instead of against the trigger. */
  at?: Point;
  /** The elements the keys move between and the checked or first of which takes focus. */
  items?: string;
  /** Takes focus as it opens instead of an item. */
  focus?: () => HTMLElement | null | undefined;
  /** Escape closes it and hands focus back to its trigger, wherever focus was before it opened. */
  escapeToTrigger?: boolean;
  onToggle?: (open: boolean) => void;
  /** Keys of its own, handled before the shared ones; prevent a key's default to keep it. */
  onKeyDown?: (event: KeyboardEvent<P>) => void;
}) {
  const popover = useRef<P>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusItem = () => focusMenuItem(popover.current, items);
  const props = {
    ref: popover,
    'data-placed': placement ? '' : undefined,
    // Placed before it shows, so its first frame is already in place.
    onBeforeToggle: (event: ToggleEvent<P>) => {
      if (event.newState !== 'open' || !placement) return;
      const box = at ? { left: at.x, top: at.y, bottom: at.y } : trigger.current?.getBoundingClientRect();
      if (!box) return;
      const placed = placePopover(box, placement, { width: window.innerWidth, height: window.innerHeight });
      const style = event.currentTarget.style;
      for (const key of ['left', 'width', 'top', 'bottom', 'height', 'maxHeight'] as const) {
        const value = placed[key];
        style[key] = value === undefined ? (key === 'top' || key === 'bottom' ? 'auto' : '') : `${value}px`;
      }
    },
    onToggle: (event: ToggleEvent<P>) => {
      const open = event.newState === 'open';
      onToggle?.(open);
      if (!open) return;
      // Once its content has rendered, unless it has closed again or focus is already inside it
      // (an item clicked first must keep what it did, such as a rename field it opened).
      requestAnimationFrame(() => {
        const el = popover.current;
        if (!el?.matches(':popover-open') || el.contains(document.activeElement)) return;
        (focus ? focus() : menuItemToFocus(el, items))?.focus();
      });
    },
    onKeyDown: (event: KeyboardEvent<P>) => {
      onKeyDown?.(event);
      if (escapeToTrigger && event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        popover.current?.hidePopover();
        trigger.current?.focus();
        return;
      }
      onMenuKeyDown(event, items);
    },
  };
  return { props, trigger, popover, focusItem };
}
