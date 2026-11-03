import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Account } from './account.js';

/**
 * ADR 0003: accio owns one Claude config folder per account on each machine and
 * every thread runs with CLAUDE_CONFIG_DIR pointing at it. accio rewrites the
 * settings it owns on every save and start; it never deletes the folder, because
 * Claude keeps its session transcripts there and Resume needs them.
 */
export function configFolderOf(home: string, accountId: string): string {
  return join(home, 'accounts', accountId, 'claude');
}

export function settingsFor(account: Account) {
  return {
    env: {
      ANTHROPIC_BASE_URL: account.hubUrl,
      ANTHROPIC_AUTH_TOKEN: account.hubKey,
    },
  };
}

export async function writeConfigFolder(home: string, account: Account): Promise<string> {
  const dir = configFolderOf(home, account.id);
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'settings.json');
  const body = JSON.stringify(settingsFor(account), null, 2);
  let current: string | undefined;
  try {
    current = await readFile(file, 'utf8');
  } catch {}
  if (current !== body) await writeFile(file, body, { mode: 0o600 });
  return dir;
}
