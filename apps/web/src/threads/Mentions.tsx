import { createContext, useContext } from 'react';
import { splitMentions, type ModelView } from '@accio/protocol';
import { ProviderLogo } from '../app/icons';
import { PrettyName } from './ModelPicker';

/**
 * The menu that opens while typing `@`: a plain list of models, the highlighted one
 * picked with Enter or Tab. It sits above the composer, starting under the @.
 */
export function MentionMenu({ options, active, left, onPick, onHover }: {
  options: { model: ModelView; handle: string }[]; active: number; left: number;
  onPick: (handle: string) => void; onHover: (index: number) => void;
}) {
  return <div className="mention-menu" role="listbox" aria-label="Mention a model" style={{ left }}>
    {options.map(({ model, handle }, i) => <div key={handle} role="option" aria-selected={i === active} id={`mention-${handle}`}
      className={`mention-option${model.limited ? ' limited' : ''}`} title={model.limited ? `${model.limited.label} is used up` : `@${handle}`}
      // The textarea keeps focus, and with it the caret.
      onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => onHover(i)} onClick={() => onPick(handle)}>
      <ProviderLogo providerId={model.providerId} />
      <PrettyName name={model.name} />
    </div>)}
  </div>;
}

/** Where the character at `index` starts, in pixels from the textarea's left edge, measured on a hidden copy. */
export function caretLeft(textarea: HTMLTextAreaElement, index: number): number {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const prop of ['font', 'letterSpacing', 'padding', 'border', 'boxSizing', 'lineHeight', 'tabSize', 'wordSpacing'] as const) mirror.style[prop] = style[prop];
  Object.assign(mirror.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: `${textarea.clientWidth}px`, top: '0', left: '-9999px' });
  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = '|';
  mirror.append(marker);
  document.body.append(mirror);
  const left = marker.offsetLeft;
  mirror.remove();
  return left;
}

/** The models a transcript's mentions are matched against: its thread's profile's. */
export const MentionModels = createContext<ModelView[]>([]);

/** A sent message with each mention of an offered model shown as a chip; the text itself is unchanged. */
export function MentionText({ text }: { text: string }) {
  const models = useContext(MentionModels);
  if (!models.length || !text.includes('@')) return <>{text}</>;
  return <>{splitMentions(text, models).map((part, i) => 'model' in part
    ? <span key={i} className="mention" title={`${part.model.name} · ${part.text}`}>
      <ProviderLogo providerId={part.model.providerId} /><PrettyName name={part.model.name} />
    </span>
    : part.text)}</>;
}
