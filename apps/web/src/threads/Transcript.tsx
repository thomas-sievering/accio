import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { TranscriptItem } from '@accio/protocol';
import { AssistantMarkdown } from './AssistantMarkdown';
import { ToolCallRow } from './ToolCallRow';
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
        const visible = [...(content.current?.querySelectorAll<HTMLElement>(':scope > .msg:not(.assistant), :scope > .tool, :scope > .notice, :scope > .msg.assistant > *') ?? [])]
          .find((node) => node.getBoundingClientRect().bottom > top);
        anchor.current = visible ? { element: visible, offset: visible.getBoundingClientRect().top - top } : undefined;
      }}>
        <div className="thread" ref={content}>
          {items.map((item) => <Item key={`${threadId}:${item.id}`} threadId={threadId} item={item} preparing={working && item.turnId === lastTurn} />)}
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

const Item = memo(function Item({ threadId, item, preparing }: { threadId: string; item: TranscriptItem; preparing: boolean }) {
  switch (item.kind) {
    case 'user':
      return <div className={`msg user${item.resume ? ' resume' : ''}`}>{item.resume ? 'Resume' : item.text}</div>;
    case 'assistant':
      if (!item.text.trim()) return null;
      return <div className="msg assistant"><AssistantMarkdown threadId={threadId} text={item.text} media={item.media} preparing={preparing} /></div>;
    case 'tool':
      return <ToolCallRow threadId={threadId} item={item} />;
    case 'notice':
      return <div className={`notice ${item.tone}`}>{item.text}</div>;
  }
});
