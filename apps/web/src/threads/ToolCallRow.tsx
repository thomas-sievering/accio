import { useEffect, useId, useState } from 'react';
import type { ToolDetails, TranscriptItem } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { Chevron } from '../app/icons';
import { InlineMedia } from './InlineMedia';
import { describeActivity, toolSummary } from './transcriptBlocks';

type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>;
const statuses: Record<ToolItem['status'], string> = { running: 'Running', done: 'Completed', error: 'Failed', interrupted: 'Interrupted' };

export function ToolCallRow({ threadId, item }: { threadId: string; item: ToolItem }) {
  const client = useClient();
  const connection = useConnectionStatus();
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ToolDetails>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open || item.detailRevision === undefined) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    void client.call('threads.toolDetails', { threadId, itemId: item.id }).then((result) => {
      if (active) setDetail(result);
    }, (cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, threadId, item.id, item.detailRevision, open, retry, connection]);

  return <div className={`tool ${item.status}${open ? ' open' : ''}`} data-item-id={item.id}>
    <button className="tool-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={detailId}>
      <span className="tool-name">{item.name}</span>
      <span className="tool-summary" title={item.summary}>{toolSummary(item)}</span>
      {item.status === 'running' && item.step && <span className="tool-step">{describeActivity(item.step)}</span>}
      <span className="tool-status">{statuses[item.status]}</span>
      <Chevron />
    </button>
    {open && <div className="tool-details" id={detailId} aria-busy={loading}>
      {loading && <div className="tool-detail-note" role="status">{detail ? 'Updating details…' : 'Loading details…'}</div>}
      {error && <div className="tool-detail-note error" role="alert">Could not load details: {error} <button className="tool-retry" onClick={() => setRetry((n) => n + 1)}>Retry</button></div>}
      {detail ? <>
        {detail.input !== null && detail.input !== undefined && <section aria-label="Tool input">
          <div className="tool-section-label">Input</div><pre>{formatInput(detail.input)}</pre>
        </section>}
        <section aria-label="Tool result">
          <div className="tool-section-label">Result</div>
          {detail.parts.map((part, index) => {
            switch (part.type) {
              case 'text': return <pre key={index}>{part.text}</pre>;
              case 'media': return <InlineMedia key={`${index}:${part.asset.id}`} threadId={threadId} asset={part.asset} />;
              case 'unsupported': return <div className="tool-detail-note" key={index}>{part.label}</div>;
            }
          })}
          {!detail.parts.length && <div className="tool-detail-note">{item.status === 'running' ? 'Waiting for result…' : 'No output.'}</div>}
          {detail.truncated && <div className="tool-detail-note">This result exceeded the saved detail limit; some output was omitted.</div>}
        </section>
      </> : item.output !== undefined ? <pre>{item.output || 'No output.'}</pre> : !loading && !error && <div className="tool-detail-note">{item.status === 'running' ? 'Waiting for tool details…' : 'No saved details.'}</div>}
    </div>}
  </div>;
}

function formatInput(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && 'command' in input && typeof input.command === 'string' && Object.keys(input).length === 1) return input.command;
  return JSON.stringify(input, null, 2) ?? String(input);
}
