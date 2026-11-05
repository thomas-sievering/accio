import { createContext, useContext } from 'react';
import { splitMentions, type MachineView, type ModelView } from '@accio/protocol';
import { Monitor, ProviderLogo } from '../app/icons';
import { PrettyName } from './ModelPicker';
import type { MentionOption } from './mentionQuery';

/**
 * The menu that opens while typing `@`: a plain list of models, then online machines
 * under a divider, the highlighted one picked with Enter or Tab. It sits above the
 * composer, starting under the @.
 */
export function MentionMenu({ options, active, left, onPick, onHover }: {
  options: MentionOption[]; active: number; left: number;
  onPick: (handle: string) => void; onHover: (index: number) => void;
}) {
  return <div className="mention-menu" role="listbox" aria-label="Mention a model or machine" style={{ left }}>
    {options.map((option, i) => {
      const limited = 'model' in option && option.model.limited;
      const firstMachine = 'machine' in option && (i === 0 || 'model' in options[i - 1]!);
      return <div key={option.handle} role="option" aria-selected={i === active} id={`mention-${option.handle}`}
        className={`mention-option${limited ? ' limited' : ''}${firstMachine && i > 0 ? ' first-machine' : ''}`}
        title={limited ? `${limited.label} is used up` : `@${option.handle}`}
        // The textarea keeps focus, and with it the caret.
        onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => onHover(i)} onClick={() => onPick(option.handle)}>
        {'model' in option
          ? <><ProviderLogo providerId={option.model.providerId} /><PrettyName name={option.model.name} /></>
          : <><Monitor /><span className="mention-machine">{option.machine.name}</span>{option.machine.thisMachine && <small>This machine</small>}</>}
      </div>;
    })}
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

/** What a transcript's mentions are matched against: its thread's profile's models, and the known machines. */
export const MentionTargets = createContext<{ models: ModelView[]; machines: MachineView[] }>({ models: [], machines: [] });

/** A sent message with each mention of an offered model or a known machine shown as a chip; the text itself is unchanged. */
export function MentionText({ text }: { text: string }) {
  const { models, machines } = useContext(MentionTargets);
  if ((!models.length && !machines.length) || !text.includes('@')) return <>{text}</>;
  return <>{splitMentions(text, models, machines).map((part, i) => 'model' in part
    ? <span key={i} className="mention" title={`${part.model.name} · ${part.text}`}>
      <ProviderLogo providerId={part.model.providerId} /><PrettyName name={part.model.name} />
    </span>
    : 'machine' in part
      ? <span key={i} className="mention" title={`Machine ${part.machine.name} · ${part.text}`}><Monitor />{part.machine.name}</span>
      : part.text)}</>;
}
