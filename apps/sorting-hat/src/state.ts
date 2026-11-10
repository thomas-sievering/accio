import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { JsonFile } from './store.js';
import type { ProviderId } from './types.js';
import type { ClaudeAccount } from './claudeOAuth.js';
import type { OpenAIAccount } from './openaiAuth.js';

/** The Sorting Hat's one state document, in its state directory. */
export const STATE_FILE = 'sorting-hat.json';

/** GLOSSARY: House. A named group of accounts, each provider's in order of use. */
export type StoredHouse = {
  id: string;
  name: string;
  /** Accounts of every provider, each provider's in order of use. */
  accountIds: string[];
};
/**
 * GLOSSARY: Hat key. Only a SHA-256 hash of the secret is kept; the secret is
 * shown once, when the key is created. A revoked key stays listed, so what was
 * done with it can still be told apart.
 */
export type StoredHatKey = { id: string; houseId: string; name: string; createdAt: string; hash: string; revokedAt: string | null };
export type StoredAccount = { id: string; name: string; providerId?: ProviderId; account: ClaudeAccount | null; openai?: OpenAIAccount | null };
export type HatState = { version: 1; houses: StoredHouse[]; hatKeys: StoredHatKey[]; accounts: StoredAccount[] };

export const emptyState = (): HatState => ({ version: 1, houses: [], hatKeys: [], accounts: [] });

/**
 * What Accio's hub stored before the Sorting Hat had houses and hat keys
 * (`profiles.json`, earlier `accounts.json`): a house per profile with one
 * access key, which the hub now asks for in memory and is dropped here.
 */
type EmbeddedProfile = { id: string; accessKey?: string; accountIds?: string[]; accountId?: string | null; openaiAccountId?: string | null };
type EmbeddedData = { profiles: EmbeddedProfile[]; accounts: StoredAccount[] };
/** Before named accounts, each profile held its login inline. */
type InlineProfile = { id: string; accessKey: string; account?: ClaudeAccount; login?: ClaudeAccount };

/**
 * Reads the state document, converting what Accio's hub stored before. The
 * earlier file is removed once the new one is written: refresh tokens rotate,
 * so two live copies would sign each other out (ADR 0018).
 */
export async function loadState(file: JsonFile<HatState>): Promise<HatState> {
  if (await file.exists()) {
    const stored = await file.read();
    return { ...emptyState(), ...stored, hatKeys: stored.hatKeys ?? [] };
  }
  const dir = dirname(file.path);
  for (const name of ['profiles.json', 'accounts.json']) {
    const old = join(dir, name);
    if (!await JsonFile.exists(old)) continue;
    const state = fromEmbedded(await new JsonFile<EmbeddedData | InlineProfile[]>(old, () => []).read());
    await file.write(state);
    await rm(old, { force: true });
    return state;
  }
  return emptyState();
}

function fromEmbedded(stored: EmbeddedData | InlineProfile[]): HatState {
  if (!Array.isArray(stored)) return { ...emptyState(), accounts: stored.accounts, houses: stored.profiles.map(orderedAccounts) };
  const accounts = stored.flatMap((p) => {
    const account = p.account ?? p.login;
    return account ? [{ id: `account-${p.id}`, name: account.email ?? p.id, account }] : [];
  });
  const houses = stored.map((p) => ({ id: p.id, name: p.id, accountIds: accounts.some((a) => a.id === `account-${p.id}`) ? [`account-${p.id}`] : [] }));
  return { ...emptyState(), houses, accounts };
}

/** Before ordered accounts, a profile selected at most one account per provider. */
function orderedAccounts({ id, accountIds, accountId, openaiAccountId }: EmbeddedProfile): StoredHouse {
  return { id, name: id, accountIds: accountIds ?? [accountId, openaiAccountId].filter((a): a is string => !!a) };
}

/** The state in `dir`, converted as on load; for an app moving the accounts of a Sorting Hat it embedded. */
export const readState = (dir: string) => loadState(new JsonFile<HatState>(join(dir, STATE_FILE), emptyState));
