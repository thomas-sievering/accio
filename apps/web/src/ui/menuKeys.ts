import type { KeyboardEvent } from 'react';

const ITEMS = 'button:not(:disabled):not([hidden])';

function itemsOf(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(ITEMS)].filter((el) => el.closest('[role="menu"], .menu') === menu);
}

/** Moves focus into a menu that just opened: the checked item if there is one, else the first. */
export function focusMenuItem(menu: HTMLElement | null) {
  if (!menu) return;
  requestAnimationFrame(() => {
    const items = itemsOf(menu);
    (items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
  });
}

/** Arrow keys and Home/End move between a menu's buttons, wrapping at the ends; Escape is left to the popover. */
export function onMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches(ITEMS)) return;
  const items = itemsOf(event.currentTarget);
  const at = items.indexOf(target);
  if (at < 0) return;
  event.preventDefault();
  event.stopPropagation();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
