import { createContext, forwardRef, useContext } from 'react';
import { splitMentions, type MachineView, type MentionPart, type ModelView, type ThreadView } from '@accio/protocol';
import { ArrowLeft, Chevron, Layers, MessageSquare, Monitor, ProviderLogo } from '../app/icons';
import { PrettyName } from './ModelPicker';
import type { MentionKind, MentionOption, ThreadGroup } from './mentionQuery';

const GROUP_LABELS: Record<ThreadGroup, string> = { open: 'Open', working: 'Working', snoozed: 'Snoozed', settled: 'Settled' };
const KIND_LABELS: Record<MentionKind, string> = { models: 'Models', machines: 'Machines', threads: 'Threads' };
const kindOf = (o: MentionOption): MentionKind => 'model' in o ? 'models' : 'machine' in o ? 'machines' : 'thread' in o ? 'threads' : o.kind;

/**
 * The menu that opens while typing `@`. With only @ typed it offers Models, Machines and
 * Threads, each opening its list; once you type it lists the matches of every kind, a divider
 * between kinds and threads under their sidebar group. The highlighted one is picked with
 * Enter or Tab. It sits above the composer, starting under the @.
 */
export function MentionMenu({ options, active, left, browsing, onPick, onHover, onBack }: {
  options: MentionOption[]; active: number; left: number; browsing?: MentionKind;
  onPick: (option: MentionOption) => void; onHover: (index: number) => void; onBack: () => void;
}) {
  return <div className="mention-menu" role="listbox" aria-label="Mention a model, machine or thread" style={{ left }}>
    {browsing && <div className="mention-back" role="presentation" onMouseDown={(e) => e.preventDefault()} onClick={onBack}>
      <ArrowLeft />{KIND_LABELS[browsing]}<small>Backspace</small>
    </div>}
    {options.map((option, i) => {
      const previous = options[i - 1];
      const limited = 'model' in option && option.model.limited;
      const newKind = i > 0 && !!previous && kindOf(previous) !== kindOf(option) && !('kind' in option);
      const group = 'thread' in option && (!previous || !('thread' in previous) || previous.group !== option.group) ? GROUP_LABELS[option.group] : undefined;
      return <div key={option.handle} role="option" aria-selected={i === active} id={`mention-${option.handle}`}
        className={`mention-option${limited ? ' limited' : ''}${newKind ? ' new-kind' : ''}`}
        title={limited ? `${limited.label} is used up` : 'kind' in option ? undefined : `@${option.handle}`}
        data-group={group}
        // The textarea keeps focus, and with it the caret.
        onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => onHover(i)} onClick={() => onPick(option)}>
        {'model' in option
          ? <><ProviderLogo providerId={option.model.providerId} /><PrettyName name={option.model.name} /></>
          : 'machine' in option
            ? <><Monitor /><span className="mention-machine">{option.machine.name}</span>{option.machine.thisMachine && <small>This machine</small>}</>
            : 'thread' in option
              ? <><MessageSquare /><span className="mention-thread">{option.thread.title || 'Untitled'}</span></>
              : <><KindIcon kind={option.kind} />{option.label}<Chevron /></>}
      </div>;
    })}
  </div>;
}

function KindIcon({ kind }: { kind: MentionKind }) {
  return kind === 'models' ? <Layers /> : kind === 'machines' ? <Monitor /> : <MessageSquare />;
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

/** What a transcript's mentions are matched against: its thread's profile's models, the known machines, and that profile's threads. */
export const MentionTargets = createContext<{ models: ModelView[]; machines: MachineView[]; threads?: ThreadView[] }>({ models: [], machines: [] });

/** A sent message with each mention of an offered model, a known machine or a thread shown as a chip; the text itself is unchanged. */
export function MentionText({ text }: { text: string }) {
  const { models, machines, threads = [] } = useContext(MentionTargets);
  if ((!models.length && !machines.length && !threads.length) || !text.includes('@')) return <>{text}</>;
  return <>{splitMentions(text, models, machines, threads).map((part, i) => 'model' in part
    ? <span key={i} className="mention" title={`${part.model.name} · ${part.text}`}>
      <ProviderLogo providerId={part.model.providerId} /><PrettyName name={part.model.name} />
    </span>
    : 'machine' in part
      ? <span key={i} className="mention" title={`Machine ${part.machine.name} · ${part.text}`}><Monitor />{part.machine.name}</span>
      : 'thread' in part
        ? <span key={i} className="mention thread" title={`Thread ${part.thread.title || 'Untitled'} · ${part.text}`}><MessageSquare />{part.thread.title || 'Untitled'}</span>
        : part.text)}</>;
}

/**
 * The composer's text drawn behind its textarea, each mention as a pill (GLOSSARY: Model mention,
 * Machine mention, Thread mention). A textarea cannot hold elements, so the pill keeps the typed
 * characters and their widths: the @ gives way to the model's logo, a machine's or a thread's icon,
 * and a thread's id part is muted. The textarea's own text is transparent over it.
 */
export const MentionBackdrop = forwardRef<HTMLDivElement, { parts: MentionPart<ModelView, MachineView, ThreadView>[] }>(function MentionBackdrop({ parts }, ref) {
  return <div ref={ref} className="composer-backdrop" aria-hidden>
    {parts.map((part, i) => {
      if (!('model' in part) && !('machine' in part) && !('thread' in part)) return part.text;
      const icon = 'model' in part ? <ProviderLogo providerId={part.model.providerId} /> : 'machine' in part ? <Monitor /> : <MessageSquare />;
      const rest = part.text.slice(1);
      const id = 'thread' in part ? /-[a-z0-9]{6}$/i.exec(rest)?.[0] ?? '' : '';
      return <span key={i} className="composer-mention"><span className="at">@{icon}</span>{rest.slice(0, rest.length - id.length)}{id && <small>{id}</small>}</span>;
    })}
    {/* A trailing newline needs a character after it to take up its line, as in the textarea. */}
    {'\u200b'}
  </div>;
});
