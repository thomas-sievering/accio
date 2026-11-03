import { access, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';

/**
 * Before the glossary renamed Account to Profile, accio stored `accounts.json`,
 * `accounts/<id>/claude` and `accountId` fields. Moves them to the new names once,
 * keeping each profile's Claude folder (and the sessions Resume needs) intact.
 * The hub moves its own file (`Hub.load`).
 */
export async function renameAccountsToProfiles(home: string) {
  await moveIfNew(join(home, 'accounts.json'), join(home, 'profiles.json'));
  await moveIfNew(join(home, 'accounts'), join(home, 'profiles'));
  await renameField(join(home, 'projects.json'), (data: { projects?: Record<string, unknown>[] }) => data.projects ?? []);
  await renameField(join(home, 'threads.json'), (data: Record<string, unknown>[]) => data);
}

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function moveIfNew(from: string, to: string) {
  if ((await exists(from)) && !(await exists(to))) await rename(from, to);
}

async function renameField<T>(file: string, recordsOf: (data: T) => Record<string, unknown>[]) {
  if (!(await exists(file))) return;
  const json = new JsonFile<T>(file, () => { throw new Error(`Missing migration input ${file}`); });
  const data = await json.read();
  let changed = false;
  for (const r of recordsOf(data)) {
    if ('accountId' in r && !('profileId' in r)) {
      r.profileId = r.accountId;
      delete r.accountId;
      changed = true;
    }
  }
  if (changed) await json.write(data);
}
