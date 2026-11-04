import { memo, useEffect, useId, useState } from 'react';
import { Chevron } from '../app/icons';
import { ToolCallRow } from './ToolCallRow';
import { useReveal } from './reveal';
import { describeTools, type ToolItem } from './transcriptBlocks';

/**
 * A run of tool calls on a step rail. Outside a turn's fold (a stopped or
 * failed turn), several calls sit behind a collapsed one-line summary.
 * Inside a fold they show bare: the fold is the summary.
 */
export const ToolGroup = memo(function ToolGroup({ threadId, items, bare = false }: { threadId: string; items: ToolItem[]; bare?: boolean }) {
  const stepsId = useId();
  const [open, setOpen] = useState(false);
  const failed = items.filter((item) => item.status === 'error').length;
  const reveal = useReveal();
  useEffect(() => { if (reveal && items.some((item) => item.id === reveal.itemId)) setOpen(true); }, [reveal, items]);
  const steps = <div className="tool-steps" id={stepsId}>{items.map((item) => <ToolCallRow key={item.id} threadId={threadId} item={item} />)}</div>;
  if (bare || items.length === 1) return <div className="tool-group single">{steps}</div>;
  return (
    <div className={`tool-group${open ? ' open' : ''}`}>
      <button className="tool-group-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={stepsId}>
        <Chevron />
        <span className="tool-group-summary">{describeTools(items)}</span>
        {failed > 0 && <span className="tool-group-failed">{failed} failed</span>}
      </button>
      {open && steps}
    </div>
  );
}, (a, b) => a.threadId === b.threadId && a.bare === b.bare && a.items.length === b.items.length && a.items.every((item, i) => item === b.items[i]));
