import type { HarnessModel } from '@accio/protocol';

/** Claude Code's stable aliases follow its current model versions and account default. */
export const CLAUDE_MODELS: HarnessModel[] = [
  { id: 'default', name: 'Claude Code default', providerId: 'anthropic', description: 'Use the default model for this Claude account.' },
  { id: 'opus', name: 'Claude Opus', providerId: 'anthropic', description: 'For complex reasoning and demanding coding tasks.' },
  { id: 'sonnet', name: 'Claude Sonnet', providerId: 'anthropic', description: 'A balance of capability and speed.' },
  { id: 'haiku', name: 'Claude Haiku', providerId: 'anthropic', description: 'For quick, lightweight tasks.' },
];

export function harnessModels(harnessId: string): HarnessModel[] {
  if (harnessId === 'codex') return [{ id: 'default', name: 'Codex default', providerId: 'openai', description: 'Use the default model for this ChatGPT account.' }];
  return harnessId === 'claudeCode' ? CLAUDE_MODELS : [];
}
