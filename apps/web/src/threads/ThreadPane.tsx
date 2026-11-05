import type { CheckoutView, ChoicePick, MachineView, ProjectView, RemoteMachine, ThreadView } from '@accio/protocol';
import { type ModelSelection } from '@accio/protocol';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useClient } from '../app/connection';
import { useLive } from '../app/useLive';
import { accountForModel, defaultModel, useProfiles } from '../profiles/profiles';
import { ProfileLabel } from '../profiles/ProfileLabel';
import { LimitsIndicator } from '../limits/LimitsIndicator';
import { ProjectMark } from '../projects/ProjectMark';
import { ProjectCrumbMenu } from '../projects/ProjectCrumbMenu';
import { useProjects } from '../projects/projects';
import { Composer } from './Composer';
import { QueueTray } from './QueueTray';
import { GoalBar } from './GoalBar';
import { PendingPick, optionName } from './Choice';
import { DeliveryActions } from './DeliveryActions';
import { MachinePicker } from './MachinePicker';
import { ModelPicker } from './ModelPicker';
import { ThreadNotice } from './ThreadNotice';
import { ThreadActionsMenu } from './ThreadActionsMenu';
import { TitleEdit } from './ThreadMenu';
import { EditableTitle } from './EditableTitle';
import { Transcript } from './Transcript';
import { CacheUsage } from './CacheUsage';
import { useReportPendingSecrets } from '../secrets/pendingSecrets';
import { viewTransition } from '../ui/viewTransition';
import { firstMessage, forgetFirstMessage, keepFirstMessage } from './sentImages';
import { useThreads, useTranscript } from './threads';
import { newThreadDraftId } from './drafts';
import { useThreadAvailability, remoteImagesReason } from './useThreadAvailability';
import { UserMessageText } from './PastedText';

/** Where a thread runs, looked up once for the header, the notice and the composer. */
function usePlace(checkoutId: string, profileId?: string, projectId?: string) {
  const { profiles = [] } = useProfiles();
  const { state } = useProjects();
  const checkout = state?.checkouts.find((c) => c.id === checkoutId);
  // Another machine's thread has no checkout here; it names this machine's project for the same repository.
  const project = state?.projects.find((p) => p.id === (checkout?.projectId ?? projectId));
  const profile = profiles.find((p) => p.id === (profileId ?? project?.profileId));
  return { checkout, project, profile };
}

export function ThreadPane({ thread, active = true, onOpenProfile, onOpenLimits, onOpenSecrets }: { thread: ThreadView; active?: boolean; onOpenProfile: (profileId: string) => void; onOpenLimits: (profileId: string) => void; onOpenSecrets?: (profileId: string) => void }) {
  const client = useClient();
  const { unavailable, imagesUnavailable } = useThreadAvailability(thread);
  const place = usePlace(thread.checkoutId, thread.profileId, thread.machine ? thread.projectId : undefined);
  const { items, error, retry } = useTranscript(thread.id);
  useReportPendingSecrets(thread.id, items);
  const starting = firstMessage(client, thread.id);
  useEffect(() => { if (items) forgetFirstMessage(client, thread.id); }, [client, thread.id, items]);
  const running = thread.status === 'running';
  const [savingModel, setSavingModel] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const lastTurn = items?.findLast((item) => item.kind === 'user')?.turnId;
  const blocked = thread.status === 'failed' || thread.status === 'interrupted';
  const notices = blocked ? items?.filter((item) => item.kind === 'notice' && item.turnId === lastTurn) : undefined;
  const detail = notices?.map((item) => 'text' in item ? item.text : '').join(' ') || undefined;
  // The delivery chip says where it shipped; older threads still hold a receipt notice for it.
  const visibleItems = useMemo(() => items?.filter((item) => item.kind !== 'notice' || !/^delivery:.*:completed$/.test(item.id) && !(blocked && item.turnId === lastTurn)), [items, blocked, lastTurn]);
  // The option ticked for the next message; it belongs to this thread only.
  const [pending, setPending] = useState<{ threadId: string; pick: ChoicePick }>();
  const pick = pending?.threadId === thread.id ? pending.pick : undefined;
  const setPick = (next?: ChoicePick) => setPending(next && { threadId: thread.id, pick: next });
  const pickedChoice = pick && items?.find((item) => item.kind === 'choice' && item.id === pick.choiceId);
  const pickLabel = pick && pickedChoice?.kind === 'choice' ? `✓ ${optionName(pickedChoice, pick.option)}` : undefined;

  return (
    <>
      <PaneHeader title={thread.title} titleEditor={renaming ? <TitleEdit thread={thread} className="header-rename" onDone={() => setRenaming(false)} /> : <EditableTitle key={thread.id} thread={thread} />} {...place} checkout={thread.workspace && !thread.workspace.releasedAt && place.checkout ? { ...place.checkout, path: thread.workspace.path } : place.checkout} actions={<ThreadActionsMenu key={thread.id} thread={thread} items={items} onRename={() => setRenaming(true)} />} projectName={thread.projectName} machine={thread.machine} />
      {!visibleItems && !error && starting ? <StartingTranscript {...starting} /> : visibleItems ? <PendingPick.Provider value={{ pick, setPick, enabled: !running && !unavailable }}>
        <Transcript threadId={thread.id} items={visibleItems} working={running} onOpenSecrets={onOpenSecrets} />
      </PendingPick.Provider> : (
        <div className="empty">
          {error && <>
            <p className="error" role="alert">Could not load transcript: {error}</p>
            <button className="ghost" onClick={retry}>Retry</button>
          </>}
        </div>
      )}
      {visibleItems && error && <div className="notice-bar error" role="alert">
        <span>Could not refresh transcript: {error}</span><button className="ghost" onClick={retry}>Retry</button>
      </div>}
      <ThreadNotice thread={thread} profile={place.profile} detail={detail} onOpenProfile={onOpenProfile} />
      <Composer
        key={thread.id}
        imagesUnavailable={imagesUnavailable}
        disabled={!!unavailable || savingModel || thread.delivery?.status === 'queued' || thread.delivery?.status === 'running' || !place.profile || !accountForModel(place.profile, thread.model)?.signedIn}
        actions={<><DeliveryActions key={thread.id} thread={thread} project={place.project} canRun={!!place.profile && !!accountForModel(place.profile, thread.model)?.signedIn} /><GoalBar thread={thread} /><QueueTray thread={thread} /></>}
        target={thread.id}
        draftId={`thread:${thread.id}`}
        profileId={thread.profileId}
        stopDisabled={!!unavailable}
        onStop={running ? async () => void (await client.call('threads.stop', { threadId: thread.id })) : undefined}
        placeholder={running ? 'Enter steers · Ctrl+Enter queues' : thread.settledAt ? 'Send a message to reopen this thread…' : `Ask ${thread.model.harnessId === 'codex' ? 'Codex' : 'Claude Code'} anything`}
        attachment={pick && pickLabel ? { label: pickLabel, onRemove: () => setPick(undefined) } : undefined}
        model={thread.model}
        onSend={async (text, mode, images) => {
          await client.call('threads.send', { threadId: thread.id, text, mode, ...(pick ? { pick } : {}), ...(images.length ? { images } : {}) });
          setPick(undefined);
        }}
        toolbar={<>
          <ModelPicker key={thread.id} profileId={thread.profileId} value={thread.model} disabled={running || !!unavailable} onChange={async (model) => {
            setSavingModel(true);
            try { await client.call('threads.setModel', { threadId: thread.id, model }); }
            finally { setSavingModel(false); }
          }} />
          {place.profile && <LimitsIndicator active={active} account={accountForModel(place.profile, thread.model)} onOpen={() => onOpenLimits(place.profile!.id)} />}
          <CacheUsage items={items ?? []} />
        </>}
      />
    </>
  );
}

/**
 * A new thread before its first message, centred under a question as in T3 Code.
 * Sending creates the thread and its first turn together.
 */
export function DraftPane({ checkoutId, profileId, active = true, onOpenProfile, onOpenLimits }: { checkoutId: string; profileId?: string; active?: boolean; onOpenProfile: (profileId: string) => void; onOpenLimits: (profileId: string) => void }) {
  const client = useClient();
  const { select } = useThreads();
  const place = usePlace(checkoutId, profileId);
  const [choice, setChoice] = useState<{ checkoutId: string; profileId?: string; model: ModelSelection }>();
  const model = choice?.checkoutId === checkoutId && choice.profileId === place.profile?.id ? choice.model : defaultModel(place.profile);
  const machines = useLive(() => client.call('machines.list', {}), 'machines.changed');
  const [chosenMachineId, setChosenMachineId] = useState<string>();
  // GLOSSARY: Relay. Another machine on the relay can run it; one without a checkout of the repository clones it first.
  const repoKey = place.project?.repoKey;
  const startable = machines?.filter((m) => m.thisMachine || (m.relay && (!checkoutId || !!repoKey)));
  const noCheckout = (m: MachineView) => !!checkoutId && !m.thisMachine && !!repoKey && !m.relay?.repos.includes(repoKey);
  const local = machines?.find((m) => m.thisMachine);
  const machineId = chosenMachineId ?? local?.id;
  const machine = startable?.find((m) => m.id === machineId);
  // Until the list loads, a send goes to this machine, as the server does without a machine id.
  const unavailable = !!machines && !machine?.connected;
  const [starting, setStarting] = useState<FirstMessage>();
  // A start can take a while; moving elsewhere meanwhile unmounts the draft, and the new thread must not pull focus back.
  const open = useRef(true);
  useEffect(() => { open.current = true; return () => { open.current = false; }; }, []);

  return (
    <>
      <PaneHeader title="New thread" {...place} />
      {starting && <StartingTranscript {...starting} />}
      {/* While starting, the composer settles where the thread's own will be, so the swap is still. */}
      <div className={`hero${starting ? ' starting' : ''}`} inert={!!starting}>
        <h1>{checkoutId ? <>What should we build in {place.project ? <span className="hero-project">{place.project.name}</span> : 'this checkout'}?</> : 'What should we build?'}</h1>
        <ThreadNotice profile={place.profile} model={model} onOpenProfile={onOpenProfile} />
        {chosenMachineId && unavailable && <p className="note" role="status">The selected machine is offline. Choose an online machine.</p>}
        <Composer
          target="draft"
          draftId={newThreadDraftId(checkoutId, profileId)}
          profileId={place.profile?.id}
          imagesUnavailable={machine && !machine.thisMachine ? remoteImagesReason : undefined}
          handsOffImages
          disabled={!!starting || !place.profile || !accountForModel(place.profile, model)?.signedIn || unavailable}
          placeholder={`Ask ${model.harnessId === 'codex' ? 'Codex' : 'Claude Code'} anything`}
          model={model}
          onSend={async (text, _mode, uploads, previews) => {
            const shown = viewTransition('thread-start', () => setStarting({ text, images: previews }));
            try {
              const images = uploads.length ? { images: uploads } : {};
              const thread = await client.call('threads.start', checkoutId ? { checkoutId, text, model, machineId, ...images } : { profileId: profileId!, text, model, machineId, ...images });
              keepFirstMessage(client, thread.id, text, previews);
              await shown;
              if (open.current) await viewTransition('thread-open', () => select(thread.id));
            } catch (error) {
              // Keep the composer mounted so a failed start restores its draft and error.
              await shown;
              await viewTransition('thread-start', () => setStarting(undefined));
              throw error;
            }
          }}
          toolbar={<>
            <ModelPicker profileId={place.profile?.id} value={model} onChange={async (model) => setChoice({ checkoutId, profileId: place.profile?.id, model })} />
            {place.profile && <LimitsIndicator active={active} account={accountForModel(place.profile, model)} onOpen={() => onOpenLimits(place.profile!.id)} />}
          </>}
        />
        <div className="draft-machine">
          <MachinePicker machines={startable} value={machineId} onChange={setChosenMachineId} note={(m) => noCheckout(m) ? 'No checkout yet' : undefined} />
        </div>
      </div>
    </>
  );
}

/** A first message as sent: its text and the local copies of its images. */
type FirstMessage = { text: string; images: string[] };

/** The first message and a live row, laid out as the transcript will be once the turn reports. */
function StartingTranscript({ text, images }: FirstMessage) {
  return <div className="transcript-scroll draft-starting" aria-busy="true">
    <div className="messages"><div className="thread">
      <div className="msg user">
        {images.length > 0 && <div className="msg-images">{images.map((url, index) =>
          <button key={url} type="button" className="msg-image" tabIndex={-1} style={{ viewTransitionName: `sent-image-${index}`, viewTransitionClass: 'sent-image' }}><img src={url} alt="" /></button>)}</div>}
        <UserMessageText text={text} />
      </div>
      <div className="turn-work live">
        <button className="turn-work-toggle" disabled><span className="turn-work-activity" role="status">Starting thread…</span></button>
      </div>
    </div></div>
  </div>;
}

/** A compact project / thread breadcrumb; hover the project to see its checkout path. */
function PaneHeader(props: {
  title: string;
  titleEditor?: ReactNode;
  checkout?: CheckoutView;
  project?: ProjectView;
  profile?: { id: string };
  actions?: ReactNode;
  projectName?: string;
  machine?: RemoteMachine;
}) {
  const { checkout, project, machine } = props;
  return (
    <header className="main-top drag">
      <div className="thread-title">
        <span className="thread-where" title={checkout?.path}>
          {project && <ProjectMark id={project.id} size={16} />}
          <span className="thread-project-name">
            {project
              ? <ProjectCrumbMenu project={project} path={checkout?.path} />
              : props.projectName ?? (checkout ? 'unknown project' : 'No project')}
          </span>
          {machine && <span className="thread-machine faint" title={machine.online ? `Runs on ${machine.name}` : `${machine.name} is offline`}>· {machine.name}{machine.online ? '' : ' (offline)'}</span>}
        </span>
        <span className="faint" aria-hidden="true">/</span>
        {props.titleEditor ?? <b title={props.title}>{props.title}</b>}
      </div>
      <ProfileLabel profileId={props.profile?.id} />
      {props.actions}
    </header>
  );
}
