import type { ModelSelection, ModelView, PresetLevel, PresetView, UsedUpLimit } from '@accio/protocol';
import { effortName } from './EffortControl';
import { StepChip } from './StepChip';

const NAMES: Record<PresetLevel, [label: string, short: string]> = { low: ['Low', 'Low'], medium: ['Medium', 'Med'], high: ['High', 'High'], ultra: ['Ultra', 'Ultra'] };

/** Whether a choice is what the preset stands for; an effort left open counts as the model's default. */
export function isPreset(preset: PresetView, value: ModelSelection, models: ModelView[]) {
  if (preset.model.harnessId !== value.harnessId || preset.model.modelId !== value.modelId) return false;
  const fallback = models.find((m) => m.harnessId === value.harnessId && m.id === value.modelId)?.defaultEffort;
  return (preset.model.effort ?? fallback) === (value.effort ?? fallback);
}

/** "Fable's weekly limit is used up · resets Thu 13:00" */
export function usedUpText(limit: UsedUpLimit) {
  const at = limit.resetsAt && new Date(limit.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return `${limit.label} is used up${at ? ` · resets ${at}` : ''}`;
}

/**
 * GLOSSARY: Preset. The level chip on the left of the composer: Low, Medium, High or
 * Ultra, each a model and effort of the thread's harness. Scrolling passes over a level
 * whose model is used up. "Custom" when the model or effort was chosen another way.
 */
export function PresetControl({ presets, models, value, onChange, disabled = false }: {
  presets: PresetView[];
  models: ModelView[];
  value: ModelSelection;
  onChange: (model: ModelSelection) => Promise<void>;
  disabled?: boolean;
}) {
  const modelOf = (p: PresetView) => models.find((m) => m.harnessId === p.model.harnessId && m.id === p.model.modelId);
  const steps = presets.map((p) => {
    const limited = modelOf(p)?.limited;
    return { value: p.model, label: NAMES[p.level][0], short: NAMES[p.level][1], ...(limited ? { unavailable: usedUpText(limited) } : {}) };
  });
  return <StepChip name="Preset" className="preset-chip" steps={steps} index={presets.findIndex((p) => isPreset(p, value, models))} disabled={disabled}
    onChange={onChange}
    tone={(i) => presets[i]?.level ?? 'none'}
    chip={(_, label) => <><i className="preset-dot" aria-hidden />{label}</>}
    detail={(i) => {
      const preset = presets[i];
      if (!preset) return 'Your own model and effort';
      const effort = preset.model.effort;
      return `${modelOf(preset)?.name ?? preset.model.modelId} · ${effort ? `${effortName(effort)} effort` : 'default effort'}`;
    }} />;
}
