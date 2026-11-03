import { access, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { JsonFile } from '@accio/persistence';
import type { ClaudeAccount } from './claudeOAuth.js';
import type { HubProfile } from './hub.js';

export type StoredAccount = { id: string; name: string; account: ClaudeAccount | null };
export type AccountData = { profiles: HubProfile[]; accounts: StoredAccount[] };
type LegacyProfile = { id: string; accessKey: string; account?: ClaudeAccount; login?: ClaudeAccount };

/** Load seam for both historical hub filenames and inline credentials. */
export async function loadAccounts(file: JsonFile<AccountData>): Promise<AccountData> {
  const old = join(dirname(file.path), 'accounts.json');
  if (!(await exists(file.path)) && await exists(old)) await rename(old, file.path);
  const stored = await file.read() as AccountData | LegacyProfile[];
  if (!Array.isArray(stored)) return stored;
  const accounts = stored.flatMap((p) => {
    const account = p.account ?? p.login;
    return account ? [{ id: `account-${p.id}`, name: account.email ?? p.id, account }] : [];
  });
  const profiles = stored.map((p) => ({ id: p.id, accessKey: p.accessKey, accountId: accounts.some((a) => a.id === `account-${p.id}`) ? `account-${p.id}` : null }));
  const data = { profiles, accounts };
  await file.write(data);
  return data;
}

async function exists(path: string) {
  try { await access(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
