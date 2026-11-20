import { describe, expect, it, vi } from 'vitest';
import type { FolderInspection } from '@accio/protocol';
import { addProjectTool, githubRepoProblem, type AddProjectDeps } from './addProject.js';

const root = process.platform === 'win32' ? 'C:\\work' : '/work';
const at = (name: string) => `${root}${process.platform === 'win32' ? '\\' : '/'}${name}`;
const folders: Record<string, FolderInspection> = {
  [at('agent-odoo')]: { path: at('agent-odoo'), name: 'agent-odoo', repoKey: 'github.com/hrc/agent-odoo', existingProject: null, alreadyAdded: false, suggestedProfileId: 'work' },
  [at('agent-epa')]: { path: at('agent-epa'), name: 'agent-epa', repoKey: 'github.com/hrc/agent-epa', existingProject: null, alreadyAdded: false, suggestedProfileId: null },
  [at('remote-app')]: { path: at('remote-app'), name: 'remote-app', repoKey: 'github.com/hrc/remote-app',
    existingProject: { id: '', name: 'remote-app', profileId: 'work', repoKey: 'github.com/hrc/remote-app' }, alreadyAdded: false, suggestedProfileId: null },
  [at('app')]: { path: at('app'), name: 'app', repoKey: 'github.com/hrc/app', existingProject: null, alreadyAdded: true, suggestedProfileId: null },
};

function setup(over: Partial<AddProjectDeps> = {}) {
  const added: [string, string][] = [];
  const deps: AddProjectDeps = {
    caller: (id) => id === 't1' ? { profileId: 'personal' } : undefined,
    profiles: () => [{ id: 'work', name: 'HRC' }, { id: 'personal', name: 'Personal' }],
    inspect: async (path) => { const f = folders[path]; if (!f) throw new Error('Not a folder'); return f; },
    addFolder: vi.fn(async (path, profileId) => { added.push([path, profileId]); }),
    known: (key) => key === 'github.com/hrc/remote-app' ? { name: 'remote-app', profileId: 'work' } : undefined,
    checkRepository: vi.fn(async (key: string) => key === 'github.com/hrc/typo' ? 'Could not resolve to a Repository' : undefined),
    addRepository: vi.fn(async (repoKey, profileId) => { added.push([repoKey, profileId]); return { repoKey, name: repoKey.split('/').pop()!, profileId }; }),
    confirm: vi.fn(async () => 'allowed' as const),
    ...over,
  };
  return { tool: addProjectTool(deps), deps, added };
}
const call = (tool: ReturnType<typeof setup>['tool'], args: Record<string, unknown>, threadId = 't1') =>
  tool.call(args as never, { threadId, signal: new AbortController().signal, progress: () => {} });

describe('add_project', () => {
  it('adds folders after one confirmation, each in its known, suggested or the thread\'s profile', async () => {
    const { tool, deps, added } = setup();
    const text = await call(tool, { folders: [at('agent-odoo'), at('agent-epa'), at('remote-app')] });
    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.confirm).toHaveBeenCalledWith('t1', expect.objectContaining({ title: 'Add 3 projects?', items: expect.arrayContaining([{ label: 'remote-app', note: `github.com/hrc/remote-app · from ${at('remote-app')} · profile HRC · joins its existing project` }]) }), expect.anything());
    expect(added).toEqual([[at('agent-odoo'), 'work'], [at('agent-epa'), 'personal'], [at('remote-app'), 'work']]);
    expect(text).toContain('agent-epa (github.com/hrc/agent-epa) in profile Personal');
  });
  it('gives new projects the named profile, but a known repository keeps its own', async () => {
    const { tool, added } = setup();
    await call(tool, { folders: [at('agent-epa'), at('remote-app')], profile: 'hrc' });
    expect(added).toEqual([[at('agent-epa'), 'work'], [at('remote-app'), 'work']]);
  });
  it('adds nothing when the user declines', async () => {
    const { tool, added } = setup({ confirm: vi.fn(async () => 'declined' as const) });
    expect(await call(tool, { folders: [at('agent-odoo')] })).toContain('declined');
    expect(added).toEqual([]);
  });
  it('skips folders already added and asks nothing when none is left', async () => {
    const { tool, deps } = setup();
    expect(await call(tool, { folders: [at('app')] })).toBe('app is already a project. Nothing was changed.');
    expect(deps.confirm).not.toHaveBeenCalled();
  });
  it('refuses relative paths, unknown folders and profiles, and a new project without any profile', async () => {
    const { tool, added } = setup();
    await expect(call(tool, { folders: ['agent-odoo'] })).rejects.toThrow('not an absolute path');
    await expect(call(tool, { folders: [at('nope')] })).rejects.toThrow('Not a folder');
    await expect(call(tool, { folders: [at('agent-epa')], profile: 'nope' })).rejects.toThrow('There is no profile called nope. Profiles: HRC, Personal.');
    await expect(call(tool, { folders: [at('agent-epa')] }, 'elsewhere')).rejects.toThrow('Name the profile for agent-epa');
    expect(added).toEqual([]);
  });
  it('says which projects were added before one that failed', async () => {
    const { tool } = setup({ addFolder: vi.fn(async (path: string) => { if (path === at('agent-epa')) throw new Error('No profile work'); }) });
    await expect(call(tool, { folders: [at('agent-odoo'), at('agent-epa')] })).rejects.toThrow('Could not add agent-epa: No profile work. Added before it: agent-odoo');
  });
  it('adds repositories by key or URL without a folder, in the named or the thread\'s profile', async () => {
    const { tool, added, deps } = setup();
    const text = await call(tool, { repositories: ['github.com/hrc/agent-odoo', 'https://github.com/HRC/agent-epa.git', 'git@github.com:hrc/remote-app.git'] });
    expect(deps.checkRepository).toHaveBeenCalledWith('github.com/hrc/agent-odoo', 'personal');
    expect(deps.confirm).toHaveBeenCalledWith('t1', expect.objectContaining({ detail: "In profile Personal. Each is cloned when a thread starts in it. A project's profile holds on every machine.",
      items: [{ label: 'agent-odoo', note: 'github.com/hrc/agent-odoo' }, { label: 'agent-epa', note: 'github.com/hrc/agent-epa' }] }), expect.anything());
    expect(added).toEqual([['github.com/hrc/agent-odoo', 'personal'], ['github.com/hrc/agent-epa', 'personal']]);
    expect(text).toContain('remote-app (github.com/hrc/remote-app) is already a project.');
    const named = setup();
    await call(named.tool, { repositories: ['github.com/hrc/agent-odoo'], profile: 'HRC' });
    expect(named.added).toEqual([['github.com/hrc/agent-odoo', 'work']]);
  });
  it('refuses a repository the profile can\'t reach, or that is not a repository, before asking', async () => {
    const { tool, deps } = setup();
    await expect(call(tool, { repositories: ['github.com/hrc/typo'] })).rejects.toThrow("Personal can't reach github.com/hrc/typo: Could not resolve to a Repository");
    await expect(call(tool, { repositories: ['agent-odoo'] })).rejects.toThrow('agent-odoo is not a repository');
    await expect(call(tool, {})).rejects.toThrow('Nothing to add');
    expect(deps.confirm).not.toHaveBeenCalled();
  });
});

describe('githubRepoProblem', () => {
  it('asks gh for GitHub repositories only and gives its last error line', async () => {
    const gh = vi.fn(async (args: string[]) => { if (args[2] === 'hrc/typo') throw Object.assign(new Error('failed'), { stderr: 'warning\nGraphQL: Could not resolve to a Repository\n' }); return '{}'; });
    expect(await githubRepoProblem('github.com/hrc/app', gh)).toBeUndefined();
    expect(gh).toHaveBeenCalledWith(['repo', 'view', 'hrc/app', '--json', 'name']);
    expect(await githubRepoProblem('github.com/hrc/typo', gh)).toBe('GraphQL: Could not resolve to a Repository');
    expect(await githubRepoProblem('gitlab.com/hrc/app', gh)).toBeUndefined();
    expect(gh).toHaveBeenCalledTimes(2);
  });
});
