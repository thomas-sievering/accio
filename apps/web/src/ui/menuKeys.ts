import type { KeyboardEvent } from 'react';

/** What the keys move between unless a menu names its own items: its enabled buttons. */
export const MENU_ITEMS = 'button';

const TEXT_FIELDS = 'textarea, select, [contenteditable]:not([contenteditable="false"]), input:not([type="button"], [type="checkbox"], [type="radio"], [type="submit"], [type="reset"])';

/** A popover's own items: enabled, shown and not inside a popover nested in it. */
function itemsOf(popover: HTMLElement, selector: string): HTMLElement[] {
  return [...popover.querySelectorAll<HTMLElement>(selector)]
    .filter((el) => !el.matches(':disabled, [hidden]') && el.closest('[popover]') === popover);
}

/** Moves focus into a popover that just opened: its checked item if there is one, else its first. */
export function focusMenuItem(popover: HTMLElement | null, selector = MENU_ITEMS) {
  if (!popover) return;
  requestAnimationFrame(() => {
    const items = itemsOf(popover, selector);
    (items.find((el) => el.matches('[aria-checked="true"], [aria-pressed="true"]')) ?? items[0])?.focus();
  });
}

/**
 * Arrow keys and Home/End move between a popover's items, wrapping at the ends. From anywhere
 * else in the popover, Down and Home go to the first item and Up and End to the last. Text
 * fields keep their keys, and Escape is left to the popover.
 */
export function onMenuKeyDown(event: KeyboardEvent<HTMLElement>, selector = MENU_ITEMS) {
  if (event.defaultPrevented || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const popover = event.currentTarget;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target.matches(TEXT_FIELDS) || target.closest('[popover]') !== popover) return;
  const items = itemsOf(popover, selector);
  if (!items.length) return;
  event.preventDefault();
  event.stopPropagation();
  const at = items.indexOf(target);
  const last = items.length - 1;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? last
    : event.key === 'ArrowDown' ? (at < 0 ? 0 : (at + 1) % items.length)
    : at < 0 ? last : (at - 1 + items.length) % items.length;
  items[next]?.focus();
}
