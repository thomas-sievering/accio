import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { startHubService } from '@accio/hub';
import type { ThreadView } from '@accio/protocol';
import { fakeClaudeFetch, startTestApp, TestClient } from '../testing/testApp.js';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';

/** GLOSSARY: Relay. Two machines on one hub: the PC reads and drives the MacBook's thread. */
describe('thread relay between machines', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop().catch(() => {}); });

  async function machines(harness = new FakeHarness()) {
    const home = await mkdtemp(join(tmpdir(), 'accio-relay-hub-'));
    cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    const hub = await startHubService({ home, port: 0, secretKey: Buffer.alloc(32, 7).toString('base64'), claudeFetch: fakeClaudeFetch }); cleanup.push(() => hub.close());
    const join_ = async (deps: Parameters<typeof startTestApp>[0] = {}) => {
      const app = await startTestApp(deps); cleanup.push(() => app.stop());
      const root = await app.connect();
      const { code } = await hub.createPairingCode();
      const saved = await root.call('hubs.pair', { name: 'Home', url: hub.url, code });
      const client = await TestClient.open(`${app.url}?token=test-token&hub=${saved.id}`); cleanup.push(async () => client.close());
      return { app, client, saved };
    };
    const mac = await join_({ harness });
    const pc = await join_({ harness: new FakeHarness() });
    return { hub, mac, pc };
  }
  const remote = (threads: ThreadView[], id: string) => threads.find((t) => t.id === id);
  /** A checkout named by its GitHub URL, added to the machine, then fetching from a bare copy beside it. */
  async function checkout(machine: { app: { home: string }; client: TestClient }, name: string, origin: string, profileId: string) {
    const home = machine.app.home;
    const path = join(home, name); const bare = join(home, `${name}.git`); await mkdir(path);
    const git = (...args: string[]) => execFileSync('git', ['-C', path, ...args]);
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    git('init', '-q', '-b', 'main'); git('remote', 'add', 'origin', origin);
    const added = await machine.client.call('checkouts.add', { path, profileId });
    git('config', `url.${bare.replaceAll('\\', '/')}.insteadOf`, origin);
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    git('push', '-q', '-u', 'origin', 'main');
    return added;
  }

  it('lists, streams and drives another machine’s thread through the hub', async () => {
    const held = gate(); cleanup.push(async () => held.release());
    const harness = new FakeHarness(async function* (_run, n) { if (n === 1) await held.opened; yield* replyWith(`reply ${n}`); });
    const { mac, pc } = await machines(harness);
    const profile = await mac.client.signedIn('Personal');
    const thread = await mac.client.call('threads.start', { profileId: profile.id, text: 'first' });

    const listed = await pc.client.waitFor('threads.changed', (threads) => remote(threads, thread.id)?.status === 'running', 10_000);
    const seen = remote(listed, thread.id)!;
    expect(seen.machine).toMatchObject({ online: true });
    expect(seen.machine!.id).not.toBe((await pc.client.call('machine.get', {})).id);
    expect(remote(await mac.client.call('threads.list', {}), thread.id)?.machine).toBeUndefined();

    const snapshot = await pc.client.call('threads.observe', { threadId: thread.id });
    expect(snapshot.items.some((i) => i.kind === 'user' && i.text === 'first')).toBe(true);
    held.release();
    await pc.client.waitFor('thread.item', (e) => e.threadId === thread.id && e.item.kind === 'assistant', 10_000);
    await pc.client.waitFor('threads.changed', (threads) => remote(threads, thread.id)?.status === 'idle', 10_000);

    await pc.client.call('threads.send', { threadId: thread.id, text: 'from the pc' });
    await expect.poll(async () => (await mac.client.call('threads.transcript', { threadId: thread.id })).some((i) => i.kind === 'user' && i.text === 'from the pc'), { timeout: 10_000 }).toBe(true);
    // Larger than one relay message both ways: the request, and the transcript observed back.
    await expect.poll(async () => remote(await mac.client.call('threads.list', {}), thread.id)?.status, { timeout: 10_000 }).toBe('idle');
    const big = 'x'.repeat(700_000);
    await pc.client.call('threads.send', { threadId: thread.id, text: big });
    await expect.poll(async () => (await pc.client.call('threads.observe', { threadId: thread.id })).items.some((i) => i.kind === 'user' && i.text === big), { timeout: 10_000 }).toBe(true);
    const settled = await pc.client.call('threads.settle', { threadId: thread.id });
    expect(settled.machine?.online).toBe(true);
    await expect(pc.client.call('threads.openPreview', { threadId: thread.id })).rejects.toThrow(/Open this on/);

    // The name from Settings → Machines labels the thread, and renaming it relabels it.
    await mac.client.call('machines.rename', { machineId: seen.machine!.id, name: 'Studio Mac' });
    await pc.client.waitFor('threads.changed', (threads) => remote(threads, thread.id)?.machine?.name === 'Studio Mac', 10_000);

    // And the other way round: the MacBook drives the PC's thread.
    const pcThread = await pc.client.call('threads.start', { profileId: profile.id, text: 'on the pc' });
    await mac.client.waitFor('threads.changed', (threads) => remote(threads, pcThread.id)?.status === 'idle' && !!remote(threads, pcThread.id)?.machine, 10_000);
    await mac.client.call('threads.send', { threadId: pcThread.id, text: 'from the mac' });
    await expect.poll(async () => (await pc.client.call('threads.transcript', { threadId: pcThread.id })).some((i) => i.kind === 'user' && i.text === 'from the mac'), { timeout: 10_000 }).toBe(true);
  }, 30_000);

  it('keeps an offline machine’s threads listed, greyed and read-only', async () => {
    const { mac, pc } = await machines();
    const profile = await mac.client.signedIn('Personal');
    const thread = await mac.client.call('threads.start', { profileId: profile.id, text: 'hello' });
    await pc.client.waitFor('threads.changed', (threads) => remote(threads, thread.id)?.status === 'idle', 10_000);
    await mac.app.stop();
    const offline = await pc.client.waitFor('threads.changed', (threads) => remote(threads, thread.id)?.machine?.online === false, 10_000);
    expect(remote(offline, thread.id)?.title).toBeTruthy();
    await expect(pc.client.call('threads.send', { threadId: thread.id, text: 'hi' })).rejects.toThrow(/offline/);
  }, 30_000);

  it('starts a thread on another machine, in its checkout of the same repository', async () => {
    const { mac, pc } = await machines();
    const profile = await mac.client.signedIn('Personal');
    const macCheckout = await checkout(mac, 'accio', 'git@github.com:me/accio.git', profile.id);
    const pcCheckout = await checkout(pc, 'accio-copy', 'https://github.com/me/accio', profile.id);
    const only = await checkout(pc, 'notes', 'https://github.com/me/notes', profile.id);
    const macId = (await mac.client.call('machine.get', {})).id;

    // The picker offers the MacBook for accio, which it has, and not for notes.
    const listed = await pc.client.waitFor('machines.changed', (all) => !!all.find((m) => m.id === macId)?.relay?.repos.length, 10_000);
    expect(listed.find((m) => m.id === macId)?.relay?.repos).toEqual(['github.com/me/accio']);
    expect(listed.find((m) => m.thisMachine)?.relay).toBeUndefined();
    expect((await pc.client.call('machines.list', {})).find((m) => m.id === macId)?.relay?.repos).toEqual(['github.com/me/accio']);

    const thread = await pc.client.call('threads.start', { checkoutId: pcCheckout.id, text: 'from the pc', machineId: macId });
    expect(thread.machine?.id).toBe(macId);
    // Listed here at once, under this machine's project, so the client can open it.
    expect(remote(await pc.client.call('threads.list', {}), thread.id)).toMatchObject({ projectId: pcCheckout.projectId, machine: { id: macId } });
    expect((await pc.client.call('threads.observe', { threadId: thread.id })).items.some((i) => i.kind === 'user' && i.text === 'from the pc')).toBe(true);
    const owned = remote(await mac.client.call('threads.list', {}), thread.id);
    expect(owned).toMatchObject({ checkoutId: macCheckout.id, profileId: profile.id });
    expect(owned?.machine).toBeUndefined();

    const loose = await pc.client.call('threads.start', { profileId: profile.id, text: 'no project', machineId: macId });
    await expect.poll(async () => remote(await mac.client.call('threads.list', {}), loose.id)?.checkoutId, { timeout: 10_000 }).toBe('');

    await expect(pc.client.call('threads.start', { checkoutId: only.id, text: 'hi', machineId: macId })).rejects.toThrow(/has no checkout of notes/);
    await mac.app.stop();
    await pc.client.waitFor('machines.changed', (all) => !all.find((m) => m.id === macId)?.relay, 10_000);
    await expect(pc.client.call('threads.start', { profileId: profile.id, text: 'hi', machineId: macId })).rejects.toThrow(/offline/);
  }, 30_000);
});
