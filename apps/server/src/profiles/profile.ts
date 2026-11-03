import type { ProfileView, SaveProfileParams } from '@accio/protocol';
import { PROVIDERS } from '@accio/hub';
import { UserError } from '../rpc/router.js';

/** GLOSSARY: Profile. It and its accounts live on the hub (ADR 0002, ADR 0004). */
export type Profile = {
  id: string;
  name: string;
};

/** Who a profile is signed in as, as the hub reports it. */
export type AccountSummary = { signedIn: boolean; email: string | null; organization: string | null; claudeAccountId: string | null };

/** Profile → providers → accounts. For now only Anthropic, with at most one account. */
export function toView(profile: Profile, claude: AccountSummary): ProfileView {
  return {
    id: profile.id,
    name: profile.name,
    providers: PROVIDERS.map((p) => ({
      ...p,
      accounts: p.id === 'anthropic' && claude.signedIn ? [{ email: claude.email, organization: claude.organization }] : [],
    })),
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

/** GLOSSARY: an account belongs to exactly one profile, so no two profiles sign in to the same Claude account. */
export function assertAccountInOneProfile(
  profiles: readonly Profile[],
  accountOf: (id: string) => AccountSummary,
  profileId: string,
  claudeAccountId: string | null,
) {
  if (!claudeAccountId) return;
  const other = profiles.find((a) => a.id !== profileId && accountOf(a.id).claudeAccountId === claudeAccountId);
  if (!other) return;
  throw new UserError(
    `${other.name} already uses this Claude account, and an account belongs to one profile only. Sign in with a different Claude account.`,
  );
}

function uniqueId(profiles: readonly Profile[], base: string): string {
  const taken = new Set(profiles.map((a) => a.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}
