import { afterEach, describe, expect, it } from 'vitest';
import { threadHandle } from '@accio/protocol';
import { FakeHarness, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';
import type { HarnessTurn } from './harness.js';

const opus = { harnessId: 'claudeCode', modelId: 'opus' };

async function mcp(run: HarnessTurn, method: string, params?: unknown) {
  const response = await fetch(run.tools!.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: run.tools!.authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await response.json() as { result: any }).result;
}

const idle = (c: TestClient, threadId: string) => c.waitFor('threads.changed', (ts) => ts.some((t) => t.id === threadId && t.status === 'idle'));

describe('mentioning another thread', () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(() => stop?.());

  it('notes the thread after the message and lets the agent read it by its handle', async () => {
    let handle = '';
    let page = '';
    let newest = '';
    let listed: string[] = [];
    const harness = new FakeHarness(async function* (run, n) {
      if (n === 3) {
        listed = (await mcp(run, 'tools/list')).tools.map((tool: { name: string }) => tool.name);
        page = (await mcp(run, 'tools/call', { name: 'read_thread', arguments: { thread: `@${handle}`, offset: 0, limit: 2 } })).content[0].text;
        newest = (await mcp(run, 'tools/call', { name: 'read_thread', arguments: { thread: handle, limit: 1 } })).content[0].text;
      }
      yield* replyWith(`reply ${n}`);
    });
    const t = await startTestApp({ harness });
    stop = t.stop;
    const c = await t.connect();
    const profile = await c.signedIn('Personal');
    const login = await c.call('threads.start', { profileId: profile.id, model: opus, text: 'Fix the login redirect loop' });
    await idle(c, login.id);
    const other = await c.call('threads.start', { profileId: profile.id, model: opus, text: 'Write the release notes' });
    await idle(c, other.id);
    const named = (await c.call('threads.list', {})).find((thread) => thread.id === login.id)!;
    handle = threadHandle(named);

    c.events.length = 0;
    await c.call('threads.send', { threadId: other.id, text: `What did @${handle} change?` });
    await idle(c, other.id);

    const prompt = harness.runs[2]!.prompt;
    expect(prompt.startsWith(`What did @${handle} change?\n\n[Threads mentioned with @, from accio.`)).toBe(true);
    expect(prompt).toContain(`- @${handle}: "${named.title}" (open`);
    expect(prompt).toContain('read_thread');
    expect(listed).toContain('read_thread');
    expect(page).toContain(`items in "${named.title}" (@${handle})`);
    expect(page).toContain('Fix the login redirect loop');
    expect(page).toContain('reply 1');
    expect(newest).toContain('reply 1');
    expect(newest).toMatch(/call with offset 0 for the ones before/);
    // The transcript keeps what the user typed.
    const sent = (await c.call('threads.transcript', { threadId: other.id })).findLast((item) => item.kind === 'user');
    expect(sent).toMatchObject({ text: `What did @${handle} change?` });
  });

  it('leaves a message without thread mentions as typed', async () => {
    const harness = new FakeHarness((_run, n) => replyWith(`reply ${n}`));
    const t = await startTestApp({ harness });
    stop = t.stop;
    const c = await t.connect();
    const profile = await c.signedIn('Personal');
    const thread = await c.call('threads.start', { profileId: profile.id, model: opus, text: 'Ask @nobody-123456 about it' });
    await idle(c, thread.id);
    expect(harness.runs[0]!.prompt).toBe('Ask @nobody-123456 about it');
  });
});
