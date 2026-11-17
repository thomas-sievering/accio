import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonFile } from '@accio/persistence';
import { claudeAccount, claudeAccountId, claudeCallback, startTestApp } from '../testing/testApp.js';

describe('profiles slice', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(async () => { vi.restoreAllMocks(); await t?.stop(); });

  it('creates a profile whose config folder points at the Sorting Hat with a hat key of its own', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const hrc = await c.call('profiles.save', { name: 'HRC', createHouse: true });
    const personal = await c.call('profiles.save', { name: 'Personal', createHouse: true });
    expect(hrc).toMatchObject({ id: 'hrc', name: 'HRC' });
    expect(claudeAccount(hrc, await c.call('accounts.list', {}))).toBeNull();

    const settingsOf = async (id: string) =>
      JSON.parse(await readFile(join(t.home, 'profiles', id, 'claude', 'settings.json'), 'utf8')).env;
    const a = await settingsOf(hrc.id);
    const b = await settingsOf(personal.id);
    expect(a.ANTHROPIC_BASE_URL).toBe(t.hat.url);
    expect(a.ANTHROPIC_AUTH_TOKEN).toMatch(/^hat-/);
    expect(a.ANTHROPIC_AUTH_TOKEN).not.toBe(b.ANTHROPIC_AUTH_TOKEN);
  });

  it('signs a selected named account in through the browser callback and tells every client who it is', async () => {
    t = await startTestApp();
    const a = await t.connect();
    const b = await t.connect();
    const profile = await a.call('profiles.save', { name: 'Personal', createHouse: true });
    const account = await a.call('accounts.save', { name: 'My Claude' });
    await a.call('profiles.save', { id: profile.id, name: profile.name, accountIds: { anthropic: [account.id] } });
    const { signInId, url } = await a.call('accounts.beginSignIn', { id: account.id });
    expect(url).toMatch(/^https:\/\/claude\.ai\/oauth\/authorize\?/);

    expect((await fetch(claudeCallback(url, 'me', 'wrong-state'))).status).toBe(400);
    expect(await a.call('accounts.signInStatus', { signInId })).toEqual({ status: 'pending' });
    expect((await fetch(claudeCallback(url, 'me'))).status).toBe(200);
    const signed = await a.call('accounts.signInStatus', { signInId });
    expect(signed).toMatchObject({ status: 'complete', account: { email: 'me@example.com', organization: null } });
    const profiles = await b.waitFor('profiles.changed', (list) => !!list[0] && claudeAccountId(list[0]) === account.id);
    const pushed = [profiles, await b.waitFor('accounts.changed', (list) => list.some((a) => a.id === account.id && a.email === 'me@example.com'))];
    expect(JSON.stringify(pushed)).not.toMatch(/oauth-|refresh-|hat-/);

    const out = await a.call('accounts.signOut', { id: account.id });
    expect(out.signedIn).toBe(false);
  });

  it('manages named accounts separately, shares selections, and protects accounts in use', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const other = await t.connect();
    const account = await c.call('accounts.save', { name: 'Team account 1' });
    expect(account).toMatchObject({ name: 'Team account 1', signedIn: false });
    await c.claudeSignIn(account.id, 'team');
    const personal = await c.call('profiles.save', { createHouse: true, name: 'Personal', accountIds: { anthropic: [account.id] } });
    const work = await c.call('profiles.save', { createHouse: true, name: 'Work', accountIds: { anthropic: [account.id] } });
    expect(claudeAccountId(personal)).toBe(account.id);
    expect(claudeAccountId(work)).toBe(account.id);
    await c.call('accounts.save', { id: account.id, name: 'Family account' });
    const pushed = await other.waitFor('accounts.changed', (list) => list.some((a) => a.name === 'Family account'));
    expect(JSON.stringify(pushed)).not.toMatch(/oauth-|refresh-|hat-/);
    const renamed = await c.call('accounts.list', {});
    expect((await c.call('profiles.list', {})).every((p) => claudeAccount(p, renamed)?.name === 'Family account')).toBe(true);
    await expect(c.call('accounts.delete', { id: account.id })).rejects.toThrow(/profiles/);
    await c.call('accounts.signOut', { id: account.id });
    const signedOut = await c.call('accounts.list', {});
    expect((await c.call('profiles.list', {})).every((p) => claudeAccount(p, signedOut)?.signedIn === false)).toBe(true);
    await c.call('profiles.save', { id: personal.id, name: personal.name, accountIds: { anthropic: [] } });
    // A deleted profile's house stays on the Sorting Hat, with its accounts.
    await c.call('profiles.save', { id: work.id, name: work.name, accountIds: { anthropic: [] } });
    await c.call('profiles.delete', { id: work.id });
    expect(await c.call('accounts.list', {})).toHaveLength(1);
    await c.call('accounts.delete', { id: account.id });
    expect(await c.call('accounts.list', {})).toEqual([]);
    await expect(c.call('profiles.save', { createHouse: true, name: 'Invalid', accountIds: { anthropic: ['missing'] } })).rejects.toThrow(/No account/);
    expect((await c.call('profiles.list', {})).map((p) => p.name)).toEqual(['Personal']);
  });

  it('keeps profiles and sign-ins across a restart', async () => {
    t = await startTestApp();
    const c = await t.connect();
    await c.signedIn('Personal');
    const home = t.home;
    await t.stop({ keepHome: true });
    t = await startTestApp({}, home);
    const client = await t.connect();
    const list = await client.call('profiles.list', {});
    const accounts = await client.call('accounts.list', {});
    expect(list.map((p) => [p.id, p.name, claudeAccount(p, accounts)?.email])).toEqual([
      ['personal', 'Personal', 'claude-personal@example.com'],
    ]);
  });
  it('starts from a hub connection cached before profiles named their accounts by id', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const signed = await c.signedIn('Personal');
    const home = t.home;
    await t.stop({ keepHome: true });
    // An older build saved each profile's accounts in full inside its providers.
    const file = join(home, 'hub-connections.json');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved[0].snapshot.profiles[0].providers[0].accountIds).toEqual([claudeAccountId(signed)]);
    for (const hub of saved) for (const profile of hub.snapshot.profiles) for (const provider of profile.providers) {
      provider.accounts = hub.snapshot.accounts.filter((a: { id: string }) => provider.accountIds.includes(a.id));
      delete provider.accountIds;
    }
    await writeFile(file, JSON.stringify(saved));
    t = await startTestApp({}, home);
    const again = await t.connect();
    const list = await again.call('profiles.list', {});
    const accounts = await again.call('accounts.list', {});
    expect(list.map((p) => [p.name, claudeAccount(p, accounts)?.email])).toEqual([['Personal', 'claude-personal@example.com']]);
  });

  it('preserves simultaneous creates and validates later renames against the committed list', async () => {
    t = await startTestApp();
    const a = await t.connect();
    const b = await t.connect();
    const [alpha, beta] = await Promise.all([
      a.call('profiles.save', { name: 'Alpha' }),
      b.call('profiles.save', { name: 'Beta' }),
    ]);
    expect((await a.call('profiles.list', {})).map((p) => p.name)).toEqual(['Alpha', 'Beta']);
    const results = await Promise.allSettled([
      a.call('profiles.save', { id: alpha.id, name: 'Same' }),
      b.call('profiles.save', { id: beta.id, name: 'Same' }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    const home = t.home;
    await t.stop({ keepHome: true });
    t = await startTestApp({}, home);
    expect((await (await t.connect()).call('profiles.list', {})).map((p) => p.name)).toEqual(['Same', 'Beta']);
  });

  it('does not publish failed saves or selections, and accepts the next mutation', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const profile = await c.call('profiles.save', { name: 'Personal', createHouse: true });
    const first = await c.call('accounts.save', { name: 'First' });
    const second = await c.call('accounts.save', { name: 'Second' });
    await c.call('profiles.save', { ...profile, accountIds: { anthropic: [first.id] } });
    const write = JsonFile.prototype.write;
    vi.spyOn(JsonFile.prototype, 'write').mockImplementation(function (value) {
      if (this.path === join(t.home, 'hub', 'settings.json')) return Promise.reject(new Error('settings disk full'));
      return write.call(this, value);
    });
    const eventCount = c.events.filter((e) => e.event === 'profiles.changed').length;
    await expect(c.call('profiles.save', { id: profile.id, name: 'Changed' })).rejects.toThrow('Hub request failed');
    expect((await c.call('profiles.list', {}))[0]).toMatchObject({ name: 'Personal' });
    expect(claudeAccountId((await c.call('profiles.list', {}))[0]!)).toBe(first.id);
    expect(c.events.filter((e) => e.event === 'profiles.changed')).toHaveLength(eventCount);
    await expect(c.call('profiles.delete', { id: profile.id })).rejects.toThrow('Hub request failed');
    expect((await c.call('profiles.list', {}))[0]?.name).toBe('Personal');
    vi.restoreAllMocks();
    await c.call('profiles.save', { id: profile.id, name: 'Changed', accountIds: { anthropic: [second.id] } });
    expect(claudeAccountId((await c.call('profiles.list', {}))[0]!)).toBe(second.id);
  });

});
