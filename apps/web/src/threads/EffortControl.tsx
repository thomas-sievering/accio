import { useLayoutEffect, useRef } from 'react';
import { fallbackEffort, type ModelView } from '@accio/protocol';
import type { Step } from './steps';

const NAMES: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const effortName = (id: string) => NAMES[id] ?? id.replace(/^./, (c) => c.toUpperCase());

/**
 * GLOSSARY: Effort. The levels a model accepts, lowest first. There is no "auto" step:
 * an unchosen effort shows the fallback level the turn will actually run at.
 */
export function effortSteps(model: ModelView, value: string | undefined) {
  const levels = model.efforts.map((e) => e.id);
  const steps: Step<string>[] = levels.map((id) => ({ value: id, label: effortName(id) }));
  const chosen = value && levels.includes(value) ? value : fallbackEffort(model);
  return { steps, index: chosen ? levels.indexOf(chosen) : -1 };
}

/** A little rolling spring on changes; every label is laid out underneath so the chip never changes width. */
export function EffortWord({ steps, index }: { steps: Step<string>[]; index: number }) {
  const label = steps[index]?.label ?? '';
  const incoming = useRef<HTMLSpanElement>(null);
  const outgoing = useRef<HTMLSpanElement>(null);
  const previous = useRef({ label, index });

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { label, index };
    if (before.label === label || !incoming.current || !outgoing.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const direction = index > before.index ? 1 : -1;
    outgoing.current.textContent = before.label;
    const exit = outgoing.current.animate([
      { transform: 'translateY(0)', opacity: 1 },
      { transform: `translateY(${-direction * 16}px) scale(0.9)`, opacity: 0 },
    ], { duration: 180, easing: 'cubic-bezier(.4,0,1,1)' });
    const enter = incoming.current.animate([
      { transform: `translateY(${direction * 16}px) scale(.86,1.12)`, opacity: 0, offset: 0 },
      { transform: `translateY(${-direction * 3}px) scale(1.08,.94)`, opacity: 1, offset: 0.55 },
      { transform: `translateY(${direction}px) scale(.98,1.02)`, offset: 0.78 },
      { transform: 'translateY(0) scale(1)', opacity: 1, offset: 1 },
    ], { duration: 360, easing: 'cubic-bezier(.2,.7,.3,1)' });
    return () => { exit.cancel(); enter.cancel(); };
  }, [label, index]);

  return <span className="effort-word" aria-hidden>
    {steps.map(step => <span className="effort-word-size" key={step.label}>{step.label}</span>)}
    <span ref={outgoing} className="effort-word-out" />
    <span ref={incoming} className="effort-word-current">{label}</span>
  </span>;
}
