/**
 * GLOSSARY: Relay. Isolated machines on one hub, for checking relayed threads in the browser.
 * "MacBook" owns the threads (deterministic harness); "PC" serves the real web client; "Old laptop" is there to be revoked.
 * A PC thread told "Put the MacBook to sleep" or "Wake the MacBook" takes the MacBook off the relay
 * and back, as a system sleep does.
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
import { callAccioTools, startTestSortingHat, TestClient } from '../apps/worker/src/testing/testApp.js';
import { fetchFrom, initRepoWithOrigin } from '../apps/worker/src/testing/gitRepo.js';
import { git } from '../apps/worker/src/git.js';
import { onShutdown } from './fixtureLifetime.js';

process.env.ACCIO_SECRET_KEY = Buffer.alloc(32, 9).toString('base64');
const root = await mkdtemp(join(tmpdir(), 'accio-relay-'));
const token = 'relay-test-token';
const hat = await startTestSortingHat(join(root, 'hub'));
const hub = await startHubService({ home: join(root, 'hub'), port: 0, webRoot: resolve('apps/web/dist') });

/** A machine already joined to the hub, as if paired through Settings → Hubs. */
async function machine(name: string, port: number, harness: FakeHarness, webRoot?: string) {
  const home = join(root, name);
  const id = randomUUID();
  await mkdir(home, { recursive: true });
  await writeFile(join(home, 'machine.json'), JSON.stringify({ id }));
  const { code } = await hub.createPairingCode();
  const paired = await fetch(hub.url + '/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, machineId: id }) }).then((r) => r.json()) as { hubId: string; token: string };
  await writeFile(join(home, 'hub-connections.json'), JSON.stringify([{ id: paired.hubId, name: 'Home', url: hub.url, token: paired.token, home: join(home, 'hubs', paired.hubId), local: true }]));
  const app = await startApp({ home, host: '127.0.0.1', port, hubPort: 0, token, webRoot }, { harness });
  const client = await TestClient.open(`ws://127.0.0.1:${app.port}/ws?token=${token}`);
  await client.call('machines.rename', { machineId: id, name });
  // Both machines have a checkout of the same repository, so it is one project.
  const repo = join(home, 'relay-demo');
  await mkdir(repo); await git(repo, 'init', '--quiet'); await git(repo, 'remote', 'add', 'origin', 'https://github.com/example/relay-demo.git');
  return { app, client, repo };
}

const macHarness = new FakeHarness(async function* (run) {
  if (run.prompt === 'Browser steering fixture') {
    const messages: string[] = [];
    let wake = () => {};
    const abort = () => wake();
    run.signal.addEventListener('abort', abort, { once: true });
    run.registerSteer?.(async text => { messages.push(text); wake(); });
    try {
      yield { type: 'harness_event', event: { kind: 'text', id: 'browser-steer-ready', text: 'Waiting for browser steering.' } };
      let count = 0;
      while (!run.signal.aborted) {
        const text = messages.shift();
        if (text === undefined) await new Promise<void>(resolve => { wake = resolve; });
        else yield { type: 'harness_event', event: { kind: 'text', id: `browser-steer-${count++}`, text: `Steered: ${text}` } };
      }
    } finally { run.registerSteer?.(undefined); run.signal.removeEventListener('abort', abort); }
    return;
  }
  if (run.prompt === 'Browser choice fixture') {
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5L8AAAAASUVORK5CYII=', 'base64');
    const options = ['Rows', 'Cards'].map(label => ({ label, path: `browser-choice-${label}.png` }));
    for (const { path } of options) await writeFile(join(run.cwd, path), pixel);
    yield* toolCall('mcp__accio__offer_choice', { question: 'Which browser layout?', options }, randomUUID());
    yield* replyWith('Choose a browser layout.');
    return;
  }
  if (run.prompt === 'Browser confirmation fixture') {
    const folder = join(root, 'MacBook', 'browser-card-fixture');
    await mkdir(folder, { recursive: true });
    const result = await callAccioTools(run, 'tools/call', { name: 'add_project', arguments: { folders: [folder] } });
    yield* replyWith(`Project answer: ${result.content[0].text}`);
    return;
  }
  const secret = /^Browser secret fixture: (save|once|existing|decline)$/.exec(run.prompt)?.[1];
  if (secret) {
    const result = await run.requestSecret!({ slot: `browser:fixture:${secret}`, label: `Browser ${secret} credential`, reason: 'Test private browser entry' });
    yield* replyWith(`Secret ${secret}: ${result.status}`);
    return;
  }
  const steps = /long/i.test(run.prompt) ? 6 : 1;
  for (let step = 1; step <= steps; step++) {
    if (steps > 1) {
      try { await sleep(1500, undefined, { signal: run.signal }); } catch { return; }
    }
    yield* toolCall('Bash', { command: `step ${step}` }, `${randomUUID()}`);
  }
  yield* replyWith(`MacBook here. You said: ${run.prompt.slice(0, 80)}`);
});
const mac = await machine('MacBook', 0, macHarness);
// A machine with nothing on it, to revoke from Settings → Machines without taking the MacBook's threads offline.
const spare = await machine('Old laptop', 0, new FakeHarness());
// Driven from a PC thread, since a sleeping MacBook can't take a message.
const pcHarness = new FakeHarness(async function* (run, n) {
  if (run.prompt === 'Temporarily put all machines to sleep') {
    void sleep(500, undefined, { ref: false }).then(async () => {
      for (const { app } of [mac, pc, spare]) app.connections.setAsleep(true);
      await sleep(5_000, undefined, { ref: false });
      for (const { app } of [mac, pc, spare]) app.connections.setAsleep(false);
    });
  }
  const asleep = /put the macbook to sleep/i.test(run.prompt) ? true : /wake the macbook/i.test(run.prompt) ? false : undefined;
  if (asleep !== undefined) mac.app.connections.setAsleep(asleep);
  if (run.prompt.startsWith('Browser ')) {
    yield* replyWith(`PC here. You said: ${run.prompt}`);
    return;
  }
  yield* replyWith(asleep === undefined ? `reply ${n}` : asleep ? 'The MacBook is asleep.' : 'The MacBook is awake.');
});
const pc = await machine('PC', Number(process.env.ACCIO_RELAY_TEST_PORT ?? 47491), pcHarness, resolve('apps/web/dist'));
await mac.client.call('sortingHat.configure', { url: hat.url, adminToken: hat.adminToken, hubName: 'Home' });
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
const browserProject = join(root, 'MacBook', 'browser-project');
const browserOrigin = join(root, 'browser-project.git');
const browserRemote = 'https://github.com/example/browser-project.git';
await initRepoWithOrigin(browserProject, browserOrigin, { 'README.md': 'Disposable browser fixture\n' });
await git(browserProject, 'remote', 'set-url', 'origin', browserRemote);
await pc.client.call('machines.setProfileFolders', { machineId: (await pc.client.thisMachine()).id, profileId: profile.id, folders: [join(root, 'PC', 'clones')] });
const browserCheckout = await mac.client.call('checkouts.add', { path: browserProject, profileId: profile.id });
fetchFrom(browserOrigin, browserRemote);
await mac.client.call('threads.start', { checkoutId: browserCheckout.id, text: 'Browser project history on the MacBook' });
await hub.settings.registerProjects([{ repoKey: 'github.com/example/hub-only', name: 'hub-only', profileId: profile.id }]);
fetchFrom(browserOrigin, 'https://github.com/example/hub-only.git');
// A folder without a remote, only on the MacBook: listed on the PC while the MacBook is online, and its threads run there.
const macNotes = join(root, 'MacBook', 'mac-notes');
await mkdir(macNotes); await git(macNotes, 'init', '--quiet');
await mac.client.call('checkouts.add', { path: macNotes, profileId: profile.id });

console.log(`Relay fixture ready: http://127.0.0.1:${pc.app.port}/#token=${token}`);
process.send?.({ type: 'ready' });
onShutdown('Relay', async () => {
  mac.client.close(); pc.client.close(); spare.client.close();
  await pc.app.close(); await mac.app.close(); await spare.app.close(); await hub.close(); await hat.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
/** Stops the MacBook only, to see its threads go offline on the PC. */
process.stdin.on('data', (data) => { if (String(data).trim() === 'mac off') void mac.app.close().then(() => console.log('MacBook stopped')); });
