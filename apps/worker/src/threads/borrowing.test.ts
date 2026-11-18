import { afterEach, describe, expect, it } from 'vitest';
import { FakeCodex } from '../testing/fakeCodex.js';
import { FakeHarness, SESSION, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';

const opus = { harnessId: 'claudeCode', modelId: 'opus' };
const codex = { harnessId: 'codex', modelId: 'test-codex' };
const CODEX_SESSION = 'codex-thread';

const idle = (c: TestClient, threadId: string) => c.waitFor('threads.changed', (ts) => ts.some((t) => t.id === threadId && t.status === 'idle'));

async function send(c: TestClient, threadId: string, text: string) {
  c.events.length = 0;
  await c.call('threads.send', { threadId, text });
  await idle(c, threadId);
}

/** GLOSSARY: Borrowing. A thread of one profile running on another profile's accounts. */
describe('borrowing another profile’s accounts', () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(() => stop?.());

  /** Work is signed in to Claude only; Personal to Claude and ChatGPT. */
  async function setup() {
    const claude = new FakeHarness((_run, n) => replyWith(`claude says ${n}`));
    const codexRuns = new FakeHarness((_run, n) => replyWith(`codex says ${n}`, CODEX_SESSION));
    const fake = new FakeCodex();
    const t = await startTestApp({ harness: claude, codexHarness: codexRuns, codexFactory: fake.factory });
    stop = t.stop;
    const c = await t.connect();
    const work = await c.signedIn('Work');
    const personal = await c.withChatGpt(await c.signedIn('Personal'), fake);
    const thread = await c.call('threads.start', { profileId: work.id, model: opus, text: 'Fix the login bug' });
    await idle(c, thread.id);
    return { c, work, personal, thread, claude, codexRuns };
  }

  it('spends the other profile’s Claude account while the thread keeps its own folder, until you pick its own model again', async () => {
    const { c, personal, thread, claude } = await setup();
    const own = claude.runs[0]!.env;

    expect(await c.call('threads.setModel', { threadId: thread.id, model: opus, borrowFrom: personal.id })).toMatchObject({ borrowFrom: personal.id, model: opus });
    await send(c, thread.id, 'Go on');
    const borrowed = claude.runs[1]!;
    expect(borrowed.env.ANTHROPIC_AUTH_TOKEN).not.toBe(own.ANTHROPIC_AUTH_TOKEN);
    expect(borrowed.env.CLAUDE_CONFIG_DIR).toBe(own.CLAUDE_CONFIG_DIR);
    // Claude Code resends the whole conversation, so the session carries on under the other account.
    expect(borrowed).toMatchObject({ sessionId: SESSION, prompt: 'Go on' });

    // Changing only the effort keeps the borrowed accounts.
    expect((await c.call('threads.setModel', { threadId: thread.id, model: { ...opus, effort: 'high' } })).borrowFrom).toBe(personal.id);

    expect((await c.call('threads.setModel', { threadId: thread.id, model: opus, borrowFrom: null })).borrowFrom).toBeUndefined();
    await send(c, thread.id, 'Thanks');
    expect(claude.runs[2]!.env.ANTHROPIC_AUTH_TOKEN).toBe(own.ANTHROPIC_AUTH_TOKEN);
  });

  it('offers the other profile’s models, such as ChatGPT that the thread’s own profile lacks', async () => {
    const { c, personal, thread, codexRuns } = await setup();
    await expect(c.call('threads.setModel', { threadId: thread.id, model: codex })).rejects.toThrow();

    await c.call('threads.setModel', { threadId: thread.id, model: codex, borrowFrom: personal.id });
    await send(c, thread.id, 'Now add a test');
    const run = codexRuns.runs[0]!;
    expect(run.sessionId).toBeNull();
    expect(run.prompt).toContain('Fix the login bug');
    expect(run.prompt.endsWith('User message:\nNow add a test')).toBe(true);
  });

  it('starts Codex afresh with the whole conversation when the accounts change under it', async () => {
    const { c, work, personal, codexRuns } = await setup();
    // A thread of Personal on its own ChatGPT account, which then borrows Work's: Work has none, so it borrows back.
    const thread = await c.call('threads.start', { profileId: personal.id, model: codex, text: 'Plan the release' });
    await idle(c, thread.id);
    await send(c, thread.id, 'And the notes');
    expect(codexRuns.runs[1]!.sessionId).toBe(CODEX_SESSION);

    await expect(c.call('threads.setModel', { threadId: thread.id, model: codex, borrowFrom: work.id })).rejects.toThrow();
    const borrowed = await c.call('threads.start', { profileId: work.id, borrowFrom: personal.id, model: codex, text: 'Plan the launch' });
    await idle(c, borrowed.id);
    await send(c, borrowed.id, 'More detail');
    expect(codexRuns.runs[3]!.sessionId).toBe(CODEX_SESSION);

    await c.call('threads.setModel', { threadId: borrowed.id, model: opus, borrowFrom: null });
    await c.call('threads.setModel', { threadId: borrowed.id, model: codex, borrowFrom: personal.id });
    await send(c, borrowed.id, 'Back to Codex');
    const fresh = codexRuns.runs[4]!;
    expect(fresh.sessionId).toBeNull();
    expect(fresh.prompt).toContain('Plan the launch');
    expect(fresh.prompt).toContain('More detail');
  });

  it('keeps a profile that threads borrow from', async () => {
    const { c, personal, thread } = await setup();
    await c.call('threads.setModel', { threadId: thread.id, model: opus, borrowFrom: personal.id });
    await expect(c.call('profiles.delete', { id: personal.id })).rejects.toThrow(/still used by/);
  });
});
