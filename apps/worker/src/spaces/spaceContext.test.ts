import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '../git.js';
import { FakeHarness, replyWith } from '../testing/fakeHarness.js';
import { initRepo } from '../testing/gitRepo.js';
import { callAccioTools, startTestApp, type TestClient } from '../testing/testApp.js';

/** A repository on this machine whose remote names `repoKey`, such as github.com/me/hrc_mcp. */
/** A folder without a remote: a local project, keyed local:<project id>, whose threads need no fetch. */
async function localProject(c: TestClient, folder: string) {
  await mkdir(folder);
  return c.call('checkouts.add', { path: folder, profileId: 'personal' });
}

async function checkout(c: TestClient, folder: string, repoKey: string, branch = 'main') {
  await initRepo(folder, { 'README.md': `# ${repoKey}\n` });
  await git(folder, 'remote', 'add', 'origin', `https://${repoKey}.git`);
  if (branch !== 'main') await git(folder, 'checkout', '--quiet', '-b', branch);
  return c.call('checkouts.add', { path: folder, profileId: 'personal' });
}

const idle = (c: TestClient, threadId: string) => c.waitFor('threads.changed', (list) => list.some((t) => t.id === threadId && t.status === 'idle'));

describe('the Space section of a thread in a space', () => {
  let t: Awaited<ReturnType<typeof startTestApp>> | undefined;
  let root: string;
  afterEach(async () => { await t?.stop(); t = undefined; await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

  it('names the space and lists the other projects with their checkout and branch, or that they are not on this machine yet', async () => {
    root = await mkdtemp(join(tmpdir(), 'accio-space-'));
    const harness = new FakeHarness();
    t = await startTestApp({ harness });
    const c = await t.signedIn('Personal');
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    const api = join(root, 'hrc_api');
    await checkout(c, api, 'github.com/me/hrc_api', 'feature/login');
    await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${mcp.projectId}`, 'github.com/me/hrc_api', 'github.com/me/hrc_web'] });

    const thread = await c.call('threads.start', { checkoutId: mcp.id, text: 'hello' });
    await idle(c, thread.id);

    const instructions = harness.runs[0]!.resourceInstructions!;
    expect(instructions).toContain('# Space: hrc');
    expect(instructions).toContain(`- hrc_api: ${api} (branch feature/login)`);
    expect(instructions).toContain('- hrc_web: not on this machine yet');
    expect(instructions).not.toContain('hrc_mcp');
  });

  it('gives no section outside a space, and follows the space from the next turn', async () => {
    root = await mkdtemp(join(tmpdir(), 'accio-space-'));
    const harness = new FakeHarness();
    t = await startTestApp({ harness });
    const c = await t.signedIn('Personal');
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    const thread = await c.call('threads.start', { checkoutId: mcp.id, text: 'hello' });
    await idle(c, thread.id);
    expect(harness.runs[0]!.resourceInstructions ?? '').not.toContain('Space');

    const space = await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${mcp.projectId}`, 'github.com/me/hrc_api'] });
    c.events.length = 0;
    await c.call('threads.send', { threadId: thread.id, text: 'again' });
    await idle(c, thread.id);
    expect(harness.runs[1]!.resourceInstructions).toContain('- hrc_api: not on this machine yet');

    // A checkout added since the last turn shows up in the next one.
    const api = join(root, 'hrc_api');
    await checkout(c, api, 'github.com/me/hrc_api');
    c.events.length = 0;
    await c.call('threads.send', { threadId: thread.id, text: 'and again' });
    await idle(c, thread.id);
    expect(harness.runs[2]!.resourceInstructions).toContain(`- hrc_api: ${api} (branch main)`);

    await c.call('spaces.save', { id: space.id, name: 'hrc', projectKeys: ['github.com/me/hrc_api'] });
    c.events.length = 0;
    await c.call('threads.send', { threadId: thread.id, text: 'once more' });
    await idle(c, thread.id);
    expect(harness.runs[3]!.resourceInstructions ?? '').not.toContain('Space');
  });

  it('gives sub-agents the same section as their thread', async () => {
    root = await mkdtemp(join(tmpdir(), 'accio-space-'));
    const harness = new FakeHarness(async function* (run) {
      // The thread asks for a sub-agent; the sub-agent's own run has no accio tools.
      if (run.tools) await callAccioTools(run, 'tools/call', { name: 'agent', arguments: { description: 'Read hrc_api', prompt: 'Summarise hrc_api.' } });
      yield* replyWith(run.tools ? 'done' : 'hrc_api is an API.', run.tools ? undefined : 'sub');
    });
    t = await startTestApp({ harness });
    const c = await t.signedIn('Personal');
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${mcp.projectId}`, 'github.com/me/hrc_api'] });
    const thread = await c.call('threads.start', { checkoutId: mcp.id, text: 'hello' });
    await idle(c, thread.id);

    const [parent, sub] = harness.runs;
    expect(sub!.prompt).toBe('Summarise hrc_api.');
    expect(sub!.resourceInstructions).toContain('# Space: hrc');
    expect(sub!.resourceInstructions).toBe(parent!.resourceInstructions);
  });
});
