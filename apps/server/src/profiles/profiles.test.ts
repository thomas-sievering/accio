import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonFile } from '@accio/persistence';
import { claudeAccount, startTestApp } from '../testing/testApp.js';

describe('profiles slice', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(async () => { vi.restoreAllMocks(); await t?.stop(); });

  it('creates a profile whose config folder points at the hub with a key of its own', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const hrc = await c.call('profiles.save', { name: 'HRC' });
    const personal = await c.call('profiles.save', { name: 'Personal' });
    expect(hrc).toMatchObject({ id: 'hrc', name: 'HRC' });
    expect(claudeAccount(hrc)).toBeNull();

    const settingsOf = async (id: string) =>
      JSON.parse(await readFile(join(t.home, 'profiles', id, 'claude', 'settings.json'), 'utf8')).env;
    const a = await settingsOf(hrc.id);
    const b = await settingsOf(personal.id);
    expect(a.ANTHROPIC_BASE_URL).toBe(t.app.hubUrl);
    expect(a.ANTHROPIC_AUTH_TOKEN).toMatch(/^accio-/);
    expect(a.ANTHROPIC_AUTH_TOKEN).not.toBe(b.ANTHROPIC_AUTH_TOKEN);
  });

  it('signs a selected named account in with a pasted code and tells every client who it is', async () => {
    t = await startTestApp();
    const a = await t.connect();
    const b = await t.connect();
    const profile = await a.call('profiles.save', { name: 'Personal' });
    const account = await a.call('accounts.save', { name: 'My Claude' });
    await a.call('profiles.save', { id: profile.id, name: profile.name, accountId: account.id });
    const { signInId, url } = await a.call('accounts.beginSignIn', { id: account.id });
    expect(url).toMatch(/^https:\/\/claude\.ai\/oauth\/authorize\?/);
    const state = new URL(url).searchParams.get('state');

    await expect(a.call('accounts.completeSignIn', { signInId, code: 'me#wrong-state' })).rejects.toThrow(/different sign-in/);
    const signed = await a.call('accounts.completeSignIn', { signInId, code: `me#${state}` });
    expect(signed).toMatchObject({ email: 'me@example.com', organization: null });
    const pushed = await b.waitFor('profiles.changed', (list) => !!list[0] && claudeAccount(list[0]) !== null);
    expect(JSON.stringify(pushed)).not.toMatch(/oauth-|refresh-|accio-/);

    const out = await a.call('accounts.signOut', { id: account.id });
    expect(out.signedIn).toBe(false);
  });

  it('manages named accounts separately, shares selections, and protects accounts in use', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const other = await t.connect();
    const account = await c.call('accounts.save', { name: 'Team account 1' });
    expect(account).toMatchObject({ name: 'Team account 1', signedIn: false });
    const start = await c.call('accounts.beginSignIn', { id: account.id });
    await c.call('accounts.completeSignIn', { signInId: start.signInId, code: 'team' });
    const personal = await c.call('profiles.save', { name: 'Personal', accountId: account.id });
    const work = await c.call('profiles.save', { name: 'Work', accountId: account.id });
    expect(claudeAccount(personal)?.id).toBe(account.id);
    expect(claudeAccount(work)?.id).toBe(account.id);
    await c.call('accounts.save', { id: account.id, name: 'Family account' });
    const pushed = await other.waitFor('accounts.changed', (list) => list.some((a) => a.name === 'Family account'));
    expect(JSON.stringify(pushed)).not.toMatch(/oauth-|refresh-|accio-/);
    expect((await c.call('profiles.list', {})).every((p) => claudeAccount(p)?.name === 'Family account')).toBe(true);
    await expect(c.call('accounts.delete', { id: account.id })).rejects.toThrow(/profiles/);
    await c.call('accounts.signOut', { id: account.id });
    expect((await c.call('profiles.list', {})).every((p) => claudeAccount(p)?.signedIn === false)).toBe(true);
    await c.call('profiles.save', { id: personal.id, name: personal.name, accountId: null });
    await c.call('profiles.delete', { id: work.id });
    expect(await c.call('accounts.list', {})).toHaveLength(1);
    await c.call('accounts.delete', { id: account.id });
    expect(await c.call('accounts.list', {})).toEqual([]);
    await expect(c.call('profiles.save', { name: 'Invalid', accountId: 'missing' })).rejects.toThrow(/No account/);
    expect((await c.call('profiles.list', {})).map((p) => p.name)).toEqual(['Personal']);
  });

  it('keeps profiles and sign-ins across a restart', async () => {
    t = await startTestApp();
    const c = await t.connect();
    await c.signedIn('Personal');
    const home = t.home;
    await t.stop({ keepHome: true });
    t = await startTestApp({}, home);
    const list = await (await t.connect()).call('profiles.list', {});
    expect(list.map((p) => [p.id, p.name, claudeAccount(p)?.email])).toEqual([
      ['personal', 'Personal', 'claude-personal@example.com'],
    ]);
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
    const profile = await c.call('profiles.save', { name: 'Personal' });
    const first = await c.call('accounts.save', { name: 'First' });
    const second = await c.call('accounts.save', { name: 'Second' });
    await c.call('profiles.save', { ...profile, accountId: first.id });
    const write = JsonFile.prototype.write;
    vi.spyOn(JsonFile.prototype, 'write').mockImplementation(function (value) {
      if (this.path === join(t.home, 'hub', 'settings.json')) return Promise.reject(new Error('settings disk full'));
      return write.call(this, value);
    });
    const eventCount = c.events.filter((e) => e.event === 'profiles.changed').length;
    await expect(c.call('profiles.save', { id: profile.id, name: 'Changed', accountId: second.id })).rejects.toThrow('Hub request failed');
    expect((await c.call('profiles.list', {}))[0]).toMatchObject({ name: 'Personal' });
    expect(claudeAccount((await c.call('profiles.list', {}))[0]!)?.id).toBe(first.id);
    expect(c.events.filter((e) => e.event === 'profiles.changed')).toHaveLength(eventCount);
    const stored = JSON.parse(await readFile(join(t.home, 'hub', 'profiles.json'), 'utf8'));
    expect(stored.profiles[0].accountId).toBe(first.id);
    await expect(c.call('profiles.delete', { id: profile.id })).rejects.toThrow('Hub request failed');
    expect((await c.call('profiles.list', {}))[0]?.name).toBe('Personal');
    vi.restoreAllMocks();
    await c.call('profiles.save', { id: profile.id, name: 'Changed', accountId: second.id });
    expect(claudeAccount((await c.call('profiles.list', {}))[0]!)?.id).toBe(second.id);
  });

  it('does not retain a hub profile when config folder preparation fails', async () => {
    t = await startTestApp();
    const c = await t.connect();
    await mkdir(join(t.home, 'profiles'), { recursive: true });
    const block = join(t.home, 'profiles', 'blocked');
    await writeFile(block, 'not a directory');
    await expect(c.call('profiles.save', { name: 'Blocked' })).rejects.toThrow();
    expect(await c.call('profiles.list', {})).toEqual([]);
    const stored = JSON.parse(await readFile(join(t.home, 'hub', 'profiles.json'), 'utf8'));
    expect(stored.profiles).toEqual([]);
    await rm(block);
    expect(await c.call('profiles.save', { name: 'Blocked' })).toMatchObject({ id: 'blocked' });
  });

});
