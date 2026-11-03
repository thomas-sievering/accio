import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeAccount, startTestApp } from '../testing/testApp.js';

describe('profiles slice', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(() => t?.stop());

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

  it('signs a profile in with a pasted code and tells every client who it is', async () => {
    t = await startTestApp();
    const a = await t.connect();
    const b = await t.connect();
    const profile = await a.call('profiles.save', { name: 'Personal' });
    const { signInId, url } = await a.call('profiles.beginSignIn', { profileId: profile.id });
    expect(url).toMatch(/^https:\/\/claude\.ai\/oauth\/authorize\?/);
    const state = new URL(url).searchParams.get('state');

    await expect(a.call('profiles.completeSignIn', { signInId, code: 'me#wrong-state' })).rejects.toThrow(/different sign-in/);
    const signed = await a.call('profiles.completeSignIn', { signInId, code: `me#${state}` });
    expect(claudeAccount(signed)).toMatchObject({ email: 'me@example.com', organization: null });
    const pushed = await b.waitFor('profiles.changed', (list) => !!list[0] && claudeAccount(list[0]) !== null);
    expect(JSON.stringify(pushed)).not.toMatch(/oauth-|refresh-|accio-/);

    const out = await a.call('profiles.signOut', { profileId: profile.id });
    expect(claudeAccount(out)?.signedIn).toBe(false);
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
});
