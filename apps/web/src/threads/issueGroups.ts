import type { IssueList, IssueView } from '@accio/protocol';

export type IssueGroup = { name: string; issues: IssueView[] };

/**
 * GLOSSARY: Issue. How the picker groups open issues: GitHub issues by triage role,
 * ready for an agent first and blocked last; local issues by feature folder, each
 * folder's blocked issues after its startable ones. `query` matches label or title.
 */
export function issueGroups(list: IssueList, query = ''): IssueGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const issues = list.issues.filter((issue) => words.every((word) => `${issue.label} ${issue.title}`.toLowerCase().includes(word)));
  const blockedLast = (a: IssueView, b: IssueView) => Number(a.blockedBy.length > 0) - Number(b.blockedBy.length > 0);
  if (list.tracker?.kind === 'local') {
    const features = new Map<string, IssueView[]>();
    for (const issue of issues) features.set(issue.group ?? '', [...(features.get(issue.group ?? '') ?? []), issue]);
    return [...features].map(([name, members]) => ({ name, issues: members.sort(blockedLast) }));
  }
  const groups: IssueGroup[] = [
    { name: 'Ready for agent', issues: [] }, { name: 'Needs triage', issues: [] }, { name: 'Open', issues: [] }, { name: 'Blocked', issues: [] },
  ];
  for (const issue of issues) {
    const index = issue.blockedBy.length ? 3 : issue.status === 'ready-for-agent' ? 0 : issue.status === 'needs-triage' || issue.status === 'needs-info' ? 1 : 2;
    groups[index]!.issues.push(issue);
  }
  return groups.filter((group) => group.issues.length);
}
