import type { ProfileView } from '@accio/protocol';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useClient } from './connection';
import { Check, ProviderLogo } from './icons';
import { useAction } from './useAction';
import { hasSignedInAccount, useProfiles } from '../profiles/profiles';
import { SignInWithClaude } from '../profiles/SignInWithClaude';
import { SignInWithOpenAI } from '../profiles/SignInWithOpenAI';
import { AddProjectForm } from '../projects/AddProjectSheet';
import { useProjects } from '../projects/projects';

/**
 * What a thread needs, in order, done right here rather than in sheets: a
 * profile, a provider account signed in to it, and a project. Steps tick off as
 * the server reports them; the new-thread draft follows on its own.
 */
export function FirstRun() {
  const { profiles = [] } = useProfiles();
  const { state } = useProjects();
  const unsigned = profiles.find((p) => !hasSignedInAccount(p));
  const signedIn = profiles.find(hasSignedInAccount);
  const projects = state?.projects ?? [];
  const steps = [
    {
      done: profiles.length > 0,
      title: 'Add a profile',
      about: 'A side of your life threads run under, like personal or work.',
      summary: profiles.map((p) => p.name).join(', '),
      body: <AddProfile />,
    },
    {
      done: !!signedIn,
      title: unsigned ? `Choose an account for ${unsigned.name}` : 'Sign in',
      about: 'Connect a Claude or ChatGPT subscription to the profile.',
      summary: signedIn ? `Signed in for ${signedIn.name}` : '',
      body: unsigned && <SetUpAccount key={unsigned.id} profile={unsigned} />,
    },
    {
      done: projects.length > 0,
      title: 'Add a project',
      about: 'Point accio at a folder with code in it.',
      summary: projects.map((p) => p.name).join(', '),
      body: <AddProjectForm />,
    },
  ];
  const current = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="first-run">
      <header className="first-run-head">
        <h1>Set up accio</h1>
        <p className="first-run-sub">Three quick steps, then you're coding with Claude or ChatGPT.</p>
        <div className="first-run-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}>
          <span className="first-run-bar"><span style={{ width: `${(doneCount / steps.length) * 100}%` }} /></span>
          <small>{doneCount} of {steps.length} done</small>
        </div>
      </header>
      <ol className="steps">
        {steps.map((s, i) => (
          <Step key={i} n={i + 1} title={s.title} about={s.done && s.summary ? s.summary : s.about} state={s.done ? 'done' : i === current ? 'current' : 'later'}>
            {s.body}
          </Step>
        ))}
      </ol>
    </div>
  );
}

function Step(props: { n: number; title: string; about: string; state: 'done' | 'current' | 'later'; children: ReactNode }) {
  return (
    <li className={`step ${props.state}`} aria-current={props.state === 'current' ? 'step' : undefined}>
      <span className="step-n">{props.state === 'done' ? <Check /> : props.n}</span>
      <div className="step-main">
        <b className="step-title">{props.title}</b>
        <small className="step-about">{props.about}</small>
        {props.state === 'current' && <div className="step-body">{props.children}</div>}
      </div>
    </li>
  );
}

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
          Add
        </button>
      </span>
      <small className="hint">You can add more later in Settings.</small>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

const providers = [
  { id: 'anthropic', name: 'Claude', company: 'Anthropic' },
  { id: 'openai', name: 'ChatGPT', company: 'OpenAI' },
] as const;

function SetUpAccount({ profile }: { profile: ProfileView }) {
  const client = useClient();
  const { accounts } = useProfiles();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [providerId, setProviderId] = useState<'anthropic' | 'openai'>('anthropic');
  const { busy, error, run } = useAction();
  const account = profile.providers.find((p) => p.id === providerId)?.accounts[0];
  if (account) return account.providerId === 'openai' ? <SignInWithOpenAI account={account} /> : <SignInWithClaude account={account} />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const id = selected || (await client.call('accounts.save', { name, providerId })).id;
      await client.call('profiles.save', { id: profile.id, name: profile.name, ...(providerId === 'openai' ? { openaiAccountId: id } : { accountId: id }) });
    });
  };
  return <form className="field" onSubmit={submit}>
    <div className="provider-choice" role="radiogroup" aria-label="Provider">
      {providers.map((p) => (
        <button type="button" role="radio" aria-checked={providerId === p.id} key={p.id} className={`provider-card${providerId === p.id ? ' on' : ''}`} onClick={() => { setProviderId(p.id); setSelected(''); }}>
          <ProviderLogo providerId={p.id} />
          <span><b>{p.name}</b><small>{p.company}</small></span>
        </button>
      ))}
    </div>
    <label className="field"><span>{providerId === 'openai' ? 'ChatGPT' : 'Claude'} account</span><select value={selected} onChange={(e) => setSelected(e.target.value)}>
      <option value="">Add a new account</option>
      {accounts?.filter((a) => a.providerId === providerId).map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}
    </select></label>
    {!selected && <label className="field"><span>Account name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team account 1" maxLength={80} required /></label>}
    <button type="submit" className="ghost primary" disabled={busy || !accounts}>Use account</button>
    {error && <p className="error">{error}</p>}
  </form>;
}
