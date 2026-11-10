import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startRemoteSortingHat } from '../../../hub/src/testing/remoteSortingHat.js';
import { FakeHarness, replyWith } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';

// The machine's own hub seals the admin token and hat keys with this key, as a headless hub would.
const previousKey = process.env.ACCIO_SECRET_KEY;
beforeAll(() => { process.env.ACCIO_SECRET_KEY = Buffer.alloc(32, 9).toString('base64'); });
afterAll(() => { if (previousKey === undefined) delete process.env.ACCIO_SECRET_KEY; else process.env.ACCIO_SECRET_KEY = previousKey; });

describe('threads on a hub with a Sorting Hat', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });

  it('run Claude Code and Codex turns through the profile’s house with a hat key, never the admin token', async () => {
    const remote = await startRemoteSortingHat(); cleanup.push(remote.close);
    const claude = await remote.claudeAccount('Mine');
    const chatgpt = await remote.chatgptAccount('My ChatGPT', 'chatgpt-personal');
    await remote.api('POST', 'houses', { name: 'Personal', accounts: { anthropic: [claude.id], openai: [chatgpt.id] } });
    // Each harness does what the real one does with its environment: one model request, then a reply.
    const claudeCode = new FakeHarness(async function* (run) {
      const res = await fetch(`${run.env.ANTHROPIC_BASE_URL}/v1/messages`, { method: 'POST', headers: { authorization: `Bearer ${run.env.ANTHROPIC_AUTH_TOKEN}`, 'content-type': 'application/json' }, body: '{"model":"claude-test","messages":[]}' });
      await res.text();
      yield* replyWith(`claude ${res.status}`);
    });
    const codex = new FakeHarness(async function* (run) {
      const res = await fetch(`${run.env.ACCIO_OPENAI_URL}/responses`, { method: 'POST', headers: { authorization: `Bearer ${run.env.ACCIO_OPENAI_KEY}`, 'content-type': 'application/json' }, body: '{"model":"gpt-test","input":[]}' });
      await res.text();
      yield* replyWith(`codex ${res.status}`);
    });
    const t = await startTestApp({ harness: claudeCode, codexHarness: codex }); cleanup.push(() => t.stop());
    const c = await t.connect();

    await c.call('sortingHat.configure', { url: remote.url, adminToken: remote.adminToken, hubName: 'Home server' });
    const spare = await c.call('profiles.save', { name: 'Spare' });
    expect(spare.house).toBeNull();
    await expect(c.call('threads.start', { profileId: spare.id, model: { harnessId: 'claudeCode', modelId: 'opus' }, text: 'hello' }))
      .rejects.toThrow('Spare isn’t linked to a house on the Sorting Hat. Choose one in Settings / Profiles.');

    const profile = await c.call('profiles.save', { name: 'Personal', houseId: 'personal' });
    const models = await c.call('models.list', { profileId: profile.id });
    const claudeModel = models.models.find((m) => m.harnessId === 'claudeCode')!;
    expect(models.models.filter((m) => m.harnessId === 'codex').map((m) => m.id)).toEqual(['gpt-test']);

    const onClaude = await c.call('threads.start', { profileId: profile.id, model: { harnessId: 'claudeCode', modelId: claudeModel.id }, text: 'hello' });
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === onClaude.id && x.status === 'idle'));
    const onCodex = await c.call('threads.start', { profileId: profile.id, model: { harnessId: 'codex', modelId: 'gpt-test' }, text: 'hello' });
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === onCodex.id && x.status === 'idle'));

    expect((await c.call('threads.transcript', { threadId: onClaude.id })).find((i) => i.kind === 'assistant')).toMatchObject({ text: 'claude 200' });
    expect((await c.call('threads.transcript', { threadId: onCodex.id })).find((i) => i.kind === 'assistant')).toMatchObject({ text: 'codex 200' });
    // The Sorting Hat swapped the hat key for each house account's own credential.
    expect(remote.anthropic.seen.at(-1)?.headers.authorization).toBe('Bearer token-1');
    expect(remote.chatgpt.seen.at(-1)?.headers.get('chatgpt-account-id')).toBe('chatgpt-personal');

    const [claudeRun] = claudeCode.runs; const [codexRun] = codex.runs;
    expect(claudeRun!.env.ANTHROPIC_BASE_URL).toBe(remote.url);
    expect(claudeRun!.env.ANTHROPIC_AUTH_TOKEN).toMatch(/^hat-/);
    expect(codexRun!.env.ACCIO_OPENAI_URL).toBe(`${remote.url}/openai`);
    // One key for this profile on this machine, for both harnesses, named for the dashboard.
    expect(codexRun!.env.ACCIO_OPENAI_KEY).toBe(claudeRun!.env.ANTHROPIC_AUTH_TOKEN);
    const keys = await remote.api('GET', 'hat-keys');
    expect(keys).toEqual([expect.objectContaining({ houseId: 'personal', name: expect.stringMatching(/^Accio · Home server · Personal · .+/), revokedAt: null })]);

    // The admin token reaches no client and no thread.
    const seen = JSON.stringify([claudeCode.runs.map((r) => r.env), codex.runs.map((r) => r.env), c.events,
      await c.call('sortingHat.get', {}), await c.call('profiles.list', {}), await c.call('accounts.list', {})]);
    expect(seen).not.toContain(remote.adminToken);
  });
});
