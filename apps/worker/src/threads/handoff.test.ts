import { afterEach, describe, expect, it } from 'vitest';
import { FakeCodex } from '../testing/fakeCodex.js';
import { FakeHarness, SESSION, replyWith, toolCall } from '../testing/fakeHarness.js';
import { claudeAccount, startTestApp, type TestClient } from '../testing/testApp.js';
import type { HarnessTurn } from './harness.js';

const opus = { harnessId: 'claudeCode', modelId: 'opus' };
const codex = { harnessId: 'codex', modelId: 'test-codex' };
const CODEX_SESSION = 'codex-thread';

/** A Personal profile signed in to both Claude and ChatGPT. */
async function bothProviders(c: TestClient, fake: FakeCodex) {
  const profile = await c.signedIn('Personal');
  const account = await c.call('accounts.save', { name: 'Personal ChatGPT', providerId: 'openai' });
  const login = await c.call('accounts.beginSignIn', { id: account.id });
  await fake.latest.complete('Personal');
  await c.call('accounts.signInStatus', { signInId: login.signInId });
  return c.call('profiles.save', { id: profile.id, name: 'Personal', accountIds: { anthropic: [claudeAccount(profile)!.id], openai: [account.id] } });
}

async function mcp(run: HarnessTurn, method: string, params?: unknown) {
  const response = await fetch(run.tools!.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: run.tools!.authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await response.json() as { result: any }).result;
}

const idle =(c: TestClient, threadId: string) => c.waitFor('threads.changed', (ts) => ts.some((t) => t.id === threadId && t.status === 'idle'));

async function send(c: TestClient, threadId: string, text: string) {
  c.events.length = 0;
  await c.call('threads.send', { threadId, text });
  await idle(c, threadId);
}

describe('handing a thread off to another harness', () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(() => stop?.());

  async function setup() {
    const claude = new FakeHarness(async function* (_run, n) {
      if (n === 1) yield* toolCall('Bash', { command: 'npm test' });
      yield* replyWith(`claude says ${n}`);
    });
    const codexRuns = new FakeHarness((_run, n) => replyWith(`codex says ${n}`, CODEX_SESSION));
    const fake = new FakeCodex();
    const t = await startTestApp({ harness: claude, codexHarness: codexRuns, codexFactory: fake.factory });
    stop = t.stop;
    const c = await t.connect();
    const profile = await bothProviders(c, fake);
    const thread = await c.call('threads.start', { profileId: profile.id, model: opus, text: 'Fix the login bug' });
    await idle(c, thread.id);
    return { t, c, thread, claude, codexRuns };
  }

  it('continues on the other harness with the conversation so far ahead of the new message', async () => {
    const { c, thread, codexRuns } = await setup();

    expect(await c.call('threads.setModel', { threadId: thread.id, model: codex })).toMatchObject({ model: codex });
    await send(c, thread.id, 'Now add a test');

    const run = codexRuns.runs[0]!;
    expect(run.sessionId).toBeNull();
    expect(run.prompt).toContain('Fix the login bug');
    expect(run.prompt).toContain('claude says 1');
    expect(run.prompt).toContain('Bash');
    expect(run.prompt.endsWith('User message:\nNow add a test')).toBe(true);
  });

  it('trims a long thread and lets the new harness read all of it', async () => {
    let page = '';
    let listed: string[] = [];
    const claude = new FakeHarness((_run, n) => replyWith(`claude says ${n}`));
    const codexRuns = new FakeHarness(async function* (run) {
      listed = (await mcp(run, 'tools/list')).tools.map((tool: { name: string }) => tool.name);
      page = (await mcp(run, 'tools/call', { name: 'read_thread', arguments: { offset: 0, limit: 2 } })).content[0].text;
      yield* replyWith('codex read it', CODEX_SESSION);
    });
    const fake = new FakeCodex();
    const t = await startTestApp({ harness: claude, codexHarness: codexRuns, codexFactory: fake.factory });
    stop = t.stop;
    const c = await t.connect();
    const profile = await bothProviders(c, fake);
    const thread = await c.call('threads.start', { profileId: profile.id, model: opus, text: 'The very first request' });
    await idle(c, thread.id);
    for (let i = 0; i < 10; i++) await send(c, thread.id, `Detail ${i} ${'x'.repeat(7000)}`);
    await c.call('threads.setModel', { threadId: thread.id, model: codex });
    await send(c, thread.id, 'Summarise');

    const prompt = codexRuns.runs[0]!.prompt;
    expect(prompt).toContain('The very first request');
    expect(prompt).toContain('claude says 11');
    expect(prompt).toMatch(/\d+ of \d+ items are left out; read the whole thread with the accio read_thread tool/);
    expect(prompt.length).toBeLessThan(60_000);
    expect(listed).toContain('read_thread');
    expect(page).toContain('The very first request');
    expect(page).toContain('claude says 1');
    expect(page).toMatch(/call again with offset 2/);
  });

  it('keeps a pending handoff across a restart', async () => {
    const { t, c, thread, claude } = await setup();
    await c.call('threads.setModel', { threadId: thread.id, model: codex });
    await t.stop({ keepHome: true });
    const codexRuns = new FakeHarness((_run, n) => replyWith(`codex says ${n}`, CODEX_SESSION));
    const restarted = await startTestApp({ harness: claude, codexHarness: codexRuns, codexFactory: new FakeCodex().factory }, t.home);
    stop = restarted.stop;
    const next = await restarted.connect();
    await send(next, thread.id, 'Now add a test');
    expect(codexRuns.runs[0]!.prompt).toContain('claude says 1');
  });

  it('sends the history again when a turn fails before the new harness takes it', async () => {
    const claude = new FakeHarness((_run, n) => replyWith(`claude says ${n}`));
    const codexRuns = new FakeHarness(async function* (_run, n) {
      if (n === 1) throw new Error('codex could not start');
      yield* replyWith(`codex says ${n}`, CODEX_SESSION);
    });
    const fake = new FakeCodex();
    const t = await startTestApp({ harness: claude, codexHarness: codexRuns, codexFactory: fake.factory });
    stop = t.stop;
    const c = await t.connect();
    const profile = await bothProviders(c, fake);
    const thread = await c.call('threads.start', { profileId: profile.id, model: opus, text: 'Fix the login bug' });
    await idle(c, thread.id);
    await c.call('threads.setModel', { threadId: thread.id, model: codex });
    c.events.length = 0;
    await c.call('threads.send', { threadId: thread.id, text: 'Now add a test' });
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'failed'));
    c.events.length = 0;
    await c.call('threads.retry', { threadId: thread.id });
    await idle(c, thread.id);
    expect(codexRuns.runs[1]!.prompt).toContain('claude says 1');
    expect(codexRuns.runs[1]!.prompt.endsWith('User message:\nNow add a test')).toBe(true);
  });

  it('resumes the harness it left with only what happened since, then sends plain prompts again', async () => {
    const { c, thread, claude, codexRuns } = await setup();
    await c.call('threads.setModel', { threadId: thread.id, model: codex });
    await send(c, thread.id, 'Now add a test');

    await c.call('threads.setModel', { threadId: thread.id, model: opus });
    await send(c, thread.id, 'Review it');
    const back = claude.runs[1]!;
    expect(back.sessionId).toBe(SESSION);
    expect(back.prompt).toContain('Now add a test');
    expect(back.prompt).toContain('codex says 1');
    expect(back.prompt).not.toContain('Fix the login bug');
    expect(back.prompt.endsWith('User message:\nReview it')).toBe(true);

    await send(c, thread.id, 'Thanks');
    expect(claude.runs[2]).toMatchObject({ sessionId: SESSION, prompt: 'Thanks' });

    await c.call('threads.setModel', { threadId: thread.id, model: codex });
    await send(c, thread.id, 'Once more');
    const again = codexRuns.runs[1]!;
    expect(again.sessionId).toBe(CODEX_SESSION);
    expect(again.prompt).toContain('Review it');
    expect(again.prompt).toContain('Thanks');
    expect(again.prompt).not.toContain('Now add a test');
  });
});
