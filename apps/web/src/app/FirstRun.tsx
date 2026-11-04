import type { ProfileView } from '@accio/protocol';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useClient, useHubs } from './connection';
import { Monitor, ProviderLogo } from './icons';
import { useAction } from './useAction';
import { hasSignedInAccount, useProfiles } from '../profiles/profiles';
import { SignIn } from '../profiles/SignIn';
import { AddProjectForm } from '../projects/AddProjectSheet';
import { useProjects } from '../projects/projects';
import { PairHubForm } from '../hub/PairHubForm';

/**
 * What a thread needs, one question at a time: a hub, a profile, a provider
 * account signed in to it, and a checkout on this machine. Each screen follows
 * from what the server reports, so a hub that is already set up skips straight
 * to the project; the new-thread draft follows on its own.
 */
export function FirstRun() {
  const { profiles = [] } = useProfiles();
  const { state } = useProjects();
  const { hubs, selectedId } = useHubs();
  const hub = hubs.find((h) => h.id === selectedId);
  // A fresh install already runs Local dev, so "decided" means the user said so, joined another hub, or set this one up.
  const [hubChosen, setHubChosen] = useState(() => sessionStorage.getItem(HUB_CHOSEN) === '1');
  const chooseLocal = () => { sessionStorage.setItem(HUB_CHOSEN, '1'); setHubChosen(true); };
  const unsigned = profiles.find((p) => !hasSignedInAccount(p));
  const steps = [
    hubChosen || !hub?.local || profiles.length > 0,
    profiles.length > 0,
    profiles.some(hasSignedInAccount),
    (state?.checkouts.length ?? 0) > 0,
  ];
  const current = steps.findIndex((done) => !done);

  return (
    <div className="first-run">
      <h1 className="first-run-kicker">Set up accio</h1>
      {current === 0 && <ChooseHub onLocal={chooseLocal} />}
      {current === 1 && (
        <Screen title="Name your first profile" sub="A side of your life threads run under. Add more later in Settings.">
          <AddProfile />
        </Screen>
      )}
      {current === 2 && unsigned && (
        <Screen title={`Choose an account for ${unsigned.name}`} sub="Threads under this profile use its Claude or ChatGPT subscription.">
          <SetUpAccount key={unsigned.id} profile={unsigned} />
        </Screen>
      )}
      {current === 3 && (
        <Screen title="Add your first project" sub="Point accio at a folder with code in it.">
          <AddProjectForm />
        </Screen>
      )}
      <div className="first-run-dots" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={current + 1}>
        {steps.map((_, i) => <span key={i} className={i === current ? 'on' : i < current ? 'done' : ''} />)}
      </div>
    </div>
  );
}

const HUB_CHOSEN = 'accio.firstRun.hubChosen';

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
    <Screen title="Where should accio keep your accounts?" sub="Profiles and sign-ins live on a hub. You can add more hubs later.">
      <div className="choice-cards" role="radiogroup" aria-label="Hub">
        <Choice on={where === 'local'} onClick={() => setWhere('local')} icon={<Monitor />} title="This PC" detail="Everything stays on this computer" />
        <Choice on={where === 'remote'} onClick={() => setWhere('remote')} icon={<Globe />} title="Remote hub" detail="Share accounts across your machines" />
      </div>
      <button type="button" className="ghost primary first-run-next" onClick={() => (where === 'local' ? onLocal() : setJoining(true))}>Continue</button>
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

function AddProfile() {
  const client = useClient();
  const [name, setName] = useState('');
  const { busy, error, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => client.call('profiles.save', { name }));
  };
  return (
    <form onSubmit={submit} className="field">
      <span className="row-input">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="personal, work…" autoFocus required />
        <button type="submit" className="ghost primary" disabled={busy || !name.trim()}>
          Continue
        </button>
      </span>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

const providers = [
  { id: 'anthropic', name: 'Claude', company: 'Anthropic' },
  { id: 'openai', name: 'ChatGPT', company: 'OpenAI' },
] as const;

/** Pick a provider; a new account is named after the profile unless you reuse one the hub already has. */
function SetUpAccount({ profile }: { profile: ProfileView }) {
  const client = useClient();
  const { accounts } = useProfiles();
  const [selected, setSelected] = useState('');
  const [providerId, setProviderId] = useState<'anthropic' | 'openai'>('anthropic');
  const { busy, error, run } = useAction();
  const account = profile.providers.find((p) => p.id === providerId)?.accounts[0];
  if (account) return <SignIn account={account} />;
  const provider = providers.find((p) => p.id === providerId)!;
  const existing = accounts?.filter((a) => a.providerId === providerId) ?? [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const id = selected || (await client.call('accounts.save', { name: `${profile.name} ${provider.name}`, providerId })).id;
      await client.call('profiles.save', { id: profile.id, name: profile.name, ...(providerId === 'openai' ? { openaiAccountId: id } : { accountId: id }) });
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
    {existing.length > 0 && <label className="field"><span>{provider.name} account</span><select value={selected} onChange={(e) => setSelected(e.target.value)}>
      <option value="">New account</option>
      {existing.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}
    </select></label>}
    <button type="submit" className="ghost primary first-run-next" disabled={busy || !accounts}>Continue</button>
    {error && <p className="error">{error}</p>}
  </form>;
}
