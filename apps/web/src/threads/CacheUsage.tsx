import type { TranscriptItem } from '@accio/protocol';

/** Recorded Claude main-conversation requests, including repeated input across turns. */
export function CacheUsage({ items }: { items: TranscriptItem[] }) {
  const records = items.filter((item): item is Extract<TranscriptItem, { kind: 'usage' }> => item.kind === 'usage' && item.provider === 'anthropic');
  if (!records.length) return null;
  const totals = records.reduce((sum, item) => ({
    input: sum.input + item.usage.inputTokens,
    read: sum.read + item.usage.cacheReadTokens,
    write: sum.write + item.usage.cacheWriteTokens,
    hour: sum.hour + (item.usage.cacheWrite1hTokens ?? 0),
  }), { input: 0, read: 0, write: 0, hour: 0 });
  const total = totals.input + totals.read + totals.write;
  if (!total) return null;
  const percent = Math.round(100 * totals.read / total);
  const tokens = (n: number) => n.toLocaleString();
  const hasHour = records.some((item) => item.usage.cacheWrite1hTokens !== undefined);
  return <details className="context-section cache-usage">
    <summary aria-label={`Claude cache usage: ${percent}% of input read from cache`}><span>Prompt cache</span><span>{percent}% read</span></summary>
    <dl>
      <dt>Read from cache</dt><dd>{tokens(totals.read)}</dd>
      <dt>Written to cache</dt><dd>{tokens(totals.write)}</dd>
      {hasHour && <><dt>Reported 1-hour writes</dt><dd>{tokens(totals.hour)}</dd></>}
      <dt>Uncached input</dt><dd>{tokens(totals.input)}</dd>
    </dl>
    <p>Tokens across recorded Claude requests in this thread. Includes the main conversation; excludes subagents and title generation. Older requests without usage reports are excluded.</p>
  </details>;
}
