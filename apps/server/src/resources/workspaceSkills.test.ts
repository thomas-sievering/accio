import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceSkill } from '@accio/protocol';
import { observedSkillLoads, repositorySkills, skillMetadata } from './workspaceSkills.js';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';
import { runCommand } from './process.js';

const instructions = (name: string, body = 'Follow these instructions.') => `---\nname: ${name}\ndescription: Helpful ${name}\n---\n${body}\n`;
async function put(path: string, name: string) { await mkdir(path, { recursive: true }); await writeFile(join(path, 'SKILL.md'), instructions(name)); }

describe('workspace skill inventory and loading evidence', () => {
  let stop: (() => Promise<void>) | undefined;
  const folders: string[] = [];
  afterEach(async () => { await stop?.(); stop = undefined; for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });

  it('reads frontmatter only, including quoted and folded descriptions', () => {
    expect(skillMetadata('---\nname: "notes"\ndescription: >-\n  First line\n  second line\n---\nname: fake', 'fallback')).toEqual({ name: 'notes', description: 'First line second line' });
    expect(skillMetadata('name: fake\ndescription: body text', 'fallback')).toEqual({ name: 'fallback', description: '' });
  });

  it('finds both repository roots recursively, deduplicates aliases, excludes external links', async () => {
    const home = await mkdtemp(join(tmpdir(), 'accio-skills-')); folders.push(home);
    const root = join(home, 'repo'); const external = join(home, 'external');
    await put(join(root, '.agents', 'skills', 'nested', 'notes'), 'notes');
    await put(join(root, '.claude', 'skills', 'other'), 'other');
    await put(external, 'external');
    await symlink(external, join(root, '.agents', 'skills', 'outside'), 'junction');
    await symlink(join(root, '.agents', 'skills', 'nested'), join(root, '.claude', 'skills', 'alias'), 'junction');
    const skills = await repositorySkills(root);
    expect(skills.map(skill => skill.name)).toEqual(['notes', 'other']);
    expect(skills.every(skill => skill.enabled && skill.origin === 'repository')).toBe(true);
  });

  it('matches actual read/invocation inputs, never mentions, edits, searches or ambiguous names', () => {
    const skill: WorkspaceSkill = { id: 'notes', name: 'notes', path: resolve('repo/.agents/skills/notes/SKILL.md'), description: '', origin: 'repository', enabled: true, enabledBy: 'project' };
    const cwd = resolve('repo'); const file = '.agents/skills/notes/SKILL.md';
    expect(observedSkillLoads('Read', { file_path: file }, '', cwd, [skill])).toHaveLength(1);
    expect(observedSkillLoads('Shell', { command: `Get-Content -LiteralPath "${file}"` }, '', cwd, [skill])).toHaveLength(1);
    expect(observedSkillLoads('Skill', { skill: 'notes' }, '', cwd, [skill])).toHaveLength(1);
    expect(observedSkillLoads('Skill', { skill: 'notes' }, '', cwd, [skill, { ...skill, id: 'duplicate' }])).toEqual([]);
    for (const command of [`echo cat ${file}`, `echo '${file}'`, `rg notes ${file}`, `cat ${file} > copy`, `cat ${file}; false`, `cat --help ${file}`, `Get-Content ${file} -TotalCount 0`, `node -e "console.log('${file}')"`]) expect(observedSkillLoads('Shell', { command }, '', cwd, [skill])).toEqual([]);
    expect(observedSkillLoads('Edit', { file_path: file }, '', cwd, [skill])).toEqual([]);
    expect(observedSkillLoads('Read', { file_path: 'README.md' }, '', cwd, [skill])).toEqual([]);
  });

  it('prefers .agents by declared name across roots but preserves duplicates within a root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'accio-skills-')); folders.push(root);
    await put(join(root, '.agents', 'skills', 'canonical'), 'notes');
    await put(join(root, '.claude', 'skills', 'wrapper'), 'notes');
    await put(join(root, '.claude', 'skills', 'only-claude'), 'other');
    await put(join(root, '.claude', 'skills', 'duplicate-claude'), 'other');
    const skills = await repositorySkills(root);
    expect(skills.filter(skill => skill.name === 'notes').map(skill => skill.id)).toEqual(['repository:.agents/skills/canonical/SKILL.md']);
    expect(skills.filter(skill => skill.name === 'other')).toHaveLength(2);
    await put(join(root, '.agents', 'skills', 'duplicate-agents'), 'notes');
    expect((await repositorySkills(root)).filter(skill => skill.name === 'notes')).toHaveLength(2);
  });

  async function fixture(harness = new FakeHarness()) {
    const t = await startTestApp({ harness }); stop = t.stop;
    const c = await t.connect(); await c.signedIn('Personal');
    const folder = join(t.home, 'project'); const source = join(t.home, 'library');
    await put(join(folder, '.agents', 'skills', 'notes'), 'notes');
    await put(join(source, 'review'), 'review'); await put(join(source, 'docs'), 'docs');
    for (const cwd of [folder, source]) {
      await runCommand('git', ['init', '--quiet', '-b', 'main'], { cwd });
      await runCommand('git', ['add', '.'], { cwd });
      await runCommand('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'initial'], { cwd });
    }
    const checkout = await c.call('checkouts.add', { path: folder, profileId: 'personal' });
    await c.call('skills.addSource', { id: 'library', name: 'Library', url: source, ref: 'HEAD' });
    const library = (await c.call('resources.get', {})).skills;
    const review = library.find(skill => skill.name === 'review')!;
    const docs = library.find(skill => skill.name === 'docs')!;
    await c.call('skills.setScope', { id: docs.id, scope: { global: false, profileIds: ['personal'], projectKeys: [] } });
    return { t, c, folder, checkout, review, docs, harness };
  }

  it('lists the canonical copy without conflict and starts a turn when a compatibility copy exists', async () => {
    const { c, checkout, folder, harness } = await fixture();
    await put(join(folder, '.claude', 'skills', 'notes'), 'notes');
    await runCommand('git', ['add', '.'], { cwd: folder });
    await runCommand('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'compatibility copy'], { cwd: folder });
    const notes = (await c.call('threads.skills', { checkoutId: checkout.id })).skills.filter(skill => skill.name === 'notes');
    expect(notes).toHaveLength(1);
    expect(notes[0]).not.toHaveProperty('conflict');
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'work' });
    await c.waitFor('threads.changed', threads => threads.some(t => t.id === thread.id && t.status === 'idle'));
    expect(harness.runs).toHaveLength(1);
    expect(harness.runs[0]?.resourceInstructions).toContain(join('.agents', 'skills', 'notes', 'SKILL.md'));
    expect(harness.runs[0]?.resourceInstructions).not.toContain(join('.claude', 'skills', 'notes', 'SKILL.md'));
  });

  it('resolves draft scopes and project selections without changing inherited selections', async () => {
    const { t, c, checkout, review, docs } = await fixture();
    const context = { checkoutId: checkout.id };
    const state = await c.call('threads.skills', context);
    expect(state.projectId).toBe(checkout.projectId);
    expect(state.skills.find(skill => skill.name === 'notes')).toMatchObject({ origin: 'repository', enabledBy: 'project' });
    expect(state.skills.find(skill => skill.id === docs.id)).toMatchObject({ enabledBy: 'profile' });
    expect(state.skills.find(skill => skill.id === review.id)).toMatchObject({ enabled: false });
    await c.call('threads.setSkillEnabled', { ...context, skillId: review.id, enabled: true });
    expect((await c.call('threads.skills', context)).skills.find(skill => skill.id === review.id)).toMatchObject({ enabledBy: 'project', enabled: true });
    await c.call('threads.setSkillEnabled', { ...context, skillId: review.id, enabled: false });
    const secondFolder = join(t.home, 'second-project'); await mkdir(secondFolder);
    const second = await c.call('checkouts.add', { path: secondFolder, profileId: 'personal' });
    await Promise.all([
      c.call('threads.setSkillEnabled', { ...context, skillId: review.id, enabled: true }),
      c.call('threads.setSkillEnabled', { checkoutId: second.id, skillId: review.id, enabled: true }),
    ]);
    expect((await c.call('resources.get', {})).skills.find(skill => skill.id === review.id)?.scope.projectKeys.sort()).toEqual([`local:${checkout.projectId}`, `local:${second.projectId}`].sort());
    expect((await c.call('resources.get', {})).skills.find(skill => skill.id === docs.id)?.scope.profileIds).toEqual(['personal']);
    await expect(c.call('threads.setSkillEnabled', { ...context, skillId: docs.id, enabled: false })).rejects.toThrow('inherited');
    await expect(c.call('threads.skills', { checkoutId: checkout.id, profileId: 'different' })).rejects.toThrow('another profile');
    await expect(c.call('threads.skillContent', { ...context, skillId: '../../outside' })).rejects.toThrow('No such skill');
    await expect(c.call('threads.saveSkillContent', { ...context, skillId: review.id, content: 'changed' })).rejects.toThrow('Only repository');
    expect((await c.call('threads.skills', { profileId: 'personal' })).skills.every(skill => skill.origin === 'library')).toBe(true);
    await expect(c.call('threads.setSkillEnabled', { profileId: 'personal', skillId: review.id, enabled: true })).rejects.toThrow('Choose a project');
  });

  it('captures successful loads in the owned worktree, persists them, and edits only that worktree', async () => {
    const harness = new FakeHarness(async function* (run) {
      const file = join(run.cwd, '.agents', 'skills', 'notes', 'SKILL.md');
      yield { type: 'harness_event', event: { kind: 'tool', id: 'failed', name: 'Read', summary: file, input: { file_path: file }, status: 'error' } };
      yield { type: 'harness_event', event: { kind: 'tool', id: 'read', name: 'Read', summary: file, input: { file_path: file }, status: 'done', output: await readFile(file, 'utf8') } };
      yield* replyWith('done');
    });
    const { t, c, checkout, folder } = await fixture(harness);
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'Read notes' });
    await c.waitFor('threads.changed', threads => threads.some(t => t.id === thread.id && t.status === 'idle'));
    const context = { threadId: thread.id };
    const notes = (await c.call('threads.skills', context)).skills.find(skill => skill.name === 'notes')!;
    expect(notes.path).not.toContain(join(folder, '.agents'));
    expect(notes.loaded?.itemId).toContain(':read');
    expect(harness.runs[0]?.resourceInstructions).toContain(notes.path);
    const transcript = await c.call('threads.transcript', context);
    expect(transcript.find(item => item.kind === 'tool' && item.id.endsWith(':failed'))).not.toHaveProperty('loadedSkills');
    expect(transcript.find(item => item.id === notes.loaded!.itemId)).toMatchObject({ loadedSkills: [{ id: notes.id, name: 'notes', path: notes.path }] });
    await c.call('threads.saveSkillContent', { ...context, skillId: notes.id, content: instructions('notes', 'New instructions.') });
    expect((await c.call('threads.skillContent', { ...context, skillId: notes.id })).content).toContain('New instructions.');
    expect(await readFile(join(folder, '.agents', 'skills', 'notes', 'SKILL.md'), 'utf8')).not.toContain('New instructions.');
    await t.stop({ keepHome: true }); stop = undefined;
    const restarted = await startTestApp({ harness }, t.home); stop = restarted.stop;
    const again = await restarted.connect();
    expect((await again.call('threads.skills', context)).skills.find(skill => skill.id === notes.id)?.loaded).toEqual(notes.loaded);
  });

  it('keeps each running turn on its original selection and rejects edits during a turn', async () => {
    const held = gate();
    const harness = new FakeHarness(async function* () { await held.opened; yield* replyWith('done'); });
    const { c, checkout, review } = await fixture(harness);
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'work' });
    try {
      await expect.poll(() => harness.runs.length).toBe(1);
      const notes = (await c.call('threads.skills', { threadId: thread.id })).skills.find(skill => skill.name === 'notes')!;
      await expect(c.call('threads.saveSkillContent', { threadId: thread.id, skillId: notes.id, content: 'changed' })).rejects.toThrow('finish');
      await c.call('threads.setSkillEnabled', { threadId: thread.id, skillId: review.id, enabled: true });
      expect(harness.runs[0]?.resourceInstructions).not.toContain('Helpful review');
    } finally { held.release(); }
    await c.waitFor('threads.changed', threads => threads.some(t => t.id === thread.id && t.status === 'idle'));
    await c.call('threads.send', { threadId: thread.id, text: 'next' });
    await c.waitFor('threads.changed', threads => threads.some(t => t.id === thread.id && t.status === 'idle') && harness.runs.length === 2);
    expect(harness.runs[1]?.resourceInstructions).toContain('Helpful review');
  });
});
