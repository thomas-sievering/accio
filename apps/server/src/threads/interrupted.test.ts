import { readFile, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HarnessMessage, HarnessTurn } from './harness.js';
import { RESUME_PROMPT } from './thread.js';
import { FakeHarness, SESSION, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';

/** Starts a tool call, then waits until it is aborted, like a long Bash command. */
async function* hangsUntilStopped(run: HarnessTurn): AsyncIterable<HarnessMessage> {
  yield { type: 'system', subtype: 'init', session_id: SESSION };
  yield {
    type: 'assistant',
    parent_tool_use_id: null,
    session_id: SESSION,
    message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'sleep 600' } }] },
  };
  await new Promise<void>((resolve) => run.signal.addEventListener('abort', () => resolve(), { once: true }));
}

const statusIs = (c: TestClient, id: string, status: string) =>
  c.waitFor('threads.changed', (list) => list.some((t) => t.id === id && t.status === status));

async function setup(harness: FakeHarness, home?: string) {
  const t = await startTestApp({ harness }, home);
  const c = await t.connect();
  return { t, c };
}

describe('interrupted turns', () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(() => stop?.());

  it('stops a running turn, marks it interrupted, and resumes it on the same session', async () => {
    const harness = new FakeHarness((run, n) => (n === 1 ? hangsUntilStopped(run) : replyWith('picked up')));
    const { t, c } = await setup(harness);
    stop = t.stop;
    const folder = join(t.home, 'repo');
    await mkdir(folder);
    await c.signedIn('Personal');
    const checkout = await c.call('checkouts.add', { path: folder, profileId: 'personal' });
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'run the long thing' });
    await c.waitFor('thread.item', (e) => e.item.kind === 'tool');
    await expect(c.call('threads.resume', { threadId: thread.id })).rejects.toThrow(/Only an interrupted/);

    await c.call('threads.stop', { threadId: thread.id });
    await statusIs(c, thread.id, 'interrupted');
    const afterStop = await c.call('threads.transcript', { threadId: thread.id });
    expect(afterStop.find((i) => i.kind === 'tool')).toMatchObject({ status: 'interrupted' });
    expect(afterStop.at(-1)).toMatchObject({ kind: 'notice', text: 'Stopped.' });

    c.events.length = 0;
    await c.call('threads.resume', { threadId: thread.id });
    await statusIs(c, thread.id, 'idle');
    expect(harness.runs[1]).toMatchObject({ prompt: RESUME_PROMPT, sessionId: SESSION });
    const items = await c.call('threads.transcript', { threadId: thread.id });
    expect(items.filter((i) => i.kind === 'user').at(-1)).toMatchObject({ resume: true });
    expect(items.at(-1)).toMatchObject({ kind: 'assistant', text: 'picked up' });
  });

  it('marks a turn that was running when accio stopped as interrupted on the next start', async () => {
    const first = await setup(new FakeHarness());
    const home = first.t.home;
    const folder = join(home, 'repo');
    await mkdir(folder);
    await first.c.signedIn('Personal');
    const checkout = await first.c.call('checkouts.add', { path: folder, profileId: 'personal' });
    const thread = await first.c.call('threads.start', { checkoutId: checkout.id, text: 'deploy' });
    await statusIs(first.c, thread.id, 'idle');
    await first.t.stop({ keepHome: true });

    // What a crash mid-turn leaves on disk: the thread still running, a tool still in flight.
    const threadsFile = join(home, 'threads.json');
    const stored = JSON.parse(await readFile(threadsFile, 'utf8'));
    stored[0].status = 'running';
    stored[0].sessionId = SESSION;
    await writeFile(threadsFile, JSON.stringify(stored));
    await mkdir(join(home, 'transcripts'), { recursive: true });
    await writeFile(
      join(home, 'transcripts', `${thread.id}.json`),
      JSON.stringify([
        { kind: 'user', id: 't1:u', turnId: 't1', text: 'deploy', at: 'x' },
        { kind: 'tool', id: 'tu1', turnId: 't1', name: 'Bash', summary: 'deploy.sh', status: 'running' },
      ]),
    );

    const harness = new FakeHarness();
    const second = await setup(harness, home);
    stop = second.t.stop;
    const [after] = await second.c.call('threads.list', {});
    expect(after?.status).toBe('interrupted');
    const items = await second.c.call('threads.transcript', { threadId: thread.id });
    expect(items[1]).toMatchObject({ kind: 'tool', status: 'interrupted' });
    expect(items[2]).toMatchObject({ kind: 'notice', text: expect.stringMatching(/accio stopped/) });
    // Nothing continues on its own.
    expect(harness.runs).toHaveLength(0);

    await second.c.call('threads.resume', { threadId: thread.id });
    await statusIs(second.c, thread.id, 'idle');
    expect(harness.runs[0]).toMatchObject({ prompt: RESUME_PROMPT, sessionId: SESSION });
  });
});
