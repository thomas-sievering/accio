import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp } from '../testing/testApp.js';

describe('profiles slice', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(() => t?.stop());

  it('creates a profile whose config folder points at the hub with a key of its own', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const hrc = await c.call('profiles.save', { name: 'HRC' });
    const personal = await c.call('profiles.save', { name: 'Personal' });
    expect(hrc).toEqual({ id: 'hrc', name: 'HRC', roots: [], signIn: null });

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
    expect(signed.signIn).toEqual({ email: 'me@example.com', organization: null });
    const pushed = await b.waitFor('profiles.changed', (list) => list[0]?.signIn !== null);
    expect(JSON.stringify(pushed)).not.toMatch(/oauth-|refresh-|accio-/);

    const out = await a.call('profiles.signOut', { profileId: profile.id });
    expect(out.signIn).toBeNull();
  });

  it('keeps each Claude account in one profile', async () => {
    t = await startTestApp();
    const c = await t.connect();
    await c.signedIn('Personal', { claudeLogin: 'me' });
    await expect(c.signedIn('HRC', { claudeLogin: 'me' })).rejects.toThrow(/Personal already uses this Claude account/);
    const hrc = await c.signedIn('HRC', { claudeLogin: 'work' });
    expect(hrc.signIn?.email).toBe('work@example.com');
  });

  it('keeps profiles and sign-ins across a restart', async () => {
    t = await startTestApp();
    const c = await t.connect();
    await c.signedIn('Personal');
    const home = t.home;
    await t.stop({ keepHome: true });
    t = await startTestApp({}, home);
    const list = await (await t.connect()).call('profiles.list', {});
    expect(list).toEqual([
      { id: 'personal', name: 'Personal', roots: [], signIn: { email: 'claude-personal@example.com', organization: null } },
    ]);
  });
});
