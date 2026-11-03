import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TranscriptItem } from '@accio/protocol';
import { AssistantMarkdown } from './AssistantMarkdown';
import { ToolCallRow } from './ToolCallRow';
import { Choice, optionName } from './Choice';
import './transcript-media.css';

/** Follow late media/layout changes only while the reader is already at the bottom. */
export function Transcript({ threadId, items, working }: { threadId: string; items: TranscriptItem[]; working: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const anchor = useRef<{ element: HTMLElement; offset: number } | undefined>(undefined);
  const [away, setAway] = useState(false);
  const lastTurn = items.findLast((item) => item.kind === 'user')?.turnId;
  const picks = useMemo(() => pickedOptions(items), [items]);

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
        const visible = [...(content.current?.querySelectorAll<HTMLElement>(':scope > .msg:not(.assistant), :scope > .tool, :scope > .choice, :scope > .notice, :scope > .turn-finished, :scope > .msg.assistant > *') ?? [])]
          .find((node) => node.getBoundingClientRect().bottom > top);
        anchor.current = visible ? { element: visible, offset: visible.getBoundingClientRect().top - top } : undefined;
      }}>
        <div className="thread" ref={content}>
          {items.map((item) => <Item key={`${threadId}:${item.id}`} threadId={threadId} item={item} preparing={working && item.turnId === lastTurn}
            picked={item.kind === 'choice' ? picks.picked.get(item.id) : undefined}
            pickName={item.kind === 'user' ? picks.names.get(item.id) : undefined} />)}
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

/** Which option each answered choice got, and how each picking message names its pick. */
function pickedOptions(items: TranscriptItem[]) {
  const choices = new Map<string, Extract<TranscriptItem, { kind: 'choice' }>>();
  const picked = new Map<string, number>();
  const names = new Map<string, string>();
  for (const item of items) {
    if (item.kind === 'choice') choices.set(item.id, item);
    if (item.kind !== 'user' || !item.pick) continue;
    const choice = choices.get(item.pick.choiceId);
    picked.set(item.pick.choiceId, item.pick.option);
    if (choice) names.set(item.id, optionName(choice, item.pick.option));
  }
  return { picked, names };
}

const Item = memo(function Item({ threadId, item, preparing, picked, pickName }: {
  threadId: string; item: TranscriptItem; preparing: boolean; picked?: number; pickName?: string;
}) {
  switch (item.kind) {
    case 'user':
      return <div className={`msg user${item.resume ? ' resume' : ''}`}>
        {pickName && <span className="msg-pick">✓ {pickName}</span>}
        {item.resume ? 'Resume' : item.text}
      </div>;
    case 'choice':
      return <Choice threadId={threadId} item={item} picked={picked} />;
    case 'assistant':
      if (!item.text.trim()) return null;
      return <div className="msg assistant"><AssistantMarkdown threadId={threadId} text={item.text} media={item.media} preparing={preparing} /></div>;
    case 'tool':
      return <ToolCallRow threadId={threadId} item={item} />;
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
