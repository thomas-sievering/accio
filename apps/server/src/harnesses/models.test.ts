import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL } from '@accio/protocol';
import { FakeHarness, gate, replyWith, SESSION } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';

const opus = { harnessId: 'claudeCode', modelId: 'opus' };
const haiku = { harnessId: 'claudeCode', modelId: 'haiku' };

describe('profile model choices', () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(async () => { await stop?.(); stop = undefined; });

  it('exposes only signed-in providers and harnesses installed on the executing machine', async () => {
    const t = await startTestApp(); stop = t.stop;
    const c = await t.connect();
    const personal = await c.signedIn('Personal');
    const work = await c.call('profiles.save', { name: 'Work' });
    const available = await c.call('models.list', { profileId: personal.id });
    expect(available.models.map((m) => [m.harnessId, m.providerId, m.id])).toEqual([
      ['claudeCode', 'anthropic', 'opus'], ['claudeCode', 'anthropic', 'sonnet'], ['claudeCode', 'anthropic', 'haiku'],
    ]);
    expect(await c.call('models.list', { profileId: work.id })).toEqual({ models: [], favorites: [] });
    await expect(c.call('models.favorite', { profileId: work.id, model: opus, favorite: true })).rejects.toThrow(/not available/);
    const machine = (await c.call('machines.list', {})).find((m) => m.thisMachine)!;
    await t.app.settings.machineConnected({ id: 'other', name: 'Remote', platform: 'linux', version: '1', harnesses: [{ harnessId: 'claudeCode', version: '1' }] });
    await t.app.machines.connect([]);
    expect((await c.call('models.list', { profileId: personal.id })).models).toEqual([]);
    expect(t.app.settings.machine(machine.id)?.harnesses).toEqual([]);
  });

  it('shares favourites with other clients, keeps profiles separate, and persists them on the hub', async () => {
    const t = await startTestApp(); stop = t.stop;
    const c = await t.connect(); const other = await t.connect();
    const personal = await c.signedIn('Personal'); const work = await c.signedIn('Work');
    await c.call('models.favorite', { profileId: personal.id, model: opus, favorite: true });
    await c.call('models.favorite', { profileId: personal.id, model: opus, favorite: true });
    await other.waitFor('models.changed');
    expect((await other.call('models.list', { profileId: personal.id })).favorites).toEqual([opus]);
    expect((await other.call('models.list', { profileId: work.id })).favorites).toEqual([]);
    // An unrelated settings write must preserve favourites.
    await c.call('profiles.save', { id: personal.id, name: 'Me' });
    const stored = JSON.parse(await readFile(join(t.home, 'hub', 'settings.json'), 'utf8'));
    expect(stored.modelFavorites[personal.id]).toEqual([opus]);
    await t.stop({ keepHome: true }); stop = undefined;
    const restarted = await startTestApp({}, t.home); stop = restarted.stop;
    const next = await restarted.connect();
    expect((await next.call('models.list', { profileId: personal.id })).favorites).toEqual([opus]);
    await next.call('models.favorite', { profileId: personal.id, model: opus, favorite: false });
    expect((await next.call('models.list', { profileId: personal.id })).favorites).toEqual([]);
    await next.call('models.favorite', { profileId: personal.id, model: opus, favorite: true });
    await next.call('profiles.delete', { id: personal.id });
    expect(JSON.parse(await readFile(join(t.home, 'hub', 'settings.json'), 'utf8')).modelFavorites[personal.id]).toBeUndefined();
  });

  it('runs the selected model, switches models on the same session, and keeps the choice after restart', async () => {
    const harness = new FakeHarness();
    const t = await startTestApp({ harness }); stop = t.stop;
    const c = await t.connect(); await c.signedIn('Personal');
    const path = join(t.home, 'repo'); await mkdir(path);
    const checkout = await c.call('checkouts.add', { path, profileId: 'personal' });
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'hello', model: opus });
    await c.waitFor('threads.changed', (ts) => ts.some((t) => t.id === thread.id && t.status === 'idle'));
    expect(harness.runs[0]).toMatchObject({ model: 'opus', modelName: 'Claude Opus', sessionId: null });
    expect(await c.call('threads.setModel', { threadId: thread.id, model: haiku })).toMatchObject({ model: haiku });
    c.events.length = 0;
    await c.call('threads.send', { threadId: thread.id, text: 'continue' });
    await c.waitFor('threads.changed', (ts) => ts.some((t) => t.id === thread.id && t.status === 'idle'));
    expect(harness.runs[1]).toMatchObject({ model: 'haiku', modelName: 'Claude Haiku', sessionId: SESSION });
    await t.stop({ keepHome: true }); stop = undefined;
    const restarted = await startTestApp({ harness }, t.home); stop = restarted.stop;
    expect((await (await restarted.connect()).call('threads.list', {}))[0]?.model).toEqual(haiku);
  });

  it('refuses forged selections before creating a thread and prevents changes during a turn', async () => {
    const held = gate();
    const harness = new FakeHarness(async function* () { await held.opened; yield* replyWith('done'); });
    const t = await startTestApp({ harness }); stop = async () => { held.release(); await t.stop(); };
    const c = await t.connect(); await c.signedIn('Personal');
    const path = join(t.home, 'repo'); await mkdir(path);
    const checkout = await c.call('checkouts.add', { path, profileId: 'personal' });
    for (const model of [{ harnessId: 'other', modelId: 'opus' }, { harnessId: 'claudeCode', modelId: 'made-up' }]) {
      await expect(c.call('threads.start', { checkoutId: checkout.id, text: 'hi', model })).rejects.toThrow(/not available/);
    }
    expect(await c.call('threads.list', {})).toEqual([]);
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'hi' });
    expect(thread.model).toEqual(DEFAULT_MODEL);
    expect(harness.runs[0]?.model).toBe('opus');
    await expect(c.call('threads.setModel', { threadId: thread.id, model: opus })).rejects.toThrow(/finish/);
    held.release();
    await c.waitFor('threads.changed', (ts) => ts.some((t) => t.id === thread.id && t.status === 'idle'));
    const [account] = await c.call('accounts.list', {});
    await c.call('accounts.signOut', { id: account!.id });
    await expect(c.call('threads.setModel', { threadId: thread.id, model: opus })).rejects.toThrow(/not available/);
  });

  it('loads threads and hub settings from before model selection existed', async () => {
    const t = await startTestApp({ harness: new FakeHarness() }); stop = t.stop;
    const c = await t.connect(); await c.signedIn('Personal');
    const path = join(t.home, 'repo'); await mkdir(path);
    const checkout = await c.call('checkouts.add', { path, profileId: 'personal' });
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'hi' });
    await c.waitFor('threads.changed', (ts) => ts.some((t) => t.id === thread.id && t.status === 'idle'));
    await t.stop({ keepHome: true }); stop = undefined;
    const file = join(t.home, 'threads.json');
    const threads = JSON.parse(await readFile(file, 'utf8')); delete threads[0].model;
    await writeFile(file, JSON.stringify(threads));
    const restarted = await startTestApp({ harness: new FakeHarness() }, t.home); stop = restarted.stop;
    const next = await restarted.connect();
    expect((await next.call('threads.list', {}))[0]?.model).toEqual(DEFAULT_MODEL);
    expect((await next.call('models.list', { profileId: 'personal' })).favorites).toEqual([]);
  });
});
