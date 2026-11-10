import type { TranscriptItem } from '@accio/protocol';
import { PromptSizeBreakdown, promptTotals } from '../harnesses/PromptSizeBreakdown';

export function PromptUsage({ items }: { items: TranscriptItem[] }) {
  const last = items.findLast(item => item.kind === 'promptSize');
  if (last?.kind !== 'promptSize') return null;
  const total = promptTotals(last.measurement);
  return <details className="context-section prompt-usage">
    <summary aria-label="Prompt size"><span>Prompt size</span><span>~{total.estimatedTokens.toLocaleString()}</span></summary>
    <p>Last request captured when a turn ended · {last.harnessId === 'codex' ? 'Codex' : 'Claude Code'}</p>
    <PromptSizeBreakdown measurement={last.measurement} />
    <p>Tool definitions include the built-in and MCP tools exposed on that request; deferred tools count only when exposed.</p>
  </details>;
}
