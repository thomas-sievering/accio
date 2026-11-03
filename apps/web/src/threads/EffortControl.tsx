import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { ModelView } from '@accio/protocol';

/** Wheel distance that counts as one step, so a trackpad's many small deltas move one level, not five. */
const WHEEL_STEP = 50;
/** Scrolling settles before the choice is saved, so passing through levels saves only the last. */
const SAVE_AFTER_MS = 400;

const NAMES: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
/** Tick labels under the slider, short enough to fit five or six side by side. */
const SHORT: Record<string, string> = { none: 'None', minimal: 'Min', low: 'Low', medium: 'Med', high: 'High', xhigh: 'XHigh', max: 'Max' };
export const effortName = (id: string) => NAMES[id] ?? id.replace(/^./, (c) => c.toUpperCase());

/**
 * GLOSSARY: Effort. A chip beside the model that shows how hard it thinks as a rising
 * meter. Hover and scroll, or focus and use the arrow keys, to step; click for the list.
 * A step is undefined when it stands for the model's default.
 */
export function EffortControl({ model, value, onChange, disabled = false }: {
  model: ModelView;
  value: string | undefined;
  onChange: (effort: string | undefined) => Promise<void>;
  disabled?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<{ effort: string | undefined }>();
  const [error, setError] = useState<string>();
  const [position, setPosition] = useState<CSSProperties>({});
  const [bump, setBump] = useState(0);
  const wheel = useRef({ distance: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined });

  const levels = model.efforts.map((e) => e.id);
  const fallback = model.defaultEffort && levels.includes(model.defaultEffort) ? model.defaultEffort : undefined;
  // Without a reported default, "Default" is its own step below the lowest level.
  const steps: (string | undefined)[] = fallback ? levels : [undefined, ...levels];
  const shown = pending ? pending.effort : value;
  // The step that stands for the current choice; "no choice" is the default's step.
  const effective = shown ?? fallback;
  const index = steps.indexOf(effective);
  const label = effective ? effortName(effective) : 'Default';
  const filled = effective ? levels.indexOf(effective) + 1 : 0;

  const save = async (effort: string | undefined) => {
    setError(undefined);
    try { await onChange(effort === fallback ? undefined : effort); }
    catch (err) { setError((err as Error).message); }
    finally { setPending(undefined); }
  };
  const step = (by: number) => {
    const at = Math.max(0, index);
    const to = Math.max(0, Math.min(steps.length - 1, at + by));
    if (to === at && index >= 0) return;
    const next = steps[to];
    setPending({ effort: next });
    setBump((n) => n + 1);
    clearTimeout(wheel.current.timer);
    wheel.current.timer = setTimeout(() => void save(next), SAVE_AFTER_MS);
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
      const w = wheel.current;
      w.distance += event.deltaMode === 0 ? event.deltaY : event.deltaY * WHEEL_STEP;
      while (Math.abs(w.distance) >= WHEEL_STEP) {
        stepRef.current(w.distance < 0 ? 1 : -1);
        w.distance -= Math.sign(w.distance) * WHEEL_STEP;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => () => clearTimeout(wheel.current.timer), []);

  /** Dragging previews each level and saves the one it settles on. */
  const slide = (effort: string | undefined) => {
    setPending({ effort });
    clearTimeout(wheel.current.timer);
    wheel.current.timer = setTimeout(() => void save(effort), SAVE_AFTER_MS);
  };

  const tone = toneOf(filled, levels.length);
  return <>
    <button type="button" ref={trigger} className={`effort-trigger tone-${tone}`} popoverTarget={id} disabled={disabled}
      aria-label={`Effort: ${label}. Scroll or use arrow keys to change.`} title={`${label} effort · scroll to change`}
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
      <Meter levels={levels.length} filled={filled} />
      <span key={bump} className={bump ? 'effort-label bumped' : 'effort-label'}>{label}</span>
    </button>
    <div id={id} ref={panel} popover="auto" className={`effort-picker tone-${tone}`} style={position} role="dialog" aria-label="Choose effort"
      onToggle={(event) => { if (event.newState === 'open') requestAnimationFrame(() => panel.current?.querySelector<HTMLInputElement>('input')?.focus()); }}>
      <p className="effort-picker-title"><span>Effort</span><b>{label}</b></p>
      {/* A native range locks into each level and handles keys, touch and screen readers. */}
      <input type="range" min={0} max={steps.length - 1} step={1} value={Math.max(0, index)} aria-label="Effort" aria-valuetext={label}
        style={{ '--at': `${(Math.max(0, index) / Math.max(1, steps.length - 1)) * 100}%` } as CSSProperties}
        onChange={(event) => slide(steps[Number(event.currentTarget.value)])} />
      <span className="effort-ticks" aria-hidden>
        {steps.map((effort, i) => <button type="button" tabIndex={-1} key={effort ?? 'default'} className={i === index ? 'on' : undefined}
          style={{ left: `${(i / Math.max(1, steps.length - 1)) * 100}%` }} onClick={() => slide(effort)}>{effort ? SHORT[effort] ?? effortName(effort) : 'Auto'}</button>)}
      </span>
    </div>
    {error && <span className="error effort-error" role="alert">{error}</span>}
  </>;
}

/** The meter warms as effort rises: the top level stands out, as it costs the most. */
function toneOf(filled: number, levels: number) {
  return filled === 0 ? 'none' : filled === levels && levels > 1 ? 'top' : filled / levels > 0.5 ? 'high' : 'low';
}

function Meter({ levels, filled }: { levels: number; filled: number }) {
  return <span className="effort-meter" aria-hidden>
    {Array.from({ length: levels }, (_, i) => <i key={i} className={i < filled ? 'on' : undefined} style={{ height: `${5 + Math.round((i / Math.max(1, levels - 1)) * 7)}px` }} />)}
  </span>;
}
