import { useEffect, useRef, useState, type RefObject } from 'react';

/** Wheel distance that counts as one step, so a trackpad's many small deltas move one level, not five. */
const WHEEL_STEP = 50;
/** Scrolling or dragging settles before the choice is saved, so passing through levels saves only the last. */
const SAVE_AFTER_MS = 400;

export type Step<T> = {
  value: T;
  /** Read out and shown in the chip's tooltip, such as "Extra high". */
  label: string;
  /** Why it cannot be chosen now; stepping passes over it. */
  unavailable?: string;
};

/**
 * A few ordered levels that preview at once and save once scrolling settles. `index` is the current level, or -1 when the current choice matches none.
 */
export function useSteps<T>(steps: Step<T>[], index: number, onChange: (value: T) => Promise<void>, onError: (message: string | undefined) => void) {
  const [pending, setPending] = useState<number>();
  const [bump, setBump] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const shown = pending ?? index;

  const settle = (to: number) => {
    setPending(to);
    onError(undefined);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const step = steps[to];
      // An unavailable level can be looked at on the slider but not chosen.
      if (!step || step.unavailable || to === index) { setPending(undefined); return; }
      try { await onChange(step.value); }
      catch (err) { onError((err as Error).message); }
      finally { setPending(undefined); }
    }, SAVE_AFTER_MS);
  };
  /** One level up or down, passing over unavailable ones; from no level, up starts at the lowest. */
  const step = (by: number) => {
    let to = shown < 0 ? (by > 0 ? -1 : steps.length) : shown;
    do to += by; while (steps[to]?.unavailable);
    if (to < 0 || to >= steps.length) return;
    setBump((n) => n + 1);
    settle(to);
  };
  return { shown, settle, step, bump };
}

/** Steps on the mouse wheel over `target`. React's onWheel is passive, so the page would scroll too; this listens directly. */
export function useWheelSteps(target: RefObject<HTMLElement | null>, step: (by: number) => void) {
  const latest = useRef(step);
  latest.current = step;
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    let distance = 0;
    const onWheel = (event: WheelEvent) => {
      if ((el as HTMLButtonElement).disabled) return;
      event.preventDefault();
      distance += event.deltaMode === 0 ? event.deltaY : event.deltaY * WHEEL_STEP;
      while (Math.abs(distance) >= WHEEL_STEP) {
        latest.current(distance < 0 ? 1 : -1);
        distance -= Math.sign(distance) * WHEEL_STEP;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [target]);
}

