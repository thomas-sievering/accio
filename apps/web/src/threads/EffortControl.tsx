import type { ModelView } from '@accio/protocol';
import { StepChip } from './StepChip';

const NAMES: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };
const SHORT: Record<string, string> = { none: 'None', minimal: 'Min', low: 'Low', medium: 'Med', high: 'High', xhigh: 'XHigh', max: 'Max' };
export const effortName = (id: string) => NAMES[id] ?? id.replace(/^./, (c) => c.toUpperCase());

/**
 * GLOSSARY: Effort. A chip beside the model that shows how hard it thinks as a rising
 * meter. Without a default the model reports, "Auto" is its own step below the lowest
 * level and leaves the choice to the harness. `quiet` shows the meter alone, for when a
 * preset already names the level.
 */
export function EffortControl({ model, value, onChange, disabled = false, quiet = false }: {
  model: ModelView;
  value: string | undefined;
  onChange: (effort: string | undefined) => Promise<void>;
  disabled?: boolean;
  quiet?: boolean;
}) {
  const levels = model.efforts.map((e) => e.id);
  const fallback = model.defaultEffort && levels.includes(model.defaultEffort) ? model.defaultEffort : undefined;
  const values: (string | undefined)[] = fallback ? levels : [undefined, ...levels];
  const steps = values.map((id) => ({ value: id, label: id ? effortName(id) : 'Auto', short: id ? SHORT[id] ?? effortName(id) : 'Auto' }));
  const filledAt = (i: number) => { const id = values[i]; return id ? levels.indexOf(id) + 1 : 0; };
  return <StepChip name="Effort" className={quiet ? 'effort-chip quiet' : 'effort-chip'} steps={steps} index={values.indexOf(value ?? fallback)} disabled={disabled}
    onChange={(effort) => onChange(effort === fallback ? undefined : effort)}
    tone={(i) => toneOf(filledAt(i), levels.length)}
    chip={(i, label) => <><Meter levels={levels.length} filled={filledAt(i)} />{!quiet && <span>{label}</span>}</>} />;
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
