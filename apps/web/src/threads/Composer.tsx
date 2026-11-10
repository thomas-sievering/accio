import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react';
import { foldsPaste, IMAGES_PER_MESSAGE, imageRefusal, joinPastes, normalizePaste, readsImage, splitMentions, type ModelSelection } from '@accio/protocol';
import { ArrowUp, Close, Queue, StopSquare } from '../app/icons';
import { useAppEvent } from '../app/appEvents';
import { useAction } from '../app/useAction';
import { useClient } from '../app/connection';
import { useLive } from '../app/useLive';
import { useThreads } from './threads';
import { caretLeft, MentionBackdrop, MentionMenu } from './Mentions';
import { mentionAt, mentionOptions, type MentionKind, type MentionOption } from './mentionQuery';
import { shelveThreads } from './shelves';
import { useModels } from './useModels';
import { base64, pastedImages, prepareImage } from './pastedImage';
import { PasteChip } from './PastedText';
import { ReactionChip } from './Reactions';
import { composerKey, useDraft } from './drafts';

/**
 * Enter steers the running turn; Ctrl+Enter queues. Shift+Enter adds a line.
 * Typing @ offers the profile's models, the online machines and the profile's threads to mention, each mention
 * then drawn as a pill (GLOSSARY: Model mention, Machine mention, Thread mention).
 * Pasted images go above the message when the model reads them (GLOSSARY: Image attachment).
 * A long text paste becomes a chip that sends before the message; Ctrl+Shift+V keeps it in the box (GLOSSARY: Pasted text).
 * A reaction picked over transcript text is a chip too, sent after the pastes (GLOSSARY: Reaction).
 */
export function Composer({
  onSend,
  onStop,
  stopDisabled,
  disabled,
  placeholder,
  toolbar,
  attachment,
  actions,
  target,
  draftId,
  profileId,
  model,
  handsOffImages,
  imagesUnavailable,
}: {
  /** `images` are upload ids, in the order they were pasted; `previews` their local copies. */
  onSend: (text: string, mode: 'steer' | 'queue' | undefined, images: string[], previews: string[]) => Promise<void>;
  /** Set while a turn runs; Stop stays beside Send. */
  onStop?: () => Promise<void>;
  /** Stop depends on reachability, independently of whether another message can send. */
  stopDisabled?: boolean;
  disabled: boolean;
  placeholder: string;
  /** Shown left of the send button. */
  toolbar?: ReactNode;
  /** A chip above the message, such as a picked option; with one, the message may be empty. */
  attachment?: { label: string; icon?: ReactNode; onRemove: () => void };
  /** Compact thread delivery controls, outside the message input. */
  actions?: ReactNode;
  /** Which `composer.insert` requests this composer accepts: its thread id, or 'draft'. */
  target: string;
  draftId: string;
  /** Whose models `@` offers. */
  profileId?: string;
  /** The model the message goes to, which must read any pasted image. */
  model?: ModelSelection;
  /** Sending hands the images' local copies to `onSend` to free, and each image travels into the sent message. */
  handsOffImages?: boolean;
  imagesUnavailable?: string;
}) {
  const client = useClient();
  const { threads, shelves, selectedId, select, now, placement } = useThreads();
  // GLOSSARY: Draft. Unsent text, Pasted text and images outlive this composer; sending or clearing them removes them.
  const { text, setText, pastes, setPastes, reactions, setReactions, images, setImages } = useDraft(composerKey(client.hubId, draftId));
  /** Set by Ctrl+Shift+V just before its paste event, which then keeps long text in the box. */
  const pasteInline = useRef(0);
  const [pasteHint, setPasteHint] = useState(false);
  const pasteShortcut = /Mac/.test(navigator.platform) ? '⌘⇧V' : 'Ctrl+Shift+V';
  const [controlHeld, setControlHeld] = useState(false);
  const { busy, error, run } = useAction();
  const sending = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const queuing = !!onStop && controlHeld;
  const { data: models } = useModels(profileId);
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  const [caret, setCaret] = useState<number>();
  const [highlight, setHighlight] = useState(0);
  /** The @ whose menu Escape closed; it stays closed until the caret leaves it. */
  const [dismissed, setDismissed] = useState<number>();
  /** The kind whose list the menu shows, picked from the first menu for the @ at `start`. */
  const [browsing, setBrowsing] = useState<{ start: number; kind: MentionKind }>();
  // Threads of the same profile, other than this one, grouped as the sidebar groups them.
  const mentionable = useMemo(() => profileId && threads
    ? shelveThreads(threads.filter((t) => t.profileId === profileId && t.id !== target), now, placement)
    : undefined, [threads, profileId, target, now, placement]);
  const mention = caret === undefined ? undefined : mentionAt(text, caret);
  const kind = browsing && browsing.start === mention?.start ? browsing.kind : undefined;
  const options = mention && mention.start !== dismissed ? mentionOptions(models, mention.query, machines, mentionable, kind) : [];
  const active = Math.min(highlight, options.length - 1);
  const pills = useMemo(() => {
    if (!text.includes('@')) return undefined;
    const parts = splitMentions(text, models?.models ?? [], machines ?? [], threads?.filter((t) => t.profileId === profileId && t.id !== target) ?? []);
    return parts.some((part) => 'model' in part || 'machine' in part || 'thread' in part) ? parts : undefined;
  }, [text, models, machines, threads, profileId, target]);
  const backdrop = useRef<HTMLDivElement>(null);
  const pickMention = (option: MentionOption) => {
    const el = input.current;
    if (!el || !mention) return;
    if ('kind' in option) { setBrowsing({ start: mention.start, kind: option.kind }); setHighlight(0); return; }
    const { handle } = option;
    const after = text.slice(caret);
    const insert = `@${handle}${/^\s/.test(after) ? '' : ' '}`;
    const end = mention.start + insert.length;
    setText(text.slice(0, mention.start) + insert + after);
    setCaret(end);
    requestAnimationFrame(() => el.setSelectionRange(end, end));
  };
  const trackCaret = () => {
    const el = input.current;
    const at = el && document.activeElement === el && el.selectionStart === el.selectionEnd ? el.selectionStart : undefined;
    setCaret(at);
    const next = at === undefined ? undefined : mentionAt(el!.value, at);
    if (next?.start !== mention?.start) { setHighlight(0); setBrowsing(undefined); }
    if (dismissed !== undefined && next?.start !== dismissed) setDismissed(undefined);
  };
  const [imageError, setImageError] = useState<string>();
  const listed = model && models?.models.find((m) => m.harnessId === model.harnessId && m.id === model.modelId);
  const refusalFor = (mimeType: string) => imagesUnavailable ?? (listed && !readsImage(listed, mimeType) ? imageRefusal(listed.name, listed.imageTypes ?? [], mimeType) : undefined);
  // A model chosen after pasting may not read what is already here.
  const refused = images.map((image) => refusalFor(image.mimeType)).find(Boolean);
  const uploading = images.some((image) => !image.uploadId);
  const sendable = (!!text.trim() || !!attachment || images.length > 0 || pastes.length > 0 || reactions.length > 0) && !uploading && !refused;
  const repairThread = error?.includes('A repair thread was started')
    ? threads?.filter((t) => t.repairToolId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;

  useEffect(() => {
    const modifier = (e: KeyboardEvent) => setControlHeld(e.ctrlKey || e.metaKey);
    const reset = () => setControlHeld(false);
    window.addEventListener('keydown', modifier);
    window.addEventListener('keyup', modifier);
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', reset);
    return () => {
      window.removeEventListener('keydown', modifier);
      window.removeEventListener('keyup', modifier);
      window.removeEventListener('blur', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, []);

  // Text another pane hands over (such as a skill reference) goes in at the cursor, without replacing the message.
  useAppEvent('composer.insert', ({ target: to, text: insert }) => {
    const el = input.current;
    if (!target || to !== target || !el) return;
    // A textarea keeps its selection while unfocused.
    const before = text.slice(0, el.selectionStart);
    const after = text.slice(el.selectionEnd);
    const lead = before && !/\s$/.test(before) ? ' ' : '';
    const trail = after && !/^\s/.test(after) ? ' ' : '';
    const next = before + lead + insert + trail + after;
    const end = (before + lead + insert + trail).length;
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(end, end); });
  });

  // The same passage reacted to again takes the new reaction rather than a second chip.
  useAppEvent('composer.react', ({ target: to, reaction }) => {
    if (!target || to !== target) return;
    setReactions((current) => [...current.filter((r) => r.quote !== reaction.quote), reaction]);
    input.current?.focus();
  });

  // Picking an option is the start of a message: put the cursor there.
  useEffect(() => { if (attachment) input.current?.focus(); }, [attachment?.label]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    syncBackdrop();
  }, [text, pills]);
  /** The pills follow the textarea's scroll, and wrap where its text does beside a scrollbar. */
  const syncBackdrop = () => {
    const el = input.current;
    const back = backdrop.current;
    if (!el || !back) return;
    back.style.width = `${el.clientWidth}px`;
    back.scrollTop = el.scrollTop;
  };

  /** Puts `insert` at the cursor, replacing the selection. */
  const insertAtCursor = (insert: string) => {
    const el = input.current;
    if (!el) return;
    const next = text.slice(0, el.selectionStart) + insert + text.slice(el.selectionEnd);
    const end = el.selectionStart + insert.length;
    setText(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(end, end); });
  };
  const editPaste = (index: number) => {
    const paste = pastes[index];
    if (paste === undefined) return;
    setPastes((current) => current.filter((_, i) => i !== index));
    setPasteHint(false);
    const el = input.current;
    const before = el ? text.slice(0, el.selectionStart) : text;
    insertAtCursor(`${before && !before.endsWith('\n') ? '\n' : ''}${paste}\n`);
  };

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = pastedImages(event.clipboardData);
    const inline = Date.now() - pasteInline.current < 1000;
    pasteInline.current = 0;
    if (!files.length) {
      const pasted = event.clipboardData.getData('text/plain');
      if (inline || !foldsPaste(pasted) || !normalizePaste(pasted).trim()) return;
      event.preventDefault();
      setPastes((current) => [...current, normalizePaste(pasted)]);
      setPasteHint(true);
      return;
    }
    event.preventDefault();
    setImageError(undefined);
    if (imagesUnavailable) { setImageError(imagesUnavailable); return; }
    // Reserve places before any await, so two quick pastes respect the limit together.
    const room = IMAGES_PER_MESSAGE - images.length;
    if (files.length > room) setImageError(`A message can carry ${IMAGES_PER_MESSAGE} images.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      const refusal = refusalFor(file.type || 'image/png');
      if (refusal) { setImageError(refusal); continue; }
      const key = crypto.randomUUID();
      const name = file.name && file.name !== 'image.png' ? file.name : 'Pasted image';
      setImages((current) => [...current, { key, name, mimeType: file.type, url: URL.createObjectURL(file) }]);
      void (async () => {
        const blob = await prepareImage(file);
        const { uploadId } = await client.call('threads.upload', { name, mimeType: blob.type as 'image/png', data: await base64(blob) });
        setImages((current) => current.map((image) => image.key === key ? { ...image, mimeType: blob.type, uploadId } : image));
      })().catch((cause: unknown) => {
        setImages((current) => current.filter((image) => { if (image.key === key) URL.revokeObjectURL(image.url); return image.key !== key; }));
        setImageError(cause instanceof Error ? cause.message : String(cause));
      });
    }
  };
  const removeImage = (key: string) => setImages((current) => current.filter((image) => {
    if (image.key === key) URL.revokeObjectURL(image.url);
    return image.key !== key;
  }));

  const submit = async (mode: 'steer' | 'queue' = 'steer') => {
    const value = text.trim();
    if (!sendable || disabled || sending.current) return;
    const sent = images;
    const sentPastes = pastes;
    const sentReactions = reactions;
    sending.current = true;
    try {
      await run(async () => {
        await onSend(joinPastes(sentPastes, value, sentReactions), mode, sent.map((image) => image.uploadId!), sent.map((image) => image.url));
        // Sent from a composer that has since closed (a started draft): forget its saved text too.
        if (!input.current || input.current.value === text) setText('');
        setImages((current) => current.filter((image) => !sent.includes(image)));
        setPastes((current) => current.filter((paste) => !sentPastes.includes(paste)));
        setReactions((current) => current.filter((reaction) => !sentReactions.includes(reaction)));
        setPasteHint(false);
        if (!handsOffImages) for (const image of sent) URL.revokeObjectURL(image.url);
        setImageError(undefined);
      });
    } finally {
      sending.current = false;
    }
  };

  return (
    <div className="composer-wrap">
      {actions}
      {(error || refused || imageError) && <p className="error composer-error" role="status">{refused ?? error ?? imageError}
        {/* A send refused for a broken tool points at the repair already under way. */}
        {repairThread && <> <button type="button" className="link" onClick={() => select(repairThread.id)}>Open repair thread</button></>}
      </p>}
      {pasteHint && pastes.length > 0 && !(error || refused || imageError) && <p className="composer-hint" role="status">
        Long paste kept as Pasted text, sent before your message. <kbd>{pasteShortcut}</kbd> pastes into the message instead.
      </p>}
      <form className="composer" onSubmit={(e: FormEvent) => { e.preventDefault(); void submit(queuing ? 'queue' : 'steer'); }}>
        {(attachment || images.length > 0 || pastes.length > 0 || reactions.length > 0) && <div className="composer-chips">
          {attachment && <span className="composer-chip">
            {attachment.icon}{attachment.label}
            <button type="button" aria-label={`Remove ${attachment.label}`} onClick={attachment.onRemove}><Close /></button>
          </span>}
          {images.map((image, index) => <span key={image.key} className={`composer-image${image.uploadId ? '' : ' uploading'}`}
            style={handsOffImages ? { viewTransitionName: `sent-image-${index}`, viewTransitionClass: 'sent-image' } : undefined}>
            <img src={image.url} alt={image.name} />
            <button type="button" aria-label={`Remove ${image.name}`} onClick={() => removeImage(image.key)}><Close /></button>
          </span>)}
          {pastes.map((paste, index) => <PasteChip key={index} text={paste} onEdit={() => editPaste(index)}
            onRemove={() => { setPastes((current) => current.filter((_, i) => i !== index)); setPasteHint(false); input.current?.focus(); }} />)}
          {reactions.map((reaction, index) => <ReactionChip key={`${index}:${reaction.quote}`} reaction={reaction}
            onChange={(kind) => setReactions((current) => current.map((r, i) => i === index ? { ...r, kind } : r))}
            onRemove={() => { setReactions((current) => current.filter((_, i) => i !== index)); input.current?.focus(); }} />)}
        </div>}
        {options.length > 0 && mention && <MentionMenu options={options} active={active} browsing={kind} onPick={pickMention} onHover={setHighlight}
          onBack={() => { setBrowsing(undefined); setHighlight(0); }}
          left={Math.min((input.current?.offsetLeft ?? 0) + (input.current ? caretLeft(input.current, mention.start) : 0), (input.current?.parentElement?.clientWidth ?? 0) - 240)} />}
        <div className={`composer-input${pills ? ' pills' : ''}`}>
        {pills && <MentionBackdrop ref={backdrop} parts={pills} />}
        <textarea
          ref={input}
          rows={1}
          value={text}
          placeholder={placeholder}
          spellCheck={false}
          autoFocus
          role="combobox"
          aria-expanded={options.length > 0}
          aria-autocomplete="list"
          aria-activedescendant={options.length > 0 ? `mention-${options[active]!.handle}` : undefined}
          onChange={(e) => setText(e.target.value)}
          onPaste={paste}
          onSelect={trackCaret}
          onFocus={trackCaret}
          onBlur={() => setCaret(undefined)}
          onScroll={syncBackdrop}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key.toLowerCase() === 'v' || e.code === 'KeyV')) pasteInline.current = Date.now();
            if (options.length > 0 && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
                return;
              }
              if ((e.key === 'Enter' || e.key === 'Tab' || (e.key === 'ArrowRight' && 'kind' in options[active]!)) && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                pickMention(options[active]!);
                return;
              }
              // Inside a kind's list, Backspace on a bare @ goes back to the kinds rather than deleting it.
              if ((e.key === 'Backspace' || e.key === 'ArrowLeft') && kind && !mention!.query) { e.preventDefault(); setBrowsing(undefined); setHighlight(0); return; }
              if (e.key === 'Escape') { e.preventDefault(); setDismissed(mention!.start); return; }
            }
            if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              const next = shelves.open[(shelves.open.findIndex((thread) => thread.id === selectedId) + 1) % shelves.open.length];
              if (next && next.id !== selectedId) {
                e.preventDefault();
                select(next.id);
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault();
              if (!e.repeat) void submit(onStop && (e.ctrlKey || e.metaKey) ? 'queue' : 'steer');
            }
          }}
        />
        </div>
        <div className="composer-bar">
          {toolbar}
          {onStop && sendable && <button type="button" className="composer-queue" disabled={disabled || busy} onClick={() => void submit('queue')}>Queue <kbd>Ctrl ↵</kbd></button>}
          {onStop && (
            <button
              type="button"
              className="send stop"
              disabled={stopDisabled || busy}
              aria-label="Stop"
              onClick={() => void run(onStop)}
            >
              <StopSquare />
            </button>
          )}
          <button type="submit" className={`send${queuing ? ' queue' : ''}`} aria-label={queuing ? 'Queue message' : 'Send'} disabled={disabled || busy || !sendable}
            onClick={e => { e.preventDefault(); void submit(onStop && (e.ctrlKey || e.metaKey) ? 'queue' : 'steer'); }}>
            {queuing ? <Queue /> : <ArrowUp />}
          </button>
        </div>
      </form>
    </div>
  );
}
