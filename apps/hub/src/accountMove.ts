import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';
import { STATE_FILE, readState, type HatState } from '@accio/sorting-hat';
import type { SharedSettings } from './sharedSettings.js';
import type { SortingHatClient } from './sortingHatClient.js';

/** What the move sends, decided once: the embedded state with its credentials, and the ids they get there. */
type Move = { state: HatState; accountIds: Record<string, string>; houses: { profileId: string; id: string; name: string; accountIds: string[] }[] };

const moveFile = (dir: string) => new JsonFile<Move | null>(join(dir, 'sorting-hat-move.json'), () => null);

/** Whether the embedded Sorting Hat still has accounts, or a move of them is unfinished. */
export async function accountsToMove(home: string) {
  const dir = join(home, 'hub');
  return await moveFile(dir).exists() || (await readState(dir)).accounts.length > 0;
}

/**
 * ADR 0018: moves the embedded Sorting Hat's accounts, with their credentials
 * and ChatGPT credential homes, to the hub's own Sorting Hat, and links each
 * profile without a house to a new house of its name with its accounts in
 * order. Call it only while the embedded one is stopped, so its copy never
 * refreshes again. The plan is kept in sorting-hat-move.json, which the
 * embedded one never reads, before its state goes; until the move finishes,
 * calling this again resends the same ids, which the Sorting Hat replaces.
 */
export async function moveAccounts(home: string, client: SortingHatClient, settings: SharedSettings) {
  const dir = join(home, 'hub');
  const codex = join(dir, 'codex');
  const file = moveFile(dir);
  let move = await file.read();
  if (!move) {
    const state = await readState(dir);
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
      const embedded = state.houses.find((h) => h.id === p.id)?.accountIds ?? [];
      return { profileId: p.id, id, name: p.name, accountIds: embedded.flatMap((a) => accountIds[a] ? [accountIds[a]] : []) };
    }) };
    await file.write(move);
  }
  await rm(join(dir, STATE_FILE), { force: true });
  const plan = move;
  const accounts = await Promise.all(plan.state.accounts.map(async (a) => {
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
