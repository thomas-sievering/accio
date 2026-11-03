import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { SecretsVault } from '@accio/hub';
import type { SecretRequestItem } from '@accio/protocol';
import { SecretRequests } from './secrets.js';
import { ThreadAssets } from '../threads/assets.js';
import { harnessEnv } from '../threads/harnessEnv.js';
import { codexEnv } from '@accio/codex';

let home = ''; let requests: SecretRequests | undefined;
const turns: string[] = [];
afterEach(async () => { vi.useRealTimers(); for (const id of turns.splice(0)) await requests?.endTurn(id); if (home) await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
const args = { slot: 'deploy:test', label: 'Deploy token', reason: 'Test the private handoff', clientRequestId: 'one' };
async function setup() {
  home = await mkdtemp(join(tmpdir(), 'accio-secret-lifecycle-'));
  const vault = new SecretsVault(home, Buffer.alloc(32, 17).toString('base64')); await vault.load();
  const items: SecretRequestItem[] = [];
  requests = new SecretRequests(home, vault, async (_threadId, item) => { items.push(item); }); await requests.load();
  function turn(id: string) {
    turns.push(id);
    return requests!.forTurn({ threadId: id, turnId: id, profileId: 'personal', projectId: 'project', profileName: 'Personal', projectName: 'Project', machineName: 'Test', signal: new AbortController().signal });
  }
  return { vault, items, turn };
}
async function pending(items: SecretRequestItem[]) { await expect.poll(() => items.find(i => i.status === 'pending')).toBeDefined(); return items.find(i => i.status === 'pending')!; }

it('deduplicates retries, permits one answer, and does not accept model-supplied identity', async () => {
  const { items, turn } = await setup(); const request = turn('first');
  const first = request(args); const second = request(args); const item = await pending(items);
  await expect(request({ ...args, clientRequestId: 'parallel' })).rejects.toThrow('already waiting');
  await expect(request({ ...args, profileId: 'work' } as any)).rejects.toThrow('Invalid secret request');
  const answers = await Promise.allSettled([
    requests!.answer({ threadId: 'first', requestId: item.requestId, answer: { type: 'once', value: 'first-marker' } }),
    requests!.answer({ threadId: 'first', requestId: item.requestId, answer: { type: 'once', value: 'second-marker' } }),
  ]);
  expect(answers.filter(a => a.status === 'fulfilled')).toHaveLength(1);
  expect(await first).toEqual(await second);
  const result = await first; if (result.status !== 'provided') throw new Error('Expected file');
  expect(await readFile(result.file, 'utf8')).toBe('first-marker');
  await requests!.endTurn('first');
  expect(await request(args)).toEqual({ status: 'cancelled' });
});

it('expires unanswered requests and removes deliveries on expiry and startup recovery', async () => {
  const { items, turn, vault } = await setup();
  const expired = turn('timeout')({ ...args, timeoutMs: 1000 });
  expect(await expired).toEqual({ status: 'expired' });
  expect(items.at(-1)?.status).toBe('expired');
  items.length = 0;
  const request = turn('delivery'); const result = request(args); const item = await pending(items);
  await requests!.answer({ threadId: 'delivery', requestId: item.requestId, answer: { type: 'once', value: 'startup-marker' } });
  const delivered = await result; if (delivered.status !== 'provided') throw new Error('Expected file');
  const restarted = new SecretRequests(home, vault, async () => {}); await restarted.load();
  await expect(readFile(delivered.file)).rejects.toThrow();
  await requests!.endTurn('delivery');
  // The existing protected directory is warm; clock only the new delivery's lifetime.
  items.length = 0; const another = turn('expiry')(args); const next = await pending(items);
  vi.useFakeTimers();
  await requests!.answer({ threadId: 'expiry', requestId: next.requestId, answer: { type: 'once', value: 'expiry-marker' } });
  const file = await another; if (file.status !== 'provided') throw new Error('Expected file');
  await vi.advanceTimersByTimeAsync(15 * 60_000 + 1); vi.useRealTimers();
  await expect.poll(async () => readFile(file.file).then(() => true, () => false)).toBe(false);
}, 15_000);

it('replacement and deletion invalidate delivered copies and subsequent uses', async () => {
  const { vault, turn } = await setup();
  const saved = await vault.save({ profileId: 'personal', name: 'Deploy', slot: args.slot, projectIds: ['project'], value: 'old-marker' });
  const first = await turn('rotate')(args); if (first.status !== 'provided') throw new Error('Expected file');
  await vault.save({ ...saved, value: 'new-marker' }); await expect(readFile(first.file)).rejects.toThrow();
  const next = await turn('delete')(args); if (next.status !== 'provided') throw new Error('Expected file');
  expect(await readFile(next.file, 'utf8')).toBe('new-marker');
  await vault.remove(saved.id); await expect(readFile(next.file)).rejects.toThrow();
  expect(vault.list('personal')).toEqual([]);
});

it('blocks private paths from downloads and snapshots and strips master keys from harnesses', async () => {
  await setup(); const assets = new ThreadAssets(home, () => true);
  const directory = join(home, 'secret-delivery'); await mkdir(directory, { recursive: true });
  const path = join(directory, 'token.png'); await writeFile(path, 'private-marker');
  await expect(assets.fileUrl('thread', home, path)).rejects.toThrow('Private Accio');
  await expect(assets.snapshot('thread', home, path)).resolves.toMatchObject({ error: expect.stringContaining('Private Accio') });
  const master = { ACCIO_SECRET_KEY: 'not-for-the-harness', ACCIO_TOOL_TOKEN: 'stale-turn-token', PATH: 'tools' };
  expect(harnessEnv(master, { baseUrl: 'http://localhost', accessKey: 'profile' }, 'config')).not.toHaveProperty('ACCIO_SECRET_KEY');
  expect(harnessEnv(master, { baseUrl: 'http://localhost', accessKey: 'profile' }, 'config')).not.toHaveProperty('ACCIO_TOOL_TOKEN');
  expect(codexEnv(master, 'config')).not.toHaveProperty('ACCIO_SECRET_KEY');
  const invalid = new SecretsVault(home, 'invalid-key');
  await expect(invalid.status()).resolves.toMatchObject({ available: false });
  await expect(invalid.save({ profileId: 'p', name: 'x', slot: 'test', projectIds: [], value: 'must-not-persist' })).rejects.toThrow('unavailable');
});
