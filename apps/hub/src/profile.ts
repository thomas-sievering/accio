import type { ProfileView, SaveProfileParams } from '@accio/protocol';
import { PROVIDERS, type SharedProfile } from './sharedSettings.js';
import type { Hub } from './hub.js';
import { SignInError } from './claudeOAuth.js';

export function profileViews(profiles: readonly SharedProfile[], hub: Hub): ProfileView[] {
  return profiles.map((p) => ({ ...p, providers: PROVIDERS.map((provider) => {
    const account = hub.selectedAccount(p.id, provider.id);
    return { ...provider, accounts: account ? [account] : [] };
  }) }));
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
