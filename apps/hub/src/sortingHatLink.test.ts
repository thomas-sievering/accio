import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startHubService } from './service.js';
import { HubClient } from './client.js';
import { startRemoteSortingHat } from './testing/remoteSortingHat.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });
const secretKey = Buffer.alloc(32, 42).toString('base64');

async function fixture() {
  const remote = await startRemoteSortingHat(); cleanup.push(remote.close);
  const home = await mkdtemp(join(tmpdir(), 'accio-hub-link-'));
  cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  let service = await startHubService({ home, port: 0, secretKey });
  cleanup.push(() => service.close());
  const tokens = new Map<string, { hubId: string; token: string }>();
  async function connect(id: string) {
    const { hubId, token } = tokens.get(id)!;
    const client = new HubClient(service.url, hubId, token, { id, name: id, platform: 'test', version: 'test', harnesses: [] });
    await client.start(); cleanup.push(() => client.close());
    return client;
  }
  async function pair(id: string) {
    const { code } = await service.createPairingCode();
    const response = await fetch(service.url + '/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machineId: id, code }) });
    tokens.set(id, await response.json() as any);
    return connect(id);
  }
  async function restart() { await service.close(); service = await startHubService({ home, port: 0, secretKey }); }
  return { remote, home, pair, connect, restart, get service() { return service; } };
}

/** A model request as Claude Code sends it with ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN. */
const claude = (url: string, key: string) => fetch(`${url}/v1/messages`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{"model":"claude-test","messages":[]}' });

describe('a hub with a Sorting Hat of its own', () => {
  it('hands each machine a hat key per profile, reused across restarts and deleted on unpairing, and never shows the admin token', async () => {
    const f = await fixture();
    const mine = await f.remote.claudeAccount('Mine');
    await f.remote.api('POST', 'houses', { name: 'Personal', accounts: { anthropic: [mine.id] } });
    await f.remote.api('POST', 'houses', { name: 'Work' });
    const laptop = await f.pair('laptop'); const desktop = await f.pair('desktop');

    await expect(laptop.call('sortingHat.configure', { url: f.remote.url, adminToken: 'hat-admin-wrong', hubName: 'Home server' })).rejects.toThrow(/refused the admin token/);
    await expect(laptop.call('sortingHat.configure', { url: 'http://sorting-hat.example.com', adminToken: f.remote.adminToken, hubName: 'Home server' })).rejects.toThrow(/HTTPS/);
    expect(await laptop.call('sortingHat.configure', { url: f.remote.url, adminToken: f.remote.adminToken, hubName: 'Home server' }))
      .toEqual({ url: f.remote.url, threadUrl: null, hubName: 'Home server', houses: [{ id: 'personal', name: 'Personal' }, { id: 'work', name: 'Work' }], problem: null });
    await desktop.refresh(true);
    expect(desktop.snapshot.sortingHat?.url).toBe(f.remote.url);

    const personal = await laptop.call('profiles.save', { name: 'Personal', houseId: 'personal' });
    expect(personal).toMatchObject({ house: { id: 'personal', name: 'Personal' }, providers: [{ id: 'anthropic', accounts: [{ id: mine.id, name: 'Mine', signedIn: true }], inUseId: mine.id }, { id: 'openai', accounts: [] }] });
    const spare = await laptop.call('profiles.save', { name: 'Spare' });
    expect(spare).toMatchObject({ house: null, providers: [{ accounts: [] }, { accounts: [] }] });
    await expect(laptop.call('machine.modelKey', { profileId: spare.id })).rejects.toThrow('Spare isn’t linked to a house on the Sorting Hat. Choose one in Settings / Profiles.');
    await expect(laptop.call('profiles.save', { id: spare.id, name: 'Spare', houseId: 'nowhere' })).rejects.toThrow(/no such house/);

    const first = await laptop.call('machine.modelKey', { profileId: personal.id });
    expect(first).toEqual({ key: expect.stringMatching(/^hat-/), url: f.remote.url });
    expect(await laptop.call('machine.modelKey', { profileId: personal.id })).toEqual(first);
    const other = await desktop.call('machine.modelKey', { profileId: personal.id });
    expect(other.key).not.toBe(first.key);
    const response = await claude(first.url, first.key);
    expect(response.status).toBe(200); await response.text();
    expect(f.remote.anthropic.seen.at(-1)?.headers.authorization).toBe('Bearer token-1');
    const names = async () => (await f.remote.api('GET', 'hat-keys')).map((k: any) => [k.houseId, k.name]).sort();
    expect(await names()).toEqual([['personal', 'Accio · Home server · Personal · desktop'], ['personal', 'Accio · Home server · Personal · laptop']]);

    // Nothing a machine receives, nor the hub's files, holds the admin token or a hat key in the clear.
    const seen = JSON.stringify([laptop.snapshot, desktop.snapshot, await laptop.call('sortingHat.get', {}), await laptop.call('profiles.list', {}), await laptop.call('accounts.list', {})]);
    expect(seen).not.toContain(f.remote.adminToken);
    expect(seen).not.toContain(first.key);
    for (const file of await readdir(join(f.home, 'hub'), { recursive: true })) {
      const text = await readFile(join(f.home, 'hub', String(file)), 'utf8').catch(() => '');
      expect(text).not.toContain(f.remote.adminToken); expect(text).not.toContain(first.key);
    }

    await f.restart();
    const again = await f.connect('laptop'); const desktopAgain = await f.connect('desktop');
    expect(await again.call('machine.modelKey', { profileId: personal.id })).toEqual(first);
    expect(await names()).toHaveLength(2);

    await desktopAgain.call('hub.revokeMachine', { machineId: 'laptop' });
    expect(await names()).toEqual([['personal', 'Accio · Home server · Personal · desktop']]);
    expect((await claude(first.url, first.key)).status).toBe(401);
    const still = await claude(other.url, other.key); expect(still.status).toBe(200); await still.text();

    await desktopAgain.call('sortingHat.disconnect', {});
    expect(desktopAgain.snapshot.sortingHat).toBeUndefined();
    expect(await names()).toEqual([]);
    expect((await desktopAgain.call('machine.modelKey', { profileId: personal.id })).key).toMatch(/^accio-/);
  });

  it('replaces a key deleted on the dashboard, moves keys with a profile’s house, and sets the house’s accounts', async () => {
    const f = await fixture();
    const mine = await f.remote.claudeAccount('Mine'); const theirs = await f.remote.claudeAccount('Theirs');
    await f.remote.api('POST', 'houses', { name: 'Personal', accounts: { anthropic: [mine.id] } });
    await f.remote.api('POST', 'houses', { name: 'Work', accounts: { anthropic: [theirs.id] } });
    const laptop = await f.pair('laptop');
    await laptop.call('sortingHat.configure', { url: f.remote.url, adminToken: f.remote.adminToken, hubName: 'Home server' });
    const profile = await laptop.call('profiles.save', { name: 'Personal', houseId: 'personal' });
    const first = await laptop.call('machine.modelKey', { profileId: profile.id });
    const [stored] = await f.remote.api('GET', 'hat-keys');
    await f.remote.api('DELETE', `hat-keys/${stored.id}`);
    await f.restart();
    const again = await f.connect('laptop');
    const replaced = await again.call('machine.modelKey', { profileId: profile.id });
    expect(replaced.key).not.toBe(first.key);
    const ok = await claude(replaced.url, replaced.key); expect(ok.status).toBe(200); await ok.text();

    // Linking another house keeps both houses' accounts and moves the key.
    const moved = await again.call('profiles.save', { id: profile.id, name: 'Personal', houseId: 'work', accountIds: { anthropic: [mine.id] } });
    expect(moved).toMatchObject({ house: { id: 'work' }, providers: [{ accounts: [{ id: theirs.id }] }, {}] });
    expect((await f.remote.api('GET', 'hat-keys')).map((k: any) => k.houseId)).toEqual([]);
    const work = await again.call('machine.modelKey', { profileId: profile.id });
    const sent = await claude(work.url, work.key); expect(sent.status).toBe(200); await sent.text();
    expect(f.remote.anthropic.seen.at(-1)?.headers.authorization).toBe('Bearer token-2');

    // Choosing accounts in Accio sets the house's accounts on the Sorting Hat.
    await again.call('profiles.save', { id: profile.id, name: 'Personal', accountIds: { anthropic: [mine.id, theirs.id] } });
    expect((await f.remote.api('GET', 'houses/work')).accounts.anthropic).toEqual([mine.id, theirs.id]);

    // A hub that reaches the Sorting Hat on its own network gives threads the public address instead, keeping their keys.
    expect(await again.call('sortingHat.configure', { url: f.remote.url, hubName: 'Home server', threadUrl: 'https://sortinghat.example.com/' })).toMatchObject({ url: f.remote.url, threadUrl: 'https://sortinghat.example.com' });
    expect(await again.call('machine.modelKey', { profileId: profile.id })).toEqual({ key: work.key, url: 'https://sortinghat.example.com' });
  });
});

describe('account settings on a hub with a Sorting Hat of its own', () => {
  it('signs accounts in, renames, orders and deletes them, reads limits and creates houses there', async () => {
    const f = await fixture();
    const laptop = await f.pair('laptop');
    await laptop.call('sortingHat.configure', { url: f.remote.url, adminToken: f.remote.adminToken, hubName: 'Home server' });
    const profile = await laptop.call('profiles.save', { name: 'Personal', createHouse: true });
    expect(profile.house).toEqual({ id: 'personal', name: 'Personal' });

    // Claude: the worker's browser callback, then the pasted code for a second account.
    const first = await laptop.call('accounts.save', { name: 'First', providerId: 'anthropic' });
    const begun = await laptop.call<{ signInId: string; url: string }>('accounts.beginSignIn', { id: first.id, redirectUri: 'http://localhost:4567/callback' });
    const state = new URL(begun.url).searchParams.get('state');
    await laptop.call('accounts.callback', { signInId: begun.signInId, code: `code#${state}`, state });
    expect(await laptop.call('accounts.signInStatus', { signInId: begun.signInId })).toMatchObject({ status: 'complete', account: { id: first.id, signedIn: true } });
    const second = await laptop.call('accounts.save', { name: 'Second', providerId: 'anthropic' });
    const pasted = await laptop.call<{ signInId: string; url: string }>('accounts.beginSignIn', { id: second.id });
    await expect(laptop.call('accounts.signInStatus', { signInId: pasted.signInId })).resolves.toEqual({ status: 'pending' });
    expect(await laptop.call('accounts.completeSignIn', { signInId: pasted.signInId, code: `pasted#${new URL(pasted.url).searchParams.get('state')}` })).toMatchObject({ signedIn: true });

    // ChatGPT: browser approval finishes on the provider's side; the status tells.
    const gpt = await laptop.call('accounts.save', { name: 'GPT', providerId: 'openai' });
    const started = await laptop.call<{ signInId: string }>('accounts.beginSignIn', { id: gpt.id });
    expect(await laptop.call('accounts.signInStatus', { signInId: started.signInId })).toEqual({ status: 'pending' });
    await f.remote.codex.latest.complete('chatgpt-me');
    expect(await laptop.call('accounts.signInStatus', { signInId: started.signInId })).toMatchObject({ status: 'complete', account: { email: 'chatgpt-me@example.com' } });
    expect(laptop.snapshot.accounts.map((a) => [a.name, a.signedIn])).toEqual([['First', true], ['Second', true], ['GPT', true]]);

    // Rename and order: both land on the Sorting Hat and read back at once.
    await laptop.call('accounts.save', { id: second.id, name: 'Second renamed' });
    expect((await f.remote.api('GET', `accounts/${second.id}`)).name).toBe('Second renamed');
    const ordered = await laptop.call('profiles.save', { id: profile.id, name: 'Personal', accountIds: { anthropic: [second.id, first.id], openai: [gpt.id] } });
    expect(ordered.providers.map((p) => p.accounts.map((a) => a.name))).toEqual([['Second renamed', 'First'], ['GPT']]);
    expect((await f.remote.api('GET', 'houses/personal')).accounts).toEqual({ anthropic: [second.id, first.id], openai: [gpt.id] });

    // A dashboard change shows on the next read.
    await f.remote.api('PATCH', `accounts/${first.id}`, { name: 'Renamed on the dashboard' });
    await f.service.sortingHatLink.poll(); await laptop.refresh(true);
    expect(laptop.snapshot.accounts[0]?.name).toBe('Renamed on the dashboard');

    f.remote.auth.usage['token-1'] = { five_hour: { utilization: 40, resets_at: new Date(Date.now() + 3600_000).toISOString() } };
    const limits = await laptop.call('accounts.refreshLimits', { accountIds: [first.id], force: true });
    expect(limits.find((l) => l.accountId === first.id)?.snapshot?.windows[0]).toMatchObject({ kind: 'session', usedPercent: 40 });

    await expect(laptop.call('accounts.delete', { id: first.id })).rejects.toThrow('This account is still in the house Personal on the Sorting Hat.');
    await laptop.call('profiles.save', { id: profile.id, name: 'Personal', accountIds: { anthropic: [second.id] } });
    await laptop.call('accounts.signOut', { id: first.id });
    await laptop.call('accounts.delete', { id: first.id });
    expect((await f.remote.api('GET', 'accounts')).map((a: any) => a.name)).toEqual(['Second renamed', 'GPT']);

    await f.remote.close();
    await f.service.sortingHatLink.poll();
    expect((await laptop.call('sortingHat.get', {}))?.problem).toMatch(/Could not reach the Sorting Hat/);
    await expect(laptop.call('accounts.save', { name: 'Offline', providerId: 'anthropic' })).rejects.toThrow(/Could not reach the Sorting Hat/);
  });
});
