import type { HarnessModel } from '@accio/protocol';

/** Claude Code's stable aliases, which follow its current model versions. */
export const CLAUDE_MODELS: HarnessModel[] = [
  { id: 'opus', name: 'Claude Opus', providerId: 'anthropic', description: 'For complex reasoning and demanding coding tasks.' },
  { id: 'sonnet', name: 'Claude Sonnet', providerId: 'anthropic', description: 'A balance of capability and speed.' },
  { id: 'haiku', name: 'Claude Haiku', providerId: 'anthropic', description: 'For quick, lightweight tasks.' },
];

export function harnessModels(harnessId: string): HarnessModel[] {
  return harnessId === 'claudeCode' ? CLAUDE_MODELS : [];
}
