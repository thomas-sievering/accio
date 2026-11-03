import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PORT } from '@accio/protocol';

export const DEFAULT_HUB_PORT = 47322;

/** Where this machine keeps everything accio owns. Never ~/.claude (ADR 0003). */
export function accioHome(): string {
  return process.env.ACCIO_HOME ?? join(homedir(), '.accio');
}

export type ServerConfig = { token: string; port: number; host: string; hubPort: number };

/** Loads the machine's server settings, creating its token on first start. */
export async function loadServerConfig(home: string): Promise<ServerConfig> {
  await mkdir(home, { recursive: true });
  const file = join(home, 'server.json');
  let stored: Partial<ServerConfig> = {};
  try {
    stored = JSON.parse(await readFile(file, 'utf8'));
  } catch {}
  const config: ServerConfig = {
    token: stored.token ?? randomBytes(32).toString('base64url'),
    port: Number(process.env.ACCIO_PORT ?? stored.port ?? DEFAULT_PORT),
    hubPort: Number(process.env.ACCIO_HUB_PORT ?? stored.hubPort ?? DEFAULT_HUB_PORT),
    // v0.1 runs on one machine only, so it listens on loopback.
    host: process.env.ACCIO_HOST ?? stored.host ?? '127.0.0.1',
  };
  if (!stored.token) {
    await writeFile(file, JSON.stringify({ ...stored, token: config.token }, null, 2), { mode: 0o600 });
  }
  return config;
}
