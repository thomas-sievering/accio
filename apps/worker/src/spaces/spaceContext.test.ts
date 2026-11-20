import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '../git.js';
import { FakeHarness, replyWith } from '../testing/fakeHarness.js';
import { fetchFrom, forgetFetchFrom, initRepo } from '../testing/gitRepo.js';
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
  afterEach(async () => { forgetFetchFrom(); await t?.stop(); t = undefined; await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

  it('names the space and lists the other projects with their checkout and branch, or that they are not available on this machine', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'accio-space-')));
    const harness = new FakeHarness();
    t = await startTestApp({ harness });
    const c = await t.signedIn('Personal');
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    const api = join(root, 'hrc_api');
    await checkout(c, api, 'github.com/me/hrc_api', 'feature/login');
    // hrc_web is known to no machine, and local:elsewhere is a folder without a remote on another machine.
    await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${mcp.projectId}`, 'github.com/me/hrc_api', 'github.com/me/hrc_web', 'local:elsewhere'] });

    const thread = await c.call('threads.start', { checkoutId: mcp.id, text: 'hello' });
    await idle(c, thread.id);

    const instructions = harness.runs[0]!.resourceInstructions!;
    expect(instructions).toContain('# Space: hrc');
    expect(instructions).toContain(`- hrc_api: ${api} (branch feature/login)`);
    expect(instructions).toContain("- hrc_web: not available on this machine (no machine that has it is online, so its profile isn't known)");
    expect(instructions).toContain('- local:elsewhere: not available on this machine (it has no remote to clone it from)');
    expect(instructions).not.toContain('hrc_mcp');
  });

  it('clones a missing sibling in the background, listing it as not on this machine yet until it is there', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'accio-space-')));
    const harness = new FakeHarness();
    t = await startTestApp({ harness });
    const c = await t.signedIn('Personal');
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    // This machine knows hrc_api, but its checkout was deleted; the clone fetches from a bare copy.
    const gone = join(root, 'hrc_api');
    await checkout(c, gone, 'github.com/me/hrc_api');
    await git(root, 'clone', '--quiet', '--bare', gone, `${gone}.git`);
    await rm(gone, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    fetchFrom(`${gone}.git`, 'https://github.com/me/hrc_api.git');
    const folder = join(root, 'personal');
    await c.call('machines.setProfileFolders', { machineId: (await c.thisMachine()).id, profileId: 'personal', folders: [folder] });
    await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${mcp.projectId}`, 'github.com/me/hrc_api'] });

    const thread = await c.call('threads.start', { checkoutId: mcp.id, text: 'hello' });
    await idle(c, thread.id);
    expect(harness.runs[0]!.resourceInstructions).toContain('- hrc_api: not on this machine yet');

    const cloned = join(folder, 'hrc_api');
    await c.waitFor('projects.changed', (state) => state.checkouts.some((checkout) => checkout.path === cloned), 10_000);
    c.events.length = 0;
    await c.call('threads.send', { threadId: thread.id, text: 'again' });
    await idle(c, thread.id);
    expect(harness.runs[1]!.resourceInstructions).toContain(`- hrc_api: ${cloned} (branch main)`);
  });

  it('gives no section outside a space, and follows the space from the next turn', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'accio-space-')));
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
    expect(harness.runs[1]!.resourceInstructions).toContain('- hrc_api: not available on this machine');

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
    root = await realpath(await mkdtemp(join(tmpdir(), 'accio-space-')));
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

  it('lists a checkout that is still there when an earlier one of the same project was deleted', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'accio-space-')));
    const harness = new FakeHarness();
    t = await startTestApp({ harness });
    const c = await t.signedIn('Personal');
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    const gone = join(root, 'hrc_api'), kept = join(root, 'hrc_api-2');
    await checkout(c, gone, 'github.com/me/hrc_api');
    await checkout(c, kept, 'github.com/me/hrc_api', 'feature/login');
    await rm(gone, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${mcp.projectId}`, 'github.com/me/hrc_api'] });
    const thread = await c.call('threads.start', { checkoutId: mcp.id, text: 'hello' });
    await idle(c, thread.id);
    expect(harness.runs[0]!.resourceInstructions).toContain(`- hrc_api: ${kept} (branch feature/login)`);
  });
});

describe('the home part of the Space section', () => {
  let t: Awaited<ReturnType<typeof startTestApp>> | undefined;
  let root: string;
  afterEach(async () => { forgetFetchFrom(); await t?.stop(); t = undefined; await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

  /** A space hrc with the home hrc_home (whose AGENTS.md says `agents`, when given) and the project hrc_mcp. */
  async function hrcSpace(agents?: string) {
    root = await realpath(await mkdtemp(join(tmpdir(), 'accio-space-')));
    const harness = new FakeHarness();
    t = await startTestApp({ harness });
    const c = await t.signedIn('Personal');
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    const homePath = join(root, 'hrc_home');
    const home = await checkout(c, homePath, 'github.com/me/hrc_home');
    if (agents !== undefined) await writeFile(join(homePath, 'AGENTS.md'), agents);
    await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${mcp.projectId}`, 'github.com/me/hrc_home'], homeProjectKey: 'github.com/me/hrc_home' });
    return { harness, c, mcp, home, homePath };
  }

  async function turn(c: TestClient, checkoutId: string, text = 'hello') {
    c.events.length = 0;
    const thread = await c.call('threads.start', { checkoutId, text });
    await idle(c, thread.id);
    return thread;
  }

  it("gives the home's name, checkout path and AGENTS.md as space-wide context that the project's own instructions override", async () => {
    const { harness, c, mcp, homePath } = await hrcSpace('Deploy with ./ship.sh.\n');
    await turn(c, mcp.id);

    const instructions = harness.runs[0]!.resourceInstructions!;
    expect(instructions).toContain('## Home: hrc_home');
    expect(instructions).toContain(`${homePath} (branch main)`);
    expect(instructions).toContain('Deploy with ./ship.sh.');
    expect(instructions).toMatch(/space-wide/);
    expect(instructions).toMatch(/this project's own instructions win/);
    // The home comes before the list of the other projects.
    expect(instructions.indexOf('Deploy with ./ship.sh.')).toBeLessThan(instructions.indexOf('## Other projects in the space'));
  });

  it("reads the home's AGENTS.md again on every turn", async () => {
    const { harness, c, mcp, homePath } = await hrcSpace('Deploy with ./ship.sh.\n');
    const thread = await turn(c, mcp.id);
    await writeFile(join(homePath, 'AGENTS.md'), 'Deploy with ./release.sh.\n');
    c.events.length = 0;
    await c.call('threads.send', { threadId: thread.id, text: 'again' });
    await idle(c, thread.id);

    expect(harness.runs[1]!.resourceInstructions).toContain('Deploy with ./release.sh.');
    expect(harness.runs[1]!.resourceInstructions).not.toContain('./ship.sh');
  });

  it('cuts an AGENTS.md over 16 KB and points to the full file', async () => {
    const { harness, c, mcp, homePath } = await hrcSpace(`${'a'.repeat(16 * 1024)}THE END\n`);
    await turn(c, mcp.id);

    const instructions = harness.runs[0]!.resourceInstructions!;
    expect(instructions).toContain('a'.repeat(1000));
    expect(instructions).not.toContain('THE END');
    expect(instructions).toContain(join(homePath, 'AGENTS.md'));
    expect(instructions).toMatch(/Cut at 16 KB/);
  });

  it("gives a thread in the home the other projects but not the home's AGENTS.md again", async () => {
    // A local home, so its thread needs no fetch.
    root = await realpath(await mkdtemp(join(tmpdir(), 'accio-space-')));
    const harness = new FakeHarness();
    t = await startTestApp({ harness });
    const c = await t.signedIn('Personal');
    const home = await localProject(c, join(root, 'hrc_home'));
    await writeFile(join(root, 'hrc_home', 'AGENTS.md'), 'Deploy with ./ship.sh.\n');
    const api = join(root, 'hrc_api');
    await checkout(c, api, 'github.com/me/hrc_api');
    await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${home.projectId}`, 'github.com/me/hrc_api'], homeProjectKey: `local:${home.projectId}` });
    await turn(c, home.id);

    const instructions = harness.runs[0]!.resourceInstructions!;
    expect(instructions).toContain('# Space: hrc');
    expect(instructions).toContain(`- hrc_api: ${api} (branch main)`);
    expect(instructions).not.toContain('./ship.sh');
  });

  it('leaves out the AGENTS.md when the home has none, and the home part when the space has no home', async () => {
    const { harness, c, mcp, homePath } = await hrcSpace();
    await turn(c, mcp.id);
    expect(harness.runs[0]!.resourceInstructions).toContain(`${homePath} (branch main)`);
    expect(harness.runs[0]!.resourceInstructions).not.toMatch(/space-wide/);

    const [space] = await c.call('spaces.list', {});
    await c.call('spaces.save', { id: space!.id, name: 'hrc', projectKeys: space!.projectKeys });
    await turn(c, mcp.id);
    expect(harness.runs[1]!.resourceInstructions).toContain('# Space: hrc');
    expect(harness.runs[1]!.resourceInstructions).not.toContain('## Home');
  });

  /** The space hrc whose home hrc_home this machine knows, but whose checkout was deleted. */
  async function goneHome(agents: string, { fetchable }: { fetchable: boolean }) {
    const { harness, c, mcp, homePath } = await hrcSpace(agents);
    await git(homePath, 'add', 'AGENTS.md');
    await git(homePath, 'commit', '--quiet', '-m', 'agents');
    if (fetchable) await git(root, 'clone', '--quiet', '--bare', homePath, `${homePath}.git`);
    await rm(homePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    // Without a bare copy, the clone fails as one from a repository that is gone would.
    fetchFrom(`${homePath}.git`, 'https://github.com/me/hrc_home.git');
    const folder = join(root, 'personal');
    await c.call('machines.setProfileFolders', { machineId: (await c.thisMachine()).id, profileId: 'personal', folders: [folder] });
    return { harness, c, mcp, cloned: join(folder, 'hrc_home') };
  }

  it('clones a home missing here before the first turn, which gets its AGENTS.md', async () => {
    const { harness, c, mcp, cloned } = await goneHome('Deploy with ./ship.sh.\n', { fetchable: true });
    await turn(c, mcp.id);

    const instructions = harness.runs[0]!.resourceInstructions!;
    expect(instructions).toContain(`The space's home is hrc_home, checked out at ${cloned} (branch main).`);
    expect(instructions).toContain('Deploy with ./ship.sh.');
    expect(instructions).toContain(`- hrc_home: ${cloned} (branch main)`);
  });

  it("notes in the section that the home couldn't be had here, and runs the turn anyway", async () => {
    const { harness, c, mcp } = await goneHome('Deploy with ./ship.sh.\n', { fetchable: false });
    await turn(c, mcp.id);
    expect(harness.runs[0]!.resourceInstructions).toMatch(/The space's home, hrc_home, is not available on this machine \(could not clone github\.com\/me\/hrc_home[^)]*\), so its space-wide instructions are missing from this turn\./);

    // One the hub knows of but no machine has recorded can't be cloned: its profile isn't known.
    const [space] = await c.call('spaces.list', {});
    await c.call('spaces.save', { id: space!.id, name: 'hrc', projectKeys: [...space!.projectKeys, 'github.com/me/hrc_wiki'], homeProjectKey: 'github.com/me/hrc_wiki' });
    await turn(c, mcp.id);
    expect(harness.runs[1]!.resourceInstructions).toContain("The space's home, hrc_wiki, is not available on this machine (no machine that has it is online, so its profile isn't known), so its space-wide instructions are missing from this turn.");
  });
});
