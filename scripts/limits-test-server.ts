/** Real app in an empty disposable home; only provider I/O and model execution are fixtures. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { startApp } from '../apps/server/src/app.js';
import { fakeClaudeFetch } from '../apps/server/src/testing/testApp.js';
import { FakeCodex } from '../apps/server/src/testing/fakeCodex.js';
import { FakeHarness, replyWith } from '../apps/server/src/testing/fakeHarness.js';

const home = await mkdtemp(join(tmpdir(), 'accio-limits-browser-'));
const reads = new Map<string, number>();
const codex = new FakeCodex();
codex.rateLimitsResponse = { rateLimits: { limitId: 'codex', primary: { usedPercent: 14, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 }, secondary: { usedPercent: 39, windowDurationMins: 10080 } } };
const app = await startApp({ home, host: '127.0.0.1', port: 47482, hubPort: 0, token: 'isolated-limits-test-token', webRoot: resolve('apps/web/dist') }, {
  harness: new FakeHarness(async function* () { yield* replyWith('Limits fixture reply'); }),
  codexFactory: async (options) => {
    const client = await codex.factory(options);
    const request = client.request.bind(client);
    client.request = async (method, params) => {
      const result = await request(method, params);
      if (method === 'account/login/start') setTimeout(() => { void client.complete('shared-chatgpt'); }, 100).unref();
      return result;
    };
    return client;
  },
  claudeFetch: async (url, init) => {
    if (String(url).includes('/oauth/token')) return fakeClaudeFetch(url, init);
    if (String(url) !== 'https://api.anthropic.com/api/oauth/usage') throw new Error('Unexpected fixture request');
    const who = new Headers(init?.headers).get('authorization')?.replace('Bearer oauth-', '') ?? 'unknown';
    const count = (reads.get(who) ?? 0) + 1;
    reads.set(who, count);
    if (who === 'shared' && count === 2) return new Response('Private fixture diagnostic', { status: 503, headers: { 'retry-after': '2' } });
    if (who === 'empty') return Response.json({ five_hour: null, seven_day: null });
    const reset = new Date(Date.now() + (who === 'expired' ? -10_000 : 3600_000)).toISOString();
    const session = { utilization: who === 'unknown' ? null : who === 'expired' ? 100 : who === 'work' ? 33 : 48, resets_at: reset };
    const weekly = { utilization: who === 'work' ? 100 : 28, resets_at: new Date(Date.now() + 2 * 86_400_000).toISOString() };
    return Response.json({ five_hour: session, seven_day: weekly,
      seven_day_breakdown: { fable: null },
      limits: [
        { id: 'session-v2', kind: 'session', percent: session.utilization, resets_at: session.resets_at },
        { id: 'weekly-v2', kind: 'weekly', percent: weekly.utilization, resets_at: weekly.resets_at },
        { kind: 'weekly_scoped', percent: 1, scope: { model: { display_name: 'Fable' } } },
      ],
    });
  },
});
console.log(`Limits fixture ready: http://127.0.0.1:${app.port}`);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await app.close();
  if (dirname(home) !== resolve(tmpdir()) || !basename(home).startsWith('accio-limits-browser-')) throw new Error('Unexpected fixture home');
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  process.exit();
};
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
