import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { lineCount, pasteGist, splitPastes } from '@accio/protocol';
import { Chevron, Close, ScrollText } from '../app/icons';
import { MentionText } from './Mentions';
import { ReactionCard } from './Reactions';
import './pasted-text.css';

const encoder = new TextEncoder();

/** "412 lines · 18 KB". */
export function pasteSize(text: string): string {
  const lines = lineCount(text);
  const bytes = encoder.encode(text).byteLength;
  const size = bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${lines === 1 ? '1 line' : `${lines.toLocaleString('en-US')} lines`} · ${size}`;
}

/** Hidden text the browser's find still reaches (`hidden="until-found"`); a match opens it. */
function useRevealOnFind(open: boolean, onReveal: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const reveal = useRef(onReveal);
  reveal.current = onReveal;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) el.removeAttribute('hidden');
    else el.setAttribute('hidden', 'until-found');
  }, [open]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const show = () => reveal.current();
    el.addEventListener('beforematch', show);
    return () => el.removeEventListener('beforematch', show);
  }, []);
  return ref;
}

/** GLOSSARY: Pasted text. In the composer: the paste by its size; it can go back into the message or be removed. */
export function PasteChip({ text, onEdit, onRemove }: { text: string; onEdit: () => void; onRemove: () => void }) {
  const gist = pasteGist(text);
  return <span className="composer-chip composer-paste">
    <button type="button" className="composer-paste-open" onClick={onEdit} title={`${gist}\n\nClick to edit it in the message.`} aria-label={`Edit pasted text in the message: ${gist.slice(0, 80)}`}>
      <ScrollText />
      <span className="composer-paste-label"><b>Pasted text</b><small>{pasteSize(text)}</small></span>
    </button>
    <button type="button" aria-label="Remove pasted text" onClick={onRemove}><Close /></button>
  </span>;
}

/** GLOSSARY: Pasted text. In a message: folded to its size and first line; it opens in place and copies whole. */
export function PasteCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const body = useRevealOnFind(open, () => setOpen(true));
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setCopied(false); }
  };
  return <div className={`paste-card${open ? ' open' : ''}`}>
    <div className="paste-head">
      <button type="button" className="paste-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ScrollText />
        <span className="paste-title"><b>Pasted text</b><small>{pasteSize(text)}</small></span>
        {!open && <span className="paste-gist">{pasteGist(text)}</span>}
        <Chevron />
      </button>
      <button type="button" className="paste-copy" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
    <div ref={body} className="paste-body" hidden><pre>{text}</pre></div>
  </div>;
}

/** Collapsed user text is this many lines tall; it only folds when that hides a good part of it. */
const FOLD_LINES = 12;
const FOLD_SLACK = 1.4;

/** Long typed text folds behind a fade until asked for. */
function FoldedText({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => {
      const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
      setLong(el.scrollHeight > line * FOLD_LINES * FOLD_SLACK);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const folded = long && !expanded;
  return <>
    <div ref={inner} className={`msg-text${folded ? ' folded' : ''}`} style={{ ['--fold-lines' as string]: FOLD_LINES }}>{children}</div>
    {long && <button type="button" className="msg-fold" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      {expanded ? 'Show less' : 'Show full message'}
    </button>}
  </>;
}

/** A user message's text: its Pasted text as cards, then its Reactions, then what was typed, folded when long. */
export function UserMessageText({ text }: { text: string }) {
  const parts = splitPastes(text);
  const typed = parts.filter((part) => part.kind === 'text').map((part) => part.text).join('\n\n');
  const pastes = parts.filter((part) => part.kind === 'paste');
  const reactions = parts.filter((part) => part.kind === 'reaction');
  return <>
    {pastes.length > 0 && <div className="msg-pastes">{pastes.map((part, i) => <PasteCard key={i} text={part.text} />)}</div>}
    {reactions.length > 0 && <div className="msg-reactions">{reactions.map((part, i) => <ReactionCard key={i} reaction={part.reaction} />)}</div>}
    {typed && <FoldedText><MentionText text={typed} /></FoldedText>}
  </>;
}
