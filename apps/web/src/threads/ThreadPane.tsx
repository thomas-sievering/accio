import type { CheckoutView, ProjectView, ThreadView } from '@accio/protocol';
import { DEFAULT_MODEL, type ModelSelection } from '@accio/protocol';
import { useState } from 'react';
import { useClient } from '../app/connection';
import { useLive } from '../app/useLive';
import { claudeAccount, useProfiles } from '../profiles/profiles';
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
  return { checkout, project, profile };
}

export function ThreadPane({ thread, onOpenProfile }: { thread: ThreadView; onOpenProfile: (profileId: string) => void }) {
  const client = useClient();
  const place = usePlace(thread.checkoutId, thread.profileId);
  const { items, error, retry } = useTranscript(thread.id);
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
      {visibleItems ? <Transcript items={visibleItems} working={running} /> : (
        <div className="empty">
          {error && <>
            <p className="error" role="alert">Could not load transcript: {error}</p>
            <button className="ghost" onClick={retry}>Retry</button>
          </>}
        </div>
      )}
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
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  const [chosenMachineId, setChosenMachineId] = useState<string>();
  const local = machines?.find((m) => m.thisMachine);
  const machineId = chosenMachineId ?? local?.id;
  const machine = machines?.find((m) => m.id === machineId);
  const online = machines?.filter((m) => m.connected) ?? [];
  const unavailable = !machine?.connected;
  const remote = !!machine && !machine.thisMachine;

  return (
    <>
      <PaneHeader title="New thread" {...place} />
      <div className="hero">
        <h1>{checkoutId ? `What should we build in ${place.project?.name ?? 'this checkout'}?` : 'What should we build?'}</h1>
        <ThreadNotice profile={place.profile} onOpenProfile={onOpenProfile} />
        {remote && <p className="note" role="status">Running threads on another machine is not available yet. Choose this machine to start a thread.</p>}
        {chosenMachineId && unavailable && <p className="note" role="status">The selected machine is offline. Choose an online machine.</p>}
        <Composer
          disabled={!place.profile || !claudeAccount(place.profile)?.signedIn || unavailable || remote}
          placeholder="Ask Claude Code anything"
          onSend={async (text) => select((await client.call('threads.start', checkoutId ? { checkoutId, text, model, machineId } : { profileId: profileId!, text, model, machineId })).id)}
          toolbar={<>
            <select className="composer-machine" aria-label="Run on machine" value={machineId ?? ''} disabled={!machines} onChange={(e) => setChosenMachineId(e.target.value)}>
              {!machineId && <option value="">Loading machines…</option>}
              {chosenMachineId && unavailable && <option value={chosenMachineId} disabled>Selected machine offline</option>}
              {online.map((m) => <option key={m.id} value={m.id}>{m.name}{m.thisMachine ? ' (local)' : ''}</option>)}
            </select>
            <ModelPicker profileId={place.profile?.id} value={model} onChange={async (model) => setChoice({ checkoutId, profileId: place.profile?.id, model })} />
          </>}
        />
      </div>
    </>
  );
}

/** A compact project / thread breadcrumb; hover the project to see its checkout path. */
function PaneHeader(props: {
  title: string;
  checkout?: CheckoutView;
  project?: ProjectView;
}) {
  const { checkout, project } = props;
  return (
    <header className="main-top drag">
      <div className="thread-title">
        <span className="thread-where" title={checkout?.path}>
          {project && <ProjectMark id={project.id} size={14} />}
          <span className="thread-project-name">
            {checkout ? <FolderLink path={checkout.path}>{project?.name ?? 'unknown project'}</FolderLink> : project?.name ?? 'No project'}
          </span>
        </span>
        <span className="faint" aria-hidden="true">/</span>
        <b title={props.title}>{props.title}</b>
      </div>
    </header>
  );
}
