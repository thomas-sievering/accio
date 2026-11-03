import { useState, type FormEvent } from 'react';
import type { AccountView, ProviderId } from '@accio/protocol';
import { useClient } from '../app/connection';
import { SettingsSection } from '../app/Settings';
import { Chevron, Plus } from '../app/icons';
import { useAction } from '../app/useAction';
import { AccountLimits } from '../limits/AccountLimits';
import { useWatchLimits } from '../limits/limits';
import { useProfiles } from './profiles';
import { SignInWithClaude } from './SignInWithClaude';
import { SignInWithOpenAI } from './SignInWithOpenAI';

export function AccountsSettings({ accountId, onOpen, onBack }: { accountId?: string; onOpen: (id: string) => void; onBack: () => void }) {
  const { accounts } = useProfiles();
  if (!accounts) return null;
  const account = accounts.find((a) => a.id === accountId);
  if (accountId === 'new' || accountId === 'new-openai' || account) return <AccountForm key={accountId} account={account} providerId={account?.providerId ?? (accountId === 'new-openai' ? 'openai' : 'anthropic')} onSaved={(a) => onOpen(a.id)} onDone={onBack} />;
  return <>
    <SettingsSection title="Anthropic">
      {accounts.filter((a) => a.providerId === 'anthropic').map((a) => <button key={a.id} className="setting setting-link" onClick={() => onOpen(a.id)}>
        <span className="setting-text"><b>{a.name}</b><small>{a.signedIn ? a.email ?? 'Signed in' : 'Signed out'}{a.organization ? ` · ${a.organization}` : ''}</small></span><Chevron />
      </button>)}
      <button className="setting setting-link" onClick={() => onOpen('new')}>
        <span className="menu-icon"><Plus /></span><span className="setting-text"><b>Add Claude account</b><small>Name an account, sign in, then select it in your profiles.</small></span>
      </button>
    </SettingsSection>
    <SettingsSection title="OpenAI">
      {accounts.filter((a) => a.providerId === 'openai').map((a) => <button key={a.id} className="setting setting-link" onClick={() => onOpen(a.id)}>
        <span className="setting-text"><b>{a.name}</b><small>{a.signedIn ? a.email ?? 'Signed in' : 'Signed out'}</small></span><Chevron />
      </button>)}
      <button className="setting setting-link" onClick={() => onOpen('new-openai')}>
        <span className="menu-icon"><Plus /></span><span className="setting-text"><b>Add ChatGPT account</b><small>Name an account, sign in, then select it in your profiles.</small></span>
      </button>
    </SettingsSection>
  </>;
}

function AccountForm({ account, providerId, onSaved, onDone }: { account?: AccountView; providerId: ProviderId; onSaved: (a: AccountView) => void; onDone: () => void }) {
  const client = useClient();
  const { profiles } = useProfiles();
  const [name, setName] = useState(account?.name ?? '');
  const { busy, error, run } = useAction();
  const usedBy = profiles?.filter((p) => p.providers.some((provider) => provider.accounts.some((a) => a.id === account?.id))) ?? [];
  useWatchLimits(account?.signedIn ? [account.id] : []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const saved = await run(() => client.call('accounts.save', { id: account?.id, name, providerId }));
    if (saved) onSaved(saved);
  };
  const remove = async () => {
    if (account && await run(async () => { await client.call('accounts.delete', { id: account.id }); return true; })) onDone();
  };
  return <form className="settings-profile-form" onSubmit={submit}>
    <SettingsSection title={account ? account.name : providerId === 'openai' ? 'New ChatGPT account' : 'New Claude account'}>
      <div className="setting-form">
        <label className="field"><span>Account name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team account 1, Family account..." maxLength={80} autoFocus={!account} required /></label>
        <small className="hint">A name you choose. Your provider identity stays visible below.</small>
        {error && <p className="error">{error}</p>}
      </div>
    </SettingsSection>
    {account && <SettingsSection title={providerId === 'openai' ? 'OpenAI' : 'Anthropic'}><div className="setting-form">{providerId === 'openai' ? <SignInWithOpenAI account={account} /> : <SignInWithClaude account={account} />}<small className="hint">{usedBy.length ? `Used by ${usedBy.map((p) => p.name).join(', ')}. Remove it from these profiles before deleting.` : 'Select this account in a profile to use it.'}</small></div></SettingsSection>}
    {account && <SettingsSection title="Limits">
      <div className="setting-form account-limits">
        <AccountLimits account={account} />
        <small className="hint">{usedBy.length > 1 ? `One allowance shared by ${usedBy.map((p) => p.name).join(', ')}. ` : ''}Set by {providerId === 'openai' ? 'OpenAI' : 'Anthropic'} and counting all of this account’s use, including use outside accio.</small>
      </div>
    </SettingsSection>}
    <footer className="settings-actions">
      {account && <button type="button" className="ghost danger" disabled={busy || usedBy.length > 0} onClick={remove}>Delete</button>}
      <span className="spacer" /><button type="button" className="ghost" onClick={onDone}>{account ? 'Done' : 'Cancel'}</button>
      <button type="submit" className="ghost primary" disabled={busy}>{account ? 'Save' : 'Add account'}</button>
    </footer>
  </form>;
}
