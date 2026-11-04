import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { SecretsVault } from '@accio/hub';
import { FakeHarness, replyWith } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';
import type { SecretDelivery } from './secrets.js';
import type { SecretRequestItem } from '@accio/protocol';

let app: Awaited<ReturnType<typeof startTestApp>> | undefined;
let scratch: string | undefined;
afterEach(async () => { await app?.stop(); app = undefined; if (scratch) await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
const slot = 'cloudflare.pages.deploy:docs';
const token = 'DUMMY_PRIVATE_TOKEN_漢字 $() `  ';

async function setup() {
  const deliveries: SecretDelivery[] = [];
  const harness = new FakeHarness(async function* (run) {
    const delivery = await run.requestSecret!({ slot: run.prompt.includes('alternate') ? 'github.release:docs' : slot, label: 'Cloudflare API token', reason: 'Deploy this project', clientRequestId: 'token' });
    if (delivery.status === 'provided') expect(await readFile(delivery.file, 'utf8')).toBe(run.prompt === 'replacement' ? 'replacement-marker' : token);
    deliveries.push(delivery);
    yield* replyWith(`Secret operation ${delivery.status}.`);
  });
  app = await startTestApp({ harness });
  const client = await app.connect();
  const profile = await client.signedIn('Personal');
  scratch = await mkdtemp(join(tmpdir(), 'accio-secret-project-'));
  const projectPath = join(scratch, 'project'); await mkdir(projectPath); execFileSync('git', ['init', '--quiet', projectPath], { windowsHide: true });
  const checkout = await client.call('checkouts.add', { path: projectPath, profileId: profile.id });
  return { client, profile, checkout, deliveries, harness };
}
async function pending(client: Awaited<ReturnType<NonNullable<typeof app>['connect']>>, threadId: string): Promise<SecretRequestItem> {
  const event = await client.waitFor('thread.item', e => e.threadId === threadId && e.item.kind === 'secret' && e.item.status === 'pending');
  return event.item as SecretRequestItem;
}
async function idle(client: Awaited<ReturnType<NonNullable<typeof app>['connect']>>, id: string) {
  await expect.poll(async () => (await client.call('threads.list', {})).find(t => t.id === id)?.status, { timeout: 10_000 }).toBe('idle');
}

it('saves privately, automatically reuses across threads, preserves exact bytes, and cleans deliveries', async () => {
  const { client, profile, checkout, deliveries, harness } = await setup();
  const thread = await client.call('threads.start', { checkoutId: checkout.id, text: 'request secret' });
  const card = await pending(client, thread.id);
  await client.call('secretRequests.answer', { threadId: thread.id, requestId: card.requestId, answer: { type: 'save', value: token } });
  await idle(client, thread.id);
  const stored = await client.call('secrets.list', { profileId: profile.id });
  expect(stored).toHaveLength(1); expect(stored[0]?.projectIds).toEqual([thread.projectId]);
  await expect(readFile((deliveries[0] as Extract<SecretDelivery, { status: 'provided' }>).file)).rejects.toThrow();
  client.events.length = 0;
  const next = await client.call('threads.start', { checkoutId: checkout.id, text: 'request secret again' });
  await idle(client, next.id);
  const transcript = await client.call('threads.transcript', { threadId: next.id });
  expect(transcript).toContainEqual(expect.objectContaining({ kind: 'secret', status: 'provided', source: 'reused' }));
  expect(client.events.some(e => e.event === 'thread.item' && (e.data as any).item?.kind === 'secret' && (e.data as any).item?.status === 'pending')).toBe(false);
  expect(JSON.stringify(client.events)).not.toContain(token);
  for (const name of ['hub/secrets/values.json', `transcripts/${thread.id}.json`, `transcripts/${next.id}.json`]) expect(await readFile(join(app!.home, name), 'utf8')).not.toContain(token);
  expect(await readdir(join(app!.home, 'secret-delivery'))).toEqual([]);
  expect(deliveries).toHaveLength(2);
  expect(harness.runs[1]?.secretPurposes).toEqual([{ slot, name: 'Cloudflare API token' }]);
  const home = app!.home;
  await app!.stop({ keepHome: true });
  app = await startTestApp({ harness }, home);
  const reconnected = await app.connect();
  const restored = await reconnected.call('threads.start', { checkoutId: checkout.id, text: 'request secret after restart' });
  await idle(reconnected, restored.id);
  expect((await reconnected.call('threads.transcript', { threadId: restored.id }))).toContainEqual(expect.objectContaining({ kind: 'secret', source: 'reused' }));
  expect(deliveries).toHaveLength(3);
}, 20_000);

it('use once and decline do not save, stale/wrong-thread answers fail, and Stop cancels', async () => {
  const { client, profile, checkout } = await setup();
  const thread = await client.call('threads.start', { checkoutId: checkout.id, text: 'request secret' });
  const card = await pending(client, thread.id);
  await expect(client.call('secretRequests.answer', { threadId: 'another-thread', requestId: card.requestId, answer: { type: 'save', value: token } })).rejects.toThrow('ended');
  await client.call('secretRequests.answer', { threadId: thread.id, requestId: card.requestId, answer: { type: 'once', value: token } });
  await idle(client, thread.id);
  expect(await client.call('secrets.list', { profileId: profile.id })).toEqual([]);
  await expect(client.call('secretRequests.answer', { threadId: thread.id, requestId: card.requestId, answer: { type: 'save', value: token } })).rejects.toThrow('ended');
  client.events.length = 0;
  await client.call('threads.send', { threadId: thread.id, text: 'request secret' });
  const next = await pending(client, thread.id);
  await client.call('secretRequests.answer', { threadId: thread.id, requestId: next.requestId, answer: { type: 'decline' } });
  await idle(client, thread.id);
  client.events.length = 0;
  await client.call('threads.send', { threadId: thread.id, text: 'request secret' });
  const stopped = await pending(client, thread.id);
  await client.call('threads.stop', { threadId: thread.id });
  await expect.poll(async () => (await client.call('threads.transcript', { threadId: thread.id })).find(i => i.kind === 'secret' && i.requestId === stopped.requestId)).toMatchObject({ status: 'cancelled' });
  expect(await client.call('secrets.list', { profileId: profile.id })).toEqual([]);
}, 20_000);

it('rejects foreign-profile access and reuses an existing same-profile secret only after explicit binding', async () => {
  const { client, profile, checkout } = await setup();
  const work = await client.call('profiles.save', { name: 'Work' });
  const saved = await client.call('secrets.save', { profileId: profile.id, name: 'Reusable', slot, projectIds: [], value: token });
  const other = await client.call('secrets.save', { profileId: work.id, name: 'Work token', slot, projectIds: [], value: 'work-only-marker' });
  await expect(client.call('secrets.save', { id: saved.id, profileId: work.id, name: 'stolen', slot, projectIds: [] })).rejects.toThrow('profile');
  const thread = await client.call('threads.start', { checkoutId: checkout.id, text: 'request secret' });
  const card = await pending(client, thread.id);
  expect(card.candidates.map(s => s.id)).toEqual([saved.id]);
  await expect(client.call('secretRequests.answer', { threadId: thread.id, requestId: card.requestId, answer: { type: 'existing', secretId: other.id } })).rejects.toThrow('project');
  await client.call('secretRequests.answer', { threadId: thread.id, requestId: card.requestId, answer: { type: 'existing', secretId: saved.id } });
  await idle(client, thread.id);
  expect((await client.call('secrets.list', { profileId: profile.id }))[0]?.projectIds).toEqual([thread.projectId]);
}, 20_000);

it('reopens encrypted values, rotates and deletes them, without a plaintext fallback', async () => {
  scratch = await mkdtemp(join(tmpdir(), 'accio-vault-'));
  const key = Buffer.alloc(32, 7).toString('base64');
  const vault = new SecretsVault(scratch, key); await vault.load();
  const saved = await vault.save({ profileId: 'p', name: 'test', slot, projectIds: ['project'], value: token });
  const reopened = new SecretsVault(scratch, key); await reopened.load();
  const scope = { profileId: 'p', projectId: 'project', slot };
  expect((await reopened.resolve(scope))?.value).toBe(token);
  await reopened.save({ ...saved, value: 'rotated-marker' });
  expect(reopened.current(saved.id, saved.version, scope)).toBe(false);
  expect((await reopened.resolve(scope))?.value).toBe('rotated-marker');
  const wrong = new SecretsVault(scratch, Buffer.alloc(32, 8).toString('base64')); await wrong.load();
  await expect(wrong.resolve(scope)).rejects.toThrow('unlocked');
  await reopened.remove(saved.id); expect(await reopened.resolve(scope)).toBeNull();
  const bytes = await readFile(join(scratch, 'hub/secrets/values.json'), 'utf8'); expect(bytes).not.toContain('rotated-marker');
});

it('does not echo invalid private input through validation or storage errors', async () => {
  const { client, profile } = await setup();
  await expect(client.call('secrets.save', { profileId: profile.id, name: 'Invalid', slot: token, projectIds: [], value: token })).rejects.not.toThrow(token);
  await expect(client.call('secrets.save', { profileId: profile.id, name: 'Invalid', slot, projectIds: [], value: 'line\n' + token })).rejects.not.toThrow(token);
});
