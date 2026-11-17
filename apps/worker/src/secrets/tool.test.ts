import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { AccioTools, type ToolAccess } from '../tools/tools.js';
import { UserError } from '../rpc/router.js';
import { FakeHarness, replyWith } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';
import { requestSecretTool, type SecretDelivery } from './secrets.js';

let server: Server | undefined;
let app: Awaited<ReturnType<typeof startTestApp>> | undefined;
afterEach(async () => {
  await app?.stop(); app = undefined;
  await new Promise<void>((done) => (server ? server.close(() => done()) : done())); server = undefined;
});

async function serve(tools: AccioTools) {
  server = createServer((req, res) => void tools.handle(req, res).then((handled) => { if (!handled) res.writeHead(404).end(); }));
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', () => done()));
  tools.listen(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
}

async function rpc(access: ToolAccess, method: string, params?: unknown) {
  const response = await fetch(access.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: access.authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }) });
  return { status: response.status, text: await response.text() };
}

const args = { slot: 'deploy:test', label: 'Deploy token', reason: 'Deploy the site' };
const call = (access: ToolAccess) => rpc(access, 'tools/call', { name: 'request_secret', arguments: args });
const listed = async (access: ToolAccess) => (JSON.parse((await rpc(access, 'tools/list')).text).result.tools as { name: string }[]).map((t) => t.name);

it('offers request_secret only to a grant that carries the turn\'s secret request', async () => {
  const delivery: SecretDelivery = { status: 'provided', file: 'C:/delivery/file', expiresAt: '2026-11-17T00:00:00.000Z' };
  const tools = new AccioTools([requestSecretTool]);
  await serve(tools);
  const plain = tools.grant('thread-1')!;
  expect(await listed(plain.access)).toEqual([]);
  expect(JSON.parse((await call(plain.access)).text).error.code).toBe(-32602);
  const measurement = tools.measurementGrant()!;
  expect(await listed(measurement.access)).toEqual([]);
  const seen: unknown[] = [];
  const turn = tools.grant('thread-1', { requestSecret: async (input) => { seen.push(input); return delivery; } })!;
  expect(await listed(turn.access)).toEqual(['request_secret']);
  const answer = JSON.parse((await call(turn.access)).text).result;
  expect(answer).toEqual({ content: [{ type: 'text', text: JSON.stringify(delivery) }] });
  expect(seen).toEqual([args]);
});

it('words a failed request without what the failure carried', async () => {
  const tools = new AccioTools([requestSecretTool]);
  await serve(tools);
  const leaky = tools.grant('thread-1', { requestSecret: async () => { throw new Error('EACCES writing private-marker-value'); } })!;
  const failed = await call(leaky.access);
  expect(failed.text).not.toContain('private-marker-value');
  expect(JSON.parse(failed.text).result).toMatchObject({ isError: true, content: [{ text: 'Could not supply the secret. Check Accio and retry request_secret.' }] });
  const refused = tools.grant('thread-1', { requestSecret: async () => { throw new UserError('This thread is already waiting for a secret.'); } })!;
  expect(JSON.parse((await call(refused.access)).text).result.content[0].text).toBe('This thread is already waiting for a secret.');
});

it('returns only a path, and a turn that has ended cannot request a secret with its token', async () => {
  const marker = 'accio-test-marker-ended-turn';
  const seen: { access?: ToolAccess; raw?: string; file?: string } = {};
  const harness = new FakeHarness(async function* (run, n) {
    if (n === 1) {
      seen.access = run.tools;
      const raw = await call(run.tools!);
      seen.raw = raw.text;
      seen.file = (JSON.parse(JSON.parse(raw.text).result.content[0].text) as Extract<SecretDelivery, { status: 'provided' }>).file;
      expect(await readFile(seen.file, 'utf8')).toBe(marker);
    }
    yield* replyWith('done');
  });
  app = await startTestApp({ harness });
  const client = await app.connect();
  const profile = await client.signedIn('Personal');
  const thread = await client.call('threads.start', { profileId: profile.id, text: 'request secret' });
  const card = await client.waitFor('thread.item', (e) => e.threadId === thread.id && e.item.kind === 'secret' && e.item.status === 'pending');
  if (card.item.kind !== 'secret') throw new Error('Missing secret card');
  await client.call('secretRequests.answer', { threadId: thread.id, requestId: card.item.requestId, answer: { type: 'once', value: marker } });
  await expect.poll(async () => (await client.call('threads.list', {})).find((t) => t.id === thread.id)?.status, { timeout: 10_000 }).toBe('idle');

  expect(seen.raw).not.toContain(marker);
  expect(Object.keys(JSON.parse(JSON.parse(seen.raw!).result.content[0].text)).sort()).toEqual(['expiresAt', 'file', 'status']);
  await expect(readFile(seen.file!)).rejects.toThrow();
  client.events.length = 0;
  // The ended turn's token no longer reaches request_secret, so no new card can open.
  expect((await call(seen.access!)).status).toBe(401);
  expect((await rpc(seen.access!, 'tools/list')).status).toBe(401);
  expect(client.events.some((e) => e.event === 'thread.item' && (e.data as { item?: { kind?: string } }).item?.kind === 'secret')).toBe(false);
  const secrets = (await client.call('threads.transcript', { threadId: thread.id })).filter((i) => i.kind === 'secret');
  expect(secrets).toHaveLength(1);
  expect(JSON.stringify(secrets)).not.toContain(marker);
}, 20_000);
