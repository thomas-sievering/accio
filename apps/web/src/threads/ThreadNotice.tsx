import type { ProfileView, ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';

/**
 * The one slot above the composer for "this thread can't go on by itself right
 * now", with the single action that fixes it. The first that applies wins:
 * a missing or signed-out profile, then an interrupted turn, then a failed one.
 */
export function ThreadNotice({
  thread,
  profile,
  detail,
  onOpenProfile,
}: {
  /** Absent for a draft, which can only be blocked by its profile. */
  thread?: ThreadView;
  profile: ProfileView | undefined;
  detail?: string;
  onOpenProfile: (profileId: string) => void;
}) {
  const client = useClient();
  const { busy, error, run } = useAction();

  let text: React.ReactNode;
  let action: { label: string; run: () => unknown } | undefined;
  let tone = 'warn';
  if (!profile) {
    text = 'The profile this thread started with no longer exists.';
    tone = 'error';
  } else if (!profile.account) {
    text = (
      <>
        <b>{profile.name}</b> isn’t signed in with Claude, so this thread can’t run yet.
      </>
    );
    action = { label: 'Sign in', run: () => onOpenProfile(profile.id) };
  } else if (thread?.status === 'interrupted') {
    text = detail ?? 'This turn was interrupted. It continues only when you resume it.';
    action = { label: 'Resume', run: () => run(() => client.call('threads.resume', { threadId: thread.id })) };
  } else if (thread?.status === 'failed') {
    text = detail ?? 'The last turn failed.';
    tone = 'error';
    action = { label: 'Retry', run: () => run(() => client.call('threads.retry', { threadId: thread.id })) };
  } else return null;

  return (
    <div className={`notice-bar ${tone}`} role="status">
      <span>
        {text}
        {error && <span className="error"> {error}</span>}
      </span>
      {action && (
        <button className="ghost primary" disabled={busy} onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}
