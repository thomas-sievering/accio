import type { ThreadView } from '@accio/protocol';
import { useState } from 'react';
import { useClient } from '../app/connection';
import { Folder, ShieldOff } from '../app/icons';
import { useProfiles } from '../profiles/profiles';
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
  const project = state?.projects.find((p) => p.id === checkout?.projectId);
  const running = thread.status === 'running';
  const canOpenFolder = window.accioDesktop?.serverOrigin === window.location.origin;
  const [folderError, setFolderError] = useState<string>();
  const openFolder = async () => {
    if (!checkout || !canOpenFolder || !window.accioDesktop) return;
    setFolderError(undefined);
    try {
      await window.accioDesktop.openFolder(checkout.path);
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : 'Could not open folder.');
    }
  };
  // A thread with nothing said yet centres its composer under a question, as T3 Code does.
  const fresh = items?.length === 0 && !running;
  const harness = <span className="composer-harness">Claude Code</span>;
  const send = async (text: string) => {
    await client.call('threads.send', { threadId: thread.id, text });
  };

  return (
    <>
      <header className="main-top drag">
        <div className="thread-title">
          <b>{thread.title}</b>
          <span className="thread-where" title={checkout?.path}>
            {profile?.name ?? 'unknown profile'}
            {checkout && (
              <span className="faint"> · {canOpenFolder ? (
                <button className="folder-link" title="Open folder in Explorer" onClick={() => void openFolder()}>
                  {checkout.path}
                </button>
              ) : checkout.path}</span>
            )}
          </span>
        </div>
      </header>
      {folderError && <p className="error" role="alert">{folderError}</p>}
      {fresh ? (
        <div className="hero">
          <h1>What should we build in {project?.name ?? 'this checkout'}?</h1>
          <p className="hero-sub">
            as {profile?.name ?? 'unknown profile'}
          </p>
          {profile && !profile.account && <ProfileNote name={profile.name} onOpen={() => onOpenProfile(profile.id)} />}
          <Composer disabled={false} placeholder="Ask Claude Code anything" onSend={send} toolbar={harness} />
          <div className="hero-meta">
            {checkout && canOpenFolder ? <button className="hero-chip folder-link" title={`Open ${checkout.path} in Explorer`} onClick={() => void openFolder()}>
              <Folder />
              {folderName(checkout.path)}
            </button> : <span className="hero-chip" title={checkout?.path}>
              <Folder />
              {checkout ? folderName(checkout.path) : 'unknown checkout'}
            </span>}
            <span className="hero-chip push" title="Threads run with full permissions (ADR 0005)">
              <ShieldOff />
              Full access
            </span>
          </div>
        </div>
      ) : items ? (
        <Transcript items={items} working={running} />
      ) : (
        <div className="empty" />
      )}
      {!fresh && profile && !profile.account && <ProfileNote name={profile.name} onOpen={() => onOpenProfile(profile.id)} />}
      {thread.status === 'interrupted' && (
        <div className="resume-bar">
          <span>This turn was interrupted. It continues only when you resume it.</span>
          <button className="ghost primary" onClick={() => client.call('threads.resume', { threadId: thread.id })}>
            Resume
          </button>
        </div>
      )}
      {!fresh && (
        <Composer
          disabled={running}
          onStop={running ? async () => void (await client.call('threads.stop', { threadId: thread.id })) : undefined}
          placeholder={running ? 'Working…' : 'Ask Claude Code anything'}
          onSend={send}
          toolbar={harness}
        />
      )}
    </>
  );
}

function ProfileNote({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <div className="profile-note">
      <span>
        <b>{name}</b> isn’t signed in with Claude, so this thread can’t run yet.
      </span>
      <button className="ghost" onClick={onOpen}>
        Open {name}
      </button>
    </div>
  );
}

function folderName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
