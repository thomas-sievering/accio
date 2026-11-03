import type { AccountLimitsView, AccountView, LimitWindow, LimitsSnapshot } from '@accio/protocol';
import { useState } from 'react';
import { ProviderLogo, Refresh, Settings } from '../app/icons';
import { useLimits } from './limits';
import {
  absoluteTime, blockingWindow, formatRemaining, fullTime, level, relativeTime, remainingPercent, resetDue, retryBlockedUntil, splitWindows,
} from './limitsModel';

type Named = { id: string; name: string };

/**
 * One named account's limits, drawn identically in the Limits view and in the
 * account's settings. Allowance, freshness and problems are kept apart: a
 * failed refresh never hides or zeroes the last values it had.
 */
export function AccountLimits({ account, onSignIn }: {
  account: AccountView;
  /** Opens this account's settings to sign in; omitted where sign-in is already on screen. */
  onSignIn?: () => void;
}) {
  const { views, status, now, refresh, loadError, refreshError, retryLoad } = useLimits();
  const view = views?.get(account.id);
  const disconnected = status !== 'open';
  const { busy, retry } = useRetry(account.id, refresh);

  if (!account.signedIn || view?.status === 'signedOut') {
    return <LimitsMessage tone="muted" text="Signed out. Sign in to see this account’s limits." action={onSignIn && { label: 'Sign in', run: onSignIn }} />;
  }
  if (!view) {
    if (!disconnected && loadError) return <LimitsMessage tone="error" text="Couldn’t load this account’s limits from the hub." action={{ label: 'Retry', run: retryLoad }} />;
    return disconnected ? <LimitsMessage tone="muted" text="Not connected. Limits appear once accio reconnects." /> : <LimitsSkeleton />;
  }
  if (view.status === 'unsupported') {
    return <LimitsMessage tone="muted" text="This account doesn’t report usage limits." />;
  }

  const snapshot = view.snapshot;
  const blockedUntil = retryBlockedUntil(view, now);
  const retryAction = disconnected ? undefined : blockedUntil
    ? { label: `Retry ${relativeTime(blockedUntil, now)}`, run: retry, disabled: true }
    : { label: busy || view.status === 'refreshing' ? 'Retrying…' : 'Retry', run: retry, disabled: busy || view.status === 'refreshing' };
  const signInAgain = view.problem?.code === 'signInRequired';
  const problem = view.status === 'error' && view.problem
    ? <LimitsMessage tone={signInAgain ? 'warn' : 'error'} text={view.problem.message}
        action={signInAgain ? onSignIn && { label: 'Sign in again', run: onSignIn } : retryAction} />
    : null;

  if (!snapshot) {
    if (view.status === 'error') return problem ?? <LimitsMessage tone="error" text="Usage unavailable." action={retryAction} />;
    return disconnected ? <LimitsMessage tone="muted" text="Not connected. Limits appear once accio reconnects." /> : <LimitsSkeleton />;
  }

  const lastKnown = view.status === 'error' || disconnected || !!refreshError;
  return (
    <div className={`limits-body${lastKnown ? ' last-known' : ''}`}>
      <SnapshotMeters snapshot={snapshot} refreshing={view.status === 'refreshing'} now={now} />
      {problem}
      {!disconnected && refreshError && <LimitsMessage tone="error" text="Couldn’t reach the hub to refresh limits." action={retryAction} />}
      <Freshness view={view} snapshot={snapshot} lastKnown={lastKnown} now={now}
        onRefresh={disconnected || view.status === 'refreshing' || blockedUntil ? undefined : retry} busy={busy} />
    </div>
  );
}

function SnapshotMeters({ snapshot, refreshing, now }: { snapshot: LimitsSnapshot; refreshing: boolean; now: number }) {
  const { general, scoped } = splitWindows(snapshot.windows);
  const blocking = blockingWindow(snapshot, now);
  if (!snapshot.windows.length) return <p className="limits-message muted">No limits were reported for this account.</p>;
  const scopedCount = scoped.reduce((n, s) => n + s.windows.length, 0);
  return <>
    {blocking && (
      <p className="limits-message warn">
        <b>{blocking.label} limit reached.</b>{' '}
        {blocking.resetsAt ? <>It resets {relativeTime(Date.parse(blocking.resetsAt), now)} (<time dateTime={blocking.resetsAt} title={fullTime(Date.parse(blocking.resetsAt))}>{absoluteTime(Date.parse(blocking.resetsAt), now)}</time>); </> : 'Its reset time wasn’t reported; '}
        shorter windows are shown as reported but may not be usable until then.
      </p>
    )}
    {general.length > 0 && <ul className="limits-meters">{general.map((w) => <Meter key={w.id} window={w} refreshing={refreshing} now={now} />)}</ul>}
    {scoped.length > 0 && (
      <details className="limits-scoped" open={general.length === 0}>
        <summary>Model-specific limits <span className="faint">· {scopedCount}</span></summary>
        {scoped.map((s) => (
          <section key={s.scope} aria-label={s.scope}>
            <h4>{capitalize(s.scope)}</h4>
            <ul className="limits-meters">{s.windows.map((w) => <Meter key={w.id} window={w} refreshing={refreshing} now={now} scope={s.scope} />)}</ul>
          </section>
        ))}
      </details>
    )}
  </>;
}

/** Name and reset on the left, one simple remaining-allowance bar, remaining percentage on the right. */
function Meter({ window: w, refreshing, now, scope }: { window: LimitWindow; refreshing: boolean; now: number; scope?: string }) {
  const remaining = remainingPercent(w);
  const state = level(w);
  const passed = resetDue(w, now);
  const reset = w.resetsAt ? Date.parse(w.resetsAt) : null;
  const resetText = passed
    ? refreshing ? 'Reset time passed · checking…' : 'Reset time passed · awaiting confirmation'
    : reset !== null ? `Resets ${relativeTime(reset, now)}` : 'Reset time not reported';
  const value = remaining === null ? 'Unknown' : state === 'empty' ? 'Used up' : `${formatRemaining(remaining)} left`;
  const name = scope ? `${capitalize(scope)} ${w.label.toLowerCase()}` : w.label;
  return (
    <li className={`limit-meter ${state === 'empty' ? 'exhausted' : state}${passed ? ' pending' : ''}`}>
      <div className="limit-name">
        <b>{w.label}</b>
        <small>
          {resetText}
          {reset !== null && !passed && <> · <time dateTime={w.resetsAt!} title={fullTime(reset)}>{absoluteTime(reset, now)}</time></>}
        </small>
      </div>
      <div className="limit-track" role={remaining === null ? 'img' : 'meter'} aria-label={`${name} allowance remaining${remaining === null ? ': usage not reported' : ''}`} aria-valuemin={remaining === null ? undefined : 0} aria-valuemax={remaining === null ? undefined : 100}
        aria-valuenow={remaining ?? undefined}
        aria-valuetext={remaining === null ? 'Usage not reported' : `${formatRemaining(remaining)} left${passed ? ', reset time passed, awaiting confirmation' : ''}`}>
        {remaining !== null && <span style={{ width: `${remaining}%` }} />}
      </div>
      <span className="limit-value">{value}</span>
    </li>
  );
}

function Freshness({ view, snapshot, lastKnown, now, onRefresh, busy }: {
  view: AccountLimitsView; snapshot: LimitsSnapshot; lastKnown: boolean; now: number; onRefresh?: () => void; busy: boolean;
}) {
  const observed = Date.parse(snapshot.observedAt);
  const refreshing = view.status === 'refreshing' || busy;
  return (
    <footer className="limits-freshness">
      <span>
        {/* Only state changes are announced, not the ticking age. */}
        <span role="status" className="limits-freshness-state">
          {lastKnown && <span className="limits-tag warn">Last known</span>}
          {refreshing && 'Updating…'}
        </span>
        {!refreshing && <span>Updated <time dateTime={snapshot.observedAt} title={fullTime(observed)}>{relativeTime(observed, now)}</time></span>}
      </span>
      {onRefresh && !refreshing && (
        <button type="button" className="limits-refresh" onClick={onRefresh} title="Refresh this account’s limits" aria-label="Refresh this account’s limits">
          <Refresh />
        </button>
      )}
    </footer>
  );
}

function LimitsMessage({ tone, text, action }: { tone: 'muted' | 'warn' | 'error'; text: string; action?: { label: string; run: () => void; disabled?: boolean } }) {
  return (
    <div className={`limits-message ${tone}`} role={tone === 'muted' ? undefined : 'status'}>
      <span>{text}</span>
      {action && <button type="button" className="ghost" disabled={action.disabled} onClick={action.run}>{action.label}</button>}
    </div>
  );
}

function LimitsSkeleton() {
  return (
    <div className="limits-skeleton" role="status" aria-label="Loading limits">
      <span /><span />
    </div>
  );
}

function useRetry(accountId: string, refresh: (ids: string[], force?: boolean) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const retry = () => {
    if (busy) return;
    setBusy(true);
    void refresh([accountId], true).finally(() => setBusy(false));
  };
  return { busy, retry };
}

/**
 * The Limits view's card: who the account is, which profiles share it, and its limits.
 * `id` lets references elsewhere in All profiles move focus here.
 */
export function AccountLimitsCard({ account, providerLabel, sharedWith, onOpenAccount }: {
  account: AccountView;
  providerLabel: string;
  sharedWith: Named[];
  onOpenAccount: () => void;
}) {
  return (
    <article className="limits-card" id={limitsCardId(account.id)} tabIndex={-1} aria-label={`${account.name}, ${providerLabel}`}>
      <header className="limits-card-top">
        <span className="limits-provider-mark"><ProviderLogo providerId={account.providerId} /></span>
        <div className="limits-identity">
          <small>{providerLabel}</small>
          <b>{account.name}</b>
          {account.email && <small className="faint">{account.email}</small>}
        </div>
        {sharedWith.length > 0 && <span className="limits-tag" title="One allowance, used by each of these profiles">Shared with {sharedWith.map((p) => p.name).join(', ')}</span>}
        <button type="button" className="row-action" title={`${account.name} settings`} aria-label={`${account.name} settings`} onClick={onOpenAccount}>
          <Settings />
        </button>
      </header>
      <AccountLimits account={account} onSignIn={onOpenAccount} />
    </article>
  );
}

export const limitsCardId = (accountId: string) => `limits-account-${accountId}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
