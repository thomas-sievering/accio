import { describe, expect, it } from 'vitest';
import type { ResourceScope, ToolEntry, ToolStatus } from '@accio/protocol';
import { cliInstructions, threadClis } from './clis.js';

const scope = (s: Partial<ResourceScope>): ResourceScope => ({ global: false, profileIds: [], spaceIds: [], projectKeys: [], ...s });
const cli = (id: string, s: Partial<ResourceScope>, more: Partial<ToolEntry> = {}): ToolEntry =>
  ({ id, name: id, package: id, version: '1.0.0', executable: id, checkArgs: ['--version'], scope: scope(s), ...more });
const at = { profileId: 'personal', spaceId: 'agents', projectKey: 'github.com/me/app' };
const ready = (toolId: string, more: Partial<ToolStatus> = {}): ToolStatus => ({ toolId, machineId: 'm', status: 'ready', ...more });

describe('threadClis', () => {
  it('turns a CLI on at any of the four levels and leaves others off', () => {
    const tools = [cli('everywhere', { global: true }), cli('profile', { profileIds: ['personal'] }), cli('space', { spaceIds: ['agents'] }), cli('project', { projectKeys: ['github.com/me/app'] }),
      cli('work', { profileIds: ['work'] }), cli('other-space', { spaceIds: ['hrc'] }), cli('optional', {})];
    expect(threadClis(tools, at).map(c => [c.tool.id, c.level])).toEqual([['project', 'project'], ['space', 'space'], ['profile', 'profile'], ['everywhere', 'everywhere']]);
    expect(threadClis(tools, { profileId: 'personal' }).map(c => c.tool.id)).toEqual(['profile', 'everywhere']);
  });
  it('lets the narrowest level win for one executable and marks the other overridden', () => {
    const wide = cli('pw', { global: true }, { executable: 'playwright-cli', version: '1.1.0' });
    const narrow = cli('pw-space', { spaceIds: ['agents'] }, { executable: 'playwright-cli', version: '1.2.0' });
    const result = threadClis([wide, narrow], at);
    expect(result.map(c => [c.tool.id, c.overriddenBy?.tool.id])).toEqual([['pw-space', undefined], ['pw', 'pw-space']]);
    expect(threadClis([wide, narrow], { profileId: 'personal' }).map(c => [c.tool.id, c.overriddenBy])).toEqual([['pw', undefined]]);
  });
  it('uses the counted level for a CLI on at several levels', () => {
    expect(threadClis([cli('x', { global: true, projectKeys: ['github.com/me/app'] })], at)[0]?.level).toBe('project');
  });
});

describe('cliInstructions', () => {
  it('lists ready CLIs with their descriptions and the --help rule', () => {
    const text = cliInstructions([
      { tool: cli('agent-desktop', { global: true }, { name: 'Agent Desktop', description: 'Controls the desktop' }), status: ready('agent-desktop') },
      { tool: cli('surf', { global: true }), status: ready('surf', { description: 'Drives a browser' }) },
    ]);
    expect(text).toContain('- agent-desktop (Agent Desktop): Controls the desktop');
    expect(text).toContain('- surf: Drives a browser');
    expect(text).toContain('`<cli> --help`');
  });
  it('says why a CLI is unavailable instead of hiding it', () => {
    const text = cliInstructions([
      { tool: cli('new', { global: true }) },
      { tool: cli('broken', { global: true }), status: { toolId: 'broken', machineId: 'm', status: 'error', detail: 'browser missing', repairThreadId: 't1' } },
    ]);
    expect(text).not.toContain('on the PATH');
    expect(text).toContain('- new: being installed on this machine');
    expect(text).toContain('- broken: its check failed: browser missing. A repair thread is fixing it.');
  });
  it('is empty without CLIs', () => {
    expect(cliInstructions([])).toBe('');
  });
});
