import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Resources, optionalScope } from './resources.js';
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


it('loads legacy tools and MCPs without profile or project scopes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'accio-resources-'));
  const tool = { id: 'browser', name: 'Browser', package: '@playwright/cli', version: '0.1.23', executable: 'playwright-cli', checkArgs: ['--version'] };
  const mcp = { id: 'remote', name: 'Remote', transport: 'http', url: 'https://example.test/mcp', args: [], auth: 'none' };
  const store = new Resources(home);
  try {
    await mkdir(join(home, 'hub'), { recursive: true });
    await writeFile(join(home, 'hub', 'resources.json'), JSON.stringify({ tools: [{ ...tool, scope: { ...optionalScope(), projectKeys: ['local:old'] } }], mcps: [{ ...mcp, scope: optionalScope() }], sources: [], skills: [], toolStatuses: [] }));
    await store.load();
    expect(store.state().tools).toEqual([tool]);
    expect(store.state().mcps).toEqual([{ ...mcp, signedIn: false }]);
  } finally { await store.close(); await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
