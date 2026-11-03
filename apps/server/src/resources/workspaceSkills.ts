import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import type { LoadedSkill, WorkspaceSkill } from '@accio/protocol';
import { inside } from './skills.js';

const MAX_CONTENT = 1_000_000;

/** Only frontmatter describes a skill; headings or examples in its body do not. */
export function skillMetadata(content: string, fallback: string) {
  const header = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1] ?? '';
  const field = (name: string) => {
    const match = new RegExp(`^${name}:[ \\t]*([^\\r\\n]*)`, 'm').exec(header);
    if (!match) return '';
    const value = match[1]!.trim();
    if (/^[>|][-+]?$/.test(value)) {
      const lines = header.slice(match.index + match[0].length).split(/\r?\n/).slice(1);
      const collected: string[] = [];
      for (const line of lines) { if (line && !/^\s/.test(line)) break; collected.push(line.trim()); }
      return collected.join(value.startsWith('>') ? ' ' : '\n').trim();
    }
    return value.replace(/^(["'])(.*)\1$/, '$2');
  };
  return { name: field('name') || fallback, description: field('description') };
}

export async function readSkillFile(path: string) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > MAX_CONTENT) throw new Error('Skill instructions must be a text file smaller than 1 MB');
  return readFile(path, 'utf8');
}

/** Scan the executing worktree, never the checkout it was forked from. */
export async function repositorySkills(cwd: string): Promise<WorkspaceSkill[]> {
  const root = await realpath(cwd);
  const seen = new Set<string>();
  const skills: WorkspaceSkill[] = [];
  let visited = 0;
  const walk = async (path: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    if (++visited > 5000) throw new Error('Too many skill directories to scan');
    const actual = await realpath(path).catch((err: NodeJS.ErrnoException) => { if (err.code === 'ENOENT') return undefined; throw err; });
    if (!actual || !inside(root, actual) || seen.has(actual)) return;
    seen.add(actual);
    const stat = await lstat(actual);
    if (!stat.isDirectory()) return;
    const entries = await readdir(actual, { withFileTypes: true });
    if (entries.some(entry => entry.name === 'SKILL.md')) {
      const file = join(actual, 'SKILL.md');
      const target = await realpath(file);
      if (inside(root, target)) {
        const content = await readSkillFile(target);
        skills.push({ id: `repository:${relative(root, file).split(sep).join('/')}`, ...skillMetadata(content, basename(actual)), path: file, origin: 'repository', enabled: true, enabledBy: 'project' });
      }
    }
    for (const entry of entries) if ((entry.isDirectory() || entry.isSymbolicLink()) && !['.git', 'node_modules'].includes(entry.name)) await walk(join(actual, entry.name), depth + 1);
  };
  await walk(join(root, '.agents', 'skills'), 0);
  // .claude often contains compatibility wrappers for canonical .agents skills.
  // Prefer the canonical root by declared name, while preserving conflicts
  // within either root so unrelated duplicates still require a choice.
  const canonicalNames = new Set(skills.map(skill => skill.name));
  const canonicalCount = skills.length;
  await walk(join(root, '.claude', 'skills'), 0);
  skills.splice(canonicalCount, skills.length - canonicalCount, ...skills.slice(canonicalCount).filter(skill => !canonicalNames.has(skill.name)));
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Resolve again at the operation boundary; client IDs are never treated as paths. */
export async function repositorySkillTarget(cwd: string, skill: WorkspaceSkill) {
  const root = await realpath(cwd);
  const file = await realpath(skill.path);
  if (skill.origin !== 'repository' || !inside(root, file) || basename(file) !== 'SKILL.md') throw new Error('Skill is outside this workspace');
  return file;
}

export async function saveRepositorySkill(cwd: string, skill: WorkspaceSkill, content: string) {
  if (Buffer.byteLength(content) > MAX_CONTENT) throw new Error('Skill instructions exceed 1 MB');
  const file = await repositorySkillTarget(cwd, skill);
  const handle = await open(file, constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Skill instructions must be a file');
    await handle.truncate(0);
    await handle.writeFile(content, 'utf8');
  } finally { await handle.close(); }
}

const pathKey = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;

/** Conservative evidence: successful native invocation, Read, or a simple shell read.
 * Shell mentions, compound scripts, searches and failed calls do not establish loading.
 */
export function observedSkillLoads(name: string, input: unknown, summary: string, cwd: string, skills: WorkspaceSkill[]): LoadedSkill[] {
  const data = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  let candidates: WorkspaceSkill[] = [];
  if (name === 'Skill' && typeof data.skill === 'string') {
    candidates = skills.filter(skill => skill.enabled && skill.name === data.skill);
    if (candidates.length !== 1) return [];
  } else {
    const paths: string[] = [];
    if (['Read', 'read_file'].includes(name)) {
      const path = data.file_path ?? data.path;
      if (typeof path === 'string') paths.push(path);
    } else if (['Shell', 'Bash', 'exec_command'].includes(name)) {
      const command = data.command ?? data.cmd ?? summary;
      if (typeof command !== 'string') return [];
      // Support straightforward cat/type/Get-Content reads without interpreting a shell.
      // Reject operators, substitutions and interpolation instead of guessing execution.
      if (/[;|&<>`$\r\n]/.test(command)) return [];
      const tokens = command.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+/g)?.map(token => token.replace(/^(["'])(.*)\1$/, '$2')) ?? [];
      const reader = tokens.shift() ?? '';
      if (!/^(cat|type|Get-Content)$/i.test(reader)) return [];
      for (const token of tokens) {
        if (token.startsWith('-')) {
          if (reader.toLowerCase() === 'get-content' ? !/^-(Raw|LiteralPath|Path)$/i.test(token) : token !== '--') return [];
        } else paths.push(token);
      }
    }
    const base = typeof data.cwd === 'string' ? resolve(cwd, data.cwd) : cwd;
    const targets = new Set(paths.map(path => pathKey(resolve(base, path))));
    candidates = skills.filter(skill => skill.enabled && targets.has(pathKey(resolve(skill.path))));
  }
  return candidates.map(({ id, name, path }) => ({ id, name, path }));
}
