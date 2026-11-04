import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ParamsOf, SecretRequestItem } from '@accio/protocol';
import { useClient } from '../app/connection';
import { Check, Key, MinusCircle } from '../app/icons';
import { useSecretStore } from './secrets';
import { safeError, valueInputProps, valueProblem } from './secretValue';

type Answer = ParamsOf<'secretRequests.answer'>['answer'];
type Action = Answer['type'];

const FILE_NOTE = 'Kept out of chat. Commands in this turn can read this secret.';

/**
 * A thread's request for a secret it does not have. Pending, it asks inline;
 * answered, it collapses to a value-free record. A saved secret the project may
 * already use never reaches the pending state: it arrives as a quiet use record.
 */
export function SecretRequestCard({ threadId, item, onOpenSecrets }: { threadId: string; item: SecretRequestItem; onOpenSecrets?: (profileId: string) => void }) {
  const section = useRef<HTMLElement>(null);
  const focused = useRef(false);
  const pending = item.status === 'pending';

  // Answering removes the focused control; keep keyboard focus on the card.
  useLayoutEffect(() => {
    if (!pending && focused.current && (document.activeElement === document.body || !document.activeElement)) section.current?.focus();
  }, [pending]);

  return (
    <section
      ref={section}
      className={`secret${pending ? '' : ' done'}`}
      aria-label={pending ? `Secret requested: ${item.label}` : recordTitle(item)}
      tabIndex={-1}
      onFocus={() => { focused.current = true; }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) focused.current = false; }}
    >
      {pending ? <PendingSecret threadId={threadId} item={item} /> : <SecretRecord item={item} onOpenSecrets={onOpenSecrets} />}
    </section>
  );
}

function PendingSecret({ threadId, item }: { threadId: string; item: SecretRequestItem }) {
  const client = useClient();
  const inputId = useId();
  const hintId = useId();
  const canSave = item.projectId !== null;
  const store = useSecretStore(canSave);
  const saveUnavailable = canSave && store?.available === false;
  const [value, setValue] = useState('');
  const [chosen, setChosen] = useState('');
  const [sending, setSending] = useState<Action>();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const tooLarge = valueProblem(value);
  const locked = !!sending || sent;
  const canSend = !locked && value.length > 0 && !tooLarge;
  const chosenSecret = item.candidates.find((c) => c.id === chosen);

  const answer = async (a: Answer) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(a.type);
    setError(undefined);
    const typed = 'value' in a ? a.value : '';
    try {
      await client.call('secretRequests.answer', { threadId, requestId: item.requestId, answer: a });
      // The server now updates this item; until it does, nothing can be sent again.
      setValue('');
      setSent(true);
    } catch (err) {
      inFlight.current = false;
      setError(safeError(err, typed, {
        decline: 'Could not decline the request. Try again.',
        existing: `Couldn't hand the saved secret to ${item.machineName}. Try again.`,
        save: `Couldn't save and hand over the secret. Try again, or use it once.`,
        once: `Couldn't hand the secret to ${item.machineName}. Nothing was saved; try again.`,
      }[a.type]));
    } finally {
      setSending(undefined);
    }
  };
  const primary: Action = canSave && !saveUnavailable ? 'save' : 'once';
  const sendValue = (type: 'save' | 'once') => { if (canSend) void answer({ type, value }); };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendValue(primary === 'save' ? 'save' : 'once');
    }
  };
  const where = `${item.profileName} / ${item.projectName}`;

  return (
    <div className="secret-body" aria-busy={locked || undefined}>
      <div className="secret-head">
        <Key />
        <b>{item.label}</b>
        <span className="secret-state"><span className="secret-dot" />Needs a secret</span>
      </div>
      {item.reason && <p className="secret-why">{item.reason}</p>}
      <p className="secret-meta">
        <span><i>Profile</i>{item.profileName}</span>
        <span><i>Project</i>{item.projectId ? item.projectName : 'No project'}</span>
        <span><i>Machine</i>{item.machineName}</span>
      </p>

      {item.candidates.length > 0 && (
        <fieldset className="secret-saved" disabled={locked}>
          <legend>Use a saved {item.profileName} secret</legend>
          {item.candidates.map((c) => (
            <label key={c.id} className="check">
              <input type="radio" name={`${item.id}:saved`} value={c.id} checked={chosen === c.id} onChange={() => setChosen(c.id)} />
              <span>{c.name}<small>{c.profileWide ? `All ${item.profileName} projects` : `Saved ${new Date(c.updatedAt).toLocaleDateString()}`}</small></span>
            </label>
          ))}
          <div className="secret-saved-foot">
            <small className="hint">
              {chosenSecret && item.projectId && !chosenSecret.profileWide
                ? `${item.projectName} will be added to ${chosenSecret.name}'s projects; later requests here use it without asking.`
                : item.projectId ? `Later requests in ${item.projectName} use the chosen secret without asking.` : 'Used for this request.'}
            </small>
            <button type="button" className="ghost" disabled={!chosen || locked} onClick={() => void answer({ type: 'existing', secretId: chosen })}>
              {sending === 'existing' ? 'Using…' : 'Use selected'}
            </button>
          </div>
        </fieldset>
      )}

      <label className={item.candidates.length ? 'secret-label' : 'secret-sr'} htmlFor={inputId}>
        {item.candidates.length ? 'Or paste a new value' : item.label}
      </label>
      <input
        id={inputId}
        className="secret-input"
        {...valueInputProps}
        placeholder="Paste secret"
        value={value}
        readOnly={locked}
        aria-invalid={tooLarge ? true : undefined}
        aria-describedby={hintId}
        onChange={(e) => { setValue(e.target.value); setError(undefined); }}
        onKeyDown={onKeyDown}
      />
      {(tooLarge || error) && <p className="secret-error" role="alert">{tooLarge ?? error}</p>}
      <p id={hintId} className="secret-scope">
        {!canSave ? 'Use once hands it to this turn without saving it.'
          : saveUnavailable ? `Saving is unavailable${store?.reason ? `: ${store.reason}` : '.'} Use once still works and saves nothing.`
          : `Save & use keeps it on the Hub for ${where}, so later requests in this project won't ask. Use once saves nothing.`}
      </p>
      <div className="secret-foot">
        <p className="secret-note">{FILE_NOTE}</p>
        <button type="button" className="ghost" disabled={locked} onClick={() => void answer({ type: 'decline' })}>
          {sending === 'decline' ? 'Declining…' : 'Decline'}
        </button>
        <button type="button" className={`ghost${primary === 'once' ? ' primary' : ''}`} disabled={!canSend} onClick={() => sendValue('once')}>
          {sending === 'once' ? 'Using…' : 'Use once'}
        </button>
        {canSave && (
          <button type="button" className="ghost primary" disabled={!canSend || saveUnavailable} onClick={() => sendValue('save')}>
            {sending === 'save' ? 'Saving…' : 'Save & use'}
          </button>
        )}
      </div>
      <p className="secret-sr" role="status">{sending ? (sending === 'decline' ? 'Declining…' : 'Sending secret…') : sent ? 'Sent' : ''}</p>
    </div>
  );
}

function recordTitle(item: SecretRequestItem): string {
  if (item.status === 'provided') {
    if (item.source === 'reused') return `Using ${item.secretName ?? item.label}`;
    if (item.source === 'saved') return 'Secret saved for this project';
    return 'Secret supplied';
  }
  return { declined: 'Declined', expired: 'Request expired', cancelled: 'Request cancelled', pending: 'Needs a secret' }[item.status];
}

function SecretRecord({ item, onOpenSecrets }: { item: SecretRequestItem; onOpenSecrets?: (profileId: string) => void }) {
  const provided = item.status === 'provided';
  const saved = provided && (item.source === 'saved' || item.source === 'reused');
  const scope = item.projectId ? `${item.profileName} / ${item.projectName}` : item.profileName;
  return (
    <div className={`secret-done${provided ? '' : ' muted'}`} role="status">
      {provided ? <Check /> : <MinusCircle />}
      <b>{recordTitle(item)}</b>
      <span className="what">{saved ? `Saved for ${scope}` : item.label}</span>
      {provided && item.source !== 'saved' && item.source !== 'reused' && <span className="when">For this turn · up to 15 min</span>}
      {saved && onOpenSecrets && <button type="button" className="link when" onClick={() => onOpenSecrets(item.profileId)}>Manage</button>}
    </div>
  );
}
