import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp } from '../testing/testApp.js';

function gitRepo(dir: string, remote?: string) {
  execFileSync('git', ['init', '-q', dir]);
  if (remote) execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', remote]);
}

describe('projects slice', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(() => t?.stop());

  it('adds a repo folder as a project under the suggested profile and groups a second checkout into it', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const repos = join(t.home, 'repos');
    const work = join(t.home, 'work');
    await mkdir(join(repos, 'accio', 'src'), { recursive: true });
    await mkdir(join(work, 'accio-copy'), { recursive: true });
    gitRepo(join(repos, 'accio'), 'git@github.com:me/accio.git');
    gitRepo(join(work, 'accio-copy'), 'https://github.com/me/accio');

    await c.call('profiles.save', { name: 'Personal' });
    await c.call('profiles.save', { name: 'Work' });
    const { id: machineId } = await c.call('machine.get', {});
    await c.call('machines.setProfileFolders', { machineId, profileId: 'personal', folders: [repos] });
    await c.call('machines.setProfileFolders', { machineId, profileId: 'work', folders: [work] });

    // Inspecting a subfolder resolves to the repository root.
    const seen = await c.call('checkouts.inspect', { path: join(repos, 'accio', 'src') });
    expect(seen).toMatchObject({ name: 'accio', repoKey: 'github.com/me/accio', existingProject: null, suggestedProfileId: 'personal' });

    await c.call('checkouts.add', { path: seen.path, profileId: 'personal' });
    const again = await c.call('checkouts.inspect', { path: join(work, 'accio-copy') });
    expect(again.existingProject?.profileId).toBe('personal');
    await c.call('checkouts.add', { path: again.path });

    const state = await c.waitFor('projects.changed', (s) => s.checkouts.length === 2);
    expect(state.projects).toHaveLength(1);

    await expect(c.call('profiles.delete', { id: 'personal' })).rejects.toThrow(/still used by project accio/);
  });

  it('treats a folder without git as its own project', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const plain = join(t.home, 'notes');
    await mkdir(plain);
    await c.call('profiles.save', { name: 'Personal' });
    const seen = await c.call('checkouts.inspect', { path: plain });
    expect(seen).toMatchObject({ name: 'notes', repoKey: null, suggestedProfileId: null });
    await expect(c.call('checkouts.add', { path: plain })).rejects.toThrow(/Choose the profile/);
    await c.call('checkouts.add', { path: plain, profileId: 'personal' });
    await expect(c.call('checkouts.inspect', { path: join(t.home, 'missing') })).rejects.toThrow(/not a folder/);
  });
});
