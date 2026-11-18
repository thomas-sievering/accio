import { useState, type FormEvent } from 'react';
import { noSortingHatMessage, type AccountView, type ProviderId } from '@accio/protocol';
import { useClient } from '../app/connection';
import { NEW, SettingLink, SettingsFooter, SettingsSection, StatusPill, type SettingsNav } from '../app/Settings';
import { Field, focusFirstInvalid } from '../resources/Field';
import { ProviderLogo } from '../app/icons';
import { useAction } from '../app/useAction';
import { AccountLimits } from '../limits/AccountLimits';
import { useLimits, useWatchLimits } from '../limits/limits';
import { useProfiles } from './profiles';
import { SignIn } from './SignIn';

export function useAccountsData() {
  return { items: useProfiles().accounts };
}
type Props = { nav: SettingsNav; data: ReturnType<typeof useAccountsData> };

export function NewAccount({ nav }: Props) {
  return <AccountForm providerId={nav.route.extra?.providerId ?? 'anthropic'} onSaved={(a) => nav.open(a.id)} onDone={nav.back} />;
}

export function AccountDetail({ nav, item }: Props & { item: AccountView }) {
  return <AccountForm account={item} providerId={item.providerId} onSaved={nav.back} onDone={nav.back} />;
}

export function AccountsList({ nav, data }: Props) {
  const { sortingHat } = useProfiles();
  const accounts = data.items!;
  const onOpen = (id: string) => nav.open(id);
  if (sortingHat === null) return <p className="note">{noSortingHatMessage}</p>;
  if (sortingHat?.problem) return <p className="error" role="alert">{sortingHat.problem}</p>;
  return <>
    <p className="note">Name an account, sign in, then select it in a profile.{sortingHat && ` Accounts are kept on the Sorting Hat at ${new URL(sortingHat.url).host}.`}</p>
    <SettingsSection title="Anthropic" add={{ label: 'Add Claude account', onClick: () => nav.open(NEW) }}>
      {accounts.filter((a) => a.providerId === 'anthropic').map((a) => <SettingLink key={a.id} icon={<ProviderLogo providerId="anthropic" />} title={a.name} description={[a.email, a.organization].filter(Boolean).join(' · ') || undefined} onClick={() => onOpen(a.id)}>
        <StatusPill tone={a.signedIn ? 'ok' : 'warn'}>{a.signedIn ? 'Signed in' : 'Signed out'}</StatusPill>
      </SettingLink>)}
    </SettingsSection>
    <SettingsSection title="OpenAI" add={{ label: 'Add ChatGPT account', onClick: () => nav.open(NEW, { providerId: 'openai' }) }}>
      {accounts.filter((a) => a.providerId === 'openai').map((a) => <SettingLink key={a.id} icon={<ProviderLogo providerId="openai" />} title={a.name} description={a.email ?? undefined} onClick={() => onOpen(a.id)}>
        <StatusPill tone={a.signedIn ? 'ok' : 'warn'}>{a.signedIn ? 'Signed in' : 'Signed out'}</StatusPill>
      </SettingLink>)}
    </SettingsSection>
  </>;
}

function AccountForm({ account, providerId, onSaved, onDone }: { account?: AccountView; providerId: ProviderId; onSaved: (a: AccountView) => void; onDone: () => void }) {
  const client = useClient();
  const { profiles } = useProfiles();
  const [name, setName] = useState(account?.name ?? '');
  const [touched, setTouched] = useState(false);
  const { busy, error, run, attempt } = useAction();
  const limitsView = useLimits().views?.get(account?.id ?? '');
  const usedBy = profiles?.filter((p) => p.providers.some((provider) => !!account && provider.accountIds.includes(account.id))) ?? [];
  useWatchLimits(account?.signedIn ? [account.id] : []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim()) return focusFirstInvalid(e.currentTarget);
    const saved = await run(() => client.call('accounts.save', { id: account?.id, name, providerId }));
    if (saved) onSaved(saved);
  };
  const remove = async () => {
    if (account && await attempt(() => client.call('accounts.delete', { id: account.id }))) onDone();
  };
  return <form className="settings-profile-form" onSubmit={submit} noValidate>
    <SettingsSection>
      <div className="setting-form">
        <Field label="Account name" error={touched && !name.trim() && 'Enter a name for the account.'}>
          {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="A name you choose, such as Team account 1" maxLength={80} autoFocus={!account} required />}
        </Field>
        {error && <p className="error">{error}</p>}
      </div>
    </SettingsSection>
    {account && <SettingsSection title={providerId === 'openai' ? 'OpenAI' : 'Anthropic'}><div className="setting-form"><SignIn account={account} /><small className="hint">{usedBy.length ? `Used by ${usedBy.map((p) => p.name).join(', ')}.` : 'Select this account in a profile to use it.'}</small></div></SettingsSection>}
    {account && <SettingsSection title="Limits">
      <div className="setting-form account-limits">
        <AccountLimits account={account} />
        {limitsView?.status !== 'unsupported' && <small className="hint">{usedBy.length > 1 ? `One allowance shared by ${usedBy.map((p) => p.name).join(', ')}. ` : ''}Set by {providerId === 'openai' ? 'OpenAI' : 'Anthropic'} and counting all of this account’s use, including use outside Accio.</small>}
      </div>
    </SettingsSection>}
    <SettingsFooter remove={account && { name: account.name, run: remove, blocked: usedBy.length ? `In use by ${usedBy.map((p) => p.name).join(', ')}. Remove it from ${usedBy.length === 1 ? usedBy[0]!.name : 'those profiles'} first.` : undefined }} busy={busy} onCancel={onDone} saveLabel={account ? 'Save' : 'Add account'} busyLabel={account ? 'Saving…' : 'Adding…'} saveDisabled={busy || (!!account && name === account.name)} dirty={name !== (account?.name ?? '') && !busy} />
  </form>;
}
