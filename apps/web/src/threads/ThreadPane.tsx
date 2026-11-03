import type { CheckoutView, ChoicePick, ProjectView, ThreadView } from '@accio/protocol';
import { type ModelSelection } from '@accio/protocol';
import { useState, type ReactNode } from 'react';
import { useClient } from '../app/connection';
import { useLive } from '../app/useLive';
import { accountForModel, defaultModel, useProfiles } from '../profiles/profiles';
import { FolderLink } from '../projects/FolderLink';
import { ProjectMark } from '../projects/ProjectMark';
import { useProjects } from '../projects/projects';
import { Composer } from './Composer';
import { PendingPick, optionName } from './Choice';
import { DeliveryActions } from './DeliveryActions';
import { ModelPicker } from './ModelPicker';
import { ThreadNotice } from './ThreadNotice';
import { ThreadActionsMenu } from './ThreadActionsMenu';
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
  // The option ticked for the next message; it belongs to this thread only.
  const [pending, setPending] = useState<{ threadId: string; pick: ChoicePick }>();
  const pick = pending?.threadId === thread.id ? pending.pick : undefined;
  const setPick = (next?: ChoicePick) => setPending(next && { threadId: thread.id, pick: next });
  const pickedChoice = pick && items?.find((item) => item.kind === 'choice' && item.id === pick.choiceId);
  const pickLabel = pick && pickedChoice?.kind === 'choice' ? `✓ ${optionName(pickedChoice, pick.option)}` : undefined;

  return (
    <>
      <PaneHeader title={thread.title} {...place} checkout={thread.workspace && !thread.workspace.releasedAt && place.checkout ? { ...place.checkout, path: thread.workspace.path } : place.checkout} actions={<ThreadActionsMenu key={thread.id} thread={thread} items={items} />} />
      {visibleItems ? <PendingPick.Provider value={{ pick, setPick, enabled: !running }}>
        <Transcript threadId={thread.id} items={visibleItems} working={running} />
      </PendingPick.Provider> : (
        <div className="empty">
          {error && <>
            <p className="error" role="alert">Could not load transcript: {error}</p>
            <button className="ghost" onClick={retry}>Retry</button>
          </>}
        </div>
      )}
      <ThreadNotice thread={thread} profile={place.profile} detail={detail} onOpenProfile={onOpenProfile} />
      <Composer
        disabled={running || savingModel || thread.delivery?.status === 'queued' || !place.profile || !accountForModel(place.profile, thread.model)?.signedIn}
        actions={<DeliveryActions key={thread.id} thread={thread} project={place.project} canRun={!!place.profile && !!accountForModel(place.profile, thread.model)?.signedIn} />}
        onStop={running ? async () => void (await client.call('threads.stop', { threadId: thread.id })) : undefined}
        placeholder={running ? 'Working…' : `Ask ${thread.model.harnessId === 'codex' ? 'Codex' : 'Claude Code'} anything`}
        attachment={pick && pickLabel ? { label: pickLabel, onRemove: () => setPick(undefined) } : undefined}
        onSend={async (text) => {
          await client.call('threads.send', { threadId: thread.id, text, ...(pick ? { pick } : {}) });
          setPick(undefined);
        }}
        toolbar={<ModelPicker key={thread.id} profileId={thread.profileId} harnessId={thread.model.harnessId} value={thread.model} disabled={running} onChange={async (model) => {
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
  const model = choice?.checkoutId === checkoutId && choice.profileId === place.profile?.id ? choice.model : defaultModel(place.profile);
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
        <ThreadNotice profile={place.profile} model={model} onOpenProfile={onOpenProfile} />
        {remote && <p className="note" role="status">Running threads on another machine is not available yet. Choose this machine to start a thread.</p>}
        {chosenMachineId && unavailable && <p className="note" role="status">The selected machine is offline. Choose an online machine.</p>}
        <Composer
          disabled={!place.profile || !accountForModel(place.profile, model)?.signedIn || unavailable || remote}
          placeholder={`Ask ${model.harnessId === 'codex' ? 'Codex' : 'Claude Code'} anything`}
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
  actions?: ReactNode;
}) {
  const { checkout, project } = props;
  return (
    <header className="main-top drag">
      <div className="thread-title">
        <span className="thread-where" title={checkout?.path}>
          {project && <ProjectMark id={project.id} size={16} />}
          <span className="thread-project-name">
            {checkout ? <FolderLink path={checkout.path}>{project?.name ?? 'unknown project'}</FolderLink> : project?.name ?? 'No project'}
          </span>
        </span>
        <span className="faint" aria-hidden="true">/</span>
        <b title={props.title}>{props.title}</b>
      </div>
      {props.actions}
    </header>
  );
}
