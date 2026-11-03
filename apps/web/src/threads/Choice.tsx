import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ChoiceOption, ChoicePick, ThreadAsset, TranscriptItem } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Check, Chevron, Close } from '../app/icons';
import { assetUrl } from './assetUrl';
import './choice.css';

type ChoiceItem = Extract<TranscriptItem, { kind: 'choice' }>;

/** The option picked for the next message, held by the thread pane and shown in its composer. */
export const PendingPick = createContext<{ pick?: ChoicePick; setPick: (pick?: ChoicePick) => void; enabled: boolean }>({ setPick: () => {}, enabled: false });

/** A, B, C… as the harness reads them. */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
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
    <div className="choice-options" style={{ ['--choice-columns' as string]: Math.min(item.options.length, 4) }}>
      {item.options.map((option, index) => (
        <div key={index} className={`choice-option${selected === index ? ' selected' : ''}`}>
          <div className="choice-frame">
            <button className="choice-open" aria-label={`View ${optionName(item, index)}`} onClick={() => setOpen(index)}>
              <OptionImage threadId={threadId} option={option} />
            </button>
            {(toggle || selected === index) && (
              <button className="choice-check" disabled={!toggle} aria-pressed={selected === index}
                aria-label={selected === index ? `Picked ${optionName(item, index)}` : `Pick ${optionName(item, index)}`}
                onClick={() => toggle?.(index)}><Check /></button>
            )}
          </div>
          <span className="choice-label">{optionName(item, index)}</span>
        </div>
      ))}
    </div>
    {open !== undefined && <ChoiceViewer threadId={threadId} item={item} start={open} selected={selected}
      onPick={toggle} onClose={() => setOpen(undefined)} />}
  </div>;
}

function OptionImage({ threadId, option }: { threadId: string; option: ChoiceOption }) {
  const url = useAssetUrl(threadId, option.asset);
  const [failed, setFailed] = useState(false);
  if (option.error || failed) return <span className="choice-missing">{option.error ?? 'This screenshot could not be loaded.'}</span>;
  return url ? <img src={url} alt={option.label} onError={() => setFailed(true)} /> : <span className="choice-missing" role="status">Loading…</span>;
}

function useAssetUrl(threadId: string, asset?: ThreadAsset) {
  const client = useClient();
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!asset) return;
    let active = true;
    void assetUrl(client, threadId, asset.id).then((result) => { if (active) setUrl(result.url); }, () => {});
    return () => { active = false; };
  }, [client, threadId, asset?.id]);
  return url;
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
