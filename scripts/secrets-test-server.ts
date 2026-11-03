/** The production server/UI with a scripted harness; all credentials are disposable test markers. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startApp } from '../apps/server/src/app.js';
import { FakeHarness, replyWith } from '../apps/server/src/testing/fakeHarness.js';
import { fakeClaudeFetch, TestClient } from '../apps/server/src/testing/testApp.js';

const home = await mkdtemp(join(tmpdir(), 'accio-secrets-browser-'));
const token = 'isolated-secrets-test-token';
// A disposable headless key also makes this fixture portable to Unix. Never a user's key.
process.env.ACCIO_SECRET_KEY = Buffer.alloc(32, 41).toString('base64');
const markers = new Set<string>();
const harness = new FakeHarness(async function* (run) {
  const delivery = await run.requestSecret!({ slot: run.prompt === 'request alternate' ? 'github.release:docs' : 'cloudflare.pages.deploy:docs',
    label: 'Cloudflare API token', reason: 'Deploy the built site to Cloudflare Pages', clientRequestId: 'deployment-token' });
  if (delivery.status === 'provided') {
    const marker = await readFile(delivery.file, 'utf8'); markers.add(marker);
    if (!marker.trim().startsWith('accio-test-marker-')) throw new Error('Expected a disposable verification value');
  }
  yield* replyWith(`Credential delivery ${delivery.status}.`);
});
const app = await startApp({ home, host: '127.0.0.1', port: Number(process.env.ACCIO_SECRETS_TEST_PORT ?? 47483), hubPort: 0, token, webRoot: resolve('apps/web/dist') }, { harness, claudeFetch: fakeClaudeFetch });
const client = await TestClient.open(`ws://127.0.0.1:${app.port}/ws?token=${token}`);
const personal = await client.signedIn('Personal'); await client.signedIn('Work');
const projectPath = join(home, 'secret-project'); await mkdir(projectPath); execFileSync('git', ['init', '--quiet', projectPath], { windowsHide: true });
const checkout = await client.call('checkouts.add', { profileId: personal.id, path: projectPath });
await client.call('threads.start', { checkoutId: checkout.id, text: 'request secret' });
console.log(`Secrets fixture ready: http://127.0.0.1:${app.port}`);
process.send?.({ type: 'ready' });
let closing = false;
const close = async () => {
  if (closing) return; closing = true;
  client.close(); await app.close();
  for (const directory of ['transcripts', 'thread-details']) {
    for (const file of await readdir(join(home, directory), { recursive: true }).catch(() => [])) {
      if (!String(file).endsWith('.json')) continue;
      const content = await readFile(join(home, directory, String(file)), 'utf8');
      for (const marker of markers) if (content.includes(marker)) throw new Error('Private marker reached retained thread data');
    }
  }
  if ((await readdir(join(home, 'secret-delivery')).catch(() => [])).length) throw new Error('Secret deliveries survived cleanup');
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  const evidence = resolve('out/secrets-ui'); await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, 'cleanup.json'), JSON.stringify({ cleanup: true, privateMarkersAbsentFromThreadData: true, deliveriesRemoved: true, dummyDeliveries: markers.size }, null, 2));
  process.exit();
};
process.on('SIGINT', () => void close()); process.on('SIGTERM', () => void close());
process.on('message', message => { if ((message as { type?: string })?.type === 'shutdown') void close(); });
