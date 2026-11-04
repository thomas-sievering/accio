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
    const bits = burst(incoming.current, steps.length > 1 ? index / (steps.length - 1) : 1, direction);
    return () => { exit.cancel(); enter.cancel(); bits(); };
  }, [label, index, steps.length]);

  return <span className="effort-word" aria-hidden>
    {steps.map(step => <span className="effort-word-size" key={step.label}>{step.label}</span>)}
    <span ref={outgoing} className="effort-word-out" />
    <span ref={incoming} className="effort-word-current">{label}</span>
  </span>;
}

/**
 * Juice for an effort change: `heat` 0..1 scales the count, spread, size and colour of the particles,
 * from a few grey motes at the lowest level to a saturated rainbow shower at the top.
 * They live on a fixed layer in <body> because the word itself clips its overflow.
 * Returns a cleanup that removes any particles still in flight.
 */
function burst(anchor: HTMLElement, heat: number, direction: number) {
  const box = anchor.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'effort-particles';
  layer.style.left = `${box.left + box.width / 2}px`;
  layer.style.top = `${box.top + box.height / 2}px`;
  document.body.appendChild(layer);
  const count = Math.round(3 + heat * heat * 26);
  const hueStart = Math.random() * 360;
  let alive = count;
  for (let i = 0; i < count; i++) {
    const bit = document.createElement('i');
    const size = 2 + Math.random() * (2 + heat * 5);
    const star = heat > 0.6 && Math.random() < heat - 0.4;
    bit.style.width = bit.style.height = `${star ? size * 1.8 : size}px`;
    if (star) bit.classList.add('star');
    const saturation = 8 + heat * 88;
    const hue = heat > 0.75 ? hueStart + (i / count) * 360 : 220 + heat * 120 + (Math.random() - 0.5) * 50 * heat;
    bit.style.background = `hsl(${hue} ${saturation}% ${62 + heat * 8}%)`;
    if (heat > 0.5) bit.style.boxShadow = `0 0 ${heat * 8}px hsl(${hue} ${saturation}% 65% / ${heat})`;
    layer.appendChild(bit);
    const angle = Math.random() * Math.PI * 2;
    const reach = (10 + Math.random() * 18) * (0.6 + heat * 1.6);
    const dx = Math.cos(angle) * reach * 1.6;
    const dy = Math.sin(angle) * reach - direction * (6 + heat * 12);
    const spin = (Math.random() - 0.5) * 360 * heat;
    bit.animate([
      { transform: 'translate(-50%,-50%) scale(0.4)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${dy * 0.6}px)) scale(1) rotate(${spin / 2}deg)`, opacity: 0.55 + heat * 0.45, offset: 0.3 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 8}px)) scale(0.2) rotate(${spin}deg)`, opacity: 0 },
    ], { duration: 380 + Math.random() * 260 + heat * 260, easing: 'cubic-bezier(.15,.7,.3,1)', delay: Math.random() * 40 * heat })
      .finished.then(() => { bit.remove(); if (--alive === 0) layer.remove(); }, () => {});
  }
  return () => { if (alive > 0) setTimeout(() => layer.remove(), 1000); };
}
