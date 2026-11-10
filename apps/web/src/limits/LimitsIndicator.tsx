import type { AccountView } from '@accio/protocol';
import { Limits } from '../app/icons';
import { useProfiles } from '../profiles/profiles';
import { useLimits, useWatchLimits } from './limits';
import { blockingWindow, formatRemaining, level, relativeTime, remainingPercent, resetDue, tightestWindow } from './limitsModel';

/**
 * The selected model's account, at a glance: its tightest general window as
 * reported, or blocked by a used-up weekly window. Opens the Limits view for
 * the thread's profile. Signed-out and unselected accounts are left to the
 * thread notice above the composer.
 */
export function LimitsIndicator({ account, active = true, onOpen }: { account: AccountView | null; active?: boolean; onOpen: () => void }) {
  useWatchLimits(active && account?.signedIn ? [account.id] : []);
  const { views, status, now } = useLimits();
  const problem = useProfiles().sortingHat?.problem;
  if (problem) return <button type="button" className="limits-chip low" onClick={onOpen} title={problem} aria-label={`${problem} Open limits`}><Limits /><span>Sorting Hat unreachable</span></button>;
  if (!account?.signedIn) return null;
  const view = views?.get(account.id);
  const snapshot = view?.snapshot;
  const resetPending = !!snapshot?.windows.some((w) => resetDue(w, now));
  const lastKnown = !!snapshot && (view?.status === 'error' || status !== 'open' || resetPending);
  const blocking = snapshot ? blockingWindow(snapshot, now) : null;
  const tightest = snapshot ? blocking ?? tightestWindow(snapshot) : null;
  const remaining = tightest ? remainingPercent(tightest) : null;

  let text = 'Limits';
  let detail = view?.status === 'unsupported' ? 'not reported' : view?.status === 'error' && !snapshot ? 'unavailable' : 'loading';
  let tone = 'unknown';
  if (resetPending) {
    text = 'Check limits';
    detail = 'reset time passed; awaiting confirmation';
  } else if (tightest && remaining !== null) {
    tone = level(tightest);
    text = tone === 'empty' ? `${tightest.label} used up` : `${formatRemaining(remaining)}`;
    const reset = tightest.resetsAt ? `, resets ${relativeTime(Date.parse(tightest.resetsAt), now)}` : '';
    detail = `${tightest.label} ${tone === 'empty' ? 'used up' : `${formatRemaining(remaining)} left`}${reset}${lastKnown ? ', last known' : ''}`;
  } else if (snapshot) detail = 'no usage reported';

  return (
    <button type="button" className={`limits-chip ${tone === 'empty' ? 'exhausted' : tone}${lastKnown ? ' last-known' : ''}`} onClick={onOpen}
      title={`${account.name}: ${detail}`} aria-label={`${account.name} limits: ${detail}. Open limits`}>
      <Limits />
      <span>{text}</span>
      {!resetPending && tightest && remaining !== null && tone !== 'empty' && <small>{tightest.label}</small>}
    </button>
  );
}
