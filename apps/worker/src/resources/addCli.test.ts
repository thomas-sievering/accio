import { describe, expect, it, vi } from 'vitest';
import type { ConfirmationItem, ToolEntry, ToolStatus } from '@accio/protocol';
import { addCliTool, type AddCliDeps } from './addCli.js';
import { Confirmations } from '../threads/confirmations.js';

const at = { profileId: 'personal', spaceId: 'agents', projectKey: 'github.com/me/app' };
function setup(over: Partial<AddCliDeps> = {}, tools: ToolEntry[] = []) {
  const saved: (ToolEntry)[] = [];
  const deps: AddCliDeps = {
    caller: (id) => id === 't1' ? { profileId: 'personal', projectId: 'p1' } : undefined,
    levelContext: () => at,
    names: () => ({ profile: 'Personal', space: 'Agents', project: 'App' }),
    tools: () => tools,
    save: vi.fn(async (tool) => { saved.push(tool); return { toolId: tool.id, machineId: 'm', status: 'ready', detail: '1.2.3' } satisfies ToolStatus; }),
    bin: () => '/home/tools/surf/bin',
    confirm: vi.fn(async () => 'allowed' as const),
    ...over,
  };
  return { tool: addCliTool(deps), deps, saved };
}
const call = (tool: ReturnType<typeof setup>['tool'], args: Record<string, unknown>, threadId = 't1') =>
  tool.call(args as never, { threadId, signal: new AbortController().signal, progress: () => {} });
const surf = { package: 'surf-cli', version: '1.2.3', executable: 'surf' };

describe('add_cli', () => {
  it('adds a CLI for the thread\'s project by default and reports the check on this machine', async () => {
    const { tool, saved, deps } = setup();
    const text = await call(tool, surf);
    expect(saved[0]).toMatchObject({ id: 'surf', name: 'surf', package: 'surf-cli', checkArgs: ['--version'], scope: { global: false, projectKeys: ['github.com/me/app'], spaceIds: [], profileIds: [] } });
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(text).toContain('for threads in App');
    expect(text).toContain('Ready on this machine');
    expect(text).toContain('in this turn run it as');
  });
  it('adds at the thread\'s space or profile without asking', async () => {
    const { tool, saved, deps } = setup();
    await call(tool, { ...surf, level: 'space' });
    await call(tool, { ...surf, level: 'profile' });
    expect(saved.map(t => [t.scope.spaceIds, t.scope.profileIds])).toEqual([[['agents'], []], [[], ['personal']]]);
    expect(deps.confirm).not.toHaveBeenCalled();
  });
  it('asks before adding everywhere and saves nothing when declined', async () => {
    const declined = setup({ confirm: vi.fn(async () => 'declined' as const) });
    expect(await call(declined.tool, { ...surf, level: 'everywhere' })).toContain('declined');
    expect(declined.saved).toEqual([]);
    const allowed = setup();
    await call(allowed.tool, { ...surf, level: 'everywhere' });
    expect(allowed.deps.confirm).toHaveBeenCalledWith('t1', expect.objectContaining({ title: 'Add surf for every thread?' }), expect.anything());
    expect(allowed.saved[0]?.scope.global).toBe(true);
  });
  it('adds a level to the same package and version instead of a second CLI, keeping the others', async () => {
    const existing: ToolEntry = { id: 'surf', name: 'Surf', ...surf, checkArgs: ['--version'], description: 'Browser', scope: { global: false, profileIds: ['work'], spaceIds: [], projectKeys: [] } };
    const { tool, saved } = setup({}, [existing]);
    await call(tool, { ...surf, level: 'profile' });
    expect(saved[0]).toMatchObject({ id: 'surf', name: 'Surf', description: 'Browser', scope: { profileIds: ['work', 'personal'] } });
  });
  it('gives another version its own CLI, so the narrowest level can win', async () => {
    const existing: ToolEntry = { id: 'surf', name: 'Surf', ...surf, version: '1.0.0', checkArgs: ['--version'], scope: { global: true, profileIds: [], spaceIds: [], projectKeys: [] } };
    const { tool, saved } = setup({}, [existing]);
    await call(tool, surf);
    expect(saved[0]?.id).toBe('surf-2');
  });
  it('explains a failed check and refuses levels the thread is not in', async () => {
    const failing = setup({ save: async (t) => ({ toolId: t.id, machineId: 'm', status: 'error', detail: 'Package does not provide surf' }) });
    expect(await call(failing.tool, surf)).toContain('Package does not provide surf');
    const noSpace = setup({ levelContext: () => ({ profileId: 'personal' }) });
    await expect(call(noSpace.tool, { ...surf, level: 'space' })).rejects.toThrow('in no space');
    await expect(call(noSpace.tool, surf)).rejects.toThrow('has no project');
    await expect(call(setup().tool, { ...surf, version: 'latest' })).rejects.toThrow('exact version');
    await expect(call(setup().tool, surf, 'elsewhere')).rejects.toThrow('not on this machine');
  });
});

describe('Confirmations', () => {
  it('publishes a pending card, resolves with the answer and records it', async () => {
    const items: ConfirmationItem[] = [];
    const confirmations = new Confirmations(async (_threadId, item) => { items.push(item); });
    const asked = confirmations.ask('t1', 'turn', { title: 'Add?', detail: 'd', allowLabel: 'Add' }, new AbortController().signal);
    await vi.waitFor(() => expect(items).toHaveLength(1));
    expect(confirmations.hasPending('t1')).toBe(true);
    await expect(confirmations.answer({ threadId: 'other', requestId: items[0]!.requestId, allow: true })).rejects.toThrow('ended');
    await confirmations.answer({ threadId: 't1', requestId: items[0]!.requestId, allow: true });
    expect(await asked).toBe('allowed');
    expect(items.map(i => i.status)).toEqual(['pending', 'allowed']);
    expect(confirmations.hasPending('t1')).toBe(false);
  });
  it('cancels when the turn ends or is stopped, and expires', async () => {
    const confirmations = new Confirmations(async () => {}, 20);
    expect(await confirmations.ask('t1', 'turn', { title: '', detail: '', allowLabel: '' }, new AbortController().signal)).toBe('expired');
    const long = new Confirmations(async () => {});
    const stop = new AbortController();
    const stopped = long.ask('t1', 'a', { title: '', detail: '', allowLabel: '' }, stop.signal);
    stop.abort();
    expect(await stopped).toBe('cancelled');
    const ended = long.ask('t1', 'b', { title: '', detail: '', allowLabel: '' }, new AbortController().signal);
    await vi.waitFor(() => expect(long.hasPending('t1')).toBe(true));
    await long.endTurn('b');
    expect(await ended).toBe('cancelled');
  });
});
