import { parse } from 'yaml';

/**
 * Whether a GitHub Actions workflow could have run for a delivered commit, read
 * from its `on:` branch and path filters. Delivery asks this only after GitHub
 * reported no checks, to tell "filtered out" apart from "never started".
 *
 * Every answer leans towards "may run": an unclear trigger, filter or pattern
 * keeps the missing checks a blocker. `files` must be a superset of what GitHub
 * compares, so a path filter can only be over-matched.
 */
export type TriggerEvent = { name: 'push'; branch: string } | { name: 'pull_request'; base: string };

/** Events that never report checks on a delivered commit as part of its delivery. */
const UNRELATED = new Set(['workflow_dispatch', 'workflow_call', 'schedule', 'repository_dispatch', 'release', 'issues',
  'issue_comment', 'discussion', 'discussion_comment', 'label', 'milestone', 'project', 'project_card', 'project_column',
  'watch', 'fork', 'gollum', 'public', 'page_build', 'registry_package', 'deployment', 'deployment_status',
  'branch_protection_rule', 'create', 'delete']);
/** GitHub runs path-filtered workflows regardless when a diff has more files than this. */
const PATH_FILTER_LIMIT = 300;

export function workflowMayRun(source: string, events: TriggerEvent[], files: string[]): boolean {
  let on: unknown;
  try { on = (parse(source) as any)?.on; } catch { return true; }
  const triggers = typeof on === 'string' ? { [on]: null } : Array.isArray(on) ? Object.fromEntries(on.map(e => [e, null])) : on;
  if (!triggers || typeof triggers !== 'object') return true;
  for (const [name, filters] of Object.entries(triggers)) {
    if (UNRELATED.has(name)) continue;
    if (name !== 'push' && name !== 'pull_request') return true;
    for (const event of events) {
      if (event.name !== name) continue;
      try { if (filtersMayRun(filters, event, files)) return true; }
      catch { return true; }
    }
  }
  return false;
}

function filtersMayRun(filters: unknown, event: TriggerEvent, files: string[]): boolean {
  if (filters === null || filters === undefined) return true;
  if (typeof filters !== 'object' || Array.isArray(filters)) throw new Error('unreadable filters');
  const f = filters as Record<string, unknown>;
  const ref = event.name === 'push' ? event.branch : event.base;
  if (f.branches !== undefined) { if (!matches(list(f.branches), ref)) return false; }
  else if (f['branches-ignore'] !== undefined) { if (ignored(list(f['branches-ignore']), ref)) return false; }
  // A push filtered only by tags never runs for a branch.
  else if (event.name === 'push' && (f.tags !== undefined || f['tags-ignore'] !== undefined)) return false;
  if (f.paths === undefined && f['paths-ignore'] === undefined) return true;
  if (!files.length || files.length > PATH_FILTER_LIMIT) return true;
  if (f.paths !== undefined) return files.some(file => matches(list(f.paths), file));
  return files.some(file => !ignored(list(f['paths-ignore']), file));
}

function list(value: unknown): string[] {
  const items = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(items) || !items.every(i => typeof i === 'string')) throw new Error('unreadable filter');
  return items;
}

/** Ordered include filter: the last matching pattern wins. Includes match generously, `!` exclusions strictly. */
function matches(patterns: string[], value: string): boolean {
  let included = false;
  for (const p of patterns) {
    if (p.startsWith('!')) { if (included && globMatch(p.slice(1), value, false)) included = false; }
    else if (!included && globMatch(p, value, true)) included = true;
  }
  return included;
}

/** Ordered ignore filter: ignores match strictly, `!` re-inclusions generously. */
function ignored(patterns: string[], value: string): boolean {
  let out = false;
  for (const p of patterns) {
    if (p.startsWith('!')) { if (out && globMatch(p.slice(1), value, true)) out = false; }
    else if (!out && globMatch(p, value, false)) out = true;
  }
  return out;
}

/** A generous match also accepts a pattern naming one of the value's parent directories. */
function globMatch(pattern: string, value: string, generous: boolean): boolean {
  const re = globRegExp(pattern);
  if (re.test(value)) return true;
  if (!generous) return false;
  const parts = value.split('/');
  return parts.slice(1).some((_, i) => re.test(parts.slice(0, i + 1).join('/')));
}

/** GitHub's filter pattern syntax: `*` stays within a segment, `**` crosses them, `?` and `+` quantify the previous character. */
export function globRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') { i++; out += '(?:.*/)?'; }
        else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?' || c === '+') out += c;
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end < 0) throw new Error('unclosed character class');
      out += pattern.slice(i, end + 1);
      i = end;
    } else if (c === '\\') {
      const next = pattern[++i];
      if (next === undefined) throw new Error('trailing escape');
      out += next.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    } else out += c.replace(/[.^${}()|\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}
