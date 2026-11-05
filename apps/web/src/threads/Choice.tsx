import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ChoiceOption, ChoicePick, TranscriptItem } from '@accio/protocol';
import { Check, Chevron, Close } from '../app/icons';
import { useSavedAsset } from './useSavedAsset';

type ChoiceItem = Extract<TranscriptItem, { kind: 'choice' }>;

/** The option picked for the next message, held by the thread pane and shown in its composer. */
export const PendingPick = createContext<{ pick?: ChoicePick; setPick: (pick?: ChoicePick) => void; enabled: boolean }>({ setPick: () => {}, enabled: false });

/** A, B, C… as the harness reads them. */
function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Rows stay even: 4 options make a 2×2 grid, 5 or 6 make rows of 3. */
function choiceColumns(count: number): number {
  return count === 4 ? 2 : Math.min(count, 3);
}

export function optionName(choice: ChoiceItem, index: number): string {
  return `${optionLetter(index)} · ${choice.options[index]?.label ?? 'Unavailable option'}`;
}

/**
 * GLOSSARY: Choice. Screenshots side by side; click one to see it full size, tick
 * one to put it in the composer. Once a message picks an option, that option
 * stays outlined and the others fade.
 */
export function Choice({ threadId, item, picked }: { threadId: string; item: ChoiceItem; picked?: number }) {
  const { pick, setPick, enabled } = useContext(PendingPick);
  const [open, setOpen] = useState<number>();
  const answered = picked !== undefined;
  const pending = pick?.choiceId === item.id ? pick.option : undefined;
  const selected = picked ?? pending;
  const toggle = enabled && !answered
    ? (option: number) => setPick(pending === option ? undefined : { choiceId: item.id, option })
    : undefined;

  return <div className={`choice${answered ? ' answered' : ''}`}>
    <p className="choice-question">{item.question}</p>
    <div className="choice-options" style={{ ['--choice-columns' as string]: choiceColumns(item.options.length) }}>
      {item.options.map((option, index) => (
        <div key={index} className={`choice-option${selected === index ? ' selected' : ''}`}>
          <div className="choice-frame">
            <OptionImage threadId={threadId} option={option} label={optionName(item, index)} onOpen={() => setOpen(index)} />
          </div>
          {toggle
            ? <button className="choice-caption" aria-pressed={selected === index}
              aria-label={selected === index ? `Picked ${optionName(item, index)}` : `Pick ${optionName(item, index)}`} onClick={() => toggle(index)}>
              <span className="choice-radio" aria-hidden><Check /></span>
              <span className="choice-label">{optionName(item, index)}</span>
            </button>
            : <div className="choice-caption">
              {selected === index && <span className="choice-radio" aria-label="Picked"><Check /></span>}
              <span className="choice-label">{optionName(item, index)}</span>
            </div>}
        </div>
      ))}
    </div>
    {open !== undefined && <ChoiceViewer threadId={threadId} item={item} start={open} selected={selected}
      onPick={toggle} onClose={() => setOpen(undefined)} />}
  </div>;
}

function OptionImage({ threadId, option, label, onOpen }: { threadId: string; option: ChoiceOption; label?: string; onOpen?: () => void }) {
  const saved = useSavedAsset(threadId, option.asset?.id);
  if (option.error || saved.error) return <span className="choice-missing" role="alert">{option.error ?? saved.error}
    {!option.error && <button onClick={saved.retry}>Retry screenshot</button>}
  </span>;
  const image = saved.url ? <img src={saved.url} alt={option.label} onLoad={saved.loaded} onError={saved.failed} /> : <span className="choice-missing" role="status">Loading…</span>;
  return onOpen ? <button className="choice-open" aria-label={`View ${label}`} onClick={onOpen}>{image}</button> : image;
}

/** Full-size, one option at a time: arrows browse, the one button picks and returns to the composer. */
function ChoiceViewer({ threadId, item, start, selected, onPick, onClose }: {
  threadId: string; item: ChoiceItem; start: number; selected?: number;
  onPick?: (option: number) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(start);
  const count = item.options.length;
  const option = item.options[index]!;
  const go = (step: number) => setIndex((i) => (i + step + count) % count);
  const close = () => { dialog.current?.close(); onClose(); };
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  return <dialog ref={dialog} className="choice-viewer" aria-label={item.question}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onKeyDown={(event) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    }}
    onClick={(event) => { if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('choice-viewer-stage')) close(); }}>
    <header>
      <span className="choice-viewer-count">{index + 1} / {count}</span>
      <span className="choice-viewer-name">{optionName(item, index)}</span>
      <button className="choice-viewer-close" aria-label="Close" autoFocus onClick={close}><Close /></button>
    </header>
    <div className="choice-viewer-stage">
      {count > 1 && <button className="choice-viewer-nav prev" aria-label="Previous option" onClick={() => go(-1)}><Chevron /></button>}
      <OptionImage key={index} threadId={threadId} option={option} />
      {count > 1 && <button className="choice-viewer-nav next" aria-label="Next option" onClick={() => go(1)}><Chevron /></button>}
    </div>
    <footer>
      {onPick
        ? <button className={`choice-viewer-pick${selected === index ? ' selected' : ''}`} aria-pressed={selected === index} onClick={() => { const unpick = selected === index; onPick(index); if (!unpick) close(); }}>
          {selected === index ? <><Check /> Picked</> : `Pick ${optionLetter(index)}`}
        </button>
        : selected === index && <span className="choice-viewer-pick selected"><Check /> Picked</span>}
    </footer>
  </dialog>;
}
