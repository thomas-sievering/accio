import { describe, expect, it } from 'vitest';
import type { HarnessModel } from '@accio/protocol';
import { resolvePresets } from './presets.js';

const levels = (...ids: string[]) => ids.map((id) => ({ id }));
const claude = (id: string, name: string, efforts = levels('low', 'medium', 'high', 'xhigh', 'max')): HarnessModel => ({ id, name, providerId: 'anthropic', description: '', efforts });
const codex = (id: string, isDefault: boolean, efforts = levels('low', 'medium', 'high', 'xhigh')): HarnessModel => ({ id, name: id, providerId: 'openai', description: '', isDefault, efforts });
const pick = (presets: ReturnType<typeof resolvePresets>) => presets.map((p) => [p.level, p.model.modelId, p.model.effort, p.custom]);

describe('presets', () => {
  const opus = claude('opus', 'Claude Opus 5.5'), sonnet = claude('sonnet', 'Claude Sonnet 5.5'), haiku = claude('haiku', 'Claude Haiku 5.5');

  it('give Claude Code one family per level, rising in effort, with Fable as Ultra', () => {
    expect(pick(resolvePresets('claudeCode', [opus, claude('fable', 'Claude Fable 5.1'), sonnet, haiku], {}))).toEqual([
      ['low', 'haiku', 'low', false], ['medium', 'sonnet', 'medium', false], ['high', 'opus', 'high', false], ['ultra', 'fable', 'high', false],
    ]);
    // A pinned Fable id counts as Fable too.
    expect(resolvePresets('claudeCode', [opus, claude('claude-fable-5[1m]', 'Claude Fable 5')], {}).find((p) => p.level === 'ultra')?.model.modelId).toBe('claude-fable-5[1m]');
  });

  it('make Ultra Opus at its highest effort when Fable is not listed, and leave out levels nothing fits', () => {
    expect(pick(resolvePresets('claudeCode', [opus, claude('sonnet', 'Claude Sonnet', [])], {}))).toEqual([
      ['medium', 'sonnet', undefined, false], ['high', 'opus', 'high', false], ['ultra', 'opus', 'max', false],
    ]);
  });

  it('raise the account default model through its efforts on Codex', () => {
    expect(pick(resolvePresets('codex', [codex('gpt-fast', false), codex('gpt-main', true)], {}))).toEqual([
      ['low', 'gpt-main', 'low', false], ['medium', 'gpt-main', 'medium', false], ['high', 'gpt-main', 'high', false], ['ultra', 'gpt-main', 'xhigh', false],
    ]);
    expect(resolvePresets('codex', [codex('gpt-main', true, levels('minimal', 'medium', 'high'))], {}).map((p) => p.model.effort)).toEqual(['minimal', 'medium', 'high', 'high']);
  });

  it('use a level set in settings while its model is listed, dropping an effort it no longer accepts', () => {
    const configured = { high: { modelId: 'sonnet', effort: 'max' }, low: { modelId: 'haiku', effort: 'turbo' }, ultra: { modelId: 'gone', effort: 'max' } };
    expect(pick(resolvePresets('claudeCode', [opus, sonnet, haiku], configured))).toEqual([
      ['low', 'haiku', undefined, true], ['medium', 'sonnet', 'medium', false], ['high', 'sonnet', 'max', true], ['ultra', 'opus', 'max', false],
    ]);
  });
});
