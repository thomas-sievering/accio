import { afterEach, expect, it } from 'vitest';
import type { ToolAccess } from '../tools/tools.js';
import { FakeHarness, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';

let app: Awaited<ReturnType<typeof startTestApp>> | undefined;
afterEach(async () => { await app?.stop(); app = undefined; });

async function needsYou(access: ToolAccess, args: Record<string, unknown>) {
  const response = await fetch(access.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: access.authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'needs_you', arguments: args } }) });
  return (JSON.parse(await response.text()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
}

const view = async (client: TestClient, id: string) => (await client.call('threads.list', {})).find((t) => t.id === id);
const actions = async (client: TestClient, id: string) => (await client.call('threads.transcript', { threadId: id })).filter((i) => i.kind === 'userAction');

it('puts a running thread in the inbox until the agent marks the step done, and ends a pending one with its turn', async () => {
  const gates: Record<number, PromiseWithResolvers<void>> = { 1: Promise.withResolvers(), 2: Promise.withResolvers() };
  const results: Record<string, unknown> = {};
  const harness = new FakeHarness(async function* (run, n) {
    results[`ask${n}`] = await needsYou(run.tools!, { action: 'Approve the sign-in in Authenticator (14)', detail: 'On your phone' });
    if (n === 1) results.empty = await needsYou(run.tools!, {});
    await gates[n]!.promise;
    if (n === 1) results.done = await needsYou(run.tools!, { done: true });
    yield* replyWith('ok');
  });
  app = await startTestApp({ harness });
  const client = await app.connect();
  const profile = await client.signedIn('Personal');
  const thread = await client.call('threads.start', { profileId: profile.id, text: 'sign in' });

  await expect.poll(async () => (await view(client, thread.id))?.needsYou, { timeout: 10_000 }).toBe('action');
  expect(await actions(client, thread.id)).toMatchObject([{ action: 'Approve the sign-in in Authenticator (14)', detail: 'On your phone', status: 'pending' }]);
  expect(results.empty).toMatchObject({ isError: true });
  gates[1]!.resolve();
  await expect.poll(async () => (await view(client, thread.id))?.status, { timeout: 10_000 }).toBe('idle');
  expect((await view(client, thread.id))?.needsYou).toBeUndefined();
  expect(await actions(client, thread.id)).toMatchObject([{ status: 'done' }]);

  await client.call('threads.send', { threadId: thread.id, text: 'again' });
  await expect.poll(async () => (await view(client, thread.id))?.needsYou, { timeout: 10_000 }).toBe('action');
  gates[2]!.resolve();
  await expect.poll(async () => (await view(client, thread.id))?.status, { timeout: 10_000 }).toBe('idle');
  expect((await view(client, thread.id))?.needsYou).toBeUndefined();
  expect((await actions(client, thread.id)).map((i) => i.kind === 'userAction' && i.status)).toEqual(['done', 'ended']);
}, 30_000);

it('ends the step when the user writes to the thread', async () => {
  const gate = Promise.withResolvers<void>();
  const harness = new FakeHarness(async function* (run, n) {
    if (n === 1) { await needsYou(run.tools!, { action: 'Sign in in the browser window' }); await gate.promise; }
    yield* replyWith('ok');
  });
  app = await startTestApp({ harness });
  const client = await app.connect();
  const profile = await client.signedIn('Personal');
  const thread = await client.call('threads.start', { profileId: profile.id, text: 'sign in' });
  await expect.poll(async () => (await view(client, thread.id))?.needsYou, { timeout: 10_000 }).toBe('action');
  await client.call('threads.send', { threadId: thread.id, text: 'Done: Sign in in the browser window', mode: 'queue' });
  await expect.poll(async () => (await view(client, thread.id))?.needsYou, { timeout: 10_000 }).toBeUndefined();
  expect(await actions(client, thread.id)).toMatchObject([{ status: 'done' }]);
  gate.resolve();
}, 30_000);
