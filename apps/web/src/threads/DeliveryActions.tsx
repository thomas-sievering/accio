import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { DeliveryMode, DeliverySummary, ProjectView, ThreadView } from '@accio/protocol';
import { useClient, useConnectionStatus } from '../app/connection';
import { Archive, Check, ChevronDown, Close, Play, Refresh, Ship, StopSquare, Undo } from '../app/icons';
import { useAction } from '../app/useAction';
import { DeliveryProgress } from './DeliveryProgress';
import { StatusGlyphIcon } from './StatusMark';
import { checkedAgo, deliveryStatus, statusText } from './status';
import { useThreads } from './threads';

/** Delivery intent stays on the server, including when this view is closed or disconnected. */
export function DeliveryActions({ thread, project, canRun }: { thread: ThreadView; project?: ProjectView; canRun: boolean }) {
  const client = useClient();
  const connection = useConnectionStatus();
  const [summary, setSummary] = useState<DeliverySummary>();
  const [loadError, setLoadError] = useState<string>();
  const [mode, setMode] = useState<DeliveryMode>('ship');
  const [attempt, setAttempt] = useState(0);
  const { busy, error, run } = useAction();
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const { now } = useThreads();
  const delivery = thread.delivery;
  const shipWhenDone = delivery?.status === 'queued' && thread.status === 'running';
  const archived = !!thread.workspace?.releasedAt;
  const target = delivery?.baseBranch ?? summary?.baseBranch ?? 'default branch';

  useEffect(() => {
    if (!thread.workspace || connection !== 'open') return;
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
  }, [client, connection, thread.id, thread.updatedAt, thread.workspace, thread.delivery, project?.previewCommand, attempt]);

  const deliver = (choice: DeliveryMode) => {
    setMode(choice);
    menu.current?.hidePopover();
    void run(async () => { await client.call('threads.deliver', { threadId: thread.id, mode: choice }); });
  };
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

  if (!thread.workspace) return null;
  const status = deliveryStatus(thread);
  const call = (method: 'threads.cancelDelivery' | 'threads.checkDelivery' | 'threads.archive' | 'threads.reopen') =>
    void run(async () => { await client.call(method, { threadId: thread.id }); });
  const settled = !!thread.settledAt;
  // A fresh request is offered with no delivery, after new work, or when a person must act.
  const offerShip = !status || status.canShip;
  const receipt = status?.phase === 'delivered';
  const age = checkedAgo(status?.checkedAt, now);
  const hint = archived ? undefined : receipt
    ? settled ? 'Thread settled · Workspace retained' : delivery?.keepOpen ? 'Kept open · Workspace retained' : 'Workspace retained'
    : status?.phase === 'queued' || status?.phase === 'shipping' ? undefined
    : [status?.detail, status && ['waiting', 'integrated', 'unavailable'].includes(status.phase) ? age : undefined].filter(Boolean).join(' · ') || undefined;
  const statusName = status && statusText(status.label, status.pullRequest);
  const statusBody = status && <>
    <StatusGlyphIcon glyph={status.glyph} tone={status.tone} />
    {statusName}
    {status.pullRequest && <span className="delivery-ext" aria-hidden="true">↗</span>}
  </>;

  return <div className="delivery-actions">
    <div className="delivery-row" aria-label="Delivery actions">
      {archived ? <span className="delivery-pill delivery-complete"><Check />Archived · history kept</span> : <>
        {!receipt && summary && <span className="delivery-pill delivery-diff" title={`${summary.files} changed ${summary.files === 1 ? 'file' : 'files'}`} aria-label={`${summary.added} lines added, ${summary.removed} lines removed`}>
          <span className="delivery-added">+{summary.added}</span><span className="delivery-removed">−{summary.removed}</span>
        </span>}
        {status?.phase === 'queued' || status?.phase === 'paused' ? <span className={`delivery-split delivery-queued${shipWhenDone ? ' delivery-armed' : ''}`}>
          {shipWhenDone && <span className="delivery-sparkles" aria-hidden="true"><i /><i /><i /><i /><i /></span>}
          <span role="status"><StatusGlyphIcon glyph={status.glyph} tone={status.tone} />{status.label}</span>
          {status.canCancel && <button disabled={busy} aria-label="Cancel queued delivery" title="Cancel queued delivery" onClick={() => call('threads.cancelDelivery')}><Close /></button>}
        </span> : status?.phase === 'shipping' ? <span className="delivery-pill delivery-queued" role="status"><StatusGlyphIcon glyph={status.glyph} tone={status.tone} />{status.label}…</span>
        : status && status.phase !== 'superseded' && <span className={`delivery-split delivery-status tone-${status.tone}`} role="status">
          {status.pullRequest
            ? <a href={status.pullRequest.url} target="_blank" rel="noreferrer" title={`Open PR #${status.pullRequest.number}`}>{statusBody}</a>
            : <span>{statusBody}</span>}
          {receipt && status.revision && <span className="delivery-rev" title="Revision on the target">{status.revision}</span>}
        </span>}
        {offerShip && <span className="delivery-split">
          <button disabled={busy || !canRun || !summary?.available || !!thread.queuedMessages?.length} title={thread.queuedMessages?.length ? 'Send or remove queued messages first' : summary?.reason ?? (mode === 'review' ? 'Prepare a PR without merging' : `Finish, verify and ship to ${target}`)} onClick={() => deliver(mode)}><Ship />{mode === 'review' ? 'Prepare for review' : 'Ship'}</button>
          <button ref={trigger} popoverTarget={id} disabled={busy || !summary?.available || !!thread.queuedMessages?.length} aria-label="Shipping options" aria-haspopup="menu"><ChevronDown /></button>
        </span>}
        {status?.canCheck && <button className="delivery-pill" disabled={busy} onClick={() => call('threads.checkDelivery')}><Refresh />Check now</button>}
        {status?.canStopFollowUps && <button className="delivery-pill" disabled={busy} title="Keep tracking the PR without starting the agent again" onClick={() => call('threads.cancelDelivery')}><StopSquare />Stop automatic follow-ups</button>}
        {status?.canCancel && status.phase !== 'queued' && <button className="delivery-pill" disabled={busy} onClick={() => call('threads.cancelDelivery')}><Close />Cancel delivery</button>}
        {receipt && <>
          {settled && <button className="delivery-pill" disabled={busy} onClick={() => call('threads.reopen')}><Undo />Reopen</button>}
          <button className="delivery-pill" disabled={busy || thread.status === 'running'} title="Frees the workspace, keeps this thread" onClick={() => call('threads.archive')}>
            <Archive />{busy ? 'Archiving…' : 'Archive'}
          </button>
        </>}
      </>}
      {!archived && summary?.previewAvailable && <button className="delivery-pill" disabled={busy} onClick={openApp}><Play />Open app</button>}
    </div>
    {hint && <p className={`delivery-hint tone-${status?.tone ?? 'ready'}`} role={status?.phase === 'attention' || status?.phase === 'closed' ? 'alert' : undefined}
      title={status?.phase === 'unavailable' ? thread.delivery?.observationError : undefined}>
      <span className="delivery-dot" aria-hidden="true" /><span className="delivery-hint-text">{hint}</span>
    </p>}
    {status?.ci && <DeliveryProgress ci={status.ci} />}
    <div id={id} ref={menu} className="menu delivery-menu" popover="auto" role="menu" aria-label="Shipping options" style={position}
      onToggle={e => {
        if (e.newState === 'open' && trigger.current) {
          const box = trigger.current.getBoundingClientRect();
          setPosition({ left: Math.max(8, Math.min(box.left - 90, window.innerWidth - 318)), top: 'auto', bottom: window.innerHeight - box.top + 8 });
          requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
        }
      }} onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[(current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
      }}>
      <button className="menu-item" role="menuitemradio" aria-checked={mode === 'ship'} disabled={busy || !canRun} onClick={() => deliver('ship')}>
        <span className="delivery-check">{mode === 'ship' && <Check />}</span>
        <span className="menu-text">Ship to {target}<small>{project?.deliveryPolicy === 'pull-request' ? 'Rebase, test and merge through a PR.' : 'Rebase, test and push when ready.'}</small></span>
      </button>
      <button className="menu-item" role="menuitemradio" aria-checked={mode === 'review'} disabled={busy || !canRun} onClick={() => deliver('review')}>
        <span className="delivery-check">{mode === 'review' && <Check />}</span>
        <span className="menu-text">Prepare for review<small>Rebase, test and open a PR. Never merges.</small></span>
      </button>
    </div>
    {(error || loadError) && <p className="delivery-error" role="alert">{error ?? loadError}{loadError && <button className="ghost" onClick={() => setAttempt(n => n + 1)}>Retry</button>}</p>}
  </div>;
}
