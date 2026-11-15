import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProfileView, ThreadView } from '@accio/protocol';
import { git } from '../git.js';
import { FakeHarness, replyWith } from '../testing/fakeHarness.js';
import { fetchFrom, forgetFetchFrom, initRepoWithOrigin } from '../testing/gitRepo.js';
import { callAccioTools, startTestApp, type TestClient } from '../testing/testApp.js';

/** A folder without a remote: a local project, keyed local:<project id>, whose threads need no fetch. */
async function localProject(c: TestClient, folder: string, profileId = 'personal') {
  await mkdir(folder);
  return c.call('checkouts.add', { path: folder, profileId });
}

/**
 * A project keyed by `repoKey`, such as github.com/me/hrc_api, whose checkout here fetches from a
 * bare copy beside it: a local origin alone would give no repository key.
 */
async function keyedProject(c: TestClient, folder: string, repoKey: string, profile: ProfileView) {
  const bare = `${folder}.git`, url = `https://${repoKey}.git`;
  await initRepoWithOrigin(folder, bare, { 'README.md': `# ${repoKey}\n` });
  await git(folder, 'remote', 'set-url', 'origin', url);
  const added = await c.call('checkouts.add', { path: folder, profileId: profile.id });
  await git(folder, 'config', `url.${bare.replaceAll('\\', '/')}.insteadOf`, url);
  return added;
}

const idle = (c: TestClient, threadId: string) => c.waitFor('threads.changed', (list) => list.some((t) => t.id === threadId && t.status === 'idle'), 10_000);

/** A harness whose first thread calls start_thread with `args`, keeping what the tool answered. */
function starting(args: () => Record<string, unknown>) {
  const answers: { text: string; isError: boolean }[] = [];
  const harness = new FakeHarness(async function* (run) {
    if (run.tools && run.prompt === 'start it') {
      const result = await callAccioTools(run, 'tools/call', { name: 'start_thread', arguments: { message: 'Fix the login page', ...args() } });
      answers.push({ text: result.content[0].text, isError: !!result.isError });
    }
    yield* replyWith('done');
  });
  return { harness, answers };
}

describe('start_thread in another project of the space', () => {
  let t: Awaited<ReturnType<typeof startTestApp>> | undefined;
  let root: string;
  afterEach(async () => { forgetFetchFrom(); await t?.stop(); t = undefined; await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

  async function app(args: () => Record<string, unknown>) {
    root = await mkdtemp(join(tmpdir(), 'accio-sibling-'));
    const { harness, answers } = starting(args);
    t = await startTestApp({ harness });
    const c = await t.signedIn('Personal');
    const work = await c.signedIn('Work');
    return { c, work, harness, answers };
  }

  async function startedBy(c: TestClient, caller: ThreadView) {
    await idle(c, caller.id);
    return (await c.call('threads.list', {})).filter((thread) => thread.id !== caller.id);
  }

  it('starts it in the sibling\'s checkout, under the sibling\'s profile', async () => {
    const { c, work, harness, answers } = await app(() => ({ project: 'hrc_api' }));
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    const api = await keyedProject(c, join(root, 'hrc_api'), 'github.com/me/hrc_api', work);
    await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${mcp.projectId}`, 'github.com/me/hrc_api'] });

    const caller = await c.call('threads.start', { checkoutId: mcp.id, text: 'start it' });
    const [child] = await startedBy(c, caller);
    expect(answers[0]).toEqual({ text: `Started thread "${child!.title}" (${child!.id}) in hrc_api on this machine. It runs on its own and shows in the thread list. To be woken when it finishes or opens a PR, call wait_for and end your turn.`, isError: false });
    expect(child).toMatchObject({ checkoutId: api.id, projectId: api.projectId, profileId: work.id });
    await idle(c, child!.id);
    expect(harness.runs.find((run) => run.prompt === 'Fix the login page')?.cwd).not.toBe(harness.runs[0]!.cwd);
  });

  it('starts it in the home, named by its key', async () => {
    let homeKey = '';
    const { c, answers } = await app(() => ({ project: homeKey }));
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    const home = await localProject(c, join(root, 'hrc'));
    homeKey = `local:${home.projectId}`;
    await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${mcp.projectId}`, homeKey], homeProjectKey: homeKey });

    const caller = await c.call('threads.start', { checkoutId: mcp.id, text: 'start it' });
    const [child] = await startedBy(c, caller);
    expect(answers[0]!.text).toContain(' in hrc on this machine.');
    expect(child).toMatchObject({ checkoutId: home.id, profileId: 'personal' });
  });

  it('refuses a project outside the space, listing the ones it can start a thread in', async () => {
    const { c, answers } = await app(() => ({ project: 'notes' }));
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    const home = await localProject(c, join(root, 'hrc'));
    await localProject(c, join(root, 'notes'));
    const homeKey = `local:${home.projectId}`;
    await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${mcp.projectId}`, homeKey, 'github.com/me/hrc_api'], homeProjectKey: homeKey });

    const caller = await c.call('threads.start', { checkoutId: mcp.id, text: 'start it' });
    expect(await startedBy(c, caller)).toEqual([]);
    expect(answers[0]).toEqual({ isError: true, text: 'notes is not a project in the space "hrc". Projects you can start a thread in: hrc_mcp (this project), hrc (home), hrc_api.' });
  });

  it("refuses any project when the thread's project is in no space", async () => {
    const { c, answers } = await app(() => ({ project: 'notes' }));
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    await localProject(c, join(root, 'notes'));

    const caller = await c.call('threads.start', { checkoutId: mcp.id, text: 'start it' });
    expect(await startedBy(c, caller)).toEqual([]);
    expect(answers[0]).toEqual({ isError: true, text: "This thread's project is in no space, so it can only start threads in its own project. Leave out project." });
  });

  it("clones a sibling missing here into its profile's folder, then starts in it", async () => {
    const { c, work, answers } = await app(() => ({ project: 'hrc_web' }));
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    // This machine knows hrc_web under the Work profile, but its checkout was deleted.
    const gone = join(root, 'hrc_web');
    const web = await keyedProject(c, gone, 'github.com/me/hrc_web', work);
    await rm(gone, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    fetchFrom(`${gone}.git`, 'https://github.com/me/hrc_web.git');
    const folder = join(root, 'work');
    await c.call('machines.setProfileFolders', { machineId: (await c.thisMachine()).id, profileId: work.id, folders: [folder] });
    await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${mcp.projectId}`, 'github.com/me/hrc_web'] });

    const caller = await c.call('threads.start', { checkoutId: mcp.id, text: 'start it' });
    const [child] = await startedBy(c, caller);
    expect(answers[0]!.text).toContain(' in hrc_web on this machine.');
    expect(child).toMatchObject({ projectId: web.projectId, profileId: work.id });
    const { checkouts } = await c.call('projects.get', {});
    expect(checkouts.find((checkout) => checkout.id === child!.checkoutId)?.path).toBe(join(folder, 'hrc_web'));
  });

  it('says when the sibling is not available on this machine', async () => {
    const { c, answers } = await app(() => ({ project: 'hrc_web' }));
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${mcp.projectId}`, 'github.com/me/hrc_web'] });

    const caller = await c.call('threads.start', { checkoutId: mcp.id, text: 'start it' });
    expect(await startedBy(c, caller)).toEqual([]);
    expect(answers[0]).toEqual({ isError: true, text: "hrc_web is not available on this machine: no machine that has it is online, so its profile isn't known." });
  });
});
