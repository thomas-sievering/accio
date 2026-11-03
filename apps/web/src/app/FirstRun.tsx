import type { ProfileView } from '@accio/protocol';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useClient } from './connection';
import { Check } from './icons';
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
  const steps = [
    { done: profiles.length > 0, title: 'Add a profile', body: <AddProfile /> },
    {
      done: profiles.some(hasSignedInAccount),
      title: unsigned ? `Choose an account for ${unsigned.name}` : 'Sign in',
      body: unsigned && <SetUpAccount key={unsigned.id} profile={unsigned} />,
    },
    { done: (state?.projects.length ?? 0) > 0, title: 'Add a project', body: <AddProjectForm /> },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="first-run">
      <h1>Set up accio</h1>
      <p className="first-run-sub">Choose a profile and sign in with Claude or ChatGPT to start coding.</p>
      <ol className="steps">
        {steps.map((s, i) => (
          <Step key={i} n={i + 1} title={s.title} state={s.done ? 'done' : i === current ? 'current' : 'later'}>
            {s.body}
          </Step>
        ))}
      </ol>
    </div>
  );
}

function Step(props: { n: number; title: string; state: 'done' | 'current' | 'later'; children: ReactNode }) {
  return (
    <li className={`step ${props.state}`}>
      <div className="step-head">
        <span className="step-n">{props.state === 'done' ? <Check /> : props.n}</span>
        <b>{props.title}</b>
      </div>
      {props.state === 'current' && <div className="step-body">{props.children}</div>}
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
      <small className="hint">A side of your life threads run under. Add more later in Settings.</small>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

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
    <label className="field"><span>Provider</span><select value={providerId} onChange={(e) => { setProviderId(e.target.value as 'anthropic' | 'openai'); setSelected(''); }}>
      <option value="anthropic">Anthropic · Claude</option><option value="openai">OpenAI · ChatGPT</option>
    </select></label>
    <label className="field"><span>{providerId === 'openai' ? 'ChatGPT' : 'Claude'} account</span><select value={selected} onChange={(e) => setSelected(e.target.value)}>
      <option value="">Add a new account</option>
      {accounts?.filter((a) => a.providerId === providerId).map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}
    </select></label>
    {!selected && <label className="field"><span>Account name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team account 1" maxLength={80} required /></label>}
    <button type="submit" className="ghost primary" disabled={busy || !accounts}>Use account</button>
    {error && <p className="error">{error}</p>}
  </form>;
}
