import { afterEach, expect, it } from 'vitest';
import type { HarnessTurn } from '../threads/harness.js';
import { FakeHarness, replyWith, toolCall } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';

let app: Awaited<ReturnType<typeof startTestApp>>;
afterEach(async () => { await app?.stop(); });

async function mcp(run: HarnessTurn, method: string, params?: unknown) {
  const response = await fetch(run.tools!.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: run.tools!.authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await response.json() as { result: any }).result;
}

it('works toward a goal across turns accio starts itself, until the harness reports it achieved', async () => {
  const listed: string[][] = [];
  const harness = new FakeHarness(async function* (run, n) {
    listed.push((await mcp(run, 'tools/list')).tools.map((t: { name: string }) => t.name));
    if (n === 3) await mcp(run, 'tools/call', { name: 'finish_goal', arguments: { outcome: 'achieved', summary: 'Tests pass' } });
    yield* toolCall('Bash', { command: 'npm test' });
    yield* replyWith(`turn ${n}`);
  });
  app = await startTestApp({ harness });
  const c = await app.connect(); await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: '/goal make the tests pass' });
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.goal?.status).toBe('achieved');
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.status).toBe('idle');
  expect(harness.runs).toHaveLength(3);
  expect(harness.runs[0]!.prompt).toBe('New goal for this thread: make the tests pass\n\nStart working toward it.');
  expect(harness.runs.slice(1).map((r) => r.prompt)).toEqual(['Continue working toward the goal.', 'Continue working toward the goal.']);
  expect(harness.runs[2]!.resourceInstructions).toContain('Goal for this thread: make the tests pass');
  expect(listed.every((names) => names.includes('finish_goal'))).toBe(true);
  expect((await c.call('threads.list', {}))[0]!.goal).toMatchObject({ objective: 'make the tests pass', turns: 3, detail: 'Tests pass' });
  const users = (await c.call('threads.transcript', { threadId: thread.id })).filter((i) => i.kind === 'user');
  expect(users.map((u) => u.kind === 'user' && [u.text, u.goal])).toEqual([['/goal make the tests pass', undefined], ['Continue working toward the goal.', 'continue'], ['Continue working toward the goal.', 'continue']]);

  // Achieved goals offer no tool; an ordinary message is an ordinary turn.
  await c.call('threads.send', { threadId: thread.id, text: 'thanks' });
  await expect.poll(() => harness.runs.length).toBe(4);
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.status).toBe('idle');
  expect(listed[3]).not.toContain('finish_goal');
  expect(harness.runs).toHaveLength(4);
});

it('pauses when the harness is blocked, resumes from the status bar, and clears', async () => {
  let refused: unknown;
  const harness = new FakeHarness(async function* (run, n) {
    // Without a goal the tool does not exist for the turn.
    if (n === 1) refused = await fetch(run.tools!.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: run.tools!.authorization },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'finish_goal', arguments: { outcome: 'achieved', summary: 'x' } } }) }).then((r) => r.json());
    if (n === 2) await mcp(run, 'tools/call', { name: 'finish_goal', arguments: { outcome: 'blocked', summary: 'Need the API token' } });
    if (n === 4) await mcp(run, 'tools/call', { name: 'finish_goal', arguments: { outcome: 'achieved', summary: 'Done' } });
    if (n !== 5) yield* toolCall('Bash', { command: 'deploy' });
    yield* replyWith(`turn ${n}`);
  });
  app = await startTestApp({ harness });
  const c = await app.connect(); await c.signedIn('Personal');
  const thread = await c.call('threads.start', { profileId: 'personal', text: 'hello' });
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.status).toBe('idle');
  await c.call('threads.send', { threadId: thread.id, text: '/goal deploy' });
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.goal?.status).toBe('paused');
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.status).toBe('idle');
  expect(harness.runs).toHaveLength(2);
  expect((await c.call('threads.list', {}))[0]!.goal?.detail).toBe('Need the API token');
  expect(refused).toMatchObject({ error: { message: 'Unknown tool: finish_goal' } });
  await expect(c.call('threads.goal', { threadId: thread.id, action: 'pause' })).rejects.toThrow('no active goal');
  await c.call('threads.goal', { threadId: thread.id, action: 'resume' });
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.goal?.status).toBe('achieved');
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.status).toBe('idle');
  expect(harness.runs).toHaveLength(4);
  await c.call('threads.send', { threadId: thread.id, text: '/goal clear' });
  expect((await c.call('threads.list', {}))[0]!.goal).toBeUndefined();
  expect(harness.runs).toHaveLength(4);

  // A turn that only talks is a stall: the goal pauses instead of looping.
  await c.call('threads.send', { threadId: thread.id, text: '/goal ship' });
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.goal).toMatchObject({ status: 'paused', detail: 'No progress in the last turn.' });
  await expect.poll(async () => (await c.call('threads.list', {}))[0]!.status).toBe('idle');
  expect(harness.runs).toHaveLength(5);
});
