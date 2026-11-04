// `pnpm try`: opens this checkout's desktop app beside the real one. It gets a fresh home seeded
// as the verify device (already joined to its hub, so accounts and real turns work) and free
// ports, so it never touches ~/.accio or port 47321. Closing the window removes the home.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockDevice, seedLinkedHome } from '../.agents/skills/3-verify/scripts/device.mjs';

const root = resolve(fileURLToPath(import.meta.url), '../..');
let release;
try {
  release = await lockDevice(`pnpm try in ${root}`, { waitMs: 0 });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const home = await mkdtemp(join(tmpdir(), `accio-try-${basename(root)}-`));
let code = 1;
try {
  const hub = await seedLinkedHome(home);
  console.log(`accio try: ${root}\n  home ${home} (removed on close)\n  hub ${hub.name} as the verify device`);
  const env = { ...process.env, ACCIO_HOME: home, ACCIO_HOST: '127.0.0.1', ACCIO_PORT: '0', ACCIO_HUB_PORT: '0', ACCIO_WINDOW_TITLE: `accio · ${basename(root)}` };
  const child = spawn(process.execPath, [join(root, 'apps/desktop/start.mjs')], { stdio: 'inherit', env });
  // Ctrl+C reaches the app too; wait for it to stop its worker instead of exiting first.
  process.on('SIGINT', () => {});
  code = await new Promise((done) => child.once('exit', (c) => done(c ?? 0)));
} catch (error) {
  console.error(error.message);
} finally {
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }).catch((error) => console.error(`Could not remove ${home}: ${error.message}`));
  await release();
}
process.exit(code);
