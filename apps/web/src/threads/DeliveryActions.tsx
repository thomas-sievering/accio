import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { shipBlockedReason, type DeliveryMode, type DeliverySummary, type ProjectView, type ThreadView } from '@accio/protocol';
import { emitAppEvent } from '../app/appEvents';
import { useClient, useConnectionStatus } from '../app/connection';
import { Archive, Check, ChevronDown, Close, Play, Refresh, Ship, StopSquare, Undo } from '../app/icons';
import { useAction } from '../app/useAction';
import { StatusGlyphIcon } from './StatusMark';
import { checkedAgo, deliveryStatus, requestedStatus, statusText } from './status';
import { useThreads } from './threads';
import { formatDayTime } from '../ui/dates';
import { usePopoverMenu } from '../ui/usePopoverMenu';
import { Button } from '../ui/Button';
import { useThreadAvailability } from './useThreadAvailability';
import { shipWhenDoneLabel, useShipWhenDone } from './ShipWhenDone';

/** Delivery intent stays on the server, including when this view is closed or disconnected. */
type CallMethod = 'threads.cancelDelivery' | 'threads.checkDelivery' | 'threads.archive' | 'threads.reopen';

export function DeliveryActions({ thread, project, canRun, active = true }: { thread: ThreadView; project?: ProjectView; canRun: boolean; active?: boolean }) {
  const client = useClient();
  const { unavailable, reason } = useThreadAvailability(thread);
  const connection = useConnectionStatus();
  const [summary, setSummary] = useState<DeliverySummary>();
  const [loadError, setLoadError] = useState<string>();
  const [mode, setMode] = useState<DeliveryMode>('ship');
  const [attempt, setAttempt] = useState(0);
  const { busy, error, run, attempt: tryCall } = useAction();
  const [calling, setCalling] = useState<CallMethod>();
  const id = useId();
  // Above the Ship split, reaching back from its chevron over the Ship button.
  const { props: menuProps, trigger, popover: menu } = usePopoverMenu({
    placement: { width: 310, side: 'above', height: 130, gap: 8, margin: 8, shift: -90 },
  });
  const pill = useRef<HTMLSpanElement>(null);
  useResizeGlide(pill);
  const { now, movesOn, moveOn } = useThreads();
  const delivery = thread.delivery;
  const released = !!thread.workspace?.releasedAt;
  // Settle also releases an unchanged worktree; only a released delivery reads as Archived.
  const archived = released && !!delivery;
  const target = delivery?.baseBranch ?? summary?.baseBranch ?? 'default branch';

  useEffect(() => {
    if (!thread.workspace || unavailable) return;
    let live = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await client.call('threads.deliverySummary', { threadId: thread.id });
        if (live) { setSummary(next); setLoadError(undefined); }
      } catch (err) { if (live) setLoadError((err as Error).message); }
      finally { pending = false; }
    };
    void refresh();
    const timer = thread.status === 'running' ? setInterval(() => void refresh(), 3000) : undefined;
    return () => { live = false; clearInterval(timer); };
  }, [client, connection, thread.id, thread.updatedAt, thread.workspace, thread.delivery, project?.previewCommand, attempt, unavailable, thread.status]);

  // Ship answers on the click: the pill shows the state the server is about to report
  // while it checks the target, and gives way once that state arrives.
  const [pending, setPending] = useState<Pending>();
  /** `running`: a turn is under way, also when it started too recently for this view to know. */
  const deliver = (running = thread.status === 'running') => {
    setPending({ from: thread.delivery?.id, running, mode });
    return tryCall(() => client.call('threads.deliver', { threadId: thread.id, mode }));
  };
  // GLOSSARY: Move on. Ship, like a send that starts a turn, opens the next inbox thread once the server takes it.
  const ship = async () => { if (await deliver() && movesOn) moveOn(thread.id); };
  const arrived = !!pending && thread.delivery?.id !== pending.from;
  // An idle thread reports queued for a moment before shipping starts; the pill does not step back to it.
  const passing = arrived && !pending.running && thread.status !== 'running' && thread.delivery?.status === 'queued';
  useEffect(() => {
    if (error || (arrived && !passing)) { setPending(undefined); return; }
    // Should shipping never start, the server's own state shows after a moment.
    if (passing) { const timer = setTimeout(() => setPending(undefined), 1500); return () => clearTimeout(timer); }
  }, [error, arrived, passing]);
  // Choosing an option only sets the mode; the main button starts delivery.
  const choose = (choice: DeliveryMode) => { setMode(choice); menu.current?.hidePopover(); trigger.current?.focus(); };
  const openApp = () => {
    const desktop = window.accioDesktop?.openPreview;
    // Reserve the tab during the user gesture, before the preview's asynchronous startup.
    const tab = desktop ? null : window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    void run(async () => {
      try {
        const { url } = await client.call('threads.openPreview', { threadId: thread.id });
        if (desktop) await desktop(url);
        else if (tab) tab.location.href = url;
        else throw new Error('Allow popups to open the app preview.');
      } catch (err) { tab?.close(); throw err; }
    });
  };

  // The Delivery panel opens once shipping actually starts, not when it is only queued.
  const phase = thread.workspace ? deliveryStatus(thread)?.phase : undefined;
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (phase === 'shipping' && lastPhase.current !== 'shipping') emitAppEvent('panel.show', 'delivery');
    lastPhase.current = phase;
  }, [phase]);

  const settled = !!thread.settledAt;
  const snoozedUntil = !settled && thread.snoozedUntil && new Date(thread.snoozedUntil) > now ? new Date(thread.snoozedUntil) : undefined;
  const status = !thread.workspace ? undefined : pending && (!arrived || passing) ? requestedStatus(pending.running, pending.mode, target) : deliveryStatus(thread);
  // The pill you pressed shows the wait; the rest are only disabled.
  const call = (method: CallMethod) => {
    setCalling(method);
    void run(async () => { await client.call(method, { threadId: thread.id }); }).finally(() => setCalling(undefined));
  };
  // A fresh request is offered with no delivery, after new work, or when a person must act.
  // Offered from the start: Ship when done can be queued before the first edit.
  // Work the agent already pushed to the target outside Ship leaves nothing to ship.
  const onBase = !!summary?.onBase && (!status || status.canShip);
  const offerShip = (!status || status.canShip) && !onBase;
  const inFlight = status?.phase === 'queued' || status?.phase === 'paused' || status?.phase === 'shipping';
  const receipt = status?.phase === 'delivered';
  const age = checkedAgo(status?.checkedAt, now);
  // The chip already says "Waiting for merge · #123"; a review request only adds when it was last checked.
  const reviewWait = thread.delivery?.mode === 'review' && status?.phase === 'waiting' && !status.followUpsStopped;
  const hint = archived || receipt ? undefined
    : settled ? undefined
    : status?.phase === 'queued' || status?.phase === 'shipping' ? undefined
    : [reviewWait ? undefined : status?.detail, status && ['waiting', 'integrated', 'unavailable'].includes(status.phase) ? age : undefined].filter(Boolean).join(' · ') || undefined;
  const statusName = status && statusText(status.label, status.pullRequest);
  // Why Ship can't run now: its button's title, and the reason Ship when done gives.
  const shipBlocked = unavailable ?? shipBlockedReason(thread) ?? (!canRun ? 'Sign in to this profile to ship'
    : !summary ? 'Checking the workspace'
    : shipBlockedReason(thread, summary));

  // GLOSSARY: Ship when done. While a message is being written, Ship arms it in the composer instead,
  // which is unavailable wherever Ship is, for the same reason.
  const composer = useShipWhenDone();
  const arming = !!composer && (composer.composing || composer.armed);
  const shipReason = !thread.workspace || released ? undefined
    : inFlight ? 'Delivery is already requested'
    : !offerShip ? onBase ? `Already on ${target}` : statusName ?? 'Nothing to ship'
    : shipBlocked;
  const offered = !!thread.workspace && !released;
  const latestDeliver = useRef(deliver);
  latestDeliver.current = deliver;
  const offer = composer?.offer;
  useEffect(() => {
    // The send has just started or steered a turn, which the delivery then waits behind.
    offer?.(offered ? { mode, reason: shipReason, deliver: () => void latestDeliver.current(true) } : undefined);
  }, [offer, offered, mode, shipReason]);
  useEffect(() => () => offer?.(undefined), [offer]);
  // Alt+S anywhere in the open thread presses Ship: it ships, or while writing arms Ship when done.
  // By key code: Alt+S types ß on a Mac keyboard. Another text field keeps the key for itself.
  const shipEnabled = offered && !inFlight && offerShip && !shipBlocked && !busy;
  const pressShip = useRef(() => {});
  pressShip.current = () => {
    // Like Ship, it arms only what can ship; an armed chip always comes off.
    if (arming) { if (composer.armed || !shipReason) composer.toggle(); }
    else if (shipEnabled) void ship();
  };
  useEffect(() => {
    if (!active || !offered) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !e.altKey || e.code !== 'KeyS' || e.shiftKey || e.ctrlKey || e.metaKey) return;
      const field = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
      if (field && !field.closest('.composer')) return;
      e.preventDefault();
      if (!e.repeat) pressShip.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, offered]);

  // A settled or snoozed thread always has its state row, even when it never had a workspace.
  if (!thread.workspace && !settled && !snoozedUntil) return null;
  const hasChip = !!thread.workspace && (archived || (!!status && status.phase !== 'superseded'));
  const checkingCI = delivery?.status === 'waiting' && (status?.phase === 'integrated'
    ? delivery.waitingOn !== 'agent'
    : status?.phase === 'waiting' && (delivery.waitingOn ?? 'checks') === 'checks');
  const statusBody = status && <>
    {checkingCI ? <span className="row-working delivery-ci-spinner" aria-hidden="true" /> : <StatusGlyphIcon glyph={status.glyph} tone={status.tone} />}
    <span className="delivery-status-text">{statusName}</span>
    {status.pullRequest && <span className="delivery-ext" aria-hidden="true">↗</span>}
  </>;

  return <div className="delivery-actions">
    <div className="delivery-row" aria-label="Delivery actions" title={unavailable}>
      {!thread.workspace || (released && !archived) ? null : archived ? <span className="delivery-pill delivery-complete"><Check />Archived · history kept</span> : <>
        {!receipt && summary && (summary.added > 0 || summary.removed > 0) && <DiffPill summary={summary} />}
        {/* Line changes stay left; delivery state and actions sit right, beside the composer's send. */}
        <span className="delivery-spacer" aria-hidden="true" />
        {!inFlight && status && status.phase !== 'superseded' && <span className={`delivery-split delivery-status tone-${status.tone}`} role="status" title={receipt ? 'Workspace retained' : undefined}>
          {status.pullRequest
            ? <a href={status.pullRequest.url} target="_blank" rel="noreferrer" title={`Open PR #${status.pullRequest.number}`}>{statusBody}</a>
            : <span>{statusBody}</span>}
          {receipt && status.revision && <span className="delivery-rev" title="Revision on the target">{status.revision}</span>}
        </span>}
        {onBase && <span className="delivery-pill delivery-complete" title="This thread's commits are already on the target and nothing is uncommitted"><Check />Already on {target}</span>}
        {/* One element from Ship through queued to shipping: it resizes in place and the sparkles carry on instead of restarting. */}
        {inFlight ? <span ref={pill} className={`delivery-split delivery-queued${status.phase === 'paused' ? '' : ' delivery-sparkly'}${status.phase === 'shipping' ? ' delivery-shipping' : ''}`}>
          {status.phase !== 'paused' && <span className="delivery-sparkles" aria-hidden="true">
            {Array.from({ length: 9 }, (_, i) => <i key={i} />)}
          </span>}
          <span role="status" key={status.phase} className="delivery-swap"><StatusGlyphIcon glyph={status.glyph} tone={status.tone} />{status.label}{status.phase === 'shipping' && '…'}</span>
          {status.canCancel && status.phase !== 'shipping' && <button disabled={!!unavailable || busy} aria-label="Cancel queued delivery" title="Cancel queued delivery" onClick={() => call('threads.cancelDelivery')}><Close /></button>}
        </span>
        : offerShip && <span ref={pill} className="delivery-split">
          <button disabled={!!shipBlocked || busy} aria-pressed={composer ? composer.armed : undefined}
            title={shipBlocked ?? (arming ? `${shipWhenDoneLabel(mode)}: sends with your message (Alt+S)` : mode === 'review' ? 'Prepare a PR without merging (Alt+S)' : `Finish, verify and ship to ${target} (Alt+S)`)}
            onClick={() => { if (arming) composer.toggle(); else void ship(); }}><Ship />{mode === 'review' ? 'Prepare for review' : 'Ship'}</button>
          <button ref={trigger} popoverTarget={id} disabled={!!unavailable || busy || !summary?.available || !!thread.queuedMessages?.length} aria-label="Shipping options" aria-haspopup="menu"><ChevronDown /></button>
        </span>}
        {status?.canCheck && <Button className="delivery-pill" disabled={!!unavailable || busy} busy={calling === 'threads.checkDelivery'} busyLabel="Checking…" onClick={() => call('threads.checkDelivery')}><Refresh />Check now</Button>}
        {status?.canStopFollowUps && <button className="delivery-pill" disabled={!!unavailable || busy} title="The PR stays tracked; the agent no longer starts to fix failing checks" onClick={() => call('threads.cancelDelivery')}><StopSquare />Stop automatic fixes</button>}
        {status?.canCancel && status.phase !== 'queued' && <button className="delivery-pill" disabled={!!unavailable || busy} onClick={() => call('threads.cancelDelivery')}><Close />Cancel delivery</button>}
      </>}
      {settled && !hasChip && <span className="delivery-settled">Settled</span>}
      {snoozedUntil && <span className="delivery-settled">Snoozed until {formatDayTime(snoozedUntil, now)}</span>}
      {settled && <Button className="delivery-pill" disabled={!!unavailable || busy} busy={calling === 'threads.reopen'} busyLabel="Reopening…" onClick={() => call('threads.reopen')}><Undo />Reopen</Button>}
      {snoozedUntil && <Button className="delivery-pill" disabled={!!unavailable || busy} busy={calling === 'threads.reopen'} busyLabel="Waking…"
        onClick={() => call('threads.reopen')}><Undo />Wake now</Button>}
      {!released && (receipt || settled) && thread.workspace && <Button className="delivery-pill" disabled={!!unavailable || busy || thread.status === 'running'} busy={calling === 'threads.archive'} busyLabel="Archiving…" title="Frees the workspace, keeps this thread" onClick={() => call('threads.archive')}>
        <Archive />Archive
      </Button>}
      {!client.browser && !released && !reason('threads.openPreview') && summary?.previewAvailable && <button className="delivery-pill" disabled={!!unavailable || busy} onClick={openApp}><Play />Open app</button>}
    </div>
    {hint && <p className={`delivery-hint tone-${status?.tone ?? 'ready'}`} role={status?.phase === 'attention' || status?.phase === 'closed' ? 'alert' : undefined}
      title={status?.phase === 'unavailable' ? thread.delivery?.observationError : undefined}>
      {/* The chip beside it already carries the tone; only a call to act keeps its own mark. */}
      {status?.tone === 'attention' && <span className="delivery-dot" aria-hidden="true" />}<span className="delivery-hint-text">{hint}</span>
    </p>}
    <div id={id} {...menuProps} className="menu delivery-menu" popover="auto" role="menu" aria-label="Shipping options">
      <button className="menu-item" role="menuitemradio" aria-checked={mode === 'ship'} disabled={!!unavailable || busy || !canRun} onClick={() => choose('ship')}>
        <span className="delivery-check">{mode === 'ship' && <Check />}</span>
        <span className="menu-text">Ship to {target}<small>{project?.deliveryPolicy === 'pull-request' ? 'Rebase, test and merge through a PR.' : 'Rebase, test and push when ready.'}</small></span>
      </button>
      <button className="menu-item" role="menuitemradio" aria-checked={mode === 'review'} disabled={!!unavailable || busy || !canRun} onClick={() => choose('review')}>
        <span className="delivery-check">{mode === 'review' && <Check />}</span>
        <span className="menu-text">Prepare for review<small>Rebase, test and open a PR. Never merges.</small></span>
      </button>
    </div>
    {(error || loadError) && <p className="delivery-error" role="alert">{error ?? loadError}{loadError && <button className="ghost" onClick={() => setAttempt(n => n + 1)}>Retry</button>}</p>}
  </div>;
}

/**
 * When a render changes the element's width, it glides from the old width to the new one
 * rather than snapping. Runs after every render, since any state can change the label.
 */
const GLIDE_MS = 320;

function useResizeGlide(ref: RefObject<HTMLElement | null>) {
  const last = useRef<{ node: HTMLElement; width: number; glide?: Animation }>(undefined);
  useLayoutEffect(() => {
    const node = ref.current;
    const prev = last.current;
    if (!node) { prev?.glide?.cancel(); last.current = undefined; return; }
    const gliding = prev?.node === node && prev.glide?.playState === 'running' ? prev.glide : undefined;
    // Mid-glide, the next one starts from where this one has got to.
    const from = gliding ? node.getBoundingClientRect().width : prev?.node === node ? prev.width : undefined;
    const elapsed = Number(gliding?.currentTime ?? 0);
    gliding?.cancel();
    const to = node.getBoundingClientRect().width;
    last.current = { node, width: to };
    if (from === undefined || Math.abs(from - to) < 4 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // A render that keeps the same target only finishes the glide already under way.
    const duration = gliding && Math.abs(prev!.width - to) < 1 ? Math.max(GLIDE_MS - elapsed, 1) : GLIDE_MS;
    node.classList.add('delivery-resizing');
    const glide = node.animate({ width: [`${from}px`, `${to}px`] }, { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    // A glide replaced by the next one leaves the class to it.
    glide.onfinish = glide.oncancel = () => { if (!last.current?.glide || last.current.glide === glide) node.classList.remove('delivery-resizing'); };
    last.current.glide = glide;
  });
}

/** Added and removed exclude the paired edits, which show as an approximate modified count. */
function DiffPill({ summary }: { summary: DeliverySummary }) {
  const modified = summary.modified ?? 0;
  const added = summary.added - modified, removed = summary.removed - modified;
  const label = [added && `${added} lines added`, removed && `${removed} lines removed`, modified && `about ${modified} lines modified`].filter(Boolean).join(', ');
  return <span className="delivery-pill delivery-diff" title={`${summary.files} changed ${summary.files === 1 ? 'file' : 'files'}`} aria-label={label}>
    {added > 0 && <span className="delivery-added">+{added}</span>}
    {removed > 0 && <span className="delivery-removed">−{removed}</span>}
    {modified > 0 && <span className="delivery-modified">~{modified}</span>}
  </span>;
}

/** A Ship click the server has not yet recorded: the delivery it replaces and what the new one will be. */
type Pending = { from?: string; running: boolean; mode: DeliveryMode };
