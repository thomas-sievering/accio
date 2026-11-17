import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from '../git.js';
import type { GhRunner } from '../github/accounts.js';
import { FakeHarness } from '../testing/fakeHarness.js';
import { fetchFrom, forgetFetchFrom } from '../testing/gitRepo.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';

/** A folder without a remote: a local project, keyed local:<project id>. */
async function localProject(c: TestClient, folder: string) {
  await mkdir(folder);
  return c.call('checkouts.add', { path: folder, profileId: 'personal' });
}

const idle = (c: TestClient, threadId: string) => c.waitFor('threads.changed', (list) => list.some((t) => t.id === threadId && t.status === 'idle'), 10_000);

// GLOSSARY: Home. "New home…" in Settings → Spaces creates the home from Accio's template.
describe('creating a new home for a space', () => {
  let t: Awaited<ReturnType<typeof startTestApp>> | undefined;
  let root: string;
  afterEach(async () => { forgetFetchFrom(); await t?.stop(); t = undefined; await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

  async function app(github?: GhRunner) {
    root = await mkdtemp(join(tmpdir(), 'accio-new-home-'));
    const harness = new FakeHarness();
    t = await startTestApp({ harness, ...(github ? { github } : {}) });
    const c = await t.signedIn('Personal');
    const { id: machineId } = await c.thisMachine();
    const folder = join(root, 'Personal');
    await c.call('machines.setProfileFolders', { machineId, profileId: 'personal', folders: [folder] });
    return { c, harness, folder, machineId };
  }

  it("creates it from the template in the profile's folder, makes it the space's home and starts its first thread", async () => {
    const { c, harness, folder } = await app();
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    const api = await localProject(c, join(root, 'hrc_api'));
    const keys = [`local:${mcp.projectId}`, `local:${api.projectId}`];

    const created = await c.call('spaces.createHome', { space: { name: 'hrc', projectKeys: keys }, name: 'hrc-home', profileId: 'personal', location: 'folder' });

    const path = join(folder, 'hrc-home');
    expect(created.path).toBe(path);
    const agents = await readFile(join(path, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('# hrc');
    expect(agents).toContain('### hrc_mcp');
    expect(agents).toContain('### hrc_api');
    expect(agents).toContain('[wiki/hrc_mcp.md](wiki/hrc_mcp.md)');
    // Threads in other projects change the home by starting a thread in it, never by editing it.
    expect(agents).toContain('start_thread');
    expect(agents).toMatch(/never edit/i);
    expect(await readFile(join(path, 'CLAUDE.md'), 'utf8')).toContain('AGENTS.md');
    expect(await readFile(join(path, 'GLOSSARY.md'), 'utf8')).toContain('# Glossary');
    expect((await readdir(join(path, 'wiki'))).sort()).toEqual(['README.md', 'hrc_api.md', 'hrc_mcp.md']);
    expect(await readFile(join(path, 'wiki', 'hrc_mcp.md'), 'utf8')).toContain('# hrc_mcp');
    expect(await readdir(join(path, 'docs', 'adr'))).toContain('README.md');
    expect(await readdir(join(path, '.agents', 'skills'))).toContain('README.md');
    await expect(readdir(join(path, '.claude'))).rejects.toThrow();
    // One commit with everything, so the first thread works in a worktree of it.
    expect((await git(path, 'log', '--format=%s')).trim()).toBe('Start the hrc home');
    expect((await git(path, 'status', '--porcelain')).trim()).toBe('');

    const project = (await c.call('projects.get', {})).projects.find((p) => p.name === 'hrc-home')!;
    expect(project).toMatchObject({ profileId: 'personal', repoKey: null });
    const homeKey = `local:${project.id}`;
    expect(await c.call('spaces.list', {})).toEqual([{ id: created.space.id, name: 'hrc', projectKeys: [...keys, homeKey], homeProjectKey: homeKey }]);

    expect(created.thread).toMatchObject({ checkoutId: created.checkoutId, projectId: project.id, profileId: 'personal' });
    await idle(c, created.thread.id);
    const [run] = harness.runs as [typeof harness.runs[number]];
    expect(harness.runs).toHaveLength(1);
    expect(run.prompt).toContain('Space section');
    expect(run.prompt).toContain('hrc_mcp, hrc_api');
    expect(run.prompt).toContain('AGENTS.md');
    expect(run.prompt).toContain('wiki/');
    expect(run.prompt).toContain('GLOSSARY.md');
    expect(run.prompt).toMatch(/ship/i);
    // The home's thread gets the sibling list through its Space section.
    expect(run.resourceInstructions).toContain('# Space: hrc');
    expect(run.resourceInstructions).toContain(`- hrc_mcp: ${join(root, 'hrc_mcp')}`);
  });

  it('keeps the space it was given, adding the home to it', async () => {
    const { c } = await app();
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    const saved = await c.call('spaces.save', { name: 'hrc', projectKeys: [] });

    const created = await c.call('spaces.createHome', { space: { id: saved.id, name: 'hrc renamed', projectKeys: [`local:${mcp.projectId}`] }, name: 'notes', profileId: 'personal', location: 'folder' });
    expect(created.space).toMatchObject({ id: saved.id, name: 'hrc renamed', homeProjectKey: created.space.projectKeys[1] });
    expect(await c.call('spaces.list', {})).toHaveLength(1);
  });

  it('refuses a folder that is already there, and changes nothing', async () => {
    const { c, folder } = await app();
    await mkdir(join(folder, 'hrc-home'), { recursive: true });
    await writeFile(join(folder, 'hrc-home', 'notes.txt'), 'mine');

    await expect(c.call('spaces.createHome', { space: { name: 'hrc', projectKeys: [] }, name: 'hrc-home', profileId: 'personal', location: 'folder' }))
      .rejects.toThrow(`${join(folder, 'hrc-home')} already exists. Choose another name.`);
    expect(await readdir(join(folder, 'hrc-home'))).toEqual(['notes.txt']);
    expect((await c.call('projects.get', {})).projects).toEqual([]);
    expect(await c.call('spaces.list', {})).toEqual([]);
  });

  it("refuses a profile whose threads can't start yet, before creating anything", async () => {
    const { c, folder } = await app();
    await c.call('profiles.save', { name: 'Work' });
    await expect(c.call('spaces.createHome', { space: { name: 'hrc', projectKeys: [] }, name: 'hrc-home', profileId: 'work', location: 'folder' }))
      .rejects.toThrow("The home's first thread can't start in this profile: ");
    await expect(readdir(join(folder, 'hrc-home'))).rejects.toThrow();
    expect(await c.call('spaces.list', {})).toEqual([]);
  });

  it('creates one home when two ask for the same folder at once, keeping it whole', async () => {
    const { c, folder } = await app();
    const ask = () => c.call('spaces.createHome', { space: { name: 'hrc', projectKeys: [] }, name: 'hrc-home', profileId: 'personal', location: 'folder' });
    const [first, second] = await Promise.allSettled([ask(), ask()]);
    const outcomes = [first.status, second.status].sort();
    expect(outcomes).toEqual(['fulfilled', 'rejected']);
    const refused = [first, second].find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason.message).toBe(`${join(folder, 'hrc-home')} already exists. Choose another name.`);
    expect(await readFile(join(folder, 'hrc-home', 'AGENTS.md'), 'utf8')).toContain('# hrc');
    expect((await git(join(folder, 'hrc-home'), 'status', '--porcelain')).trim()).toBe('');
    const created = (first.status === 'fulfilled' ? first : second) as PromiseFulfilledResult<{ thread: { id: string } }>;
    await idle(c, created.value.thread.id);
  });

  it('refuses a project already in another space before creating anything', async () => {
    const { c, folder } = await app();
    const mcp = await localProject(c, join(root, 'hrc_mcp'));
    await c.call('spaces.save', { name: 'agents', projectKeys: [`local:${mcp.projectId}`] });

    await expect(c.call('spaces.createHome', { space: { name: 'hrc', projectKeys: [`local:${mcp.projectId}`] }, name: 'hrc-home', profileId: 'personal', location: 'folder' }))
      .rejects.toThrow('hrc_mcp is already in the space agents');
    await expect(readdir(join(folder, 'hrc-home'))).rejects.toThrow();
  });

  it("creates a new GitHub repo with the profile's GitHub login and pushes the template", async () => {
    let bare = '';
    const calls: { args: string[]; env?: Record<string, string> }[] = [];
    // Stands in for gh: `repo create --source --push` adds origin and pushes, here to a bare copy.
    const gh: GhRunner = async (args, options) => {
      calls.push({ args, env: options?.env });
      if (args[0] === 'auth' && args[1] === 'token') return 'work-token\n';
      if (args[0] === 'repo' && args[1] === 'create') {
        const url = 'https://github.com/me/hrc-home.git';
        bare = join(root, 'hrc-home.git');
        await git(root, 'init', '--quiet', '--bare', '-b', 'main', bare);
        fetchFrom(bare, url);
        await git(options!.cwd!, 'remote', 'add', 'origin', url);
        await git(options!.cwd!, 'push', '--quiet', '-u', 'origin', 'main');
        return `${url}\n`;
      }
      throw new Error(`unexpected gh ${args.join(' ')}`);
    };
    const { c, folder } = await app(gh);
    await chooseGitHub(c, 'me');

    const created = await c.call('spaces.createHome', { space: { name: 'hrc', projectKeys: [] }, name: 'hrc-home', profileId: 'personal', location: 'github' });

    const path = join(folder, 'hrc-home');
    expect(calls.find((call) => call.args[1] === 'create')).toEqual({
      args: ['repo', 'create', 'me/hrc-home', '--private', '--source', path, '--remote', 'origin', '--push'],
      env: { GH_TOKEN: 'work-token' },
    });
    expect((await git(bare, 'log', '--format=%s', 'main')).trim()).toBe('Start the hrc home');
    expect(await git(path, 'config', '--get', 'remote.origin.url')).toBe('https://github.com/me/hrc-home.git');
    // The project's key comes from inspecting the folder, as for any added checkout. Here the URL rewrite
    // that stands in for GitHub hides it, so only the home being this project is checked.
    const project = (await c.call('projects.get', {})).projects.find((p) => p.name === 'hrc-home')!;
    expect(created.space.homeProjectKey).toBe(project.repoKey ?? `local:${project.id}`);
    expect(created.thread.checkoutId).toBe(created.checkoutId);
    await idle(c, created.thread.id);
  });

  it('explains when gh could not create the repo, and leaves no project or home behind', async () => {
    const gh: GhRunner = async (args) => {
      if (args[1] === 'create') throw Object.assign(new Error('failed'), { stderr: 'GraphQL: Name already exists on this account (createRepository)\n' });
      if (args[1] === 'token') return 'token\n';
      throw new Error('unexpected');
    };
    const { c, folder } = await app(gh);
    await chooseGitHub(c, 'me');
    await expect(c.call('spaces.createHome', { space: { name: 'hrc', projectKeys: [] }, name: 'hrc-home', profileId: 'personal', location: 'github' }))
      .rejects.toThrow('Could not create the GitHub repo hrc-home: GraphQL: Name already exists on this account (createRepository)');
    await expect(readdir(join(folder, 'hrc-home'))).rejects.toThrow();
    expect((await c.call('projects.get', {})).projects).toEqual([]);
    expect(await c.call('spaces.list', {})).toEqual([]);
  });

  it("refuses a GitHub repo for a profile without a chosen GitHub account, rather than using gh's active one", async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => { calls.push(args); throw new Error('unexpected'); };
    const { c, folder } = await app(gh);
    await expect(c.call('spaces.createHome', { space: { name: 'hrc', projectKeys: [] }, name: 'hrc-home', profileId: 'personal', location: 'github' }))
      .rejects.toThrow("Choose a GitHub account for this profile in Settings / Profiles first. The home's repo is created under it.");
    expect(calls.filter((args) => args[0] === 'repo')).toEqual([]);
    await expect(readdir(join(folder, 'hrc-home'))).rejects.toThrow();
    expect(await c.call('spaces.list', {})).toEqual([]);
  });
});

/** GLOSSARY: GitHub account. Chooses the personal profile's, for every machine. */
async function chooseGitHub(c: Awaited<ReturnType<typeof app>>['c'], login: string) {
  const personal = (await c.call('profiles.list', {})).find((p) => p.id === 'personal')!;
  await c.call('profiles.save', { id: personal.id, name: personal.name, githubLogin: login });
}
