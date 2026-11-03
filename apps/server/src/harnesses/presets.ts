import { PRESET_LEVELS, type HarnessModel, type PresetLevel, type PresetView } from '@accio/protocol';
import type { PresetChoice } from '@accio/hub';

/** Claude Code's defaults: one model family per level, thinking harder as it rises. */
const CLAUDE_DEFAULTS: Record<PresetLevel, { family: string; effort: string }> = {
  low: { family: 'haiku', effort: 'low' },
  medium: { family: 'sonnet', effort: 'medium' },
  high: { family: 'opus', effort: 'high' },
  ultra: { family: 'fable', effort: 'high' },
};
/** Elsewhere one model rises through its efforts; the first level it accepts wins. */
const EFFORTS: Record<PresetLevel, string[]> = {
  low: ['low', 'minimal'],
  medium: ['medium'],
  high: ['high'],
  ultra: ['xhigh', 'max', 'high'],
};

/** "opus" names Claude Code's alias, a pinned id such as claude-fable-5[1m], or a display name such as Claude Fable 5.1. */
function ofFamily(model: HarnessModel, family: string) {
  return model.id === family || model.id.startsWith(`claude-${family}`) || new RegExp(`\b${family}\b`, 'i').test(model.name);
}
const accepts = (model: HarnessModel, effort: string | undefined) => !!effort && model.efforts.some((e) => e.id === effort);

/** accio's choice for a level when settings leave it open; undefined when no listed model fits. */
function defaultChoice(harnessId: string, level: PresetLevel, models: HarnessModel[]): PresetChoice | undefined {
  if (harnessId === 'claudeCode') {
    const { family, effort } = CLAUDE_DEFAULTS[level];
    const model = models.find((m) => ofFamily(m, family));
    if (model) return { modelId: model.id, ...(accepts(model, effort) ? { effort } : {}) };
    // Without Fable, Ultra is Opus thinking as hard as it can.
    if (level !== 'ultra') return undefined;
    const opus = models.find((m) => ofFamily(m, 'opus'));
    return opus && { modelId: opus.id, ...(opus.efforts.length ? { effort: opus.efforts.at(-1)!.id } : {}) };
  }
  const model = models.find((m) => m.isDefault) ?? models[0];
  if (!model) return undefined;
  const effort = EFFORTS[level].find((e) => accepts(model, e));
  return { modelId: model.id, ...(effort ? { effort } : {}) };
}

/**
 * GLOSSARY: Preset. A harness's four levels as `models` allow: a level set in
 * settings keeps its model while it is listed, and drops an effort the model no
 * longer accepts; otherwise accio's default applies. Levels nothing fits are left out.
 */
export function resolvePresets(harnessId: string, models: HarnessModel[], configured: Record<string, PresetChoice>): PresetView[] {
  return PRESET_LEVELS.flatMap((level) => {
    const set = configured[level];
    const model = set && models.find((m) => m.id === set.modelId);
    const choice = model ? { modelId: model.id, ...(accepts(model, set.effort) ? { effort: set.effort } : {}) } : defaultChoice(harnessId, level, models);
    return choice ? [{ harnessId, level, model: { harnessId, ...choice }, custom: !!model }] : [];
  });
}
