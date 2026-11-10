import { rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { JsonFile } from './store.js';
import type { ProviderId } from './types.js';
import type { ClaudeAccount } from './claudeOAuth.js';
import type { OpenAIAccount } from './openaiAuth.js';

/**
 * GLOSSARY: House, as stored today: its id is chosen by the app that embeds the
 * Sorting Hat, and its access key is the one hat key that app forwards with. The
 * file still calls houses `profiles`, their name before accounts left the hub.
 */
export type StoredHouse = {
  id: string;
  accessKey: string;
  /** Accounts of every provider, each provider's in order of use. */
  accountIds: string[];
};
export type StoredAccount = { id: string; name: string; providerId?: ProviderId; account: ClaudeAccount | null; openai?: OpenAIAccount | null };
export type AccountData = { profiles: StoredHouse[]; accounts: StoredAccount[] };
type LegacyProfile = { id: string; accessKey: string; account?: ClaudeAccount; login?: ClaudeAccount };
/** Before ordered accounts, a profile selected at most one account per provider. */
type SingleAccountProfile = { id: string; accessKey: string; accountIds?: string[]; accountId?: string | null; openaiAccountId?: string | null };

/** Load seam for both historical filenames and inline credentials. */
export async function loadAccounts(file: JsonFile<AccountData>): Promise<AccountData> {
  const old = join(dirname(file.path), 'accounts.json');
  if (!(await file.exists()) && await JsonFile.exists(old)) await rename(old, file.path);
  const stored = await file.read() as (Omit<AccountData, 'profiles'> & { profiles: SingleAccountProfile[] }) | LegacyProfile[];
  if (!Array.isArray(stored)) return { ...stored, profiles: stored.profiles.map(orderedAccounts) };
  const accounts = stored.flatMap((p) => {
    const account = p.account ?? p.login;
    return account ? [{ id: `account-${p.id}`, name: account.email ?? p.id, account }] : [];
  });
  const profiles = stored.map((p) => ({ id: p.id, accessKey: p.accessKey, accountIds: accounts.some((a) => a.id === `account-${p.id}`) ? [`account-${p.id}`] : [] }));
  const data = { profiles, accounts };
  await file.write(data);
  return data;
}

function orderedAccounts({ id, accessKey, accountIds, accountId, openaiAccountId }: SingleAccountProfile): StoredHouse {
  return { id, accessKey, accountIds: accountIds ?? [accountId, openaiAccountId].filter((a): a is string => !!a) };
}
