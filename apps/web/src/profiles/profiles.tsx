import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_MODEL, accountInUse, type AccountView, type ProfileView, type ModelSelection, type ProviderId, type SortingHatView } from '@accio/protocol';
import { useClient } from '../app/connection';
import { useLive, useLocalState } from '../app/useLive';

/** 'all' or a profile id. The sidebar shows only what belongs to it. */
export type ProfileFilter = 'all' | (string & {});

type ProfilesState = {
  profiles: ProfileView[] | undefined;
  accounts: AccountView[] | undefined;
  /** The hub's own Sorting Hat; null while the hub keeps accounts itself. */
  sortingHat: SortingHatView | null | undefined;
  filter: ProfileFilter;
  setFilter: (f: ProfileFilter) => void;
};

const Ctx = createContext<ProfilesState | null>(null);

export function ProfilesProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const profiles = useLive(() => client.call('profiles.list', {}), 'profiles.changed');
  const accounts = useLive(() => client.call('accounts.list', {}), 'accounts.changed');
  const sortingHat = useLive(() => client.call('sortingHat.get', {}), 'sortingHat.changed');
  const [stored, setFilter] = useLocalState<ProfileFilter>('accio.profileFilter', 'all');
  // A deleted profile falls back to showing everything.
  const filter = stored !== 'all' && profiles && !profiles.some((a) => a.id === stored) ? 'all' : stored;
  return <Ctx.Provider value={{ profiles, accounts, sortingHat, filter, setFilter }}>{children}</Ctx.Provider>;
}

export function useProfiles(): ProfilesState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useProfiles outside ProfilesProvider');
  return s;
}

/**
 * The account a profile's turns use at a provider: its first signed-in one, or
 * else its first, signed out, so notices can name it. Null when none is selected.
 */
export function profileAccount(profile: ProfileView, providerId: ProviderId) {
  const provider = profile.providers.find((p) => p.id === providerId);
  return accountInUse(provider) ?? provider?.accounts[0] ?? null;
}

/** The account Claude Code uses for this profile. */
export function claudeAccount(profile: ProfileView) {
  return profileAccount(profile, 'anthropic');
}

export function accountForModel(profile: ProfileView, model: ModelSelection) {
  return profileAccount(profile, model.harnessId === 'codex' ? 'openai' : 'anthropic');
}
/** Each provider's selected account ids, in order of use. */
export type AccountSelection = Record<ProviderId, string[]>;

export function selectionOf(profile?: ProfileView): AccountSelection {
  const ids = (id: ProviderId) => profile?.providers.find((p) => p.id === id)?.accounts.map((a) => a.id) ?? [];
  return { anthropic: ids('anthropic'), openai: ids('openai') };
}

/**
 * The ordered selection, plus each provider's first account for hubs from before ordered accounts.
 * `houseId` links a house on the hub's Sorting Hat (null for none); leave it out on hubs without one.
 */
export function profileSave(id: string | undefined, name: string, selection: AccountSelection, houseId?: string | null) {
  return { id, name, accountIds: selection, accountId: selection.anthropic[0] ?? null, openaiAccountId: selection.openai[0] ?? null, ...(houseId !== undefined ? { houseId } : {}) };
}

export function hasSignedInAccount(profile: ProfileView) {
  return profile.providers.some((p) => p.available && p.accounts.some((a) => a.signedIn));
}
/** Codex-only profiles start on the ChatGPT account's default; everyone else on DEFAULT_MODEL. */
export function defaultModel(profile?: ProfileView): ModelSelection {
  const codexOnly = profile && !claudeAccount(profile)?.signedIn && profile.providers.some((p) => p.id === 'openai' && p.accounts.some((a) => a.signedIn));
  return codexOnly ? { harnessId: 'codex', modelId: 'default' } : DEFAULT_MODEL;
}
