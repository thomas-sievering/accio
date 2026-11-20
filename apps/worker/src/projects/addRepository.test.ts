import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HubProject } from '@accio/protocol';
import { Projects, type ProjectsHub } from './projects.js';
import type { Profiles } from '../profiles/profiles.js';
import type { Machines } from '../machine/machine.js';

async function setup(kept: HubProject[] | undefined) {
  const hub: ProjectsHub = {
    list: () => kept,
    register: vi.fn(async (list: HubProject[]) => { kept?.push(...list.filter((p) => p.profileId !== 'gone')); return kept; }),
    setProfile: async () => {}, forget: async () => {}, renames: () => ({}), rename: async () => {}, onChanged: () => {}, checkoutElsewhere: () => false, holdings: () => [],
  };
  const profiles = { onCheckInUse: () => {}, useProfile: () => () => {}, syncReferences: async () => {} } as unknown as Profiles;
  const projects = new Projects(await mkdtemp(join(tmpdir(), 'accio-repo-')), profiles, {} as Machines, () => {}, hub);
  return { projects, hub };
}

describe('Projects.addRepository', () => {
  it('has the hub keep a repository without a checkout, and leaves a known one as it is', async () => {
    const kept: HubProject[] = [{ repoKey: 'github.com/hrc/app', name: 'app', profileId: 'work' }];
    const { projects, hub } = await setup(kept);
    expect(await projects.addRepository('github.com/hrc/agent-odoo', 'work')).toEqual({ repoKey: 'github.com/hrc/agent-odoo', name: 'agent-odoo', profileId: 'work' });
    expect(projects.view().elsewhere).toContainEqual(expect.objectContaining({ repoKey: 'github.com/hrc/agent-odoo', name: 'agent-odoo', profileId: 'work', on: [] }));
    expect(await projects.addRepository('github.com/hrc/app', 'personal')).toEqual({ repoKey: 'github.com/hrc/app', name: 'app', profileId: 'work' });
    expect(hub.register).toHaveBeenCalledTimes(1);
  });
  it('refuses when the hub keeps no projects or does not take it', async () => {
    await expect((await setup(undefined)).projects.addRepository('github.com/hrc/x', 'work')).rejects.toThrow('keeps no projects yet');
    await expect((await setup([])).projects.addRepository('github.com/hrc/x', 'gone')).rejects.toThrow('The hub did not take github.com/hrc/x.');
  });
});
