import type { ProfileView, SaveProfileParams } from '@accio/protocol';
import { PROVIDERS, type SharedProfile } from './sharedSettings.js';
import type { AccountSelection, SortingHatApi } from '@accio/sorting-hat';
import { HubError } from './errors.js';

/**
 * Where profiles' houses are. `linked` is set for a Sorting Hat of the hub's own,
 * where a profile links to the house it chose, or to none; without it a profile
 * links to the embedded house of the same id.
 */
export type HouseSource = Pick<SortingHatApi, 'selectedAccounts' | 'accountIdInUse'> & {
  linked?: (profile: SharedProfile) => { id: string; name: string } | null;
};

/** Each profile with its house's accounts. */
export function profileViews(profiles: readonly SharedProfile[], hat: HouseSource): ProfileView[] {
  return profiles.map(({ houseId: _houseId, ...p }) => {
    const house = hat.linked ? hat.linked({ ...p, houseId: _houseId }) : undefined;
    const id = house === undefined ? p.id : house?.id;
    return { ...p, providers: PROVIDERS.map((provider) => ({ ...provider, accounts: id ? hat.selectedAccounts(id, provider.id) : [], inUseId: id ? hat.accountIdInUse(id, provider.id) : null })),
      ...(house !== undefined ? { house } : {}) };
  });
}

/** The accounts a save selects per provider; the ordered form wins over the single-account one. */
export function accountSelection(req: SaveProfileParams): AccountSelection {
  const single = (id: string | null | undefined) => id === undefined ? undefined : id === null ? [] : [id];
  const selection: AccountSelection = { anthropic: req.accountIds?.anthropic ?? single(req.accountId), openai: req.accountIds?.openai ?? single(req.openaiAccountId) };
  for (const key of Object.keys(selection) as (keyof AccountSelection)[]) if (!selection[key]) delete selection[key];
  return selection;
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
