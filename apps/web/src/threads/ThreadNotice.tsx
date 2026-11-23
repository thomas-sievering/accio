import { noSortingHatMessage, type ProfileView, type ThreadView, type ModelSelection, harnessProvider } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useAction } from '../app/useAction';
import { accountForModel, defaultModel, useProfiles } from '../profiles/profiles';
import { useThreadAvailability } from './useThreadAvailability';

/**
 * The one slot above the composer for "this thread can't go on by itself right
 * now", with the single action that fixes it. The first that applies wins:
 * a missing profile, a hub without a Sorting Hat, an unlinked or signed-out profile, then an interrupted turn, then a failed one.
 */
export function ThreadNotice({
  thread,
  profile,
  borrowed = false,
  detail,
  model,
  onOpenProfile,
}: {
  /** Absent for a draft, which can only be blocked by its profile. */
  thread?: ThreadView;
  /** The profile whose accounts its turns spend. */
  profile: ProfileView | undefined;
  /** GLOSSARY: Borrowing. `profile` is another one, whose accounts it borrows. */
  borrowed?: boolean;
  detail?: string;
  model?: ModelSelection;
  onOpenProfile: (profileId: string) => void;
}) {
  const client = useClient();
  const { unavailable } = useThreadAvailability(thread);
  const { busy, error, run } = useAction();
  const { sortingHat, accounts } = useProfiles();

  let text: React.ReactNode;
  let action: { label: string; run: () => unknown } | undefined;
  let tone = 'warn';
  const selected = model ?? thread?.model ?? defaultModel(profile, accounts);
  if (unavailable) {
    text = unavailable;
  } else if (!profile) {
    text = borrowed ? 'The profile this thread borrows accounts from no longer exists. Choose one of its own profile’s models.' : 'The profile this thread started with no longer exists.';
    tone = 'error';
  } else if (sortingHat === null && !client.browser) {
    text = noSortingHatMessage;
  } else if (profile.house === null) {
    text = (
      <>
        <b>{profile.name}</b> isn’t linked to a house on the Sorting Hat, so this thread can’t run yet.
      </>
    );
    if (!client.browser) action = { label: 'Choose house', run: () => onOpenProfile(profile.id) };
  } else if (!accountForModel(profile, selected, accounts)?.signedIn) {
    text = (
      <>
        <b>{profile.name}</b> isn’t signed in with {harnessProvider(selected.harnessId) === 'openai' ? 'ChatGPT' : 'Claude'}, so this thread can’t run yet.
      </>
    );
    if (!client.browser) action = { label: 'Choose account', run: () => onOpenProfile(profile.id) };
  } else if (thread?.status === 'interrupted') {
    text = detail ?? (client.browser ? 'This turn was interrupted.' : 'This turn was interrupted. It continues only when you resume it.');
    if (!client.browser) action = { label: 'Resume', run: () => run(() => client.call('threads.resume', { threadId: thread.id })) };
  } else if (thread?.status === 'failed') {
    text = detail ?? 'The last turn failed.';
    tone = 'error';
    if (!client.browser) action = { label: 'Retry', run: () => run(() => client.call('threads.retry', { threadId: thread.id })) };
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
