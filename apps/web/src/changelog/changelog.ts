import type { ChangelogEntry, CommitView } from '@accio/protocol';

/**
 * GLOSSARY: Changelog. The entries the sidebar's filters allow, as for threads: a project
 * entry when its project is in scope, a No project entry when its profile is shown. The
 * search matches the summary, things to try, thread title, target and PR number.
 */
export function filterChangelog(entries: readonly ChangelogEntry[], scope: { projectIds: ReadonlySet<string>; profile: string; query: string }): ChangelogEntry[] {
  const words = scope.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (!scope.projectIds.has(e.projectId)) return false;
    if (!e.projectId && scope.profile !== 'all' && e.profileId !== scope.profile) return false;
    if (!words.length) return true;
    const text = [e.note?.summary, ...(e.note?.test ?? []), e.title, e.target, e.pullRequest && `#${e.pullRequest.number}`].join('\n').toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** "Merged into main · #12" or "Shipped to main": where the change landed. */
export function landedText(e: ChangelogEntry): string {
  return e.pullRequest ? `Merged into ${e.target} · #${e.pullRequest.number}` : `Shipped to ${e.target}`;
}

/** "Today", "Yesterday", or a date such as "Mon 3 Nov": the day a change shipped. */
export function shippedDay(iso: string, now: Date): string {
  const day = new Date(iso);
  if (day.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', ...(day.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

/** Entries grouped by the day they shipped, keeping their newest-first order. */
export function byDay(entries: readonly ChangelogEntry[], now: Date): { day: string; entries: ChangelogEntry[] }[] {
  const groups: { day: string; entries: ChangelogEntry[] }[] = [];
  for (const e of entries) {
    const day = shippedDay(e.deliveredAt, now);
    if (groups.at(-1)?.day === day) groups.at(-1)!.entries.push(e);
    else groups.push({ day, entries: [e] });
  }
  return groups;
}

/**
 * The Changelog entry that delivered a commit on the default branch: the same revision
 * (either may be abbreviated), or else the PR a squash merge names at the end of its subject.
 */
export function entryForCommit(c: CommitView, entries: readonly ChangelogEntry[]): ChangelogEntry | undefined {
  const sameRevision = entries.find((e) => e.revision && (c.sha.startsWith(e.revision) || e.revision.startsWith(c.sha)));
  if (sameRevision) return sameRevision;
  const pr = Number(c.subject.match(/\(#(\d+)\)\s*$/)?.[1]);
  return pr > 0 ? entries.find((e) => e.pullRequest?.number === pr) : undefined;
}
