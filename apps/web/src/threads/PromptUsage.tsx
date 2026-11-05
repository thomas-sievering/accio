import type { TranscriptItem } from '@accio/protocol';
import { PromptSizeBreakdown, promptTotals } from '../harnesses/PromptSizeBreakdown';
import './cache-usage.css';

export function PromptUsage({ items }: { items: TranscriptItem[] }) {
  const last = items.findLast(item => item.kind === 'promptSize');
  if (last?.kind !== 'promptSize') return null;
  const total = promptTotals(last.measurement);
  return <details className="cache-usage prompt-usage">
    <summary aria-label="Prompt size">Prompt ~{total.estimatedTokens.toLocaleString()}</summary>
    <div className="cache-usage-details">
      <strong>Last measured request · {last.harnessId === 'codex' ? 'Codex' : 'Claude Code'}</strong>
      <PromptSizeBreakdown measurement={last.measurement} />
      <p>Last request captured when a turn ended. Tool definitions include the built-in and MCP tools exposed on that request; deferred tools count only when exposed.</p>
    </div>
  </details>;
}
