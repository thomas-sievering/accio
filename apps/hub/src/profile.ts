import type { ProfileView, SaveProfileParams } from '@accio/protocol';
import { PROVIDERS, type SharedProfile } from './sharedSettings.js';
import type { AccountSelection, Hub } from './hub.js';
import { SignInError } from './claudeOAuth.js';

export function profileViews(profiles: readonly SharedProfile[], hub: Hub): ProfileView[] {
  return profiles.map((p) => ({ ...p, providers: PROVIDERS.map((provider) => ({ ...provider, accounts: hub.selectedAccounts(p.id, provider.id), inUseId: hub.accountIdInUse(p.id, provider.id) })) }));
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
  if (req.id && !old) throw new SignInError(`No profile ${req.id}`);
  const base = req.name.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'profile';
  let id = old?.id ?? base;
  for (let n = 2; !old && profiles.some((p) => p.id === id); n++) id = `${base}-${n}`;
  const saved = { id, name: req.name };
  if (profiles.some((p) => p.id !== id && p.name.toLowerCase() === req.name.toLowerCase())) throw new SignInError(`A profile named ${req.name} already exists`);
  return { saved, profiles: old ? profiles.map((p) => p.id === id ? saved : p) : [...profiles, saved] };
}
