import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_MODEL, type AccountView, type ProfileView, type ModelSelection } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLive, useLocalState } from '../app/useLive';

/** 'all' or a profile id. The sidebar shows only what belongs to it. */
export type ProfileFilter = 'all' | (string & {});

type ProfilesState = {
  profiles: ProfileView[] | undefined;
  accounts: AccountView[] | undefined;
  filter: ProfileFilter;
  setFilter: (f: ProfileFilter) => void;
};

const Ctx = createContext<ProfilesState | null>(null);

export function ProfilesProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const profiles = useLive(() => client.call('profiles.list', {}), 'profiles.changed');
  const accounts = useLive(() => client.call('accounts.list', {}), 'accounts.changed');
  const [stored, setFilter] = useLocalState<ProfileFilter>('accio.profileFilter', 'all');
  // A deleted profile falls back to showing everything.
  const filter = stored !== 'all' && profiles && !profiles.some((a) => a.id === stored) ? 'all' : stored;
  return <Ctx.Provider value={{ profiles, accounts, filter, setFilter }}>{children}</Ctx.Provider>;
}

export function useProfiles(): ProfilesState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useProfiles outside ProfilesProvider');
  return s;
}

/** The account Claude Code uses for this profile. */
export function claudeAccount(profile: ProfileView) {
  return profile.providers.find((p) => p.id === 'anthropic')?.accounts[0] ?? null;
}

export function accountForModel(profile: ProfileView, model: ModelSelection) {
  return profile.providers.find((p) => p.id === (model.harnessId === 'codex' ? 'openai' : 'anthropic'))?.accounts[0] ?? null;
}
export function hasSignedInAccount(profile: ProfileView) {
  return profile.providers.some((p) => p.available && p.accounts.some((a) => a.signedIn));
}
/** Codex-only profiles start on the ChatGPT account's default; everyone else on DEFAULT_MODEL. */
export function defaultModel(profile?: ProfileView): ModelSelection {
  const codexOnly = profile && !claudeAccount(profile)?.signedIn && profile.providers.some((p) => p.id === 'openai' && p.accounts.some((a) => a.signedIn));
  return codexOnly ? { harnessId: 'codex', modelId: 'default' } : DEFAULT_MODEL;
}
