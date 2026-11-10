import type { ReactNode } from 'react';
import type { TranscriptItem } from '@accio/protocol';
import { CacheUsage } from './CacheUsage';
import { PromptUsage } from './PromptUsage';
import './context-meter.css';

/** "106k", "1m", "1.5m". */
export function shortTokens(n: number) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/**
 * GLOSSARY: Context window. The latest request's size, against the latest window a turn
 * reported. Claude reports its window when a turn ends, so a running turn's requests
 * use the previous turn's; turns that predate the report have no window.
 */
export function contextFill(items: TranscriptItem[]): { usedTokens: number; windowTokens?: number; compactAtTokens?: number } | undefined {
  let usedTokens: number | undefined;
  for (const item of items.toReversed()) {
    if (item.kind === 'context') return { usedTokens: usedTokens ?? item.usedTokens, windowTokens: item.windowTokens, compactAtTokens: item.compactAtTokens };
    if (item.kind === 'usage') usedTokens ??= item.usage.inputTokens + item.usage.cacheReadTokens + item.usage.cacheWriteTokens;
  }
  return usedTokens === undefined ? undefined : { usedTokens };
}

function Ring({ ratio }: { ratio: number }) {
  const size = 14, r = 5.5, c = 2 * Math.PI * r;
  return <svg className="context-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
    <circle cx={7} cy={7} r={r} className="context-ring-track" />
    {ratio > 0 && <circle cx={7} cy={7} r={r} className="context-ring-fill" strokeDasharray={`${Math.max(c * ratio, 1)} ${c}`} transform="rotate(-90 7 7)" />}
  </svg>;
}

/**
 * The thread's context window at a glance in the composer bar. Its popover also holds
 * the account's limits, the prompt cache and the last request's prompt size, which
 * stay out of the way until opened. Low or used-up limits tint the pill.
 */
export function ContextMeter({ items, limits }: { items: TranscriptItem[]; limits?: ReactNode }) {
  const fill = contextFill(items);
  const ratio = fill?.windowTokens ? Math.min(1, fill.usedTokens / fill.windowTokens) : 0;
  const percent = Math.round(ratio * 100);
  // Compaction, where reported, is what the conversation runs into first.
  const compactAt = fill?.windowTokens && fill.compactAtTokens && fill.compactAtTokens < fill.windowTokens ? fill.compactAtTokens : undefined;
  const nearness = fill ? fill.usedTokens / (compactAt ?? fill.windowTokens ?? Infinity) : 0;
  const tone = nearness >= 0.9 ? ' full' : nearness >= 0.75 ? ' filling' : '';
  const text = fill ? fill.windowTokens ? `${shortTokens(fill.usedTokens)} / ${shortTokens(fill.windowTokens)}` : shortTokens(fill.usedTokens) : undefined;
  const label = fill
    ? `Context: ${fill.usedTokens.toLocaleString()} tokens${fill.windowTokens ? ` of ${fill.windowTokens.toLocaleString()} (${percent}%)` : ''}`
    : 'Context: not measured yet';
  return <details className={`context-meter${tone}`}>
    <summary aria-label={label} title={label}><Ring ratio={ratio} />{text && <span>{text}</span>}</summary>
    <div className="context-panel">
      <section className="context-window">
        <div className="context-heading"><strong>Context window</strong>{fill?.windowTokens !== undefined && <span>{percent}%</span>}</div>
        <div className="context-bar" role="meter" aria-label="Context window used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${ratio * 100}%` }} />
          {compactAt && <i className="context-compact-tick" title="Compacts here" style={{ left: `${100 * compactAt / fill!.windowTokens!}%` }} />}
        </div>
        <p>{!fill ? 'Measured after the first reply.'
          : fill.windowTokens ? `${fill.usedTokens.toLocaleString()} of ${fill.windowTokens.toLocaleString()} tokens in the latest request. ${
            compactAt ? `Compacts automatically at about ${compactAt.toLocaleString()} tokens.` : 'The harness compacts the conversation as it nears the window.'}`
          : `${fill.usedTokens.toLocaleString()} tokens in the latest request. The window is reported from the next turn.`}</p>
      </section>
      {limits && <div className="context-limits">{limits}</div>}
      <CacheUsage items={items} />
      <PromptUsage items={items} />
    </div>
  </details>;
}
