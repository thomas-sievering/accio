import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL } from '@accio/protocol';
import { FakeHarness, gate, replyWith, SESSION } from '../testing/fakeHarness.js';
import { fakeClaudeFetch, startTestApp } from '../testing/testApp.js';
import type { ClaudeModelInfo } from './catalog.js';

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
    expect(await c.call('models.list', { profileId: work.id })).toEqual({ models: [], favorites: [], usedUp: [] });
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

  it('offers the models Claude Code reports for the account, with their efforts, and runs the chosen effort', async () => {
    const levels = ['low', 'medium', 'high', 'xhigh', 'max'];
    const reported: ClaudeModelInfo[] = [
      { value: 'default', displayName: 'Default (recommended)', description: 'Use the default model (currently Opus 5.5)', supportsEffort: true, supportedEffortLevels: levels },
      { value: 'opus', displayName: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks · $4/$20 per Mtok', supportsEffort: true, supportedEffortLevels: levels },
      { value: 'claude-fable-5[1m]', displayName: 'Fable', description: 'Fable 5 · Most capable for your hardest tasks', supportsEffort: true, supportedEffortLevels: levels },
      { value: 'haiku', displayName: 'Haiku', description: 'Haiku 5.5 · Fastest for quick answers', supportsEffort: false },
    ];
    const asked: Record<string, string>[] = [];
    const harness = new FakeHarness();
    const t = await startTestApp({ harness, claudeModels: async (env) => { asked.push(env); return reported; } }); stop = t.stop;
    const c = await t.connect(); await c.signedIn('Personal');
    const fable = { harnessId: 'claudeCode', modelId: 'claude-fable-5[1m]', effort: 'max' };
    // Straight after a restart the list may still be on its way; a thread waits for it rather than refusing Fable.
    const thread = await c.call('threads.start', { profileId: 'personal', text: 'hi', model: fable });
    expect(thread.model).toEqual(fable);
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'idle'));
    expect(harness.runs[0]).toMatchObject({ model: 'claude-fable-5[1m]', effort: 'max', modelName: 'Claude Fable 5' });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ CLAUDE_CONFIG_DIR: expect.stringContaining('personal'), ANTHROPIC_AUTH_TOKEN: expect.stringMatching(/^accio-/) });
    expect((await c.call('models.list', { profileId: 'personal' })).models.map((m) => [m.id, m.name, m.description, m.efforts.length])).toEqual([
      ['opus', 'Claude Opus 5.5', 'Best for everyday, complex tasks', 5],
      ['claude-fable-5[1m]', 'Claude Fable 5', 'Most capable for your hardest tasks', 5],
      ['haiku', 'Claude Haiku 5.5', 'Fastest for quick answers', 0],
    ]);
    await expect(c.call('threads.setModel', { threadId: thread.id, model: { ...haiku, effort: 'low' } })).rejects.toThrow(/does not accept low/);
    expect(await c.call('threads.setModel', { threadId: thread.id, model: { ...opus, effort: 'low' } })).toMatchObject({ model: { ...opus, effort: 'low' } });
    // Favourites name the model alone.
    expect((await c.call('models.favorite', { profileId: 'personal', model: fable, favorite: true })).favorites).toEqual([{ harnessId: 'claudeCode', modelId: 'claude-fable-5[1m]' }]);
  });

  it('refuses a model whose own limit is used up until it resets, and only reports a used-up general limit', async () => {
    const reported: ClaudeModelInfo[] = [
      { value: 'opus', displayName: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
      { value: 'fable', displayName: 'Fable', description: 'Fable 5.1 · Most capable for your hardest tasks', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
    ];
    let resets = '';
    const harness = new FakeHarness();
    const t = await startTestApp({ harness, claudeModels: async () => reported, claudeFetch: async (url, init) => String(url).endsWith('/api/oauth/usage')
      ? Response.json({ seven_day_fable: { utilization: 100, resets_at: resets ||= new Date(Date.now() + 3000).toISOString() }, five_hour: { utilization: 100, resets_at: '2099-01-01T00:00:00Z' }, seven_day: { utilization: 20, resets_at: '2099-01-01T00:00:00Z' } })
      : fakeClaudeFetch(url, init) }); stop = t.stop;
    const c = await t.connect(); await c.signedIn('Personal');
    const fable = { harnessId: 'claudeCode', modelId: 'fable' };
    // Before the hub has read the account's limits, Fable runs.
    const thread = await c.call('threads.start', { profileId: 'personal', text: 'hi', model: fable });
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'idle'));
    // The turn spent allowance, so the machine reads the account's limits on its own; nobody opened the Limits view.
    await expect.poll(async () => (await c.call('models.list', { profileId: 'personal' })).models.find((m) => m.id === 'fable')?.limited).toBeDefined();
    const state = await c.call('models.list', { profileId: 'personal' });
    expect(state.models.map((m) => [m.id, m.limited])).toEqual([['opus', undefined], ['fable', { label: "Fable's weekly limit", resetsAt: resets }]]);
    expect(state.usedUp).toEqual([{ providerId: 'anthropic', label: 'The 5-hour limit', resetsAt: '2099-01-01T00:00:00.000Z' }]);
    await expect(c.call('threads.send', { threadId: thread.id, text: 'more' })).rejects.toThrow(/^Fable's weekly limit is used up until .+\. Choose another model\.$/);
    expect((await c.call('threads.list', {})).find((x) => x.id === thread.id)?.status).toBe('idle');
    await expect(c.call('threads.start', { profileId: 'personal', text: 'hi', model: fable })).rejects.toThrow(/Fable's weekly limit is used up/);
    expect(await c.call('threads.list', {})).toHaveLength(1);
    // The used-up general limit is the provider's to enforce: a turn on Opus still starts.
    expect(await c.call('threads.setModel', { threadId: thread.id, model: opus })).toMatchObject({ model: opus });
    await expect(c.call('threads.setModel', { threadId: thread.id, model: fable })).rejects.toThrow(/used up/);
    expect((await c.call('models.favorite', { profileId: 'personal', model: fable, favorite: true })).favorites).toEqual([fable]);
    const next = await c.call('threads.start', { profileId: 'personal', text: 'hi' });
    expect(next.model).toEqual(DEFAULT_MODEL);
    await c.waitFor('threads.changed', (ts) => ts.every((x) => x.status === 'idle'));
    // When Fable's limit resets, clients hear so without another read of the limits.
    c.events.length = 0;
    await c.waitFor('models.changed');
    expect((await c.call('models.list', { profileId: 'personal' })).models.find((m) => m.id === 'fable')?.limited).toBeUndefined();
    expect(await c.call('threads.setModel', { threadId: thread.id, model: fable })).toMatchObject({ model: fable });
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
