import type { ProfileView } from '@accio/protocol';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useClient } from './connection';
import { Check } from './icons';
import { useAction } from './useAction';
import { claudeAccount, useProfiles } from '../profiles/profiles';
import { SignInWithClaude } from '../profiles/SignInWithClaude';
import { AddProjectForm } from '../projects/AddProjectSheet';
import { useProjects } from '../projects/projects';

/**
 * What a thread needs, in order, done right here rather than in sheets: a
 * profile, a Claude account signed in to it, and a project. Steps tick off as
 * the server reports them; the new-thread draft follows on its own.
 */
export function FirstRun() {
  const { profiles = [] } = useProfiles();
  const { state } = useProjects();
  const unsigned = profiles.find((p) => !claudeAccount(p)?.signedIn);
  const steps = [
    { done: profiles.length > 0, title: 'Add a profile', body: <AddProfile /> },
    {
      done: profiles.some((p) => claudeAccount(p)?.signedIn),
      title: unsigned ? `Sign ${unsigned.name} in with Claude` : 'Sign in with Claude',
      body: unsigned && <SetUpAccount key={unsigned.id} profile={unsigned} />,
    },
    { done: (state?.projects.length ?? 0) > 0, title: 'Add a project', body: <AddProjectForm /> },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="first-run">
      <h1>Set up accio</h1>
      <p className="first-run-sub">Every thread runs in a project, under a profile signed in with Claude.</p>
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
  const { busy, error, run } = useAction();
  const account = claudeAccount(profile);
  if (account) return <SignInWithClaude account={account} />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const id = selected || (await client.call('accounts.save', { name })).id;
      await client.call('profiles.save', { id: profile.id, name: profile.name, accountId: id });
    });
  };
  return <form className="field" onSubmit={submit}>
    <label className="field"><span>Claude account</span><select value={selected} onChange={(e) => setSelected(e.target.value)}>
      <option value="">Add a new account</option>
      {accounts?.map((a) => <option value={a.id} key={a.id}>{a.name}</option>)}
    </select></label>
    {!selected && <label className="field"><span>Account name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team account 1" maxLength={80} required /></label>}
    <button type="submit" className="ghost primary" disabled={busy || !accounts}>Use account</button>
    {error && <p className="error">{error}</p>}
  </form>;
}
