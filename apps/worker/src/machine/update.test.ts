import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { startHubService } from '@accio/hub';
import type { UpdateView } from '@accio/protocol';
import { git } from '../git.js';
import { runCommand } from '../resources/process.js';
import { fakeClaudeFetch, startTestApp, TestClient } from '../testing/testApp.js';
import { Updates, type UpdateDeps } from './update.js';
import type { DesktopHost } from './desktop.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

/** A node script standing in for pnpm: fails the steps named in FAIL_PNPM. */
const fakePnpm = (fail: string[] = []): UpdateDeps['pnpm'] => ({
  command: process.execPath,
  args: ['-e', 'process.exit(process.env.FAIL_PNPM.split(",").includes(process.argv[1]) ? 1 : 0)'],
  env: { ...process.env, FAIL_PNPM: fail.join(',') },
});

function fakeHost() {
  const host = { relaunched: 0, scripts: [] as (string | undefined)[] };
  const desktop: DesktopHost = { relaunch: () => { host.relaunched++; }, capture: async (script) => { host.scripts.push(script); return { png: PNG, note: 'Captured the page only.' }; } };
  return { host, desktop };
}

describe('updating a machine’s Accio', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop().catch(() => {}); });

  /** An origin, the checkout Accio runs from on main, and a way to land a commit on origin/main. */
  async function repo() {
    const dir = await mkdtemp(join(tmpdir(), 'accio-update-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    const origin = join(dir, 'origin.git'); const app = join(dir, 'app'); const other = join(dir, 'other');
    await git(dir, 'init', '--bare', '-b', 'main', origin);
    await git(dir, 'clone', origin, other);
    const commit = async (file: string) => {
      await writeFile(join(other, file), file);
      await git(other, 'add', '.'); await git(other, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', file); await git(other, 'push', 'origin', 'HEAD:main');
    };
    await commit('one');
    await git(dir, 'clone', origin, app);
    return { app, commit };
  }

  const updates = (root: string | undefined, host?: DesktopHost, fail?: string[]) => new Updates({ machineId: 'm', root, host, run: runCommand, pnpm: fakePnpm(fail) });
  const settled = (u: Updates, states: UpdateView['state'][]) => new Promise<UpdateView>((done) => {
    const off = u.onChange((view) => { if (states.includes(view.state)) { off(); done(view); } });
  });

  it('fast-forwards to the latest main, builds and restarts the app', async () => {
    const { app, commit } = await repo();
    const { host, desktop } = fakeHost();
    const u = updates(app, desktop);
    expect(await u.status()).toMatchObject({ state: 'current' });
    await commit('two');
    const before = await u.status({ fresh: true });
    expect(before).toMatchObject({ state: 'behind', behind: 1 });
    const restarting = settled(u, ['restarting', 'failed']);
    expect(await u.start()).toMatchObject({ state: 'updating' });
    expect(await restarting).toMatchObject({ state: 'restarting' });
    await expect.poll(() => host.relaunched).toBe(1);
    expect((await u.status()).commit).not.toBe(before.commit);
  });

  it('rolls back to the previous commit when the build fails, and keeps running', async () => {
    const { app, commit } = await repo();
    const { host, desktop } = fakeHost();
    const u = updates(app, desktop, ['build']);
    const before = await u.status();
    await commit('two');
    const failed = settled(u, ['failed', 'restarting']);
    await u.start();
    expect(await failed).toMatchObject({ state: 'failed', commit: before.commit });
    expect(host.relaunched).toBe(0);
    expect(await u.status()).toMatchObject({ state: 'failed', behind: 1 });
  });

  it('refuses a checkout that isn’t a clean main', async () => {
    const { app, commit } = await repo();
    const u = updates(app, fakeHost().desktop);
    await commit('two');
    await writeFile(join(app, 'one'), 'edited');
    expect(await u.status({ fresh: true })).toMatchObject({ state: 'blocked', detail: expect.stringMatching(/uncommitted/) });
    await expect(u.start()).rejects.toThrow(/uncommitted/);
    await git(app, 'checkout', '--', 'one'); await git(app, 'checkout', '-b', 'feature');
    expect(await u.status({ fresh: true })).toMatchObject({ state: 'blocked', detail: 'Runs from branch feature, not main.' });
    expect(await updates(app).status()).toMatchObject({ state: 'unsupported' });
    expect(await updates(undefined).status()).toMatchObject({ state: 'unsupported', commit: null });
  });

  it('lets another machine update it and take a screenshot through the relay', async () => {
    const { app, commit } = await repo();
    const { host, desktop } = fakeHost();
    const home = await mkdtemp(join(tmpdir(), 'accio-update-hub-'));
    cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    const hub = await startHubService({ home, port: 0, secretKey: Buffer.alloc(32, 7).toString('base64'), claudeFetch: fakeClaudeFetch }); cleanup.push(() => hub.close());
    const join_ = async (deps: Parameters<typeof startTestApp>[0]) => {
      const t = await startTestApp(deps); cleanup.push(() => t.stop());
      const root = await t.connect();
      const { code } = await hub.createPairingCode();
      const saved = await root.call('hubs.pair', { name: 'Home', url: hub.url, code });
      const client = await TestClient.open(`${t.url}?token=test-token&hub=${saved.id}`); cleanup.push(async () => client.close());
      return client;
    };
    const mac = await join_({ updates: { root: app, host: desktop, pnpm: fakePnpm() } });
    const pc = await join_({ updates: { root: undefined } });
    const macId = (await mac.call('machine.get', {})).id;
    await commit('two');

    await expect.poll(() => pc.call('update.status', { machineId: macId }).then((v) => v.state, () => 'waiting'), { timeout: 10_000 }).toBe('behind');
    const { png, note } = await pc.call('app.screenshot', { machineId: macId, script: 'openSettings()' });
    expect(Buffer.from(png, 'base64')).toEqual(PNG);
    expect(note).toBe('Captured the page only.');
    expect(host.scripts).toEqual(['openSettings()']);

    const restarting = pc.waitFor('update.changed', (v) => v.machineId === macId && v.state === 'restarting', 10_000);
    await pc.call('update.start', { machineId: macId });
    await restarting;
    await expect.poll(() => host.relaunched).toBe(1);
    await expect(pc.call('update.status', { machineId: 'nope' })).rejects.toThrow(/No such machine/);
  }, 30_000);
});
