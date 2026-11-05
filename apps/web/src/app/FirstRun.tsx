import type { ProfileView } from '@accio/protocol';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useClient, useHubs } from './connection';
import { Monitor, ProviderLogo } from './icons';
import { useAction } from './useAction';
import { hasSignedInAccount, useProfiles } from '../profiles/profiles';
import { SignIn } from '../profiles/SignIn';
import { AddProjectForm, AddProjectSheet } from '../projects/AddProjectSheet';
import { useProjects } from '../projects/projects';
import { PairHubForm } from '../hub/PairHubForm';
import { MenuSelect } from '../ui/MenuSelect';

/**
 * What a thread needs, one question at a time: a hub, a profile, a provider
 * account signed in to it, and a checkout on this machine. Each screen follows
 * from what the server reports, so a hub that is already set up skips straight
 * to the project; the new-thread draft follows on its own.
 */
export function FirstRun() {
  const { profiles = [] } = useProfiles();
  const { state } = useProjects();
  const { hubs, selectedId, chosen, select } = useHubs();
  const hub = hubs.find((h) => h.id === selectedId);
  const unsigned = profiles.find((p) => !hasSignedInAccount(p));
  const steps = [
    // A fresh install already runs Local dev, so "decided" means the user picked it, joined another hub, or set this one up.
    // With several saved hubs, an unfinished one may just be the wrong hub, so ask.
    chosen || hubs.length === 1 && (!hub?.local || profiles.length > 0),
    profiles.length > 0,
    profiles.some(hasSignedInAccount),
    (state?.checkouts.length ?? 0) > 0,
  ];
  const current = steps.findIndex((done) => !done);
  const [addingProject, setAddingProject] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);

  return (
    <div className="first-run">
      <h1 className="first-run-kicker">Set up Accio</h1>
      {current === 0 && (hubs.length > 1 ? <ChooseSavedHub onChoose={select} /> : <ChooseHub onLocal={() => select(selectedId)} />)}
      {(current === 1 || editingProfile && unsigned) && (
        <Screen title="Name your first profile" sub="A profile groups the accounts and projects for one side of your life, such as personal or work.">
          <AddProfile profile={editingProfile ? unsigned : undefined} onDone={() => setEditingProfile(false)} />
        </Screen>
      )}
      {current === 2 && unsigned && !editingProfile && (
        <Screen title={`Choose an account for ${unsigned.name}`} sub="Threads under this profile use its Claude or ChatGPT subscription.">
          <SetUpAccount key={unsigned.id} profile={unsigned} onBack={() => setEditingProfile(true)} addedProject={state?.projects.map(p => p.name).join(', ')} onAddProject={(state?.projects.length ?? 0) === 0 ? () => setAddingProject(true) : undefined} />
        </Screen>
      )}
      {addingProject && <AddProjectSheet onClose={() => setAddingProject(false)} />}
      {current === 3 && (
        <Screen title="Add your first project" sub="Point Accio at a folder with code in it.">
          <AddProjectForm />
        </Screen>
      )}
      <div className="first-run-dots" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={(editingProfile ? 1 : current) + 1}>
        {steps.map((_, i) => <span key={i} className={i === (editingProfile ? 1 : current) ? 'on' : i < (editingProfile ? 1 : current) ? 'done' : ''} />)}
      </div>
    </div>
  );
}

function Screen(props: { title: string; sub: string; children: ReactNode }) {
  return (
    <section className="first-run-screen">
      <h2>{props.title}</h2>
      <p className="first-run-sub">{props.sub}</p>
      {props.children}
    </section>
  );
}

/** Local or remote first; the address and pairing code only once you pick remote. */
function ChooseHub({ onLocal }: { onLocal: () => void }) {
  const [where, setWhere] = useState<'local' | 'remote'>('local');
  const [joining, setJoining] = useState(false);
  if (joining) return (
    <Screen title="Join your hub" sub="Use the code from the hub’s setup command, or from a device that’s already paired.">
      <PairHubForm className="field" askName={false} submitClassName="ghost primary first-run-next" />
      <button type="button" className="link first-run-back" onClick={() => setJoining(false)}>Back</button>
    </Screen>
  );
  return (
    <Screen title="Where should Accio keep your accounts?" sub="Profiles and sign-ins live on a hub. You can add more hubs later.">
      <div className="choice-cards" role="radiogroup" aria-label="Hub">
        <Choice on={where === 'local'} onClick={() => setWhere('local')} icon={<Monitor />} title="This PC" detail="Everything stays on this computer" />
        <Choice on={where === 'remote'} onClick={() => setWhere('remote')} icon={<Globe />} title="Remote hub" detail="Share accounts across your machines" />
      </div>
      <button type="button" className="ghost primary first-run-next" onClick={() => (where === 'local' ? onLocal() : setJoining(true))}>Continue</button>
    </Screen>
  );
}

/** Several hubs are saved on this machine: pick the one to use here. */
function ChooseSavedHub({ onChoose }: { onChoose: (id: string) => void }) {
  const { hubs, selectedId } = useHubs();
  const [where, setWhere] = useState(selectedId);
  return (
    <Screen title="Which hub should this window use?" sub="Each hub has its own profiles, projects and threads.">
      <div className="choice-cards" role="radiogroup" aria-label="Hub">
        {hubs.map((h) => <Choice key={h.id} on={where === h.id} onClick={() => setWhere(h.id)} icon={h.local ? <Monitor /> : <Globe />}
          title={h.name} detail={h.status === 'connected' ? 'Connected' : h.status === 'connecting' ? 'Connecting' : 'Offline'} />)}
      </div>
      <button type="button" className="ghost primary first-run-next" onClick={() => onChoose(where)}>Continue</button>
    </Screen>
  );
}

function Choice(props: { on: boolean; onClick: () => void; icon: ReactNode; title: string; detail: string }) {
  return (
    <button type="button" role="radio" aria-checked={props.on} className={`choice-card${props.on ? ' on' : ''}`} onClick={props.onClick}>
      {props.icon}
      <span><b>{props.title}</b><small>{props.detail}</small></span>
    </button>
  );
}

const Globe = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20" />
  </svg>
);

function AddProfile({ profile, onDone }: { profile?: ProfileView; onDone?: () => void } = {}) {
  const client = useClient();
  const [name, setName] = useState(profile?.name ?? '');
  const [missing, setMissing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setMissing(true); input.current?.focus(); return; }
    void run(async () => { await client.call('profiles.save', { id: profile?.id, name }); onDone?.(); });
  };
  return (
    <form onSubmit={submit} className="field" noValidate>
      <input ref={input} value={name} onChange={(e) => { setName(e.target.value); setMissing(false); }} placeholder="personal, work…" aria-label="Profile name" aria-invalid={missing} aria-describedby={missing ? 'profile-name-error' : undefined} autoFocus />
      {missing && <small className="error" id="profile-name-error" role="alert">Enter a name for the profile.</small>}
      {error && <p className="error">{error}</p>}
      <button type="submit" className="ghost primary first-run-next" disabled={busy}>Continue</button>
    </form>
  );
}

const providers = [
  { id: 'anthropic', name: 'Claude', company: 'Anthropic' },
  { id: 'openai', name: 'ChatGPT', company: 'OpenAI' },
] as const;

/** Pick a provider; a new account is named after the profile unless you reuse one the hub already has. */
function SetUpAccount({ profile, onAddProject, addedProject, onBack }: { profile: ProfileView; onAddProject?: () => void; addedProject?: string; onBack: () => void }) {
  const client = useClient();
  const { accounts } = useProfiles();
  const [selected, setSelected] = useState('');
  const started = profile.providers.find((p) => p.accounts.length > 0);
  const [providerId, setProviderId] = useState<'anthropic' | 'openai'>(started?.id ?? 'anthropic');
  // Signing in comes after picking; Back returns to the pick to change provider.
  const [signingIn, setSigningIn] = useState(!!started);
  const { busy, error, run } = useAction();
  const account = profile.providers.find((p) => p.id === providerId)?.accounts[0];
  const projectFirst = addedProject ? <span role="status">Added {addedProject}.</span> : onAddProject && <button type="button" className="link" onClick={onAddProject}>Set up a project first</button>;
  if (account && signingIn) return <>
    <SignIn account={account} />
    <div className="first-run-links">
      <button type="button" className="link" onClick={() => setSigningIn(false)}>Back</button>
      {projectFirst && <><span aria-hidden="true">·</span>{projectFirst}</>}
    </div>
  </>;
  const provider = providers.find((p) => p.id === providerId)!;
  const existing = accounts?.filter((a) => a.providerId === providerId) ?? [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (account) return setSigningIn(true);
    void run(async () => {
      const id = selected || (await client.call('accounts.save', { name: `${profile.name} ${provider.name}`, providerId })).id;
      await client.call('profiles.save', { id: profile.id, name: profile.name, accountIds: { [providerId]: [id] }, ...(providerId === 'openai' ? { openaiAccountId: id } : { accountId: id }) });
      setSigningIn(true);
    });
  };
  return <form className="field" onSubmit={submit}>
    <div className="choice-cards" role="radiogroup" aria-label="Provider">
      {providers.map((p) => (
        <button type="button" role="radio" aria-checked={providerId === p.id} key={p.id} className={`choice-card${providerId === p.id ? ' on' : ''}`} onClick={() => { setProviderId(p.id); setSelected(''); }}>
          <ProviderLogo providerId={p.id} />
          <span><b>{p.name}</b><small>{p.company}</small></span>
        </button>
      ))}
    </div>
    {existing.length > 0 && <div className="field"><span>{provider.name} account</span>
      <MenuSelect label={`${provider.name} account`} value={selected} onChange={setSelected}
        options={[{ value: '', label: 'New account' }, ...existing.map((a) => ({ value: a.id, label: a.name }))]} />
    </div>}
    <button type="submit" className="ghost primary first-run-next" disabled={busy || !accounts}>Continue</button>
    {error && <p className="error">{error}</p>}
    <div className="first-run-links"><button type="button" className="link" onClick={onBack}>Back</button>{projectFirst && <><span aria-hidden="true">·</span>{projectFirst}</>}</div>
  </form>;
}
