import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccessConfig } from './access.js';
import { OpenAIAuth } from './openaiAuth.js';
import { startServer } from './server.js';
import { SortingHat } from './sortingHat.js';
import type { CodexFactory } from './codex.js';
import type { Fetch } from './types.js';

/** In the state directory: the admin token, readable only by its owner. */
export const ADMIN_TOKEN_FILE = 'admin-token';

export type StandaloneOptions = {
  /** The state directory: sorting-hat.json, admin-token and each ChatGPT account's credential home. */
  dir: string;
  host?: string;
  port?: number;
  /** Used instead of the admin-token file, for example from a deployment's secrets. */
  adminToken?: string;
  /** Cloudflare Access in front of the dashboard and management API (README.md, "Dashboard"). */
  access?: AccessConfig;
  accessFetch?: Fetch;
  claudeFetch?: Fetch;
  codexFactory?: CodexFactory;
  anthropicUrl?: string;
  openaiUrl?: string;
  openaiFetch?: Fetch;
};

/** The Sorting Hat on its own: its state, the management API and the model routes on one port. */
export async function startStandalone(opts: StandaloneOptions) {
  await mkdir(opts.dir, { recursive: true, mode: 0o700 });
  const admin = opts.adminToken ? { token: opts.adminToken, created: false } : await adminToken(opts.dir);
  const hat = new SortingHat(opts.dir, opts.claudeFetch, new OpenAIAuth(opts.dir, opts.codexFactory));
  await hat.load();
  let server;
  try {
    server = await startServer({ hat, host: opts.host ?? '127.0.0.1', port: opts.port ?? 0, adminToken: admin.token,
      access: opts.access, accessFetch: opts.accessFetch, upstream: opts.anthropicUrl, fetchImpl: opts.claudeFetch, openaiUpstream: opts.openaiUrl, openaiFetch: opts.openaiFetch });
  } catch (error) { await hat.close(); throw error; }
  // ChatGPT accounts' models change over time; read them again once per start.
  const modelsRefreshed = hat.refreshCodexModels().catch(() => false);
  return {
    hat,
    url: server.url,
    port: server.port,
    adminToken: admin.token,
    /** True when this start created the admin token. */
    createdAdminToken: admin.created,
    adminTokenFile: opts.adminToken ? null : join(opts.dir, ADMIN_TOKEN_FILE),
    close: async () => { await server.close(); await modelsRefreshed; await hat.close(); },
  };
}

/** Reads the admin token, creating it on first start. */
async function adminToken(dir: string) {
  const file = join(dir, ADMIN_TOKEN_FILE);
  try {
    const token = (await readFile(file, 'utf8')).trim();
    if (token) return { token, created: false };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const token = `hat-admin-${randomBytes(32).toString('base64url')}`;
  await writeFile(file, `${token}\n`, { mode: 0o600 });
  return { token, created: true };
}
