import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { HarnessTurn } from '../threads/harness.js';
import { FakeHarness, replyWith } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';

let app: Awaited<ReturnType<typeof startTestApp>>;
afterEach(async () => { await app?.stop(); });

async function mcp(run: HarnessTurn, method: string, params?: unknown) {
  const response = await fetch(run.tools!.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: run.tools!.authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await response.json() as { result?: any; error?: any });
}

it('a project setup thread finds the app commands and saves them through project_settings; other threads cannot', async () => {
  const listed: string[][] = [];
  const harness = new FakeHarness(async function* (run, n) {
    listed.push((await mcp(run, 'tools/list')).result.tools.map((t: { name: string }) => t.name));
    if (n === 1) await mcp(run, 'tools/call', { name: 'project_settings', arguments: { startCommand: 'pnpm worker', setupCommand: 'pnpm install' } });
    yield* replyWith(`turn ${n}`);
  });
  app = await startTestApp({ harness });
  const c = await app.connect(); await c.signedIn('Personal');
  const folder = join(app.home, 'repo');
  await mkdir(folder);
  const checkout = await c.call('checkouts.add', { path: folder, profileId: 'personal' });

  const thread = await c.call('threads.setUpProject', { projectId: checkout.projectId });
  expect(thread).toMatchObject({ projectSetup: true, title: 'Set up repo app', checkoutId: checkout.id });
  expect(harness.runs[0]!.prompt).toContain('project_settings');
  expect(harness.runs[0]!.prompt).toContain('PORT');
  await expect.poll(async () => (await c.call('projects.get', {})).projects[0]).toMatchObject({ startCommand: 'pnpm worker', setupCommand: 'pnpm install' });
  expect(listed[0]).toContain('project_settings');

  // An ordinary thread in the same project is not offered the tool.
  const other = await c.call('threads.start', { checkoutId: checkout.id, text: 'hello' });
  await expect.poll(() => listed.length).toBe(2);
  expect(listed[1]).not.toContain('project_settings');
  await expect.poll(async () => (await c.call('threads.list', {})).find((t) => t.id === other.id)?.status).toBe('idle');
});
