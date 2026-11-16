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

it('loads skill selections saved before spaces as selected for no space, and keeps concurrent space selections', async () => {
  const home = await mkdtemp(join(tmpdir(), 'accio-resources-'));
  const legacy = { global: false, profileIds: ['personal'], projectKeys: ['local:old'] };
  const skill = { id: 'library:review', sourceId: 'library', name: 'review', description: '', path: '/cache/review', revision: 'abc', scope: legacy };
  const store = new Resources(home);
  try {
    await mkdir(join(home, 'hub'), { recursive: true });
    await writeFile(join(home, 'hub', 'resources.json'), JSON.stringify({ tools: [], mcps: [], sources: [], skills: [skill], toolStatuses: [], skillSelections: { [skill.id]: legacy } }));
    await store.load();
    expect(store.state().skills[0]?.scope).toEqual({ ...legacy, spaceIds: [] });
    await Promise.all([store.setSkillSpace(skill.id, { spaceId: 'hrc', enabled: true }), store.setSkillSpace(skill.id, { spaceId: 'copilot', enabled: true })]);
    expect(store.state().skills[0]?.scope.spaceIds.sort()).toEqual(['copilot', 'hrc']);
    await store.setSkillSpace(skill.id, { spaceId: 'hrc', enabled: false });
    expect(store.state().skills[0]?.scope).toEqual({ ...legacy, spaceIds: ['copilot'] });
  } finally { await store.close(); await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
