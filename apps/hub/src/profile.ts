import type { ProfileView, ProviderId, SaveProfileParams } from '@accio/protocol';
import { PROVIDERS, type SharedProfile } from './sharedSettings.js';
import type { SortingHatLink } from './sortingHatLink.js';
import { HubError } from './errors.js';

/** Per provider, the accounts to select in order; a provider left out keeps its selection. */
export type AccountSelection = Partial<Record<ProviderId, string[]>>;

/** Each profile with its house on the Sorting Hat and that house's accounts. */
export function profileViews(profiles: readonly SharedProfile[], link: Pick<SortingHatLink, 'house' | 'selectedAccounts' | 'accountIdInUse'>): ProfileView[] {
  return profiles.map(({ houseId, ...p }) => ({
    ...p,
    house: houseId ? { id: houseId, name: link.house(houseId)?.name ?? houseId } : null,
    providers: PROVIDERS.map((provider) => ({ ...provider, accounts: houseId ? link.selectedAccounts(houseId, provider.id) : [], inUseId: houseId ? link.accountIdInUse(houseId, provider.id) : null })),
  }));
}

/** The accounts a save selects per provider. */
export function accountSelection(req: SaveProfileParams): AccountSelection {
  return Object.fromEntries(Object.entries(req.accountIds ?? {}).filter(([, ids]) => ids)) as AccountSelection;
}

export function saveSharedProfile(profiles: readonly SharedProfile[], req: SaveProfileParams) {
  const old = req.id ? profiles.find((p) => p.id === req.id) : undefined;
  if (req.id && !old) throw new HubError(`No profile ${req.id}`);
  const base = req.name.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'profile';
  let id = old?.id ?? base;
  for (let n = 2; !old && profiles.some((p) => p.id === id); n++) id = `${base}-${n}`;
  const houseId = req.houseId === undefined ? old?.houseId : req.houseId ?? undefined;
  const saved: SharedProfile = { id, name: req.name, ...(houseId ? { houseId } : {}) };
  if (profiles.some((p) => p.id !== id && p.name.toLowerCase() === req.name.toLowerCase())) throw new HubError(`A profile named ${req.name} already exists`);
  return { saved, profiles: old ? profiles.map((p) => p.id === id ? saved : p) : [...profiles, saved] };
}
