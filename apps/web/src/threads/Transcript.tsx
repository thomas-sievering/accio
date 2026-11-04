import { createContext, memo, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TranscriptItem } from '@accio/protocol';
import { AssistantMarkdown } from './AssistantMarkdown';
import { SecretRequestCard } from '../secrets/SecretRequestCard';
import { ToolGroup } from './ToolGroup';
import { Chevron } from '../app/icons';
import { useAppEvent } from '../app/appEvents';
import { blocksHaveItem, layoutTranscript, type TranscriptBlock } from './transcriptBlocks';
import { RevealContext, useReveal, type Reveal } from './reveal';

const revealFrames = 30;
import { Choice, optionName } from './Choice';

/** Follow late media/layout changes only while the reader is already at the bottom. */
export function Transcript({ threadId, items, working, onOpenSecrets }: { threadId: string; items: TranscriptItem[]; working: boolean; onOpenSecrets?: (profileId: string) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastTop = useRef(0);
  const anchor = useRef<{ element: HTMLElement; offset: number } | undefined>(undefined);
  const [away, setAway] = useState(false);
  const lastTurn = items.findLast((item) => item.kind === 'user')?.turnId;
  const picks = useMemo(() => pickedOptions(items), [items]);
  // Another pane (the skills panel) can ask to show an item, even one folded away.
  const [reveal, setReveal] = useState<Reveal>();
  useAppEvent('transcript.reveal', (request) => {
    if (request.threadId === threadId) setReveal((previous) => ({ itemId: request.itemId, request: (previous?.request ?? 0) + 1 }));
  });
  // Folds open in their own effects; wait a few frames for the item to render, then give up quietly.
  useEffect(() => {
    if (!reveal) return;
    let frame = 0;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown: HTMLElement | undefined;
    const find = () => {
      const element = content.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(reveal.itemId)}"]`);
      if (!element && ++tries < revealFrames) { frame = requestAnimationFrame(find); return; }
      setReveal(undefined);
      if (!element) return;
      // A tool call focuses its toggle; a message itself takes focus, for screen readers and keyboard scrolling.
      const target = (element.matches('.tool') && element.querySelector<HTMLElement>('.tool-toggle')) || element;
      if (target === element && !element.hasAttribute('tabindex')) element.tabIndex = -1;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.focus({ preventScroll: true });
      shown = element;
      element.classList.add('revealed');
      timer = setTimeout(() => element.classList.remove('revealed'), 1600);
    };
    frame = requestAnimationFrame(find);
    return () => {
      cancelAnimationFrame(frame);
      // Clearing the request re-runs this effect; the highlight still fades on its own.
      if (!shown) clearTimeout(timer);
    };
  }, [reveal]);

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
        // Late media can grow the content between our scroll-to-bottom and this event;
        // only a move up (the reader scrolling) stops following.
        const movedUp = el.scrollTop < lastTop.current;
        lastTop.current = el.scrollTop;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 || (pinned.current && !movedUp);
        // Only a reader more than a viewport above the end needs the shortcut.
        setAway(!pinned.current && el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight);
        const top = el.getBoundingClientRect().top;
        const visible = [...(content.current?.querySelectorAll<HTMLElement>(':scope .msg:not(.assistant), :scope .turn-work-toggle, :scope .tool-group-toggle, :scope .tool, :scope .choice, :scope .secret, :scope .notice, :scope .turn-finished, :scope .msg.assistant > *') ?? [])]
          .find((node) => node.getBoundingClientRect().bottom > top);
        anchor.current = visible ? { element: visible, offset: visible.getBoundingClientRect().top - top } : undefined;
      }}>
        <div className="thread" ref={content}>
          <RevealContext.Provider value={reveal}><OpenSecrets.Provider value={onOpenSecrets}>
            <Picks.Provider value={picks}><Blocks threadId={threadId} blocks={layoutTranscript(items, working ? lastTurn : undefined)} preparingTurn={working ? lastTurn : undefined} /></Picks.Provider>
          </OpenSecrets.Provider></RevealContext.Provider>
          {working && !lastTurn && <div className="typing" aria-label="Working"><i /><i /><i /></div>}
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
const Picks = createContext<ReturnType<typeof pickedOptions>>({ picked: new Map(), names: new Map() });
const OpenSecrets = createContext<((profileId: string) => void) | undefined>(undefined);

function Blocks({ threadId, blocks, preparingTurn, inWork = false }: { threadId: string; blocks: TranscriptBlock[]; preparingTurn?: string; inWork?: boolean }) {
  return blocks.map((block) => {
    switch (block.kind) {
      case 'tools': return <ToolGroup key={`${threadId}:${block.id}`} threadId={threadId} items={block.items} bare={inWork} />;
      case 'work': return <TurnWork key={`${threadId}:${block.id}`} threadId={threadId} block={block} />;
      case 'item': return <PickedItem key={`${threadId}:${block.item.id}`} threadId={threadId} item={block.item} preparing={block.item.turnId === preparingTurn} />;
    }
  });
}

/**
 * A turn's tool calls and interim messages behind one line above its answer:
 * what the harness is doing now while it runs, "Worked for …" once complete.
 */
function TurnWork({ threadId, block }: { threadId: string; block: Extract<TranscriptBlock, { kind: 'work' }> }) {
  const bodyId = useId();
  const [open, setOpen] = useState(false);
  const empty = !block.blocks.length;
  const reveal = useReveal();
  useEffect(() => { if (reveal && blocksHaveItem(block.blocks, reveal.itemId)) setOpen(true); }, [reveal, block.blocks]);
  return (
    <div className={`turn-work${open ? ' open' : ''}${block.live ? ' live' : ''}`}>
      <button className="turn-work-toggle" onClick={() => setOpen(!open)} disabled={empty} aria-expanded={empty ? undefined : open} aria-controls={empty ? undefined : bodyId}>
        {block.live
          ? <><span className="turn-work-activity" role="status">{block.activity}</span>{block.startedAt && <Elapsed since={block.startedAt} />}</>
          : <>Worked for {formatDuration(block.ms)}</>}
        {block.failed > 0 && <span className="turn-work-failed">{block.failed} failed</span>}
        {!empty && <Chevron />}
      </button>
      {open && !empty && <div className="turn-work-body" id={bodyId}><Blocks threadId={threadId} blocks={block.blocks} inWork /></div>}
    </div>
  );
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="turn-work-elapsed">{formatDuration(Math.max(0, now - Date.parse(since)))}</span>;
}

function PickedItem(props: { threadId: string; item: TranscriptItem; preparing: boolean }) {
  const { picked, names } = useContext(Picks);
  return <Item {...props} picked={props.item.kind === 'choice' ? picked.get(props.item.id) : undefined} pickName={props.item.kind === 'user' ? names.get(props.item.id) : undefined} />;
}

const Item = memo(function Item({ threadId, item, preparing, picked, pickName }: {
  threadId: string; item: TranscriptItem; preparing: boolean; picked?: number; pickName?: string;
}) {
  const onOpenSecrets = useContext(OpenSecrets);
  switch (item.kind) {
    case 'user':
      if (item.resume) return <div className="notice info" data-item-id={item.id}>Resumed</div>;
      return <div className="msg user" data-item-id={item.id}>
        {item.steered && <span className="msg-pick">Steered mid-turn</span>}
        {pickName && <span className="msg-pick">✓ {pickName}</span>}
        {item.text}
      </div>;
    case 'choice':
      return <Choice threadId={threadId} item={item} picked={picked} />;
    case 'assistant':
      if (!item.text.trim()) return null;
      return <div className="msg assistant" data-item-id={item.id}><AssistantMarkdown threadId={threadId} text={item.text} media={item.media} preparing={preparing} /></div>;
    case 'tool':
      return null; // Rendered by ToolGroup.
    case 'notice':
      return <div className={`notice ${item.tone}`} data-item-id={item.id}>{item.text}</div>;
    case 'secret':
      return <SecretRequestCard threadId={threadId} item={item} onOpenSecrets={onOpenSecrets} />;
    case 'finished':
      return <div className="turn-finished">Worked for {formatDuration(item.ms)}</div>;
  }
});

/** <1s, 9s, 1m 44s, 2h 5m. */
function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 1) return '<1s';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
