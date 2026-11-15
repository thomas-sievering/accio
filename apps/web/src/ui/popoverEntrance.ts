/**
 * Marks a popover with `data-entering` while it opens, so `motion.css` gives its rows a starting
 * style (below and transparent) only then. The mark goes once the popover has painted: the rows
 * that opened with it have started their rise, and a row that mounts later (a search widening, a
 * picker stepping into a project) has no starting style and simply appears. One listener for every
 * popover; no component knows.
 */
const frames = new WeakMap<Element, number>();

export function markPopoverEntrances(doc: Document = document): () => void {
  const view = doc.defaultView ?? window;
  const clear = (el: HTMLElement) => {
    view.cancelAnimationFrame(frames.get(el) ?? 0);
    el.removeAttribute('data-entering');
  };
  // beforetoggle fires before the popover is shown, so its first styled frame already carries the mark.
  const onBeforeToggle = (event: Event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement) || !(event instanceof ToggleEvent)) return;
    clear(el);
    if (event.newState === 'open') el.setAttribute('data-entering', '');
  };
  // toggle fires after the popover is shown. Two frames later the opening rows have been styled,
  // including those React renders in response to the open.
  const onToggle = (event: Event) => {
    const el = event.target;
    if (!(el instanceof HTMLElement) || !(event instanceof ToggleEvent) || event.newState !== 'open') return;
    frames.set(el, view.requestAnimationFrame(() => frames.set(el, view.requestAnimationFrame(() => clear(el)))));
  };
  // Neither event bubbles; capturing listeners still see them for every popover.
  doc.addEventListener('beforetoggle', onBeforeToggle, true);
  doc.addEventListener('toggle', onToggle, true);
  return () => {
    doc.removeEventListener('beforetoggle', onBeforeToggle, true);
    doc.removeEventListener('toggle', onToggle, true);
  };
}
