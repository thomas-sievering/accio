import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ProfileProviderView } from '@accio/protocol';
import { Close, Limits, ProviderLogo, Refresh } from '../app/icons';
import { useProfiles } from '../profiles/profiles';
import { AccountLimitsCard, limitsCardId } from './AccountLimits';
import { useLimits, useWatchLimits } from './limits';
import { limitsLayout, retryBlockedUntil, type LimitsEntry, type LimitsScope } from './limitsModel';

/**
 * Profile → provider → selected account, with each account's own allowance
 * windows. Opening or navigating from here never changes a profile's accounts.
 */
export function LimitsView({ scope, onScope, onClose, onOpenAccount }: {
  scope: LimitsScope;
  onScope: (scope: LimitsScope) => void;
  onClose: () => void;
  onOpenAccount: (accountId: string) => void;
}) {
  const { profiles } = useProfiles();
  const { views, loadError, retryLoad, refreshError, refresh, status, now } = useLimits();
  const missing = scope !== 'all' && profiles !== undefined && !profiles.some((p) => p.id === scope);
  const groups = profiles && !missing ? limitsLayout(profiles, scope) : [];
  const drawn = groups.flatMap((g) => g.entries.flatMap((e) => e.kind === 'account' ? [e.account] : []));
  useWatchLimits(drawn.map((a) => a.id));
  const signedIn = drawn.filter((a) => a.signedIn).map((a) => a.id);
  const refreshing = signedIn.some((id) => views?.get(id)?.status === 'refreshing');
  const canRefresh = signedIn.some((id) => { const view = views?.get(id); return view && !retryBlockedUntil(view, now); });
  const disconnected = status !== 'open';

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target;
      if (e.key === 'Escape' && !e.defaultPrevented && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <header className="main-top drag">
        <div className="thread-title">
          <span className="limits-title-icon"><Limits /></span>
          <b>Limits</b>
        </div>
        <span className="spacer" />
        <button type="button" className="ghost with-icon limits-refresh-all" disabled={disconnected || refreshing || !canRefresh}
          onClick={() => void refresh(signedIn, true)}>
          <Refresh />{refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button type="button" className="side-icon" title="Close limits (Esc)" aria-label="Close limits" onClick={onClose}><Close /></button>
      </header>
      <div className="settings-scroll">
        <div className="limits-page">
          {(profiles?.length ?? 0) > 1 && <ScopePicker scope={scope} onScope={onScope} />}
          {disconnected && <p className="limits-banner" role="status">Not connected to Accio’s server. Values below are last known and update once it reconnects.</p>}
          {!disconnected && loadError && (
            <div className="limits-banner error" role="alert">
              <span>Couldn’t load limits from the hub: {loadError}</span>
              <button type="button" className="ghost" onClick={retryLoad}>Retry</button>
            </div>
          )}
          {!disconnected && refreshError && (
            <div className="limits-banner error" role="alert">
              <span>Couldn’t reach the hub to refresh limits: {refreshError}</span>
              <button type="button" className="ghost" onClick={() => void refresh(signedIn, true)}>Retry</button>
            </div>
          )}
          {missing && (
            <div className="limits-banner" role="status">
              <span>This profile no longer exists.</span>
              <button type="button" className="ghost" onClick={() => onScope('all')}>Show all profiles</button>
            </div>
          )}
          {profiles?.length === 0 && <p className="limits-intro">No profiles yet. Add one under Settings / Profiles.</p>}
          {groups.map(({ profile, entries }) => (
            <section key={profile.id} className="limits-profile" aria-labelledby={`limits-profile-${profile.id}`}>
              {scope === 'all' && <h2 id={`limits-profile-${profile.id}`}>{profile.name}</h2>}
              {scope !== 'all' && <h2 id={`limits-profile-${profile.id}`} className="visually-hidden">{profile.name}</h2>}
              {entries.length === 0 && <p className="limits-intro">No accounts selected for this profile.</p>}
              {entries.map((entry) => (
                <Entry key={`${entry.provider.id}:${entry.account.id}`} entry={entry} onOpenAccount={onOpenAccount} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

function Entry({ entry, onOpenAccount }: {
  entry: LimitsEntry; onOpenAccount: (id: string) => void;
}) {
  const label = providerLabel(entry.provider);
  if (entry.kind === 'account') {
    return <AccountLimitsCard account={entry.account} providerLabel={label} sharedWith={entry.sharedWith} onOpenAccount={() => onOpenAccount(entry.account.id)} />;
  }
  if (entry.kind === 'reference') {
    const show = () => {
      const card = document.getElementById(limitsCardId(entry.account.id));
      card?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      card?.focus({ preventScroll: true });
    };
    return (
      <div className="limits-row">
        <span className="limits-provider-mark"><ProviderLogo providerId={entry.provider.id} /></span>
        <div className="limits-identity">
          <small>{label}</small>
          <b>{entry.account.name}</b>
          <small>Shared with {entry.shownUnder.name}. One allowance, shown under {entry.shownUnder.name}.</small>
        </div>
        <button type="button" className="ghost" onClick={show}>Show limits</button>
      </div>
    );
  }
}

/** Profiles as a single-choice group; arrow keys move between them as in a tab list. */
function ScopePicker({ scope, onScope }: { scope: LimitsScope; onScope: (s: LimitsScope) => void }) {
  const { profiles = [] } = useProfiles();
  const group = useRef<HTMLDivElement>(null);
  const options: { id: LimitsScope; name: string }[] = [{ id: 'all', name: 'All profiles' }, ...profiles.map((p) => ({ id: p.id, name: p.name }))];
  const move = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.id === scope);
    const next = options[(Math.max(i, 0) + step + options.length) % options.length]!;
    onScope(next.id);
    requestAnimationFrame(() => group.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus());
  };
  const selected = options.some((o) => o.id === scope) ? scope : null;
  useEffect(() => { group.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus(); }, []);
  return (
    <div className="limits-scope" role="radiogroup" aria-label="Profile" ref={group} onKeyDown={move}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === selected} tabIndex={o.id === (selected ?? 'all') ? 0 : -1} onClick={() => onScope(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

const providerLabel = (p: ProfileProviderView) => `${p.name} · ${p.accountName}`;
