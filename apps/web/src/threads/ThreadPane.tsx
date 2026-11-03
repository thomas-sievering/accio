import type { ThreadView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { ProfileTile, useProfiles } from '../profiles/profiles';
import { useProjects } from '../projects/projects';
import { Composer } from './Composer';
import { Transcript } from './Transcript';
import { useTranscript } from './threads';

export function ThreadPane({ thread, onOpenProfile }: { thread: ThreadView; onOpenProfile: (profileId: string) => void }) {
  const client = useClient();
  const { profiles = [] } = useProfiles();
  const { state } = useProjects();
  const items = useTranscript(thread.id);
  const profile = profiles.find((a) => a.id === thread.profileId);
  const checkout = state?.checkouts.find((c) => c.id === thread.checkoutId);
  const running = thread.status === 'running';

  return (
    <>
      <header className="main-top drag">
        <div className="thread-title">
          <b>{thread.title}</b>
          <span className="thread-where" title={checkout?.path}>
            <ProfileTile profile={profile} size="xs" />
            {profile?.name ?? 'unknown profile'}
            {checkout && <span className="faint"> · {checkout.path}</span>}
          </span>
        </div>
      </header>
      {items ? (
        items.length ? (
          <Transcript items={items} working={running} />
        ) : (
          <div className="empty">What should the agent do in {checkout?.path ?? 'this checkout'}?</div>
        )
      ) : (
        <div className="empty" />
      )}
      {profile && !profile.signIn && (
        <div className="profile-note">
          <span>
            <b>{profile.name}</b> isn’t signed in with Claude, so this thread can’t run yet.
          </span>
          <button className="ghost" onClick={() => onOpenProfile(profile.id)}>
            Open {profile.name}
          </button>
        </div>
      )}
      {thread.status === 'interrupted' && (
        <div className="resume-bar">
          <span>This turn was interrupted. It continues only when you resume it.</span>
          <button className="ghost primary" onClick={() => client.call('threads.resume', { threadId: thread.id })}>
            Resume
          </button>
        </div>
      )}
      <Composer
        disabled={running}
        onStop={running ? async () => void (await client.call('threads.stop', { threadId: thread.id })) : undefined}
        placeholder={running ? 'Working…' : 'Message'}
        onSend={async (text) => {
          await client.call('threads.send', { threadId: thread.id, text });
        }}
      />
    </>
  );
}
