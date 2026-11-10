import type { JsonFile } from './store.js';
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

/** Reads the state document, filling in what earlier versions of it lacked. */
export async function loadState(file: JsonFile<HatState>): Promise<HatState> {
  const stored = await file.read();
  return { ...emptyState(), ...stored, hatKeys: stored.hatKeys ?? [] };
}
