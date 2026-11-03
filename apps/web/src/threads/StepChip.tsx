import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Wheel distance that counts as one step, so a trackpad's many small deltas move one level, not five. */
const WHEEL_STEP = 50;
/** Scrolling or dragging settles before the choice is saved, so passing through levels saves only the last. */
const SAVE_AFTER_MS = 400;

export type Step<T> = {
  value: T;
  /** Shown on the chip and read out, such as "Extra high". */
  label: string;
  /** Under the slider, short enough to fit five or six side by side, such as "XHigh". */
  short: string;
  /** Why it cannot be chosen now; scrolling passes over it. */
  unavailable?: string;
};

/**
 * A chip for one of a few ordered levels. Hover and scroll, or focus and use the arrow
 * keys, to step; click for a slider that locks into each level. A level is saved once
 * the scrolling or dragging settles.
 */
export function StepChip<T>({ name, steps, index, onChange, disabled = false, tone, chip, detail, className = '' }: {
  name: string;
  steps: Step<T>[];
  /** The current level; -1 when the current choice matches none. */
  index: number;
  onChange: (value: T) => Promise<void>;
  disabled?: boolean;
  tone: (index: number) => string;
  /** The chip's content for the level shown, or -1. */
  chip: (index: number, label: string) => ReactNode;
  /** A line under the slider about the level shown. */
  detail?: (index: number) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<number>();
  const [error, setError] = useState<string>();
  const [position, setPosition] = useState<CSSProperties>({});
  const [bump, setBump] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const distance = useRef(0);

  const shown = pending ?? index;
  const label = steps[shown]?.label ?? 'Custom';

  const settle = (to: number) => {
    setPending(to);
    setError(undefined);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const step = steps[to];
      // An unavailable level can be looked at on the slider but not chosen.
      if (!step || step.unavailable || to === index) { setPending(undefined); return; }
      try { await onChange(step.value); }
      catch (err) { setError((err as Error).message); }
      finally { setPending(undefined); }
    }, SAVE_AFTER_MS);
  };
  const step = (by: number) => {
    let to = shown < 0 ? (by > 0 ? -1 : steps.length) : shown;
    do to += by; while (steps[to]?.unavailable);
    if (to < 0 || to >= steps.length) return;
    setBump((n) => n + 1);
    settle(to);
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  // React's onWheel is passive, so the page would scroll too; listen directly instead.
  useEffect(() => {
    const el = trigger.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (el.disabled) return;
      event.preventDefault();
      distance.current += event.deltaMode === 0 ? event.deltaY : event.deltaY * WHEEL_STEP;
      while (Math.abs(distance.current) >= WHEEL_STEP) {
        stepRef.current(distance.current < 0 ? 1 : -1);
        distance.current -= Math.sign(distance.current) * WHEEL_STEP;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const at = (i: number) => `${(i / Math.max(1, steps.length - 1)) * 100}%`;
  return <>
    <button type="button" ref={trigger} className={`step-chip ${className} tone-${tone(shown)}`} popoverTarget={id} disabled={disabled}
      aria-label={`${name}: ${label}. Scroll or use arrow keys to change.`} title={`${name}: ${label} · scroll to change`}
      onKeyDown={(event) => {
        if (['ArrowUp', 'ArrowRight'].includes(event.key)) { event.preventDefault(); step(1); }
        if (['ArrowDown', 'ArrowLeft'].includes(event.key)) { event.preventDefault(); step(-1); }
      }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const width = 260;
        const above = rect.top >= window.innerHeight - rect.bottom;
        setPosition({ width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
          ...(above ? { bottom: window.innerHeight - rect.top + 8, top: 'auto' } : { top: rect.bottom + 8, bottom: 'auto' }) });
      }}>
      <span key={bump} className={bump ? 'step-chip-content bumped' : 'step-chip-content'}>{chip(shown, label)}</span>
    </button>
    <div id={id} ref={panel} popover="auto" className={`step-picker tone-${tone(shown)}`} style={position} role="dialog" aria-label={`Choose ${name.toLowerCase()}`}
      onToggle={(event) => { if (event.newState === 'open') requestAnimationFrame(() => panel.current?.querySelector<HTMLInputElement>('input')?.focus()); }}>
      <p className="step-picker-title"><span>{name}</span><b>{label}</b></p>
      {/* A native range locks into each level and handles keys, touch and screen readers. */}
      <input type="range" min={0} max={steps.length - 1} step={1} value={Math.max(0, shown)} aria-label={name} aria-valuetext={label}
        style={{ '--at': at(Math.max(0, shown)) } as CSSProperties}
        onChange={(event) => settle(Number(event.currentTarget.value))} />
      <span className="step-ticks" aria-hidden>
        {steps.map((s, i) => <button type="button" tabIndex={-1} key={i} className={[i === shown && 'on', s.unavailable && 'unavailable'].filter(Boolean).join(' ') || undefined}
          style={{ left: at(i) }} onClick={() => settle(i)}>{s.short}</button>)}
      </span>
      {(detail || steps[shown]?.unavailable) && <p className={steps[shown]?.unavailable ? 'step-picker-detail unavailable' : 'step-picker-detail'}>
        {steps[shown]?.unavailable ?? detail?.(shown)}
      </p>}
    </div>
    {error && <span className="error step-error" role="alert">{error}</span>}
  </>;
}
