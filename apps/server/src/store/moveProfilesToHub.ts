import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import type { MachineInfo } from '@accio/protocol';
import type { SharedSettings, SharedSeed } from '@accio/hub';

/**
 * Before ADR 0004 took effect, each machine kept its profiles and their folders in
 * `profiles.json`. On the hub's first start this seeds the shared settings with
 * them, the folders under this machine, and sets the old file aside.
 */
export async function moveProfilesToHub(home: string, here: MachineInfo, settings: SharedSettings): Promise<void> {
  const file = join(home, 'profiles.json');
  let migrated = false;
  await settings.load(async (): Promise<SharedSeed> => {
    // Profile folders were stored as `roots` before the glossary named them.
    type Stored = { id: string; name: string; folders?: string[]; roots?: string[] };
    let stored: Stored[];
    try {
      stored = JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { profiles: [], machines: [] };
      throw err;
    }
    const profileFolders: Record<string, string[]> = {};
    for (const p of stored) {
      const folders = p.folders ?? p.roots ?? [];
      if (folders.length) profileFolders[p.id] = folders;
    }
    migrated = true;
    return {
      profiles: stored.map(({ id, name }) => ({ id, name })),
      machines: [{ ...here, harnesses: [], lastSeen: new Date().toISOString(), profileFolders }],
    };
  });
  // Keep the original usable until the hub has durably saved its replacement.
  if (migrated) await rename(file, `${file}.moved-to-hub`);
}
