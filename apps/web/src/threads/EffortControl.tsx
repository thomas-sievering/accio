import { useLayoutEffect, useRef } from 'react';
import type { ModelView } from '@accio/protocol';
import type { Step } from './steps';

const NAMES: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
export const effortName = (id: string) => NAMES[id] ?? id.replace(/^./, (c) => c.toUpperCase());

/**
 * GLOSSARY: Effort. The levels a model accepts, lowest first. Without a default the
 * model reports, "Auto" is its own step below the lowest and leaves it to the harness;
 * a step's value is undefined when it stands for the model's default.
 */
export function effortSteps(model: ModelView, value: string | undefined) {
  const levels = model.efforts.map((e) => e.id);
  const fallback = model.defaultEffort && levels.includes(model.defaultEffort) ? model.defaultEffort : undefined;
  const ids: (string | undefined)[] = fallback ? levels : [undefined, ...levels];
  const steps: Step<string | undefined>[] = ids.map((id) => ({ value: id === fallback ? undefined : id, label: id ? effortName(id) : 'Auto' }));
  return { steps, index: ids.indexOf(value ?? fallback) };
}

/** A little rolling spring on changes; reserve the labels' width so the chip stays still. */
export function EffortWord({ steps, index }: { steps: Step<string | undefined>[]; index: number }) {
  const label = steps[index]?.label.toLowerCase() ?? 'auto';
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
    {steps.map((step) => <span className="effort-word-size" key={step.label}>{step.label.toLowerCase()}</span>)}
    <span ref={outgoing} className="effort-word-out" />
    <span ref={incoming} className="effort-word-current">{label}</span>
  </span>;
}
