import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { optionalScope } from '@accio/hub';
import type { SkillEntry, SkillSource } from '@accio/protocol';
import { runCommand, type CommandRunner } from './process.js';
import { inside } from '../paths.js';

/** Immutable source snapshots: updating a source never changes files a turn already received. */
export class SkillFiles {
  constructor(private home: string, private run: CommandRunner = runCommand) {}
  async fetch(source: SkillSource): Promise<SkillEntry[]> {
    if (source.url.startsWith('-') || source.ref.startsWith('-')) throw new Error('Invalid Git source or revision');
    const folder = join(this.home, 'hub', 'skill-sources', source.id, randomUUID());
    await mkdir(folder, { recursive: true });
    await this.run('git', ['clone', '--no-checkout', '--', source.url, folder], { timeout: 120_000 });
    await this.run('git', ['checkout', '--detach', source.ref], { cwd: folder });
    const revision = (await this.run('git', ['rev-parse', 'HEAD'], { cwd: folder })).trim();
    const skills: SkillEntry[] = [];
    const walk = async (dir: string, depth: number) => {
      if (depth > 12) return;
      const entries = await readdir(dir, { withFileTypes: true });
      if (entries.some(e => e.name === 'SKILL.md' && e.isFile())) {
        const content = await readFile(join(dir, 'SKILL.md'), 'utf8');
        const path = relative(folder, dir).split(sep).join('/') || '.';
        const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(content)?.[1]?.replace(/^["']|["']$/g, '') ?? '';
        skills.push({ id: `${source.id}:${path}`, sourceId: source.id, name: field('name') || dir.split(sep).at(-1)!, description: field('description'), path: dir, revision, scope: optionalScope() });
      }
      for (const entry of entries) if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules') await walk(join(dir, entry.name), depth + 1);
    };
    await walk(folder, 0);
    if (!skills.length) throw new Error('This source contains no SKILL.md files');
    return skills;
  }
  async validate(skill: SkillEntry) {
    const root = await realpath(join(this.home, 'hub', 'skill-sources'));
    if (!inside(root, await realpath(skill.path))) throw new Error('Skill is outside the managed source cache');
    // Reject symlinks anywhere in a skill: copied assets cannot escape the source.
    const walk = async (dir: string) => { for (const entry of await readdir(dir)) { const path = join(dir, entry); const stat = await lstat(path); if (stat.isSymbolicLink()) throw new Error('Skill contains a symbolic link'); if (stat.isDirectory() && entry !== '.git') await walk(path); } };
    await walk(skill.path);
  }
  async copy(skill: SkillEntry, checkout: string) {
    await this.validate(skill);
    const root = await realpath(checkout);
    const name = skill.name.replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!name) throw new Error('Skill needs a valid name');
    const target = resolve(root, '.agents', 'skills', name);
    for (const path of [join(root, '.agents'), join(root, '.agents', 'skills'), target]) {
      const stat = await lstat(path).catch((err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return undefined; throw err; });
      if (stat?.isSymbolicLink()) throw new Error('Cannot copy into a symbolic link');
      if (stat && path === target) throw new Error('This project already has a skill with that name');
    }
    await mkdir(join(root, '.agents', 'skills'), { recursive: true });
    await cp(skill.path, target, { recursive: true, errorOnExist: true, force: false, filter: path => !path.split(sep).includes('.git') });
    return { path: target };
  }
}
