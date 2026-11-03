import type { AccountView, SaveAccountParams } from '@accio/protocol';
import { UserError } from '../rpc/router.js';

/** GLOSSARY: Account. Its provider login lives on the hub (ADR 0002, ADR 0007). */
export type Account = {
  id: string;
  name: string;
  isJob: boolean;
  roots: string[];
};

/** Who an account is signed in as, as the hub reports it. */
export type SignIn = { signedIn: boolean; email: string | null; organization: string | null; claudeAccountId: string | null };

export function toView(account: Account, signIn: SignIn): AccountView {
  return {
    ...account,
    signIn: signIn.signedIn ? { email: signIn.email, organization: signIn.organization } : null,
  };
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'account';
}

/** Applies a save request to the current accounts and returns the new list. */
export function saveAccount(accounts: readonly Account[], req: SaveAccountParams): { accounts: Account[]; saved: Account } {
  const existing = req.id ? accounts.find((a) => a.id === req.id) : undefined;
  if (req.id && !existing) throw new UserError(`No account ${req.id}`);

  const saved: Account = {
    id: existing?.id ?? uniqueId(accounts, slugify(req.name)),
    name: req.name,
    isJob: req.isJob,
    roots: [...new Set(req.roots ?? [])],
  };
  if (accounts.some((a) => a.id !== saved.id && a.name.toLowerCase() === saved.name.toLowerCase())) {
    throw new UserError(`An account named ${saved.name} already exists`);
  }
  const next = existing ? accounts.map((a) => (a.id === saved.id ? saved : a)) : [...accounts, saved];
  return { accounts: next, saved };
}

/**
 * GLOSSARY: a job account never shares a login with any other account. So the
 * same Claude login may back two accio accounts only if neither is a job account.
 */
export function assertLoginKeptApart(
  accounts: readonly Account[],
  signInOf: (id: string) => SignIn,
  accountId: string,
  claudeAccountId: string | null,
) {
  if (!claudeAccountId) return;
  const me = accounts.find((a) => a.id === accountId);
  const other = accounts.find((a) => a.id !== accountId && signInOf(a.id).claudeAccountId === claudeAccountId);
  if (!me || !other || (!me.isJob && !other.isJob)) return;
  const job = me.isJob ? me : other;
  throw new UserError(
    `${other.name} is already signed in with this Claude login, and ${job.name} is a job account, so it needs a login of its own. ` +
      'Sign in with a different Claude account.',
  );
}

function uniqueId(accounts: readonly Account[], base: string): string {
  const taken = new Set(accounts.map((a) => a.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}
