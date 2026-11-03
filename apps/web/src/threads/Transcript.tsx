import { memo, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TranscriptItem } from '@accio/protocol';
import { Chevron } from '../app/icons';

/** The conversation, centred like botbot's chat; follows new output while you are at the bottom. */
export function Transcript({ items, working }: { items: TranscriptItem[]; working: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  });

  return (
    <div
      className="messages"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      <div className="thread">
        {items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
        {working && (
          <div className="typing" aria-label="Working">
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
    </div>
  );
}

const Item = memo(function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return <div className={`msg user${item.resume ? ' resume' : ''}`}>{item.resume ? 'Resume' : item.text}</div>;
    case 'assistant':
      if (!item.text.trim()) return null;
      return (
        <div className="msg assistant">
          <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
        </div>
      );
    case 'tool':
      return <ToolRow item={item} />;
    case 'notice':
      return <div className={`notice ${item.tone}`}>{item.text}</div>;
  }
});

function ToolRow({ item }: { item: Extract<TranscriptItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`tool ${item.status}${open ? ' open' : ''}`}>
      <button onClick={() => setOpen(!open)} disabled={!item.output}>
        <span className="tool-name">{item.name}</span>
        <span className="tool-summary">{item.summary}</span>
        {item.output !== undefined && <Chevron />}
      </button>
      {open && item.output && <pre>{item.output}</pre>}
    </div>
  );
}
