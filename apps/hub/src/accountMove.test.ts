import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeCodex, testJWT } from '../../sorting-hat/src/testing/fakeProviders.js';
import { startHubService } from './service.js';
import { HubClient } from './client.js';
import { SortingHatClient, SortingHatError } from './sortingHatClient.js';
import { startRemoteSortingHat } from './testing/remoteSortingHat.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const stop of cleanup.splice(0).reverse()) await stop(); });
const secretKey = Buffer.alloc(32, 42).toString('base64');
const exists = (path: string) => access(path).then(() => true, () => false);
const credentialId = '00000000-0000-4000-8000-000000000001';
const claude = (url: string, key: string) => fetch(`${url}/v1/messages`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{"model":"claude-test","messages":[]}' });

/** A hub whose embedded Sorting Hat holds two Claude accounts (B's token about to expire) and a ChatGPT account with its credential home. */
async function fixture() {
  const remote = await startRemoteSortingHat(); cleanup.push(remote.close);
  const home = await mkdtemp(join(tmpdir(), 'accio-hub-move-'));
  cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const hub = join(home, 'hub');
  await mkdir(join(hub, 'codex', credentialId), { recursive: true });
  await writeFile(join(hub, 'codex', credentialId, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: testJWT('gpt-me'), account_id: 'gpt-me', refresh_token: 'refresh-gpt' } }));
  const login = (token: string, expiresAt: number) => ({ accessToken: `access-${token}`, refreshToken: `refresh-${token}`, expiresAt, email: `${token}@example.com`, claudeAccountId: token, organization: null });
  await writeFile(join(hub, 'sorting-hat.json'), JSON.stringify({ version: 1, hatKeys: [], houses: [], accounts: [
    { id: 'claude-a', name: 'Claude A', providerId: 'anthropic', account: login('a', Date.now() + 3600_000) },
    { id: 'claude-b', name: 'Claude B', providerId: 'anthropic', account: login('b', Date.now() + 1000) },
    { id: 'gpt', name: 'GPT', providerId: 'openai', account: null, openai: { credentialId, email: 'gpt-me@example.com', planType: 'pro', models: [] } },
  ] }));
  // The hub's own copy must never refresh or be used once the move starts.
  const hubClaude = vi.fn(async () => Response.json({}, { status: 500 }));
  const start = () => startHubService({ home, port: 0, secretKey, claudeFetch: hubClaude, codexFactory: new FakeCodex().factory });
  let service = await start();
  cleanup.push(() => service.close());
  const { code } = await service.createPairingCode();
  const paired = await (await fetch(service.url + '/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machineId: 'laptop', code }) })).json() as any;
  const connect = async () => {
    const client = new HubClient(service.url, paired.hubId, paired.token, { id: 'laptop', name: 'laptop', platform: 'test', version: 'test', harnesses: [] });
    await client.start(); cleanup.push(() => client.close());
    return client;
  };
  const restart = async () => { await service.close(); service = await start(); return connect(); };
  return { remote, home, hub, hubClaude, connect, restart, get service() { return service; } };
}

describe('moving the hub’s accounts to its Sorting Hat', () => {
  it('moves credentials, houses and order once, survives failing halfway, and leaves the hub without credentials', async () => {
    const f = await fixture();
    let laptop = await f.connect();
    const personal = await laptop.call('profiles.save', { name: 'Personal', accountIds: { anthropic: ['claude-b', 'claude-a'], openai: ['gpt'] } });
    // A turn running from before the move holds the hub's own model key.
    const running = await laptop.call('machine.modelKey', { profileId: personal.id });

    // The upload fails: nothing reaches the Sorting Hat, and the hub's copy is no longer live.
    const real = SortingHatClient.prototype.importAccounts;
    const upload = vi.spyOn(SortingHatClient.prototype, 'importAccounts');
    upload.mockRejectedValue(new SortingHatError('Could not reach the Sorting Hat.', 0));
    await expect(laptop.call('sortingHat.configure', { url: f.remote.url, adminToken: f.remote.adminToken, hubName: 'Home server' })).rejects.toThrow(/could not be moved to the Sorting Hat yet/);
    await laptop.call('profiles.list', {}); // After the hub's own retry.
    expect(await f.remote.api('GET', 'accounts')).toEqual([]);
    expect(await readFile(join(f.hub, 'sorting-hat.json'), 'utf8')).not.toContain('refresh-');

    // The hub stops right after the upload, before cleaning up; it finishes on the next start, without duplicates.
    upload.mockReset().mockImplementationOnce(async function (this: SortingHatClient, ...args) { await real.apply(this, args); throw new Error('crashed'); });
    await f.restart();
    expect((await f.remote.api('GET', 'accounts')).map((a: any) => a.id)).toEqual(['claude-a', 'claude-b', 'gpt']);
    expect(await exists(join(f.hub, 'sorting-hat-move.json'))).toBe(true);
    laptop = await f.restart();

    expect((await f.remote.api('GET', 'accounts')).map((a: any) => [a.id, a.signedIn])).toEqual([['claude-a', true], ['claude-b', true], ['gpt', true]]);
    expect(await f.remote.api('GET', 'houses')).toEqual([{ id: 'personal', name: 'Personal', accounts: { anthropic: ['claude-b', 'claude-a'], openai: ['gpt'] }, inUse: { anthropic: 'claude-b', openai: 'gpt' } }]);
    expect(laptop.snapshot.profiles[0]).toMatchObject({ house: { id: 'personal', name: 'Personal' }, providers: [{ accounts: [{ id: 'claude-b' }, { id: 'claude-a' }] }, { accounts: [{ id: 'gpt' }] }] });

    // The hub keeps no credentials, and its own copy never refreshed.
    expect(await exists(join(f.hub, 'codex'))).toBe(false);
    expect(await exists(join(f.hub, 'sorting-hat-move.json'))).toBe(false);
    for (const file of await readdir(f.hub, { recursive: true })) {
      const text = await readFile(join(f.hub, String(file)), 'utf8').catch(() => '');
      for (const secret of ['access-a', 'refresh-a', 'refresh-b', 'refresh-gpt', 'gpt-me']) expect(text).not.toContain(secret);
    }
    expect(f.hubClaude).not.toHaveBeenCalled();

    // Every account works there without signing in again: B with its refresh token, A with its access token, ChatGPT from its credential home.
    expect(await exists(join(f.remote.dir, 'codex', credentialId, 'auth.json'))).toBe(true);
    const fresh = await laptop.call('machine.modelKey', { profileId: personal.id });
    expect(fresh).toEqual({ key: expect.stringMatching(/^hat-/), url: f.remote.url });
    f.remote.auth.usage['access-a'] = { five_hour: { utilization: 25, resets_at: new Date(Date.now() + 3600_000).toISOString() } };
    const sent = await claude(fresh.url, fresh.key); expect(sent.status).toBe(200); await sent.text();
    expect(f.remote.auth.refreshed).toEqual(['refresh-b']);
    expect(f.remote.anthropic.seen.at(-1)?.headers.authorization).toBe('Bearer token-1');
    const limits = await f.remote.api('POST', 'limits/refresh', { accountIds: ['claude-a'], force: true });
    expect(limits.find((l: any) => l.accountId === 'claude-a')).toMatchObject({ status: 'ready', snapshot: { windows: [{ usedPercent: 25 }] } });
    const answered = await fetch(`${fresh.url}/openai/responses`, { method: 'POST', headers: { authorization: `Bearer ${fresh.key}`, 'content-type': 'application/json' }, body: '{"model":"gpt-test","input":[]}' });
    expect(answered.status).toBe(200); await answered.text();
    expect(f.remote.chatgpt.seen.at(-1)?.headers.get('chatgpt-account-id')).toBe('gpt-me');

    // The running turn's next request, with the hub's own key, reaches the same house through the hub.
    const carriedOn = await claude(f.service.url, running.key);
    expect(carriedOn.status).toBe(200); await carriedOn.text();
    expect(f.remote.anthropic.seen.at(-1)?.headers.authorization).toBe('Bearer token-1');
  });
});
