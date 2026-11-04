import { useState, type FormEvent } from 'react';
import type { AccountView, ProviderId } from '@accio/protocol';
import { useClient } from '../app/connection';
import { SettingLink, SettingsFooter, SettingsSection, StatusPill } from '../app/Settings';
import { Field } from '../resources/Field';
import { Plus } from '../app/icons';
import { useAction } from '../app/useAction';
import { AccountLimits } from '../limits/AccountLimits';
import { useWatchLimits } from '../limits/limits';
import { useProfiles } from './profiles';
import { SignIn } from './SignIn';

export function AccountsSettings({ accountId, onOpen, onBack }: { accountId?: string; onOpen: (id: string) => void; onBack: () => void }) {
  const { accounts } = useProfiles();
  if (!accounts) return null;
  const account = accounts.find((a) => a.id === accountId);
  if (accountId === 'new' || accountId === 'new-openai' || account) return <AccountForm key={accountId} account={account} providerId={account?.providerId ?? (accountId === 'new-openai' ? 'openai' : 'anthropic')} onSaved={(a) => (account ? onBack() : onOpen(a.id))} onDone={onBack} />;
  return <>
    <SettingsSection title="Anthropic">
      {accounts.filter((a) => a.providerId === 'anthropic').map((a) => <SettingLink key={a.id} title={a.name} description={[a.email, a.organization].filter(Boolean).join(' · ') || undefined} onClick={() => onOpen(a.id)}>
        <StatusPill tone={a.signedIn ? 'ok' : 'warn'}>{a.signedIn ? 'Signed in' : 'Signed out'}</StatusPill>
      </SettingLink>)}
      <SettingLink icon={<Plus />} title="Add Claude account" description="Name an account, sign in, then select it in your profiles." chevron={false} onClick={() => onOpen('new')} />
    </SettingsSection>
    <SettingsSection title="OpenAI">
      {accounts.filter((a) => a.providerId === 'openai').map((a) => <SettingLink key={a.id} title={a.name} description={a.email ?? undefined} onClick={() => onOpen(a.id)}>
        <StatusPill tone={a.signedIn ? 'ok' : 'warn'}>{a.signedIn ? 'Signed in' : 'Signed out'}</StatusPill>
      </SettingLink>)}
      <SettingLink icon={<Plus />} title="Add ChatGPT account" description="Name an account, sign in, then select it in your profiles." chevron={false} onClick={() => onOpen('new-openai')} />
    </SettingsSection>
  </>;
}

function AccountForm({ account, providerId, onSaved, onDone }: { account?: AccountView; providerId: ProviderId; onSaved: (a: AccountView) => void; onDone: () => void }) {
  const client = useClient();
  const { profiles } = useProfiles();
  const [name, setName] = useState(account?.name ?? '');
  const [touched, setTouched] = useState(false);
  const { busy, error, run } = useAction();
  const usedBy = profiles?.filter((p) => p.providers.some((provider) => provider.accounts.some((a) => a.id === account?.id))) ?? [];
  useWatchLimits(account?.signedIn ? [account.id] : []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim()) return;
    const saved = await run(() => client.call('accounts.save', { id: account?.id, name, providerId }));
    if (saved) onSaved(saved);
  };
  const remove = async () => {
    if (account && await run(async () => { await client.call('accounts.delete', { id: account.id }); return true; })) onDone();
  };
  return <form className="settings-profile-form" onSubmit={submit} noValidate>
    <SettingsSection>
      <div className="setting-form">
        <Field label="Account name" error={touched && !name.trim() && 'Name required'} hint="A name you choose. Your provider identity stays visible below.">
          {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Team account 1, Family account..." maxLength={80} autoFocus={!account} required />}
        </Field>
        {error && <p className="error">{error}</p>}
      </div>
    </SettingsSection>
    {account && <SettingsSection title={providerId === 'openai' ? 'OpenAI' : 'Anthropic'}><div className="setting-form"><SignIn account={account} /><small className="hint">{usedBy.length ? `Used by ${usedBy.map((p) => p.name).join(', ')}.` : 'Select this account in a profile to use it.'}</small></div></SettingsSection>}
    {account && <SettingsSection title="Limits">
      <div className="setting-form account-limits">
        <AccountLimits account={account} />
        <small className="hint">{usedBy.length > 1 ? `One allowance shared by ${usedBy.map((p) => p.name).join(', ')}. ` : ''}Set by {providerId === 'openai' ? 'OpenAI' : 'Anthropic'} and counting all of this account’s use, including use outside Accio.</small>
      </div>
    </SettingsSection>}
    <SettingsFooter remove={account && { name: account.name, run: remove, blocked: usedBy.length ? `In use by ${usedBy.map((p) => p.name).join(', ')}. Remove it from those profiles first.` : undefined }} busy={busy} onCancel={onDone} saveLabel={account ? 'Save' : 'Add account'} saveDisabled={busy || (!!account && name === account.name)} />
  </form>;
}
