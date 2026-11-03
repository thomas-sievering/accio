import type { CheckoutView, ProfileView, ProjectView, ThreadView } from '@accio/protocol';
import { DEFAULT_MODEL, type ModelSelection } from '@accio/protocol';
import { useState } from 'react';
import { useClient } from '../app/connection';
import { ShieldOff } from '../app/icons';
import { claudeAccount, useProfiles } from '../profiles/profiles';
import { folderName } from '../projects/folderName';
import { FolderLink } from '../projects/FolderLink';
import { ProjectMark } from '../projects/ProjectMark';
import { useProjects } from '../projects/projects';
import { Composer } from './Composer';
import { ModelPicker } from './ModelPicker';
import { ThreadNotice } from './ThreadNotice';
import { Transcript } from './Transcript';
import { useThreads, useTranscript } from './threads';

/** Where a thread runs, looked up once for the header, the notice and the composer. */
function usePlace(checkoutId: string, profileId?: string) {
  const { profiles = [] } = useProfiles();
  const { state } = useProjects();
  const checkout = state?.checkouts.find((c) => c.id === checkoutId);
  const project = state?.projects.find((p) => p.id === checkout?.projectId);
  const profile = profiles.find((p) => p.id === (profileId ?? project?.profileId));
  return { checkout, project, profile, manyProfiles: profiles.length > 1 };
}

export function ThreadPane({ thread, onOpenProfile }: { thread: ThreadView; onOpenProfile: (profileId: string) => void }) {
  const client = useClient();
  const place = usePlace(thread.checkoutId, thread.profileId);
  const items = useTranscript(thread.id);
  const running = thread.status === 'running';
  const [savingModel, setSavingModel] = useState(false);
  const lastTurn = items?.findLast((item) => item.kind === 'user')?.turnId;
  const blocked = thread.status === 'failed' || thread.status === 'interrupted';
  const notices = blocked ? items?.filter((item) => item.kind === 'notice' && item.turnId === lastTurn) : undefined;
  const detail = notices?.map((item) => 'text' in item ? item.text : '').join(' ') || undefined;
  const visibleItems = blocked ? items?.filter((item) => item.kind !== 'notice' || item.turnId !== lastTurn) : items;

  return (
    <>
      <PaneHeader title={thread.title} {...place} />
      {visibleItems ? <Transcript items={visibleItems} working={running} /> : <div className="empty" />}
      <ThreadNotice thread={thread} profile={place.profile} detail={detail} onOpenProfile={onOpenProfile} />
      <Composer
        disabled={running || savingModel || !place.profile || !claudeAccount(place.profile)?.signedIn}
        onStop={running ? async () => void (await client.call('threads.stop', { threadId: thread.id })) : undefined}
        placeholder={running ? 'Working…' : 'Ask Claude Code anything'}
        onSend={async (text) => void (await client.call('threads.send', { threadId: thread.id, text }))}
        toolbar={<ModelPicker key={thread.id} profileId={thread.profileId} value={thread.model} disabled={running} onChange={async (model) => {
          setSavingModel(true);
          try { await client.call('threads.setModel', { threadId: thread.id, model }); }
          finally { setSavingModel(false); }
        }} />}
      />
    </>
  );
}

/**
 * A new thread before its first message, centred under a question as in T3 Code.
 * Sending creates the thread and its first turn together.
 */
export function DraftPane({ checkoutId, profileId, onOpenProfile }: { checkoutId: string; profileId?: string; onOpenProfile: (profileId: string) => void }) {
  const client = useClient();
  const { select } = useThreads();
  const place = usePlace(checkoutId, profileId);
  const [choice, setChoice] = useState<{ checkoutId: string; profileId?: string; model: ModelSelection }>();
  const model = choice?.checkoutId === checkoutId && choice.profileId === place.profile?.id ? choice.model : DEFAULT_MODEL;

  return (
    <>
      <PaneHeader title="New thread" {...place} />
      <div className="hero">
        <h1>{checkoutId ? `What should we build in ${place.project?.name ?? 'this checkout'}?` : 'What should we build?'}</h1>
        <ThreadNotice profile={place.profile} onOpenProfile={onOpenProfile} />
        <Composer
          disabled={!place.profile || !claudeAccount(place.profile)?.signedIn}
          placeholder="Ask Claude Code anything"
          onSend={async (text) => select((await client.call('threads.start', checkoutId ? { checkoutId, text, model } : { profileId: profileId!, text, model })).id)}
          toolbar={<ModelPicker profileId={place.profile?.id} value={model} onChange={async (model) => setChoice({ checkoutId, profileId: place.profile?.id, model })} />}
        />
      </div>
    </>
  );
}

/** One line under the title says where the thread runs: project, checkout folder and, when there is a choice, profile. */
function PaneHeader(props: {
  title: string;
  checkout?: CheckoutView;
  project?: ProjectView;
  profile?: ProfileView;
  manyProfiles: boolean;
}) {
  const { checkout, project, profile } = props;
  return (
    <header className="main-top drag">
      <div className="thread-title">
        <b>{props.title}</b>
        <span className="thread-where" title={checkout?.path}>
          {project && <ProjectMark id={project.id} size={10} />}
          {checkout ? <FolderLink path={checkout.path}>
            {project?.name ?? 'unknown project'}
            {folderName(checkout.path) !== project?.name && <span className="faint"> / {folderName(checkout.path)}</span>}
          </FolderLink> : project?.name ?? 'No project'}
          {props.manyProfiles && (
            <>
              <span className="faint">·</span>
              {profile?.name ?? 'unknown profile'}
            </>
          )}
          <span className="full-access" title="Threads run with full permissions (ADR 0005)">
            <ShieldOff />
          </span>
        </span>
      </div>
    </header>
  );
}
