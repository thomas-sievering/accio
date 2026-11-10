import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';
import type { SharedSettings } from './sharedSettings.js';
import type { ImportedAccount, SortingHatClient } from './sortingHatClient.js';

/** An account as the hub kept it, with its credentials; a ChatGPT account's are in codex/<credentialId>/auth.json. */
type OldAccount = Omit<ImportedAccount, 'codexAuth'>;
/** The hub's accounts and each profile's (by id), every provider's in order. */
type OldState = { accounts: OldAccount[]; houses: { id: string; accountIds: string[] }[] };
/** What the move sends, decided once: the hub's accounts with their credentials, and the ids they get there. */
type Move = { state: OldState; accountIds: Record<string, string>; houses: { profileId: string; id: string; name: string; accountIds: string[] }[] };

/**
 * Where the hub kept its accounts: `profiles.json` before the Sorting Hat, with
 * a profile's single account per provider before ordered accounts; `sorting-hat.json`
 * while the hub embedded the Sorting Hat.
 */
const OLD_FILES = ['profiles.json', 'sorting-hat.json'];
type OldProfile = { id: string; accountIds?: string[]; accountId?: string | null; openaiAccountId?: string | null };

async function readOld(dir: string): Promise<OldState> {
  const state: OldState = { accounts: [], houses: [] };
  for (const name of OLD_FILES) {
    const stored = await new JsonFile<{ accounts?: OldAccount[]; houses?: OldState['houses']; profiles?: OldProfile[] }>(join(dir, name), () => ({})).read();
    state.accounts.push(...stored.accounts ?? []);
    state.houses.push(...stored.houses ?? [], ...(stored.profiles ?? []).map((p) => ({ id: p.id, accountIds: p.accountIds ?? [p.accountId, p.openaiAccountId].filter((a): a is string => !!a) })));
  }
  return state;
}

const moveFile = (dir: string) => new JsonFile<Move | null>(join(dir, 'sorting-hat-move.json'), () => null);

/** Whether the hub still has accounts of its own, or a move of them is unfinished. */
export async function accountsToMove(home: string) {
  const dir = join(home, 'hub');
  return await moveFile(dir).exists() || (await readOld(dir)).accounts.length > 0;
}

/**
 * ADR 0018: moves the accounts the hub kept itself, with their credentials and
 * ChatGPT credential homes, to its Sorting Hat, and links each profile without
 * a house to a new house of its name with its accounts in order. Nothing on the
 * hub uses them any more, so its copy never refreshes again. The plan is kept
 * in sorting-hat-move.json before the old files go; until the move finishes,
 * calling this again resends the same ids, which the Sorting Hat replaces.
 * Remove once every hub has moved.
 */
export async function moveAccounts(home: string, client: SortingHatClient, settings: SharedSettings) {
  const dir = join(home, 'hub');
  const codex = join(dir, 'codex');
  const file = moveFile(dir);
  let move = await file.read();
  if (!move) {
    const state = await readOld(dir);
    // Nothing (left) to move: the credential homes of a finished move go too.
    if (!state.accounts.length) return void await rm(codex, { recursive: true, force: true, maxRetries: 5 });
    const [houses, accounts] = await Promise.all([client.houses(), client.accounts()]);
    const taken = new Set(houses.map((h) => h.id)), takenAccounts = new Set(accounts.map((a) => a.id));
    // Another hub's move may have used the same ids; this one's then gets new ones.
    const accountIds = Object.fromEntries(state.accounts.map((a) => [a.id, takenAccounts.has(a.id) ? randomUUID() : a.id]));
    move = { state, accountIds, houses: settings.profiles().filter((p) => !p.houseId).map((p) => {
      const base = p.id.slice(0, 56);
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      taken.add(id);
      const kept = state.houses.find((h) => h.id === p.id)?.accountIds ?? [];
      return { profileId: p.id, id, name: p.name, accountIds: kept.flatMap((a) => accountIds[a] ? [accountIds[a]] : []) };
    }) };
    await file.write(move);
  }
  for (const name of OLD_FILES) await rm(join(dir, name), { force: true });
  const plan = move;
  const accounts = await Promise.all(plan.state.accounts.map(async (a): Promise<ImportedAccount> => {
    const id = plan.accountIds[a.id]!;
    if (!a.openai) return { ...a, id };
    const auth = await readFile(join(codex, a.openai.credentialId, 'auth.json'), 'utf8').then(JSON.parse, () => null);
    return auth ? { ...a, id, codexAuth: auth } : { ...a, id, openai: null };
  }));
  await client.importAccounts(accounts, plan.houses.map(({ id, name, accountIds }) => ({ id, name, accountIds })));
  await settings.setProfiles(settings.profiles().map((p) => {
    const house = p.houseId ? undefined : plan.houses.find((h) => h.profileId === p.id);
    return house ? { ...p, houseId: house.id } : p;
  }));
  await rm(file.path, { force: true });
  await rm(codex, { recursive: true, force: true, maxRetries: 5 });
}
