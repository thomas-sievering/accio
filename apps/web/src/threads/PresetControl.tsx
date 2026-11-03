import type { ModelSelection, ModelView, PresetLevel, PresetView, UsedUpLimit } from '@accio/protocol';
import { effortName } from './EffortControl';
import type { Step } from './steps';

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

/** What a choice runs, such as "Claude Opus · High effort". */
export function choiceDetail(model: ModelSelection, models: ModelView[]) {
  const name = models.find((m) => m.harnessId === model.harnessId && m.id === model.modelId)?.name ?? model.modelId;
  return `${name} · ${model.effort ? `${effortName(model.effort)} effort` : 'default effort'}`;
}

/**
 * GLOSSARY: Preset. A harness's levels as steps: Low, Medium, High and Ultra. A level
 * whose model is used up cannot be chosen until it resets.
 */
export function presetSteps(presets: PresetView[], models: ModelView[], value: ModelSelection) {
  const steps: Step<ModelSelection>[] = presets.map((p) => {
    const limited = models.find((m) => m.harnessId === p.model.harnessId && m.id === p.model.modelId)?.limited;
    return { value: p.model, label: NAMES[p.level][0], short: NAMES[p.level][1], ...(limited ? { unavailable: usedUpText(limited) } : {}) };
  });
  return { steps, index: presets.findIndex((p) => isPreset(p, value, models)), tone: (i: number) => presets[i]?.level ?? 'none' };
}
