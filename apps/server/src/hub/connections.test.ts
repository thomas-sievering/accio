import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { startHubService } from '@accio/hub';
import { fakeClaudeFetch, startTestApp, TestClient } from '../testing/testApp.js';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';

describe('named hub connections and work ownership', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });
  async function fixture(harness = new FakeHarness()) {
    const home = await mkdtemp(join(tmpdir(), 'accio-other-hub-'));
    cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    const other = await startHubService({ home, port: 0, claudeFetch: fakeClaudeFetch }); cleanup.push(() => other.close());
    const app = await startTestApp({ harness }); cleanup.push(() => app.stop());
    const local = await app.connect();
    const { code } = await other.createPairingCode();
    const saved = await local.call('hubs.pair', { name: 'Other hub', url: other.url, code });
    const remote = await TestClient.open(`${app.url}?token=test-token&hub=${saved.id}`); cleanup.push(async () => remote.close());
    return { app, local, remote, other, home, saved };
  }
  it('keeps matching profile IDs, accounts, project associations, and saved credentials isolated', async () => {
    const { app, local, remote, saved } = await fixture();
    const a = await local.signedIn('Personal', { claudeAccount: 'local-me' });
    const b = await remote.signedIn('Personal', { claudeAccount: 'remote-me' });
    expect(a.id).toBe(b.id);
    expect((await local.call('accounts.list', {}))[0]?.email).toBe('local-me@example.com');
    expect((await remote.call('accounts.list', {}))[0]?.email).toBe('remote-me@example.com');
    const hubViews = await remote.call('hubs.list', {});
    expect(hubViews.map((h) => h.name)).toEqual(['Local dev', 'Other hub']);
    expect(JSON.stringify(hubViews)).not.toMatch(/accio-device-|tokenHash|private/);
    await local.call('checkouts.add', { path: app.home, profileId: a.id });
    expect((await remote.call('projects.get', {})).checkouts).toEqual([]);
    const aAccess = await app.app.profiles.hubAccess(a.id);
    const otherWorkspace = app.app.connections.workspace(saved.id);
    const bAccess = await otherWorkspace.profiles.hubAccess(b.id);
    expect(aAccess.baseUrl).not.toBe(bAccess.baseUrl); expect(aAccess.accessKey).not.toBe(bAccess.accessKey);
    const otherConfig = JSON.parse(await readFile(join(otherWorkspace.home, 'profiles', b.id, 'claude', 'settings.json'), 'utf8'));
    expect(otherConfig.env.ANTHROPIC_BASE_URL).toBe(saved.url);
    const stored = JSON.parse(await readFile(join(app.home, 'hub-connections.json'), 'utf8'));
    expect(stored).toHaveLength(2); expect(stored[0].token).not.toBe(stored[1].token);
  });
  it('keeps a running turn and later resume on its original hub while another hub is selected', async () => {
    const held = gate();
    cleanup.push(async () => held.release());
    const harness = new FakeHarness(async function* () { await held.opened; yield* replyWith('done'); });
    const { app, local, remote, saved } = await fixture(harness);
    const a = await local.signedIn('Personal'); await remote.signedIn('Personal');
    const thread = await local.call('threads.start', { profileId: a.id, text: 'stay here' });
    expect(thread.hubId).toBe(app.app.connections.defaultId);
    expect((await remote.call('threads.list', {}))).toEqual([]);
    expect((await remote.call('hubs.list', {})).find((h) => h.id === thread.hubId)?.running).toBe(1);
    await expect(remote.call('threads.stop', { threadId: thread.id })).rejects.toThrow(/No such thread/);
    await expect(remote.call('hubs.remove', { id: thread.hubId! })).rejects.toThrow(/running work/);
    expect(harness.runs[0]?.env.ANTHROPIC_BASE_URL).toBe(app.app.hubUrl);
    await local.call('threads.stop', { threadId: thread.id }); held.release();
    await local.waitFor('threads.changed', (threads) => threads.some((t) => t.id === thread.id && t.status === 'interrupted'));
    await local.call('threads.resume', { threadId: thread.id });
    await local.waitFor('threads.changed', (threads) => threads.some((t) => t.id === thread.id && t.status === 'idle'));
    expect(harness.runs.at(-1)?.env.ANTHROPIC_BASE_URL).toBe(app.app.hubUrl);
    expect(remote.events.some((e) => e.event === 'threads.changed' && (e.data as any[]).some((t) => t.id === thread.id))).toBe(false);
  });
  it('preserves both pairings across restart and binds legacy data to the original hub', async () => {
    const { app, local, remote, saved } = await fixture();
    await local.signedIn('Local'); await remote.signedIn('Remote');
    const oldId = (await local.call('hubs.list', {}))[0]!.id;
    await app.stop({ keepHome: true });
    const restarted = await startTestApp({ harness: new FakeHarness() }, app.home); cleanup.push(() => restarted.stop());
    const root = await restarted.connect();
    expect((await root.call('hubs.list', {})).map((h) => h.id)).toEqual([oldId, saved.id]);
    const otherClient = await TestClient.open(`${restarted.url}?token=test-token&hub=${saved.id}`); cleanup.push(async () => otherClient.close());
    expect((await root.call('profiles.list', {})).map((p) => p.name)).toEqual(['Local']);
    expect((await otherClient.call('profiles.list', {})).map((p) => p.name)).toEqual(['Remote']);
  });
});
