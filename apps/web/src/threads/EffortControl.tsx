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
  const filled = (i: number) => { const id = ids[i]; return id ? levels.indexOf(id) + 1 : 0; };
  return { steps, index: ids.indexOf(value ?? fallback), levels: levels.length, filled, tone: (i: number) => toneOf(filled(i), levels.length) };
}

/** The meter warms as effort rises: the top level stands out, as it costs the most. */
function toneOf(filled: number, levels: number) {
  return filled === 0 ? 'none' : filled === levels && levels > 1 ? 'top' : filled / levels > 0.5 ? 'high' : 'low';
}

export function Meter({ levels, filled }: { levels: number; filled: number }) {
  return <span className="effort-meter" aria-hidden>
    {Array.from({ length: levels }, (_, i) => <i key={i} className={i < filled ? 'on' : undefined} style={{ height: `${5 + Math.round((i / Math.max(1, levels - 1)) * 7)}px` }} />)}
  </span>;
}
