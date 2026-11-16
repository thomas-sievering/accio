import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Resources, everywhere, optionalScope } from './resources.js';
import type { SkillEntry } from '@accio/protocol';

it('retains selections for a skill removed by an update and restored after restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'accio-skills-'));
  const source = { id: 'library', name: 'Library', url: 'https://example.test/skills.git', ref: 'HEAD' };
  const skill: SkillEntry = { id: 'library:browser', sourceId: 'library', name: 'browser', description: '', path: '/cache/browser', revision: 'old', scope: optionalScope() };
  const scope = { ...optionalScope(), profileIds: ['personal'] };
  let store = new Resources(home);
  try {
    await store.load(); await store.saveSource(source, [skill]);
    await store.setSkillScope(skill.id, scope);
    await store.saveSource(source, [{ ...skill, id: 'library:other', name: 'other', revision: 'new' }]);
    await store.close(); store = new Resources(home); await store.load();
    await store.applySkills(source.id, 'old');
    expect(store.state().skills[0]?.scope).toEqual(scope);
    await store.deleteSource(source.id);
    await store.saveSource(source, [skill]);
    expect(store.state().skills[0]?.scope).toEqual(optionalScope());
  } finally { await store.close(); await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

it('keeps CLI levels across a save, a reload and a definition change, and drops them with the CLI', async () => {
  const home = await mkdtemp(join(tmpdir(), 'accio-resources-'));
  const tool = { id: 'surf', name: 'Surf', package: 'surf-cli', version: '1.0.0', executable: 'surf', checkArgs: ['--version'] };
  const space = { ...optionalScope(), spaceIds: ['agents'] };
  try {
    let store = new Resources(home); await store.load();
    await store.saveTool({ ...tool, scope: space });
    expect(store.state().tools[0]?.scope).toEqual(space);
    await store.saveTool({ ...tool, version: '1.1.0' });
    expect(store.state().tools[0]).toMatchObject({ version: '1.1.0', scope: space });
    await store.setToolScope('surf', { ...optionalScope(), profileIds: ['personal'] });
    await store.close();
    store = new Resources(home); await store.load();
    expect(store.state().tools[0]?.scope.profileIds).toEqual(['personal']);
    await expect(store.setToolScope('missing', space)).rejects.toThrow('No such CLI');
    await store.deleteTool('surf'); await store.saveTool(tool);
    expect(store.state().tools[0]?.scope).toEqual(everywhere());
    await store.close();
  } finally { await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});


it('loads legacy tools Everywhere, dropping scopes stored on old definitions, and MCPs without scopes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'accio-resources-'));
  const tool = { id: 'browser', name: 'Browser', package: '@playwright/cli', version: '0.1.23', executable: 'playwright-cli', checkArgs: ['--version'] };
  const mcp = { id: 'remote', name: 'Remote', transport: 'http', url: 'https://example.test/mcp', args: [], auth: 'none' };
  const store = new Resources(home);
  try {
    await mkdir(join(home, 'hub'), { recursive: true });
    await writeFile(join(home, 'hub', 'resources.json'), JSON.stringify({ tools: [{ ...tool, scope: { ...optionalScope(), projectKeys: ['local:old'] } }], mcps: [{ ...mcp, scope: optionalScope() }], sources: [], skills: [], toolStatuses: [] }));
    await store.load();
    expect(store.state().tools).toEqual([{ ...tool, scope: everywhere() }]);
    expect(store.state().mcps).toEqual([{ ...mcp, signedIn: false }]);
  } finally { await store.close(); await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
