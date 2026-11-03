import { query } from '@anthropic-ai/claude-agent-sdk';
import type { HarnessModel, ModelEffort } from '@accio/protocol';

const CLAUDE_EFFORTS: ModelEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({ id }));

/** Claude Code's stable aliases, used until Claude Code has reported this profile's own list. */
export const CLAUDE_MODELS: HarnessModel[] = [
  { id: 'opus', name: 'Claude Opus', providerId: 'anthropic', description: 'For complex reasoning and demanding coding tasks.', efforts: CLAUDE_EFFORTS },
  { id: 'sonnet', name: 'Claude Sonnet', providerId: 'anthropic', description: 'A balance of capability and speed.', efforts: CLAUDE_EFFORTS },
  { id: 'haiku', name: 'Claude Haiku', providerId: 'anthropic', description: 'For quick, lightweight tasks.', efforts: CLAUDE_EFFORTS },
];

/** What Claude Code's supportedModels() reports for one model. */
export type ClaudeModelInfo = {
  value: string; displayName: string; description: string;
  supportsEffort?: boolean; supportedEffortLevels?: string[];
};
/** Asks Claude Code, signed in as one profile, which models it offers. */
export type ClaudeModelSource = (env: Record<string, string>, cwd: string) => Promise<ClaudeModelInfo[]>;

/** Starts Claude Code without a prompt, reads its model list and stops it; no turn runs. */
export const sdkClaudeModels: ClaudeModelSource = async (env, cwd) => {
  const abortController = new AbortController();
  const idle = (async function* () { await new Promise<never>(() => {}); })();
  const q = query({ prompt: idle, options: { cwd, env, abortController, settingSources: ['user'] } });
  const timer = setTimeout(() => abortController.abort(), 30_000);
  try { return await q.supportedModels(); }
  finally { clearTimeout(timer); abortController.abort(); }
};

/**
 * "Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok" becomes the name
 * "Claude Opus 5.5" and the description "Best for everyday, complex tasks". Prices
 * are left out: subscription turns do not pay them.
 */
export function claudeModel(info: ClaudeModelInfo): HarnessModel | undefined {
  if (info.value === 'default') return undefined;
  const [first, ...rest] = info.description.split(' · ').map((part) => part.trim());
  const versioned = first && first.toLowerCase().startsWith(info.displayName.toLowerCase()) ? first : info.displayName;
  const description = (versioned === first ? rest : [first, ...rest]).filter((part) => part && !part.startsWith('$')).join(' · ');
  return {
    id: info.value, providerId: 'anthropic', description,
    name: versioned.startsWith('Claude ') ? versioned : `Claude ${versioned}`,
    efforts: info.supportsEffort === false ? [] : (info.supportedEffortLevels ?? []).map((id) => ({ id })),
  };
}

/** The models a harness offers before any profile is asked. Codex has no fixed catalog: its models come from the signed-in ChatGPT account. */
export function harnessModels(harnessId: string): HarnessModel[] {
  return harnessId === 'claudeCode' ? CLAUDE_MODELS : [];
}
