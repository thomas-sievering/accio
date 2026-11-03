import { memo, useId, useState } from 'react';
import { Chevron } from '../app/icons';
import './tool-group.css';
import { ToolCallRow } from './ToolCallRow';
import { describeTools, type ToolItem } from './transcriptBlocks';

/**
 * A run of tool calls in one turn. A lone call shows as its own row;
 * several fold behind a one-line summary that opens onto a step rail. The group
 * stays open while a step runs or after one fails, until you choose otherwise.
 * Inside a turn's folded work it starts open: you already asked to see the work.
 */
export const ToolGroup = memo(function ToolGroup({ threadId, items, opened = false }: { threadId: string; items: ToolItem[]; opened?: boolean }) {
  const stepsId = useId();
  const [choice, setChoice] = useState<boolean>();
  const running = items.some((item) => item.status === 'running');
  const failed = items.filter((item) => item.status === 'error').length;
  const steps = <div className="tool-steps" id={stepsId}>{items.map((item) => <ToolCallRow key={item.id} threadId={threadId} item={item} />)}</div>;
  if (items.length === 1) return <div className="tool-group single">{steps}</div>;
  const open = choice ?? (opened || running || failed > 0);
  return (
    <div className={`tool-group${open ? ' open' : ''}${running ? ' running' : ''}`}>
      <button className="tool-group-toggle" onClick={() => setChoice(!open)} aria-expanded={open} aria-controls={stepsId}>
        <Chevron />
        <span className="tool-group-summary">{describeTools(items)}</span>
        {failed > 0 && <span className="tool-group-failed">{failed} failed</span>}
        {running && <span className="tool-group-running" role="status">Working</span>}
      </button>
      {open && steps}
    </div>
  );
}, (a, b) => a.threadId === b.threadId && a.opened === b.opened && a.items.length === b.items.length && a.items.every((item, i) => item === b.items[i]));
