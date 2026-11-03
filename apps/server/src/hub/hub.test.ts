import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp } from '../testing/testApp.js';

describe('hub', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(() => t?.stop());

  it('shows where the hub is, that it answers, and which profiles it holds an account for', async () => {
    t = await startTestApp();
    const client = await t.connect();
    await client.signedIn('personal', { claudeAccount: 'claude-me' });
    await client.call('profiles.save', { name: 'work', folders: [] });

    const info = await client.call('hub.get', {});

    expect(info).toMatchObject({ runs: 'inThisServer', url: t.app.hubUrl, reachable: true });
    expect(info.store).toContain(t.home);
    expect(info.profiles).toEqual([
      { profileId: expect.any(String), name: 'personal', account: { email: 'claude-me@example.com', organization: null } },
      { profileId: expect.any(String), name: 'work', account: null },
    ]);
  });

  it('never hands a client the hub’s keys or tokens', async () => {
    t = await startTestApp();
    const client = await t.connect();
    const profile = await client.signedIn('personal', { claudeAccount: 'claude-me' });
    const key = await t.app.hub.ensureProfile(profile.id);
    const token = await t.app.hub.accessToken(profile.id);

    const raw = JSON.stringify(await client.call('hub.get', {}));

    expect(raw).not.toContain(key);
    expect(raw).not.toContain(token);
    expect(raw).not.toContain('refresh-claude-me');
  });
});
