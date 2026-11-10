import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IssueList, IssueTrackerView, IssueView } from '@accio/protocol';
import { maybeGit } from '../git.js';

/** Runs gh in a repository as a profile's GitHub account and returns stdout. */
export type GhAs = (profileId: string, cwd: string, args: string[]) => Promise<string>;

/**
 * Where a checkout's issues live. `configured` is true when the agent skills say so;
 * a GitHub origin alone is only a guess, so its failures stay quiet.
 */
export type Tracker =
  | { kind: 'github'; repository: string; configured: boolean }
  | { kind: 'local'; configured: boolean }
  | { kind: 'unsupported'; name: string };

const TRIAGE = ['ready-for-agent', 'needs-triage', 'needs-info', 'ready-for-human'] as const;
const LOCAL_STATUS = [...TRIAGE, 'claimed'] as const;
const DONE = /^(resolved|done|closed|fixed|wontfix|won't fix|complete|completed)$/i;
const SCRATCH = '.scratch';
const FRESH_MS = 20_000;

/**
 * GLOSSARY: Issue tracker. Reads the tracker the project's agent skills name
 * (`docs/agents/issue-tracker.md`, or the Agent skills block in CLAUDE.md or
 * AGENTS.md), else local issue files under `.scratch/`, else the GitHub origin.
 */
export async function findTracker(cwd: string): Promise<Tracker | undefined> {
  const configured = await configuredTracker(cwd);
  const origin = await maybeGit(cwd, 'config', '--get', 'remote.origin.url');
  const repository = origin ? githubRepository(origin) : undefined;
  if (configured === 'github') return repository ? { kind: 'github', repository, configured: true } : { kind: 'unsupported', name: 'GitHub without a GitHub origin' };
  if (configured === 'local') return { kind: 'local', configured: true };
  if (configured) return { kind: 'unsupported', name: configured };
  if ((await localIssueFiles(cwd)).length) return { kind: 'local', configured: false };
  return repository ? { kind: 'github', repository, configured: false } : undefined;
}

/** A checkout's open issues, read again at most every 20 seconds. */
export class Issues {
  private recent = new Map<string, { at: number; list: Promise<IssueList> }>();
  constructor(private gh: GhAs) {}

  list(profileId: string, cwd: string): Promise<IssueList> {
    const key = `${profileId}\n${cwd}`;
    const known = this.recent.get(key);
    if (known && Date.now() - known.at < FRESH_MS) return known.list;
    const list = this.read(profileId, cwd);
    this.recent.set(key, { at: Date.now(), list });
    list.catch(() => this.recent.delete(key));
    return list;
  }

  /**
   * Claims a picked issue for a new thread: assigns it on GitHub, or sets a local
   * issue's `Status:` line to claimed in the thread's worktree, else in the
   * checkout when the issue files are not in git.
   */
  async claim(profileId: string, checkoutPath: string, worktree: string, ref: string): Promise<void> {
    this.recent.clear();
    const tracker = await findTracker(checkoutPath);
    if (tracker?.kind === 'github') {
      const number = /^#([1-9]\d*)$/.exec(ref)?.[1];
      if (!number) throw new Error(`${ref} is not a GitHub issue`);
      await this.gh(profileId, checkoutPath, ['issue', 'edit', number, '--add-assignee', '@me']);
      return;
    }
    if (tracker?.kind !== 'local') throw new Error('This project has no issue tracker Accio can claim in');
    const issue = (await localIssues(checkoutPath)).find((i) => i.ref === ref);
    if (!issue) throw new Error(`${ref} is not an open issue`);
    const inWorktree = await readFile(join(worktree, ref), 'utf8').then((text) => ({ text, root: worktree }), () => undefined);
    const target = inWorktree ?? { text: await readFile(join(checkoutPath, ref), 'utf8'), root: checkoutPath };
    await writeFile(join(target.root, ref), withStatus(target.text, 'claimed'));
  }

  private async read(profileId: string, cwd: string): Promise<IssueList> {
    const tracker = await findTracker(cwd);
    if (!tracker) return { issues: [] };
    if (tracker.kind === 'unsupported') return { issues: [], unavailable: `Accio can't list issues from ${tracker.name} yet.` };
    const view: IssueTrackerView = tracker.kind === 'github' ? { kind: 'github', repository: tracker.repository } : { kind: 'local', folder: SCRATCH };
    if (tracker.kind === 'local') return { tracker: view, issues: await localIssues(cwd) };
    try {
      return { tracker: view, issues: await githubIssues((args) => this.gh(profileId, cwd, args)) };
    } catch (error) {
      // An unconfigured GitHub guess shows nothing rather than an error about a tracker nobody chose.
      if (!tracker.configured) return { issues: [] };
      return { tracker: view, issues: [], unavailable: `Couldn't read issues with gh: ${firstLine(error)}` };
    }
  }
}

async function configuredTracker(cwd: string): Promise<string | undefined> {
  const doc = await readFile(join(cwd, 'docs', 'agents', 'issue-tracker.md'), 'utf8').catch(() => undefined);
  const heading = doc && /^#\s*Issue tracker:\s*(.+)$/im.exec(doc)?.[1]?.trim();
  if (heading) return trackerKind(heading);
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const text = await readFile(join(cwd, name), 'utf8').catch(() => undefined);
    const section = text && /^###\s*Issue tracker\s*$([\s\S]*?)(?=^#{1,3}\s|(?![\s\S]))/im.exec(text)?.[1]?.trim();
    if (section) return trackerKind(section);
  }
  return undefined;
}

function trackerKind(text: string) {
  if (/\bgithub\b/i.test(text)) return 'github';
  if (/\blocal\b|\.scratch/i.test(text)) return 'local';
  if (/\bgitlab\b/i.test(text)) return 'GitLab';
  return text.split('\n')[0]!.replace(/[.`*]/g, '').slice(0, 60) || 'this tracker';
}

export function githubRepository(origin: string) {
  return /github\.com[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i.exec(origin.trim())?.[1];
}

type GhIssue = {
  number: number; title: string; url?: string;
  labels?: { name: string }[]; assignees?: { login: string }[];
  blockedBy?: { nodes?: { number: number; state: string }[] };
  parent?: { number: number; title: string } | null;
};

async function githubIssues(gh: (args: string[]) => Promise<string>): Promise<IssueView[]> {
  const list = (fields: string) => gh(['issue', 'list', '--state', 'open', '--limit', '200', '--json', fields]);
  const base = 'number,title,url,labels,assignees';
  // gh before 2.94 has no dependency or parent fields; those issues just show no blockers.
  const out = await list(`${base},blockedBy,parent`).catch((error) => /Unknown JSON field/i.test(String(error)) ? list(base) : Promise.reject(error));
  return (JSON.parse(out) as GhIssue[]).map((issue) => {
    const labels = (issue.labels ?? []).map((l) => l.name);
    const status = TRIAGE.find((role) => labels.includes(role));
    return {
      ref: `#${issue.number}`, label: `#${issue.number}`, title: issue.title,
      ...(status ? { status } : {}),
      blockedBy: (issue.blockedBy?.nodes ?? []).filter((b) => b.state === 'OPEN').map((b) => `#${b.number}`),
      ...(issue.parent ? { group: `#${issue.parent.number} ${issue.parent.title}` } : {}),
      labels: labels.filter((l) => !status || l !== status),
      assignees: (issue.assignees ?? []).map((a) => a.login),
      ...(issue.url ? { url: issue.url } : {}),
    };
  });
}

/** `.scratch/<feature>/issues/*.md`, as paths relative to the checkout with forward slashes. */
async function localIssueFiles(cwd: string): Promise<string[]> {
  const features = await readdir(join(cwd, SCRATCH), { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const feature of features.filter((f) => f.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const names = await readdir(join(cwd, SCRATCH, feature.name, 'issues')).catch(() => [] as string[]);
    files.push(...names.filter((n) => n.toLowerCase().endsWith('.md')).sort().map((n) => `${SCRATCH}/${feature.name}/issues/${n}`));
  }
  return files;
}

/** The open local issues: each file's title, `Status:` and `Blocked by:` lines. */
export async function localIssues(cwd: string): Promise<IssueView[]> {
  const parsed = await Promise.all((await localIssueFiles(cwd)).map(async (ref) => {
    const text = await readFile(join(cwd, ref), 'utf8');
    const [, feature, , file] = ref.split('/');
    const label = /^(\d+)/.exec(file!)?.[1] ?? file!.replace(/\.md$/i, '');
    const status = headerLine(text, 'Status')?.toLowerCase();
    const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? file!.replace(/\.md$/i, '').replace(/^\d+-/, '').replace(/-/g, ' ');
    const blockers = (headerLine(text, 'Blocked by') ?? '').split(/[,\s]+/).map((b) => /(\d+)/.exec(b)?.[1]).filter((b): b is string => !!b);
    return { ref, feature: feature!, label, title, status, blockers, open: !status || !DONE.test(status) };
  }));
  return parsed.filter((i) => i.open).map((issue) => {
    const status = LOCAL_STATUS.find((role) => role === issue.status);
    const blockedBy = issue.blockers.filter((n) => parsed.some((other) => other.feature === issue.feature && other.open && Number(other.label) === Number(n)));
    return { ref: issue.ref, label: issue.label, title: issue.title, ...(status ? { status } : {}), blockedBy, group: issue.feature, labels: [], assignees: [] };
  });
}

/** A `Name: value` line before the body's first section heading. */
function headerLine(text: string, name: string) {
  const header = text.split(/^##\s/m)[0]!;
  return new RegExp(`^\\**${name}\\**:\\**\\s*(.+?)\\s*$`, 'im').exec(header)?.[1]?.trim();
}

/** The issue text with its `Status:` line set, added under the title when it has none. */
export function withStatus(text: string, status: string) {
  const header = text.split(/^##\s/m)[0]!;
  const line = /^\**Status\**:.*$/im.exec(header);
  if (line) return text.slice(0, line.index) + `Status: ${status}` + text.slice(line.index + line[0].length);
  const title = /^#\s+.+$/m.exec(text);
  if (!title) return `Status: ${status}\n\n${text}`;
  const end = title.index + title[0].length;
  return `${text.slice(0, end)}\n\nStatus: ${status}${text.slice(end).replace(/^\r?\n(?!\r?\n)/, '\n\n')}`;
}

function firstLine(error: unknown) {
  const stderr = (error as { stderr?: unknown })?.stderr;
  return (typeof stderr === 'string' && stderr.trim() ? stderr : error instanceof Error ? error.message : String(error)).split('\n').find((l) => l.trim())?.trim() ?? 'unknown error';
}
