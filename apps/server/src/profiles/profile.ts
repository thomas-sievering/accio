import type { AccountView, ProfileView, SaveProfileParams } from '@accio/protocol';
import { PROVIDERS } from '@accio/hub';
import { UserError } from '../rpc/router.js';

/** GLOSSARY: Profile. It and its accounts live on the hub (ADR 0002, ADR 0004). */
export type Profile = {
  id: string;
  name: string;
};

/** Profiles expose selected accounts without credentials. */
export function toView(profile: Profile, account: AccountView | null): ProfileView {
  return {
    ...profile,
    providers: PROVIDERS.map((p) => ({ ...p, accounts: p.id === 'anthropic' && account ? [account] : [] })),
  };
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'profile';
}

/** Applies a save request to the current profiles and returns the new list. */
export function saveProfile(profiles: readonly Profile[], req: SaveProfileParams): { profiles: Profile[]; saved: Profile } {
  const existing = req.id ? profiles.find((a) => a.id === req.id) : undefined;
  if (req.id && !existing) throw new UserError(`No profile ${req.id}`);

  const saved: Profile = {
    id: existing?.id ?? uniqueId(profiles, slugify(req.name)),
    name: req.name,
  };
  if (profiles.some((a) => a.id !== saved.id && a.name.toLowerCase() === saved.name.toLowerCase())) {
    throw new UserError(`A profile named ${saved.name} already exists`);
  }
  const next = existing ? profiles.map((a) => (a.id === saved.id ? saved : a)) : [...profiles, saved];
  return { profiles: next, saved };
}

function uniqueId(profiles: readonly Profile[], base: string): string {
  const taken = new Set(profiles.map((a) => a.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}
