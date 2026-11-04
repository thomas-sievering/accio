import { flushSync } from 'react-dom';

let playing: Promise<unknown> = Promise.resolve();

/**
 * Applies a React state change as a view transition of the given type, so the
 * elements named in CSS move to their new place instead of jumping there.
 * A second change waits for the first to land: starting one cuts the other short.
 * Without the API, or with reduced motion, the change applies at once.
 */
export async function viewTransition(type: string, update: () => void): Promise<void> {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  const before = playing;
  let done!: () => void;
  playing = new Promise<void>((resolve) => { done = resolve; });
  await before;
  try {
    const transition = document.startViewTransition({ update: () => flushSync(update), types: [type] });
    await transition.updateCallbackDone;
    void transition.finished.finally(done);
  } catch (error) {
    done();
    throw error;
  }
}
