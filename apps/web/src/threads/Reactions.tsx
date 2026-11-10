import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { normalizeQuote, REACTION_KINDS, REACTION_QUOTE_CHARS, REACTIONS, type Reaction, type ReactionKind } from '@accio/protocol';
import { Close } from '../app/icons';
import { emitAppEvent } from '../app/appEvents';
import './reactions.css';

type Selected = { quote: string; rect: DOMRect };

/** The selection, when it lies inside one assistant message of this transcript and has text. */
function selectedQuote(container: HTMLElement): Selected | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  const message = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('.msg.assistant');
  const start = message(range.startContainer);
  if (!start || start !== message(range.endContainer) || !container.contains(start)) return undefined;
  const quote = normalizeQuote(selection.toString());
  if (!quote) return undefined;
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
  return { quote, rect: rects[0] ?? range.getBoundingClientRect() };
}

/**
 * GLOSSARY: Reaction. Selecting text in an assistant message offers 👍 ❓ 👎 just above it;
 * a pick goes to this thread's composer as a chip, so several can travel in one message.
 */
export function ReactionBar({ threadId, container }: { threadId: string; container: RefObject<HTMLElement | null> }) {
  const [selected, setSelected] = useState<Selected>();
  const bar = useRef<HTMLDivElement>(null);
  const pointerDown = useRef(false);

  useEffect(() => {
    // While the pointer drags, the selection is still growing: offer reactions once it lets go.
    const update = () => {
      if (pointerDown.current) return;
      const el = container.current;
      setSelected(el ? selectedQuote(el) : undefined);
    };
    const down = (event: PointerEvent) => {
      if (bar.current?.contains(event.target as Node)) return;
      pointerDown.current = true;
      setSelected(undefined);
    };
    const up = () => { pointerDown.current = false; requestAnimationFrame(update); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(undefined); };
    document.addEventListener('selectionchange', update);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('keydown', key);
    // The transcript scrolls under a fixed bar: follow the text.
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [container]);

  // Centered above the selection's first line, or below it at the top of the window; never off screen.
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el || !selected) return;
    const { width, height } = el.getBoundingClientRect();
    const { rect } = selected;
    const above = rect.top - height - 8;
    el.style.top = `${above >= 8 ? above : rect.bottom + 8}px`;
    el.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8))}px`;
  }, [selected]);

  if (!selected) return null;
  const tooLong = selected.quote.length > REACTION_QUOTE_CHARS;
  const react = (kind: ReactionKind) => {
    emitAppEvent('composer.react', { target: threadId, reaction: { kind, quote: selected.quote } });
    window.getSelection()?.removeAllRanges();
    setSelected(undefined);
  };
  return <div ref={bar} className="reaction-bar" role="toolbar" aria-label="React to the selected text">
    {tooLong
      ? <span className="reaction-bar-note">Select less to react</span>
      : REACTION_KINDS.map((kind) => <button key={kind} type="button" title={REACTIONS[kind].label} aria-label={REACTIONS[kind].label}
        // Keep the selection while the click lands.
        onPointerDown={(event) => event.preventDefault()} onClick={() => react(kind)}>{REACTIONS[kind].emoji}</button>)}
  </div>;
}

/** GLOSSARY: Reaction. In the composer: the emoji and the start of its quote; the emoji changes the reaction. */
export function ReactionChip({ reaction, onChange, onRemove }: { reaction: Reaction; onChange: (kind: ReactionKind) => void; onRemove: () => void }) {
  const { emoji, label } = REACTIONS[reaction.kind];
  const next = REACTION_KINDS[(REACTION_KINDS.indexOf(reaction.kind) + 1) % REACTION_KINDS.length]!;
  return <span className="composer-chip composer-reaction" title={reaction.quote}>
    <button type="button" className="composer-reaction-kind" aria-label={`${label}; change to ${REACTIONS[next].label}`} onClick={() => onChange(next)}>{emoji}</button>
    <span className="composer-reaction-quote">{reaction.quote.replace(/\s+/g, ' ')}</span>
    <button type="button" aria-label={`Remove ${label} reaction`} onClick={onRemove}><Close /></button>
  </span>;
}

/** GLOSSARY: Reaction. In a sent message: the emoji beside the passage it answers. */
export function ReactionCard({ reaction }: { reaction: Reaction }) {
  const { emoji, label } = REACTIONS[reaction.kind];
  return <div className={`reaction-card ${reaction.kind}`}>
    <span className="reaction-card-kind" role="img" aria-label={label} title={label}>{emoji}</span>
    <blockquote>{reaction.quote}</blockquote>
  </div>;
}
