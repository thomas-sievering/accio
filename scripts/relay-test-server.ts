/**
 * GLOSSARY: Relay. Two isolated machines on one hub, for checking relayed threads in the browser.
 * "MacBook" owns the threads (deterministic harness); "PC" serves the real web client.
 * Prints the PC's URL. Ctrl+C stops everything and removes the homes.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { startHubService } from '../apps/hub/src/index.js';
import { startApp } from '../apps/worker/src/app.js';
import { FakeHarness, replyWith, toolCall } from '../apps/worker/src/testing/fakeHarness.js';
import { fakeClaudeFetch, TestClient } from '../apps/worker/src/testing/testApp.js';
import { git } from '../apps/worker/src/git.js';
import { closeWhenOrphaned } from './fixtureLifetime.js';

process.env.ACCIO_SECRET_KEY = Buffer.alloc(32, 9).toString('base64');
const root = await mkdtemp(join(tmpdir(), 'accio-relay-'));
const token = 'relay-test-token';
const hub = await startHubService({ home: join(root, 'hub'), port: 0, claudeFetch: fakeClaudeFetch });

/** A machine already joined to the hub, as if paired through Settings → Hubs. */
async function machine(name: string, port: number, harness: FakeHarness, webRoot?: string) {
  const home = join(root, name);
  const id = randomUUID();
  await mkdir(home, { recursive: true });
  await writeFile(join(home, 'machine.json'), JSON.stringify({ id }));
  const { code } = await hub.createPairingCode();
  const paired = await fetch(hub.url + '/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, machineId: id }) }).then((r) => r.json()) as { hubId: string; token: string };
  await writeFile(join(home, 'hub-connections.json'), JSON.stringify([{ id: paired.hubId, name: 'Home', url: hub.url, token: paired.token, home: join(home, 'hubs', paired.hubId), local: true }]));
  const app = await startApp({ home, host: '127.0.0.1', port, hubPort: 0, token, webRoot }, { claudeFetch: fakeClaudeFetch, harness });
  const client = await TestClient.open(`ws://127.0.0.1:${app.port}/ws?token=${token}`);
  await client.call('machines.rename', { machineId: id, name });
  // Both machines have a checkout of the same repository, so it is one project.
  const repo = join(home, 'relay-demo');
  await mkdir(repo); await git(repo, 'init', '--quiet'); await git(repo, 'remote', 'add', 'origin', 'https://github.com/example/relay-demo.git');
  return { app, client, repo };
}

const macHarness = new FakeHarness(async function* (run) {
  const steps = /long/i.test(run.prompt) ? 6 : 1;
  for (let step = 1; step <= steps; step++) {
    if (steps > 1) await sleep(1500);
    yield* toolCall('Bash', { command: `step ${step}` }, `${randomUUID()}`);
  }
  yield* replyWith(`MacBook here. You said: ${run.prompt.slice(0, 80)}`);
});
const mac = await machine('MacBook', 0, macHarness);
const pc = await machine('PC', Number(process.env.ACCIO_RELAY_TEST_PORT ?? 47491), new FakeHarness(), resolve('apps/web/dist'));
const profile = await mac.client.signedIn('Personal');
await pc.client.call('checkouts.add', { path: pc.repo, profileId: profile.id });
const macCheckout = await mac.client.call('checkouts.add', { path: mac.repo, profileId: profile.id });
await mac.client.call('threads.start', { checkoutId: macCheckout.id, text: 'Hello from the MacBook' });
await mac.client.call('threads.start', { checkoutId: macCheckout.id, text: 'A long task on the MacBook' });
await pc.client.call('threads.start', { checkoutId: (await pc.client.call('projects.get', {})).checkouts[0]!.id, text: 'A thread on the PC' });
// A repository only the MacBook has: its thread is listed on the PC under the MacBook's project name.
const macOnly = join(root, 'MacBook', 'mac-only');
await mkdir(macOnly); await git(macOnly, 'init', '--quiet'); await git(macOnly, 'remote', 'add', 'origin', 'https://github.com/example/mac-only.git');
const macOnlyCheckout = await mac.client.call('checkouts.add', { path: macOnly, profileId: profile.id });
await mac.client.call('threads.start', { checkoutId: macOnlyCheckout.id, text: 'Only the MacBook has this repository' });

console.log(`Relay fixture ready: http://127.0.0.1:${pc.app.port}/#token=${token}`);
process.send?.({ type: 'ready' });
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  mac.client.close(); pc.client.close();
  await pc.app.close(); await mac.app.close(); await hub.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  process.exit();
};
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
/** Stops the MacBook only, to see its threads go offline on the PC. */
process.stdin.on('data', (data) => { if (String(data).trim() === 'mac off') void mac.app.close().then(() => console.log('MacBook stopped')); });
closeWhenOrphaned('Relay', () => void close());
