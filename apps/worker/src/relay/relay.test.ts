import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { startHubService } from '@accio/hub';
import type { ThreadView } from '@accio/protocol';
import { callAccioTools, startTestApp, startTestSortingHat, TestClient } from '../testing/testApp.js';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';
import { fetchFrom, forgetFetchFrom } from '../testing/gitRepo.js';

/** GLOSSARY: Relay. Two machines on one hub: the PC reads and drives the MacBook's thread. */
describe('thread relay between machines', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop().catch(() => {}); });

  async function machines(harness = new FakeHarness(), pcHarness = new FakeHarness()) {
    const home = await mkdtemp(join(tmpdir(), 'accio-relay-hub-'));
    cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    const hat = await startTestSortingHat(home); cleanup.push(() => hat.close());
    const hub = await startHubService({ home, port: 0, secretKey: Buffer.alloc(32, 7).toString('base64') }); cleanup.push(() => hub.close());
    const join_ = async (deps: Parameters<typeof startTestApp>[0] = {}) => {
      const app = await startTestApp(deps); cleanup.push(() => app.stop());
      const root = await app.connect();
      const { code } = await hub.createPairingCode();
      const saved = await root.call('hubs.pair', { name: 'Home', url: hub.url, code });
      const client = await TestClient.open(`${app.url}?token=test-token&hub=${saved.id}`); cleanup.push(async () => client.close());
      return { app, client, saved };
    };
    const mac = await join_({ harness });
    await mac.client.call('sortingHat.configure', { url: hat.url, adminToken: hat.adminToken, hubName: 'Home' });
    const pc = await join_({ harness: pcHarness });
    return { hub, mac, pc, join: join_ };
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
    expect(seen.machine!.id).not.toBe((await pc.client.thisMachine()).id);
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

  it('answers another machine’s secret request through the hub', async () => {
    const marker = 'accio-test-marker-relayed-secret';
    let read: string | undefined;
    const harness = new FakeHarness(async function* (run) {
      const result = await callAccioTools(run, 'tools/call', { name: 'request_secret', arguments: { slot: 'deploy:test', label: 'Deploy token', reason: 'Deploy the site' } });
      read = await readFile(JSON.parse(result.content[0].text).file, 'utf8');
      yield* replyWith('done');
    });
    const { mac, pc } = await machines(harness);
    const profile = await mac.client.signedIn('Personal');
    const thread = await mac.client.call('threads.start', { profileId: profile.id, text: 'request secret' });
    await pc.client.waitFor('threads.changed', (threads) => !!remote(threads, thread.id), 10_000);
    const pending = async () => (await pc.client.call('threads.observe', { threadId: thread.id })).items.find((i) => i.kind === 'secret' && i.status === 'pending');
    await expect.poll(pending, { timeout: 10_000 }).toBeTruthy();
    const card = { item: (await pending())! };
    if (card.item.kind !== 'secret') throw new Error('Missing secret card');
    await pc.client.call('secretRequests.answer', { threadId: thread.id, requestId: card.item.requestId, answer: { type: 'once', value: marker } });
    await expect.poll(async () => remote(await mac.client.call('threads.list', {}), thread.id)?.status, { timeout: 10_000 }).toBe('idle');
    expect(read).toBe(marker);
  }, 30_000);

  it('shows another machine’s images and linked files, fetched once through the hub', async () => {
    const image = await readFile(fileURLToPath(new URL('../../../../tests/fixtures/chat.png', import.meta.url)));
    const harness = new FakeHarness(async function* (run) {
      await writeFile(join(run.cwd, 'shot.png'), image);
      await writeFile(join(run.cwd, 'notes.txt'), 'version 1');
      yield* replyWith('![Shot](shot.png)\n\n[Notes](notes.txt)');
    });
    const { mac, pc } = await machines(harness);
    const profile = await mac.client.signedIn('Personal');
    const thread = await mac.client.call('threads.start', { profileId: profile.id, text: 'show me' });
    await pc.client.waitFor('threads.changed', (threads) => remote(threads, thread.id)?.status === 'idle', 10_000);
    const assistant = (await pc.client.call('threads.observe', { threadId: thread.id })).items.find((i) => i.kind === 'assistant');
    const asset = assistant?.kind === 'assistant' ? assistant.media?.[0]?.asset : undefined;
    if (!asset) throw new Error('Missing image');
    const get = (machine: typeof pc, url: string) => fetch(`http://127.0.0.1:${machine.app.app.port}/hubs/${machine.saved.id}${url}`);

    const grant = await pc.client.call('threads.assetUrl', { threadId: thread.id, assetId: asset.id });
    const response = await get(pc, grant.url);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(image);

    const notes = join(harness.runs[0]!.cwd, 'notes.txt');
    expect(await (await get(pc, (await pc.client.call('threads.fileUrl', { threadId: thread.id, path: 'notes.txt' })).url)).text()).toBe('version 1');
    await writeFile(notes, 'version 2');
    const file = await get(pc, (await pc.client.call('threads.fileUrl', { threadId: thread.id, path: 'notes.txt' })).url);
    expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename="notes.txt"/);
    expect(await file.text()).toBe('version 2');
    await expect(pc.client.call('threads.fileUrl', { threadId: thread.id, path: 'private.txt' })).rejects.toThrow(/not linked/);

    // The image was kept here, so it still shows once its machine is offline; files are not.
    await mac.app.stop();
    await pc.client.waitFor('threads.changed', (threads) => remote(threads, thread.id)?.machine?.online === false, 10_000);
    const again = await pc.client.call('threads.assetUrl', { threadId: thread.id, assetId: asset.id, download: true });
    expect(Buffer.from(await (await get(pc, again.url)).arrayBuffer())).toEqual(image);
    await expect(pc.client.call('threads.fileUrl', { threadId: thread.id, path: 'notes.txt' })).rejects.toThrow(/offline/);
  }, 30_000);

  it('keeps an offline machine’s threads listed, greyed and read-only', async () => {
    const { mac, pc } = await machines();
    const profile = await mac.client.signedIn('Personal');
    const thread = await mac.client.call('threads.start', { profileId: profile.id, text: 'hello' });
    await pc.client.waitFor('threads.changed', (threads) => remote(threads, thread.id)?.status === 'idle', 10_000);
    await mac.app.stop();
    const offline = await pc.client.waitFor('threads.changed', (threads) => remote(threads, thread.id)?.machine?.online === false, 10_000);
    expect(remote(offline, thread.id)?.title).toBeTruthy();
    for (const [method, params] of [
      ['threads.send', { threadId: thread.id, text: 'hi' }],
      ['threads.settle', { threadId: thread.id }],
      ['threads.snooze', { threadId: thread.id, until: new Date(Date.now() + 60_000).toISOString() }],
      ['threads.reopen', { threadId: thread.id }],
    ] as const) await expect(pc.client.call(method, params as never), method).rejects.toThrow(/offline/);
  }, 30_000);

  it('shows a sleeping machine offline until it really wakes', async () => {
    const { mac, pc } = await machines();
    const profile = await mac.client.signedIn('Personal');
    const thread = await mac.client.call('threads.start', { profileId: profile.id, text: 'hello' });
    await pc.client.waitFor('threads.changed', (threads) => remote(threads, thread.id)?.status === 'idle', 10_000);

    // The desktop app reports a suspend: the worker may still run on a dark wake, but stays away.
    mac.app.app.connections.setAsleep(true);
    await pc.client.waitFor('threads.changed', (threads) => remote(threads, thread.id)?.machine?.online === false, 10_000);
    // Reporting in from the dark wake, as it does when its harnesses change, says nothing to the hub.
    await mac.app.app.connections.workspaces.values().next().value!.machines.connect([]);
    expect(remote(await pc.client.call('threads.list', {}), thread.id)).toMatchObject({ machine: { online: false } });

    // A real wake: it is back.
    mac.app.app.connections.setAsleep(false);
    await pc.client.waitFor('threads.changed', (threads) => remote(threads, thread.id)?.machine?.online === true, 20_000);
  }, 60_000);


  it('starts a thread on another machine, in its checkout of the same repository', async () => {
    const { mac, pc } = await machines();
    const profile = await mac.client.signedIn('Personal');
    const macCheckout = await checkout(mac, 'accio', 'git@github.com:me/accio.git', profile.id);
    const pcCheckout = await checkout(pc, 'accio-copy', 'https://github.com/me/accio', profile.id);
    const only = await checkout(pc, 'notes', 'https://github.com/me/notes', profile.id);
    const macId = (await mac.client.thisMachine()).id;

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

    // The MacBook has no checkout of notes: it clones one under the profile's folder there, then starts in it.
    const folder = join(mac.app.home, 'code');
    // The clone fetches from the PC's bare copy instead of GitHub.
    Object.assign(process.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${join(pc.app.home, 'notes.git').replaceAll('\\', '/')}.insteadOf`, GIT_CONFIG_VALUE_0: 'https://github.com/me/notes' });
    cleanup.push(async () => { for (const key of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) delete process.env[key]; });
    await mac.client.call('machines.setProfileFolders', { machineId: macId, profileId: profile.id, folders: [folder] });
    const cloned = await pc.client.call('threads.start', { checkoutId: only.id, text: 'clone it', machineId: macId });
    expect(cloned.machine?.id).toBe(macId);
    const macState = await mac.client.call('projects.get', {});
    const clonedThere = remote(await mac.client.call('threads.list', {}), cloned.id);
    const notes = macState.checkouts.find((c) => c.id === clonedThere?.checkoutId);
    expect(notes?.path).toBe(join(folder, 'notes'));
    expect(macState.projects.find((p) => p.id === notes?.projectId)).toMatchObject({ repoKey: 'github.com/me/notes', profileId: profile.id });
    // The next thread reuses that checkout rather than cloning again.
    await pc.client.waitFor('machines.changed', (all) => !!all.find((m) => m.id === macId)?.relay?.repos.includes('github.com/me/notes'), 10_000);
    const again = await pc.client.call('threads.start', { checkoutId: only.id, text: 'again', machineId: macId });
    await expect.poll(async () => remote(await mac.client.call('threads.list', {}), again.id)?.checkoutId, { timeout: 10_000 }).toBe(notes?.id);
    expect((await mac.client.call('projects.get', {})).checkouts).toHaveLength(2);

    await mac.app.stop();
    await pc.client.waitFor('machines.changed', (all) => !all.find((m) => m.id === macId)?.relay, 10_000);
    await expect(pc.client.call('threads.start', { profileId: profile.id, text: 'hi', machineId: macId })).rejects.toThrow(/offline/);
  }, 30_000);

  it('starts a thread in a sibling project of the space, in its checkout on the machine named', async () => {
    const answers: string[] = [];
    let macName = '';
    // The PC's thread asks for one in notes, a sibling only the MacBook has: here, then on the MacBook.
    const pcHarness = new FakeHarness(async function* (run) {
      if (run.tools && run.prompt === 'start it') {
        for (const machine of [undefined, macName]) {
          const result = await callAccioTools(run, 'tools/call', { name: 'start_thread', arguments: { message: 'Write the notes', project: 'notes', ...(machine ? { machine } : {}) } });
          answers.push(result.content[0].text);
        }
      }
      if (run.tools && run.prompt === 'start wiki') {
        const result = await callAccioTools(run, 'tools/call', { name: 'start_thread', arguments: { message: 'Write the wiki', project: 'wiki' } });
        answers.push(result.content[0].text);
      }
      yield* replyWith('done');
    });
    const { mac, pc } = await machines(new FakeHarness(), pcHarness);
    const profile = await mac.client.signedIn('Personal');
    const work = await mac.client.signedIn('Work');
    const pcCheckout = await checkout(pc, 'accio', 'https://github.com/me/accio', profile.id);
    // The MacBook fetches notes over ssh, which only its URL says: the https address from the key would fail.
    const notes = await checkout(mac, 'notes', 'git@github.com:me/notes.git', work.id);
    fetchFrom(join(mac.app.home, 'notes.git'), 'git@github.com:me/notes.git');
    cleanup.push(async () => forgetFetchFrom());
    const macView = await mac.client.thisMachine();
    macName = macView.name;
    const pcId = (await pc.client.thisMachine()).id;
    const folder = join(pc.app.home, 'work');
    await pc.client.call('machines.setProfileFolders', { machineId: pcId, profileId: work.id, folders: [folder] });
    await pc.client.call('spaces.save', { name: 'accio', projectKeys: ['github.com/me/accio', 'github.com/me/notes'] });
    await pc.client.waitFor('machines.changed', (all) => !!all.find((m) => m.id === macView.id)?.relay?.repos.includes('github.com/me/notes'), 10_000);

    const caller = await pc.client.call('threads.start', { checkoutId: pcCheckout.id, text: 'start it' });
    await pc.client.waitFor('threads.changed', (list) => list.some((t) => t.id === caller.id && t.status === 'idle'), 30_000);
    // Here, notes is cloned from the MacBook's URL into the Work profile's folder, then the thread starts in it.
    expect(answers[0]).toContain(' in notes on this machine. It runs on its own');
    const here = await pc.client.call('projects.get', {});
    const cloned = here.checkouts.filter((c) => here.projects.find((p) => p.id === c.projectId)?.repoKey === 'github.com/me/notes');
    // One clone, though the turn's Space section started one in the background at the same time.
    expect(cloned.map((c) => c.path)).toEqual([join(folder, 'notes')]);
    expect(here.projects.find((p) => p.id === cloned[0]!.projectId)?.profileId).toBe(work.id);
    const childHere = answers[0]!.match(/\(([^)]+)\)/)![1]!;
    expect((await pc.client.call('threads.list', {})).find((t) => t.id === childHere)).toMatchObject({ checkoutId: cloned[0]!.id, profileId: work.id });

    expect(answers[1]).toContain(` in notes on ${macName}. It runs on its own`);
    const childId = answers[1]!.match(/\(([^)]+)\)/)![1]!;
    await expect.poll(async () => remote(await mac.client.call('threads.list', {}), childId), { timeout: 10_000 }).toMatchObject({ checkoutId: notes.id, profileId: work.id });

    // wiki is only on the MacBook, which goes offline: the hub still says wiki's profile, so it is cloned here from its https address.
    await checkout(mac, 'wiki', 'https://github.com/me/wiki', work.id);
    // The https address from the key ends in .git.
    fetchFrom(join(mac.app.home, 'wiki'), 'https://github.com/me/wiki');
    await pc.client.waitFor('machines.changed', (all) => !!all.find((m) => m.id === macView.id)?.relay?.repos.includes('github.com/me/wiki'), 10_000);
    await mac.app.stop({ keepHome: true });
    cleanup.push(() => rm(mac.app.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    await pc.client.waitFor('machines.changed', (all) => !all.find((m) => m.id === macView.id)?.relay, 10_000);
    const [space] = await pc.client.call('spaces.list', {});
    await pc.client.call('spaces.save', { id: space!.id, name: 'accio', projectKeys: [...space!.projectKeys, 'github.com/me/wiki'] });
    const wikiCaller = await pc.client.call('threads.start', { checkoutId: pcCheckout.id, text: 'start wiki' });
    await pc.client.waitFor('threads.changed', (list) => list.some((t) => t.id === wikiCaller.id && t.status === 'idle'), 30_000);
    expect(answers[2]).toContain(' in wiki on this machine. It runs on its own');
    const wiki = await pc.client.call('projects.get', {});
    expect(wiki.projects.find((p) => p.repoKey === 'github.com/me/wiki')?.profileId).toBe(work.id);
  }, 60_000);

  it('lists every hub project, clones one on the machine a new thread runs on, and forgets it with its last checkout', async () => {
    const { mac, pc } = await machines();
    const personal = await mac.client.signedIn('Personal');
    const work = await mac.client.signedIn('Work');
    const macId = (await mac.client.thisMachine()).id;
    const pcId = (await pc.client.thisMachine()).id;
    // notes is only on the MacBook, under Work: the PC lists it from the hub without a checkout.
    const notes = await checkout(mac, 'notes', 'https://github.com/me/notes', work.id);
    fetchFrom(join(mac.app.home, 'notes.git'), 'https://github.com/me/notes');
    cleanup.push(async () => forgetFetchFrom());
    const listed = await pc.client.waitFor('projects.changed', (s) => !!s.elsewhere?.some((p) => p.repoKey === 'github.com/me/notes'), 10_000);
    expect(listed.elsewhere).toEqual([{ repoKey: 'github.com/me/notes', name: 'notes', profileId: work.id }]);
    expect((await mac.client.call('projects.get', {})).elsewhere).toEqual([]);

    // Sending on this machine clones it into the profile's folder here, under the hub's profile.
    const folder = join(pc.app.home, 'work');
    await pc.client.call('machines.setProfileFolders', { machineId: pcId, profileId: work.id, folders: [folder] });
    const thread = await pc.client.call('threads.start', { repoKey: 'github.com/me/notes', text: 'write notes' });
    const here = await pc.client.call('projects.get', {});
    const cloned = here.checkouts.find((c) => c.id === thread.checkoutId);
    expect(cloned?.path).toBe(join(folder, 'notes'));
    expect(here.projects.find((p) => p.id === cloned?.projectId)).toMatchObject({ repoKey: 'github.com/me/notes', profileId: work.id });
    expect(thread.profileId).toBe(work.id);
    expect(here.elsewhere).toEqual([]);

    // A machine adding a repository the hub has under another profile adopts the hub's.
    await checkout(pc, 'accio', 'https://github.com/me/accio', personal.id);
    await mac.client.waitFor('projects.changed', (s) => !!s.elsewhere?.some((p) => p.repoKey === 'github.com/me/accio'), 10_000);
    const joined = await checkout(mac, 'accio', 'https://github.com/me/accio', work.id);
    expect((await mac.client.call('projects.get', {})).projects.find((p) => p.id === joined.projectId)?.profileId).toBe(personal.id);
    // Moving it moves it for every machine, but not while a machine has threads in it.
    const pcAccio = (await pc.client.call('projects.get', {})).projects.find((p) => p.repoKey === 'github.com/me/accio')!;
    await pc.client.call('projects.setProfile', { projectId: pcAccio.id, profileId: work.id });
    await expect.poll(async () => (await mac.client.call('projects.get', {})).projects.find((p) => p.id === joined.projectId)?.profileId, { timeout: 10_000 }).toBe(work.id);
    const macThread = await mac.client.call('threads.start', { checkoutId: joined.id, text: 'hi' });
    await pc.client.waitFor('threads.changed', (threads) => remote(threads, macThread.id)?.status === 'idle', 10_000);
    await expect(pc.client.call('projects.setProfile', { projectId: pcAccio.id, profileId: personal.id })).rejects.toThrow(/1 thread on other machines/);

    // Started on the MacBook, which has none of wiki since it removed its checkout: it clones there.
    const wiki = await checkout(pc, 'wiki', 'https://github.com/me/wiki', work.id);
    fetchFrom(join(pc.app.home, 'wiki.git'), 'https://github.com/me/wiki');
    await mac.client.waitFor('projects.changed', (s) => !!s.elsewhere?.some((p) => p.repoKey === 'github.com/me/wiki'), 10_000);
    const remoteStart = await mac.client.call('threads.start', { repoKey: 'github.com/me/wiki', text: 'on the pc', machineId: pcId });
    expect(remoteStart.machine?.id).toBe(pcId);
    expect(remote(await pc.client.call('threads.list', {}), remoteStart.id)?.checkoutId).toBe(wiki.id);
    await mac.client.call('machines.setProfileFolders', { machineId: macId, profileId: work.id, folders: [join(mac.app.home, 'work')] });
    await pc.client.waitFor('machines.changed', (all) => !!all.find((m) => m.id === macId)?.relay, 10_000);
    const onMac = await pc.client.call('threads.start', { checkoutId: wiki.id, text: 'on the mac', machineId: macId });
    expect(onMac.machine?.id).toBe(macId);
    const macWiki = (await mac.client.call('projects.get', {})).checkouts.find((c) => c.path === join(mac.app.home, 'work', 'wiki'));
    expect(macWiki).toBeDefined();

    // Removing the MacBook's notes leaves it on the hub, since the PC has a checkout of it…
    await pc.client.waitFor('machines.changed', (all) => !!all.find((m) => m.id === macId)?.relay?.repos.includes('github.com/me/wiki'), 10_000);
    await mac.client.waitFor('machines.changed', (all) => !!all.find((m) => m.id === pcId)?.relay?.repos.includes('github.com/me/notes'), 10_000);
    await mac.client.call('checkouts.remove', { id: notes.id });
    expect((await mac.client.call('projects.get', {})).elsewhere?.map((p) => p.repoKey)).toEqual(['github.com/me/notes']);
    // …while removing the last checkout anywhere forgets it.
    const docs = await checkout(pc, 'docs', 'https://github.com/me/docs', work.id);
    await mac.client.waitFor('projects.changed', (s) => !!s.elsewhere?.some((p) => p.repoKey === 'github.com/me/docs'), 10_000);
    await pc.client.call('checkouts.remove', { id: docs.id });
    await expect.poll(async () => (await mac.client.call('projects.get', {})).elsewhere?.map((p) => p.repoKey), { timeout: 10_000 }).toEqual(['github.com/me/notes']);
  }, 60_000);
});
