import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeCodex } from '../testing/fakeCodex.js';
import { FakeHarness } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';
import { runCommand } from './process.js';

const instructions = (name: string, from: string) => `---\nname: ${name}\ndescription: ${name} from ${from}\n---\nFollow these instructions.\n`;
async function put(path: string, name: string, from: string) { await mkdir(path, { recursive: true }); await writeFile(join(path, 'SKILL.md'), instructions(name, from)); }
async function commit(cwd: string) {
  await runCommand('git', ['init', '--quiet', '-b', 'main'], { cwd });
  await runCommand('git', ['add', '.'], { cwd });
  await runCommand('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'initial'], { cwd });
}

/** GLOSSARY: Skill level, Space, Home. A space's skills: its home's skill files plus library skills turned on for it (ADR 0020). */
describe('space skills', () => {
  let stop: (() => Promise<void>) | undefined;
  const folders: string[] = [];
  afterEach(async () => { await stop?.(); stop = undefined; for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

  /**
   * A project (its own `notes`) and a home (`guide`, `notes`, `docs`) in the space "hrc";
   * a library with `docs` turned on for the profile, `wide` everywhere and `review` optional.
   */
  async function fixture(options: { codex?: FakeCodex } = {}) {
    const harness = new FakeHarness();
    const codexHarness = new FakeHarness();
    const t = await startTestApp({ harness, codexHarness, ...(options.codex ? { codexFactory: options.codex.factory } : {}) }); stop = t.stop;
    const c = await t.connect();
    let profile = await c.signedIn('Personal');
    if (options.codex) profile = await c.withChatGpt(profile, options.codex);
    const project = join(t.home, 'project'); const home = join(t.home, 'home'); const source = join(t.home, 'library');
    await put(join(project, '.agents', 'skills', 'notes'), 'notes', 'project');
    await put(join(home, '.agents', 'skills', 'guide'), 'guide', 'home');
    await put(join(home, '.agents', 'skills', 'notes'), 'notes', 'home');
    await put(join(home, '.claude', 'skills', 'docs'), 'docs', 'home');
    for (const name of ['docs', 'wide', 'review']) await put(join(source, name), name, 'library');
    for (const cwd of [project, home, source]) await commit(cwd);
    const checkout = await c.call('checkouts.add', { path: project, profileId: profile.id });
    const homeCheckout = await c.call('checkouts.add', { path: home, profileId: profile.id });
    await c.call('skills.addSource', { id: 'library', name: 'Library', url: source, ref: 'HEAD' });
    const library = (await c.call('resources.get', {})).skills;
    const skill = (name: string) => library.find(entry => entry.name === name)!;
    await c.call('skills.setScope', { id: skill('docs').id, scope: { global: false, profileIds: [profile.id], projectKeys: [], spaceIds: [] } });
    await c.call('skills.setScope', { id: skill('wide').id, scope: { global: true, profileIds: [], projectKeys: [], spaceIds: [] } });
    const space = await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${checkout.projectId}`, `local:${homeCheckout.projectId}`], homeProjectKey: `local:${homeCheckout.projectId}` });
    return { t, c, profile, harness, codexHarness, checkout, homeCheckout, space, skill };
  }

  it('lists the home’s skill files and space selections at the Space level, between Project and Profile', async () => {
    const { c, checkout, space, skill, harness } = await fixture();
    const context = { checkoutId: checkout.id };
    await c.call('threads.setSkillEnabled', { ...context, skillId: skill('review').id, enabled: true, level: 'space' });
    const state = await c.call('threads.skills', context);
    expect(state.space).toEqual({ id: space.id, name: 'hrc' });
    const on = (name: string) => state.skills.filter(entry => entry.name === name && entry.enabled && entry.origin !== 'harness')
      .map(entry => [entry.origin, entry.enabledBy, entry.overriddenBy ?? null, entry.description]);
    // Project over Space: the project's own notes win.
    expect(on('notes')).toEqual([['repository', 'project', null, 'notes from project'], ['repository', 'space', 'project', 'notes from home']]);
    // Space over Profile: the home's docs win.
    expect(on('docs')).toEqual([['repository', 'space', null, 'docs from home'], ['library', 'profile', 'space', 'docs from library']]);
    expect(on('guide')).toEqual([['repository', 'space', null, 'guide from home']]);
    expect(on('review')).toEqual([['library', 'space', null, 'review from library']]);
    expect(on('wide')).toEqual([['library', 'global', null, 'wide from library']]);
    expect((await c.call('resources.get', {})).skills.find(entry => entry.id === skill('review').id)?.scope.spaceIds).toEqual([space.id]);

    const thread = await c.call('threads.start', { ...context, text: 'work' });
    await c.waitFor('threads.changed', threads => threads.some(t => t.id === thread.id && t.status === 'idle'));
    const delivered = harness.runs[0]!.resourceInstructions!;
    for (const name of ['notes', 'docs', 'guide', 'review', 'wide']) expect(delivered.match(new RegExp(`- ${name}:`, 'g'))).toHaveLength(1);
    expect(delivered).toContain('notes from project');
    expect(delivered).toContain('docs from home');
    expect(delivered).not.toContain('docs from library');

    // Turning it off for the space leaves it off everywhere here; the project can't turn off what the space turned on.
    await expect(c.call('threads.setSkillEnabled', { ...context, skillId: skill('review').id, enabled: false })).rejects.toThrow('inherited');
    await c.call('threads.setSkillEnabled', { ...context, skillId: skill('review').id, enabled: false, level: 'space' });
    expect((await c.call('threads.skills', context)).skills.find(entry => entry.id === skill('review').id)).toMatchObject({ enabled: false, enabledBy: null });
  });

  it('gives a thread in the home its skill files once, as Project skills, and its space’s selections at the Space level', async () => {
    const { c, homeCheckout, skill, harness } = await fixture();
    await c.call('threads.setSkillEnabled', { checkoutId: homeCheckout.id, skillId: skill('review').id, enabled: true, level: 'space' });
    const thread = await c.call('threads.start', { checkoutId: homeCheckout.id, text: 'work' });
    await c.waitFor('threads.changed', threads => threads.some(t => t.id === thread.id && t.status === 'idle'));
    const { skills, space } = await c.call('threads.skills', { threadId: thread.id });
    expect(space?.name).toBe('hrc');
    const levels = (name: string) => skills.filter(entry => entry.name === name && entry.origin !== 'harness').map(entry => [entry.origin, entry.enabledBy, entry.overriddenBy ?? null]);
    expect(levels('guide')).toEqual([['repository', 'project', null]]);
    expect(levels('notes')).toEqual([['repository', 'project', null]]);
    expect(levels('docs')).toEqual([['repository', 'project', null], ['library', 'profile', 'project']]);
    expect(levels('review')).toEqual([['library', 'space', null]]);
    const delivered = harness.runs[0]!.resourceInstructions!;
    for (const name of ['guide', 'notes', 'docs', 'review']) expect(delivered.match(new RegExp(`- ${name}:`, 'g'))).toHaveLength(1);
  });

  it('delivers a space selection made in Settings and the home’s files to Claude and Codex threads alike', async () => {
    const codex = new FakeCodex();
    const { c, profile, checkout, space, skill, harness, codexHarness } = await fixture({ codex });
    await expect(c.call('skills.setScope', { id: skill('review').id, scope: { global: false, profileIds: [], projectKeys: [], spaceIds: ['no-such-space'] } })).rejects.toThrow('No such space');
    await c.call('skills.setScope', { id: skill('review').id, scope: { global: false, profileIds: [], projectKeys: [], spaceIds: [space.id] } });
    for (const model of [{ harnessId: 'claudeCode', modelId: 'opus' }, { harnessId: 'codex', modelId: 'test-codex' }]) {
      const thread = await c.call('threads.start', { checkoutId: checkout.id, profileId: profile.id, model, text: 'work' });
      await c.waitFor('threads.changed', threads => threads.some(t => t.id === thread.id && t.status === 'idle'));
    }
    for (const run of [harness.runs[0], codexHarness.runs[0]]) {
      expect(run?.resourceInstructions).toContain('review from library');
      expect(run?.resourceInstructions).toContain('guide from home');
    }
    // A space deleted since stays in a selection without blocking other changes to it.
    await c.call('spaces.delete', { id: space.id });
    await c.call('skills.setScope', { id: skill('review').id, scope: { global: true, profileIds: [], projectKeys: [], spaceIds: [space.id] } });
  });
});
