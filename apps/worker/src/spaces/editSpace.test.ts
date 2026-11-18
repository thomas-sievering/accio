import { describe, expect, it, vi } from 'vitest';
import type { ProjectsState, SaveSpace, Space } from '@accio/protocol';
import { editSpaceTool, type EditSpaceDeps } from './editSpace.js';

const state: ProjectsState = {
  projects: [
    { id: 'p-home', name: 'hrc-home', profileId: 'work', repoKey: 'github.com/hrc/hrc-home' },
    { id: 'p-app', name: 'app', profileId: 'work', repoKey: 'github.com/hrc/app' },
    { id: 'p-new', name: 'new-app', profileId: 'personal', repoKey: 'github.com/me/new-app' },
    { id: 'p-other', name: 'other', profileId: 'personal', repoKey: 'github.com/me/other' },
  ],
  checkouts: [],
  elsewhere: [{ repoKey: 'github.com/hrc/remote-app', name: 'remote-app', profileId: 'work' }],
};
const spaces: Space[] = [
  { id: 's1', name: 'hrc-home-apps', projectKeys: ['github.com/hrc/hrc-home', 'github.com/hrc/app'], homeProjectKey: 'github.com/hrc/hrc-home' },
  { id: 's2', name: 'Agents', projectKeys: ['github.com/me/other'] },
];

function setup(over: Partial<EditSpaceDeps> = {}) {
  const saved: SaveSpace[] = [];
  const deps: EditSpaceDeps = {
    caller: (id) => id === 't1' ? { projectId: 'p-app' } : id === 't2' ? { projectId: 'p-new' } : undefined,
    spaces: () => spaces,
    projects: () => state,
    save: vi.fn(async (space) => { saved.push(space); return { ...space, id: space.id! } as Space; }),
    confirm: vi.fn(async () => 'allowed' as const),
    ...over,
  };
  return { tool: editSpaceTool(deps), deps, saved };
}
const call = (tool: ReturnType<typeof setup>['tool'], args: Record<string, unknown>, threadId = 't1') =>
  tool.call(args as never, { threadId, signal: new AbortController().signal, progress: () => {} });

describe('edit_space', () => {
  it('adds projects by name, including one not on this machine, after the user allows it', async () => {
    const { tool, saved, deps } = setup();
    const text = await call(tool, { space: 'HRC-home-apps', add_projects: ['new-app', 'remote-app'] }, 't2');
    expect(deps.confirm).toHaveBeenCalledWith('t2', expect.objectContaining({ title: 'Change the space hrc-home-apps?', detail: expect.stringContaining('Add new-app and remote-app.') }), expect.anything());
    expect(saved).toEqual([{ id: 's1', name: 'hrc-home-apps', homeProjectKey: 'github.com/hrc/hrc-home',
      projectKeys: ['github.com/hrc/hrc-home', 'github.com/hrc/app', 'github.com/me/new-app', 'github.com/hrc/remote-app'] }]);
    expect(text).toContain('next turn');
  });
  it('saves nothing when the user declines', async () => {
    const { tool, saved } = setup({ confirm: vi.fn(async () => 'declined' as const) });
    expect(await call(tool, { add_projects: ['new-app'] })).toContain('declined');
    expect(saved).toEqual([]);
  });
  it('defaults to the caller\'s space and removing the home leaves it without one', async () => {
    const { tool, saved } = setup();
    await call(tool, { remove_projects: ['github.com/hrc/hrc-home'] });
    expect(saved[0]).toEqual({ id: 's1', name: 'hrc-home-apps', projectKeys: ['github.com/hrc/app'] });
  });
  it('sets the home to a project added in the same change, and clears it with none', async () => {
    const set = setup();
    await call(set.tool, { add_projects: ['new-app'], home: 'new-app' });
    expect(set.saved[0]?.homeProjectKey).toBe('github.com/me/new-app');
    const clear = setup();
    await call(clear.tool, { home: 'none', rename: 'hrc apps' });
    expect(clear.saved[0]).toEqual({ id: 's1', name: 'hrc apps', projectKeys: spaces[0]!.projectKeys });
  });
  it('refuses a project in another space, an unknown project and a home outside the space', async () => {
    const { tool, saved } = setup();
    await expect(call(tool, { add_projects: ['other'] })).rejects.toThrow('already in the space "Agents"');
    await expect(call(tool, { add_projects: ['nope'] })).rejects.toThrow('nope is not a project in Settings → Projects');
    await expect(call(tool, { home: 'new-app' })).rejects.toThrow('not a project in the space "hrc-home-apps" after this change');
    await expect(call(tool, { remove_projects: ['new-app'] })).rejects.toThrow('not a project in the space "hrc-home-apps"');
    expect(saved).toEqual([]);
  });
  it('needs a space name outside a space, and says when nothing changes', async () => {
    const { tool, deps } = setup();
    await expect(call(tool, { add_projects: ['app'] }, 't2')).rejects.toThrow('in no space');
    expect(await call(tool, { add_projects: ['app'] })).toContain('Nothing was changed');
    expect(deps.confirm).not.toHaveBeenCalled();
  });
});
