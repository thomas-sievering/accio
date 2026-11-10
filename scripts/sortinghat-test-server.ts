/** The standalone Sorting Hat in an empty disposable state folder; only the providers are fixtures. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { closeWhenOrphaned } from './fixtureLifetime.js';
import { startStandalone } from '../apps/sorting-hat/src/standalone.js';
import { FakeCodex, fakeAnthropicApi, fakeAnthropicAuth } from '../apps/sorting-hat/src/testing/fakeProviders.js';

const dir = await mkdtemp(join(tmpdir(), 'sorting-hat-browser-'));
const auth = fakeAnthropicAuth();
// Every Claude account reports the same allowance, so a house's order decides its account in use.
const hour = 3600_000;
const claudeUsage = { five_hour: { utilization: 42, resets_at: new Date(Date.now() + 2 * hour).toISOString() }, seven_day: { utilization: 18, resets_at: new Date(Date.now() + 80 * hour).toISOString() } };
for (let n = 1; n <= 20; n++) auth.usage[`token-${n}`] = claudeUsage;
// Earlier usage, of a house, hat key and account deleted since: 30 hours, 10 days and 60 days ago.
// Rows: [hour, provider, house, hat key, account, model, requests, input, output, cache read, cache write].
const seededHour = (hoursAgo: number) => new Date(Math.floor(Date.now() / hour) * hour - hoursAgo * hour).toISOString().replace('.000Z', 'Z');
await writeFile(join(dir, 'usage.json'), JSON.stringify({ version: 1, days: [], hours: [
  [seededHour(30), 'anthropic', 'archive', null, 'gone-account', 'claude-old', 3, 1000, 200, 300, 50],
  [seededHour(240), 'anthropic', 'archive', 'gone-key', 'gone-account', 'claude-old', 2, 5000, 700, 0, 0],
  [seededHour(1440), 'openai', 'archive', null, 'gone-account', 'gpt-old', 1, 400, 100, 50, 0],
] }));
const anthropic = await fakeAnthropicApi();
const codex = new FakeCodex();
const hat = await startStandalone({
  dir,
  port: Number(process.env.ACCIO_SORTINGHAT_TEST_PORT ?? 47483),
  claudeFetch: auth.fetch,
  anthropicUrl: anthropic.url,
  // ChatGPT's device approval happens on the provider's page; here it completes shortly after the sign-in starts.
  codexFactory: async (options) => {
    const client = await codex.factory(options);
    const request = client.request.bind(client);
    client.request = async (method, params) => {
      if (method === 'account/rateLimits/read') {
        return { rateLimits: { limitId: 'codex', primary: { usedPercent: 64, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 5400 }, secondary: { usedPercent: 31, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 400_000 } } } as never;
      }
      const result = await request(method, params);
      if (method === 'account/login/start') setTimeout(() => { void (client as unknown as { complete(who: string): Promise<void> }).complete('chatgpt-personal'); }, 1500).unref();
      return result;
    };
    return client;
  },
  openaiFetch: async () => new Response('{}'),
  openaiUrl: 'https://chatgpt.test/backend-api/codex',
});
console.log(`Sorting Hat fixture ready: ${hat.url}`);
process.send?.({ type: 'ready' });

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await hat.close();
  await anthropic.close();
  if (dirname(dir) !== resolve(tmpdir()) || !basename(dir).startsWith('sorting-hat-browser-')) throw new Error('Unexpected fixture folder');
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  process.exit();
};
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
process.on('message', (message) => { if ((message as { type?: string })?.type === 'shutdown') void close(); });
closeWhenOrphaned('Sorting Hat', () => void close());
