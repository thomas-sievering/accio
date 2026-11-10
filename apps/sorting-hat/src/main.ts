// Runs the Sorting Hat on its own. See README.md.
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { accessFromEnv } from './access.js';
import { startStandalone } from './standalone.js';

const { values } = parseArgs({ options: { dir: { type: 'string' }, host: { type: 'string' }, port: { type: 'string' } } });
const env = process.env;
const dir = resolve(values.dir ?? env.SORTING_HAT_DIR ?? join(homedir(), '.sorting-hat'));
const host = values.host ?? env.SORTING_HAT_HOST ?? '127.0.0.1';
const port = Number(values.port ?? env.SORTING_HAT_PORT ?? 47330);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port ${values.port ?? env.SORTING_HAT_PORT}`);

const access = accessFromEnv(env);
const hat = await startStandalone({ dir, host, port, adminToken: env.SORTING_HAT_ADMIN_TOKEN || undefined, access });
console.log(`Sorting Hat: ${hat.url} (state in ${dir})`);
console.log(access
  ? `Dashboard: behind Cloudflare Access (${access.teamDomain})`
  : `Dashboard: ${hat.url}/ from this machine only (no Cloudflare Access configured)`);
if (hat.createdAdminToken) console.log(`Admin token, created now and kept in ${hat.adminTokenFile}:\n  ${hat.adminToken}`);
else if (hat.adminTokenFile) console.log(`Admin token: in ${hat.adminTokenFile}`);
// One machine-readable line for whoever started this process.
console.log(`SORTING_HAT_READY ${JSON.stringify({ url: hat.url, port: hat.port })}`);

let stopping = false;
const stop = () => { if (stopping) return; stopping = true; void hat.close().then(() => process.exit(0), () => process.exit(1)); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
