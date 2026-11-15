import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeCodex } from '../testing/fakeCodex.js';
import { FakeHarness, replyWith } from '../testing/fakeHarness.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';
import { runCommand } from './process.js';

const instructions = (name: string) => `---\nname: ${name}\ndescription: Helpful ${name}\n---\nFollow these instructions.\n`;
async function put(path: string, name: string) { await mkdir(path, { recursive: true }); await writeFile(join(path, 'SKILL.md'), instructions(name)); }
async function commit(cwd: string) {
  await runCommand('git', ['init', '--quiet', '-b', 'main'], { cwd });
  await runCommand('git', ['add', '.'], { cwd });
  await runCommand('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'initial'], { cwd });
}
const idle = (c: TestClient, threadId: string) => c.waitFor('threads.changed', threads => threads.some(t => t.id === threadId && t.status === 'idle'));

/** GLOSSARY: Skill level, Space, Home. A space's skills sit between Project and Profile (ADR 0020). */
describe('space skills', () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(async () => { await stop?.(); stop = undefined; });

  /**
   * A project and its space's home, both with skill files, and a library with `review` and a
   * profile-wide `docs`. The home has `notes` (the project has one too), `docs` and `glossary`.
   */
  async function space(deps: Parameters<typeof startTestApp>[0], signIn: (c: TestClient) => Promise<unknown>) {
    const t = await startTestApp(deps); stop = t.stop;
    const c = await t.connect();
    await signIn(c);
    const folder = join(t.home, 'project'); const homeFolder = join(t.home, 'home'); const source = join(t.home, 'library');
    await put(join(folder, '.agents', 'skills', 'notes'), 'notes');
    await put(join(homeFolder, '.agents', 'skills', 'notes'), 'notes');
    await put(join(homeFolder, '.claude', 'skills', 'docs'), 'docs');
    await put(join(homeFolder, '.agents', 'skills', 'glossary'), 'glossary');
    await put(join(source, 'review'), 'review'); await put(join(source, 'docs'), 'docs');
    for (const cwd of [folder, homeFolder, source]) await commit(cwd);
    const checkout = await c.call('checkouts.add', { path: folder, profileId: 'personal' });
    const home = await c.call('checkouts.add', { path: homeFolder, profileId: 'personal' });
    const saved = await c.call('spaces.save', { name: 'hrc', projectKeys: [`local:${checkout.projectId}`, `local:${home.projectId}`], homeProjectKey: `local:${home.projectId}` });
    await c.call('skills.addSource', { id: 'library', name: 'Library', url: source, ref: 'HEAD' });
    const library = (await c.call('resources.get', {})).skills;
    const review = library.find(skill => skill.name === 'review')!;
    const docs = library.find(skill => skill.name === 'docs')!;
    await c.call('skills.setScope', { id: docs.id, scope: { global: false, profileIds: ['personal'], projectKeys: [], spaceIds: [] } });
    return { t, c, homeFolder, checkout, home, saved, review, docs };
  }

  it('puts the home’s skill files and the space’s library skills between Project and Profile', async () => {
    const harness = new FakeHarness();
    const { c, homeFolder, checkout, saved, review, docs } = await space({ harness }, c => c.signedIn('Personal'));
    const context = { checkoutId: checkout.id };
    await c.call('threads.setSkillEnabled', { ...context, skillId: review.id, enabled: true, level: 'space' });
    expect((await c.call('resources.get', {})).skills.find(skill => skill.id === review.id)?.scope).toMatchObject({ spaceIds: [saved.id], projectKeys: [] });
    const listed = await c.call('threads.skills', context);
    expect(listed.space).toEqual({ id: saved.id, name: 'hrc' });
    const named = (name: string) => listed.skills.filter(skill => skill.name === name).map(skill => [skill.origin, skill.enabledBy, skill.overriddenBy]);
    // Project over Space: the project's notes win over the home's.
    expect(named('notes')).toEqual([['repository', 'project', undefined], ['home', 'space', 'project']]);
    // Space over Profile: the home's docs win over the profile's library docs.
    expect(named('docs')).toEqual([['home', 'space', undefined], ['library', 'profile', 'space']]);
    expect(named('glossary')).toEqual([['home', 'space', undefined]]);
    expect(named('review')).toEqual([['library', 'space', undefined]]);
    const glossary = listed.skills.find(skill => skill.name === 'glossary')!;
    expect(glossary.path).toBe(join(homeFolder, '.agents', 'skills', 'glossary', 'SKILL.md'));
    expect(await c.call('threads.skillContent', { ...context, skillId: glossary.id })).toMatchObject({ editable: false, content: expect.stringContaining('Helpful glossary') });
    await expect(c.call('threads.saveSkillContent', { ...context, skillId: glossary.id, content: 'changed' })).rejects.toThrow('Only repository');
    // Turned on for the space, it's turned off for the space, not for the project.
    await expect(c.call('threads.setSkillEnabled', { ...context, skillId: review.id, enabled: false })).rejects.toThrow('space');
    const thread = await c.call('threads.start', { ...context, text: 'work' });
    await idle(c, thread.id);
    const delivered = harness.runs[0]!.resourceInstructions!;
    for (const name of ['notes', 'docs', 'glossary', 'review']) expect(delivered.match(new RegExp(`- ${name}:`, 'g'))).toHaveLength(1);
    expect(delivered).toContain(join(homeFolder, '.claude', 'skills', 'docs', 'SKILL.md'));
    expect(delivered).not.toContain(join(homeFolder, '.agents', 'skills', 'notes', 'SKILL.md'));
    expect(delivered).not.toContain(docs.path);
    await c.call('threads.setSkillEnabled', { ...context, skillId: review.id, enabled: false, level: 'space' });
    expect((await c.call('threads.skills', context)).skills.find(skill => skill.id === review.id)).toMatchObject({ enabled: false, enabledBy: null });
  });

  it('gives a thread in the home its skill files once, as Project skills', async () => {
    const harness = new FakeHarness();
    const { c, home } = await space({ harness }, c => c.signedIn('Personal'));
    const listed = await c.call('threads.skills', { checkoutId: home.id });
    expect(listed.skills.filter(skill => skill.origin === 'home')).toEqual([]);
    expect(listed.skills.filter(skill => skill.origin === 'repository').map(skill => [skill.name, skill.enabledBy])).toEqual([['docs', 'project'], ['glossary', 'project'], ['notes', 'project']]);
    const thread = await c.call('threads.start', { checkoutId: home.id, text: 'work' });
    await idle(c, thread.id);
    expect(harness.runs[0]!.resourceInstructions!.match(/- glossary:/g)).toHaveLength(1);
  });

  it('lists no home skill files when the home isn’t on this machine', async () => {
    const { c, homeFolder, checkout, saved } = await space({}, c => c.signedIn('Personal'));
    await rm(homeFolder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    const listed = await c.call('threads.skills', { checkoutId: checkout.id });
    expect(listed.space).toMatchObject({ id: saved.id, name: 'hrc', homeUnavailable: expect.stringContaining('home') });
    expect(listed.skills.filter(skill => skill.origin === 'home')).toEqual([]);
  });

  it('delivers a space’s library skills to Claude and Codex threads alike, chosen in Settings', async () => {
    const claude = new FakeHarness();
    const codex = new FakeHarness((_run, n) => replyWith(`codex says ${n}`, 'codex-thread'));
    const fake = new FakeCodex();
    const { c, checkout, saved, review } = await space({ harness: claude, codexHarness: codex, codexFactory: fake.factory }, async c => c.withChatGpt(await c.signedIn('Personal'), fake));
    await expect(c.call('skills.setScope', { id: review.id, scope: { global: false, profileIds: [], projectKeys: [], spaceIds: ['no-such-space'] } })).rejects.toThrow('No such space');
    await c.call('skills.setScope', { id: review.id, scope: { global: false, profileIds: [], projectKeys: [], spaceIds: [saved.id] } });
    for (const model of [{ harnessId: 'claudeCode', modelId: 'opus' }, { harnessId: 'codex', modelId: 'test-codex' }]) {
      const thread = await c.call('threads.start', { checkoutId: checkout.id, model, text: 'work' });
      await idle(c, thread.id);
    }
    for (const runs of [claude.runs, codex.runs]) {
      expect(runs).toHaveLength(1);
      expect(runs[0]!.resourceInstructions).toContain('- review: Helpful review');
      expect(runs[0]!.resourceInstructions).toContain('- glossary: Helpful glossary');
    }
  });
});
