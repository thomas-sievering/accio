import { memo, useId, useLayoutEffect, useRef, useState } from 'react';
import type { TranscriptItem } from '@accio/protocol';
import { AssistantMarkdown } from './AssistantMarkdown';
import { ToolGroup } from './ToolGroup';
import { Chevron } from '../app/icons';
import { layoutTranscript, type TranscriptBlock } from './transcriptBlocks';
import './transcript-media.css';

/** Follow late media/layout changes only while the reader is already at the bottom. */
export function Transcript({ threadId, items, working }: { threadId: string; items: TranscriptItem[]; working: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const anchor = useRef<{ element: HTMLElement; offset: number } | undefined>(undefined);
  const [away, setAway] = useState(false);
  const lastTurn = items.findLast((item) => item.kind === 'user')?.turnId;

  useLayoutEffect(() => {
    pinned.current = true;
    anchor.current = undefined;
    setAway(false);
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [threadId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items, working]);

  useLayoutEffect(() => {
    const el = scroller.current;
    const thread = content.current;
    if (!el || !thread) return;
    let frame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (pinned.current) el.scrollTop = el.scrollHeight;
        else if (anchor.current?.element.isConnected) {
          const nextOffset = anchor.current.element.getBoundingClientRect().top - el.getBoundingClientRect().top;
          el.scrollTop += nextOffset - anchor.current.offset;
        }
      });
    });
    resize.observe(thread);
    resize.observe(el);
    return () => { resize.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  return (
    <div className="transcript-scroll">
      <div className="messages" ref={scroller} onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        setAway(!pinned.current);
        const top = el.getBoundingClientRect().top;
        const visible = [...(content.current?.querySelectorAll<HTMLElement>(':scope .msg:not(.assistant), :scope .turn-work-toggle, :scope .tool-group-toggle, :scope .tool, :scope .notice, :scope .turn-finished, :scope .msg.assistant > *') ?? [])]
          .find((node) => node.getBoundingClientRect().bottom > top);
        anchor.current = visible ? { element: visible, offset: visible.getBoundingClientRect().top - top } : undefined;
      }}>
        <div className="thread" ref={content}>
          <Blocks threadId={threadId} blocks={layoutTranscript(items)} preparingTurn={working ? lastTurn : undefined} />
          {working && <div className="typing" aria-label="Working"><i /><i /><i /></div>}
        </div>
      </div>
      {away && <button className="jump-latest" onClick={() => {
        pinned.current = true;
        setAway(false);
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
      }}>Jump to latest ↓</button>}
    </div>
  );
}

function Blocks({ threadId, blocks, preparingTurn, inWork = false }: { threadId: string; blocks: TranscriptBlock[]; preparingTurn?: string; inWork?: boolean }) {
  return blocks.map((block) => {
    switch (block.kind) {
      case 'tools': return <ToolGroup key={`${threadId}:${block.id}`} threadId={threadId} items={block.items} opened={inWork} />;
      case 'work': return <TurnWork key={`${threadId}:${block.id}`} threadId={threadId} block={block} />;
      case 'item': return <Item key={`${threadId}:${block.item.id}`} threadId={threadId} item={block.item} preparing={block.item.turnId === preparingTurn} />;
    }
  });
}

/** A completed turn's tool calls and interim messages, folded above its answer. */
function TurnWork({ threadId, block }: { threadId: string; block: Extract<TranscriptBlock, { kind: 'work' }> }) {
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className={`turn-work${open ? ' open' : ''}`}>
      <button className="turn-work-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={bodyId}>
        Worked for {formatDuration(block.ms)}
        {block.failed > 0 && <span className="turn-work-failed">{block.failed} failed</span>}
        <Chevron />
      </button>
      {open && <div className="turn-work-body" id={bodyId}><Blocks threadId={threadId} blocks={block.blocks} inWork /></div>}
    </div>
  );
}

const Item = memo(function Item({ threadId, item, preparing }: { threadId: string; item: TranscriptItem; preparing: boolean }) {
  switch (item.kind) {
    case 'user':
      return <div className={`msg user${item.resume ? ' resume' : ''}`}>{item.resume ? 'Resume' : item.text}</div>;
    case 'assistant':
      if (!item.text.trim()) return null;
      return <div className="msg assistant"><AssistantMarkdown threadId={threadId} text={item.text} media={item.media} preparing={preparing} /></div>;
    case 'tool':
      return null; // Rendered by ToolGroup.
    case 'notice':
      return <div className={`notice ${item.tone}`}>{item.text}</div>;
    case 'finished':
      return <div className="turn-finished">Worked for {formatDuration(item.ms)}</div>;
  }
});

/** <1s, 9s, 1m 44s, 2h 5m. */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 1) return '<1s';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
