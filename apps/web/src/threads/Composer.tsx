import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from 'react';
import { foldsPaste, IMAGES_PER_MESSAGE, imageRefusal, joinPastes, normalizePaste, readsImage, type ModelSelection } from '@accio/protocol';
import { ArrowUp, Close, Queue, StopSquare } from '../app/icons';
import { useAppEvent } from '../app/appEvents';
import { useAction } from '../app/useAction';
import { useClient } from '../app/connection';
import { useLive } from '../app/useLive';
import { useThreads } from './threads';
import { caretLeft, MentionMenu } from './Mentions';
import { mentionAt, mentionOptions } from './mentionQuery';
import { useModels } from './useModels';
import { base64, pastedImages, prepareImage } from './pastedImage';
import { PasteChip } from './PastedText';
import { composerKey, useDraft } from './drafts';

/**
 * Enter steers the running turn; Ctrl+Enter queues. Shift+Enter adds a line.
 * Typing @ lists the profile's models and the online machines to mention (GLOSSARY: Model mention, Machine mention).
 * Pasted images go above the message when the model reads them (GLOSSARY: Image attachment).
 * A long text paste becomes a chip that sends before the message; Ctrl+Shift+V keeps it in the box (GLOSSARY: Pasted text).
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
  const { threads, shelves, selectedId, select } = useThreads();
  // GLOSSARY: Draft. Unsent text, Pasted text and images outlive this composer; sending or clearing them removes them.
  const { text, setText, pastes, setPastes, images, setImages } = useDraft(composerKey(client.hubId, draftId));
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
  const mention = caret === undefined ? undefined : mentionAt(text, caret);
  const options = mention && mention.start !== dismissed ? mentionOptions(models, mention.query, machines) : [];
  const active = Math.min(highlight, options.length - 1);
  const pickMention = (handle: string) => {
    const el = input.current;
    if (!el || !mention) return;
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
    if (next?.start !== mention?.start) setHighlight(0);
    if (dismissed !== undefined && next?.start !== dismissed) setDismissed(undefined);
  };
  const [imageError, setImageError] = useState<string>();
  const listed = model && models?.models.find((m) => m.harnessId === model.harnessId && m.id === model.modelId);
  const refusalFor = (mimeType: string) => imagesUnavailable ?? (listed && !readsImage(listed, mimeType) ? imageRefusal(listed.name, listed.imageTypes ?? [], mimeType) : undefined);
  // A model chosen after pasting may not read what is already here.
  const refused = images.map((image) => refusalFor(image.mimeType)).find(Boolean);
  const uploading = images.some((image) => !image.uploadId);
  const sendable = (!!text.trim() || !!attachment || images.length > 0 || pastes.length > 0) && !uploading && !refused;
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

  // Picking an option is the start of a message: put the cursor there.
  useEffect(() => { if (attachment) input.current?.focus(); }, [attachment?.label]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

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
    sending.current = true;
    try {
      await run(async () => {
        await onSend(joinPastes(sentPastes, value), mode, sent.map((image) => image.uploadId!), sent.map((image) => image.url));
        // Sent from a composer that has since closed (a started draft): forget its saved text too.
        if (!input.current || input.current.value === text) setText('');
        setImages((current) => current.filter((image) => !sent.includes(image)));
        setPastes((current) => current.filter((paste) => !sentPastes.includes(paste)));
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
        {(attachment || images.length > 0 || pastes.length > 0) && <div className="composer-chips">
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
        </div>}
        {options.length > 0 && mention && <MentionMenu options={options} active={active} onPick={pickMention} onHover={setHighlight}
          left={Math.min((input.current?.offsetLeft ?? 0) + (input.current ? caretLeft(input.current, mention.start) : 0), (input.current?.parentElement?.clientWidth ?? 0) - 240)} />}
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
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key.toLowerCase() === 'v' || e.code === 'KeyV')) pasteInline.current = Date.now();
            if (options.length > 0 && !e.nativeEvent.isComposing) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
                return;
              }
              if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                pickMention(options[active]!.handle);
                return;
              }
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
