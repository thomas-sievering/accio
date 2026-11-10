import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** How a profile's threads reach their models: the hub's proxy and a model key, or the hub's Sorting Hat and a hat key. */
export type HubAccess = { baseUrl: string; accessKey: string };

/**
 * ADR 0003: accio owns one Claude config folder per profile on each machine and
 * every thread runs with CLAUDE_CONFIG_DIR pointing at it. accio rewrites the
 * settings it owns on every save and start; it never deletes the folder, because
 * Claude keeps its session transcripts there and Resume needs them.
 */
export function configFolderOf(home: string, profileId: string): string {
  return join(home, 'profiles', profileId, 'claude');
}

export function settingsFor(access: HubAccess) {
  return { env: { ANTHROPIC_BASE_URL: access.baseUrl, ANTHROPIC_AUTH_TOKEN: access.accessKey } };
}

export async function writeConfigFolder(home: string, profileId: string, access: HubAccess): Promise<string> {
  const dir = configFolderOf(home, profileId);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'settings.json');
  const body = JSON.stringify(settingsFor(access), null, 2);
  let current: string | undefined;
  try {
    current = await readFile(file, 'utf8');
  } catch {}
  if (current !== body) await writeFile(file, body, { mode: 0o600 });
  return dir;
}
