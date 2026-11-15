/**
 * Marks a popover with `data-entering` from the moment it starts to open until its rows have
 * risen into place, so `motion.css` staggers the rows of a first open only. A row that mounts
 * while the popover stays open (a search widening, a picker stepping into a project) has no
 * mark to rise under and simply appears. One listener for every popover; no component knows.
 */
const ENTRANCE_MS = 400; // the last row: 140ms delay + 220ms rise, with room to land

const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

export function markPopoverEntrances(doc: Document = document): () => void {
  // beforetoggle fires before the popover is shown, so its first styled frame already carries the mark.
  const onBeforeToggle = (event: Event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement) || !(event instanceof ToggleEvent)) return;
    clearTimeout(timers.get(el));
    if (event.newState !== 'open') { el.removeAttribute('data-entering'); return; }
    el.setAttribute('data-entering', '');
    timers.set(el, setTimeout(() => el.removeAttribute('data-entering'), ENTRANCE_MS));
  };
  // beforetoggle does not bubble; a capturing listener still sees it for every popover.
  doc.addEventListener('beforetoggle', onBeforeToggle, true);
  return () => doc.removeEventListener('beforetoggle', onBeforeToggle, true);
}
