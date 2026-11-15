import type { IssueList, IssueView } from '@accio/protocol';
import { issueState } from '../threads/offerRows';

/**
 * One row of the dashboard's Issues fold. `lane` is the dot's column. Lines cross the
 * row in three ways: `through` lanes pass by top to bottom, `incoming` lanes come
 * from the top edge into the dot, `outgoing` lanes leave the dot for the bottom edge.
 */
export type IssueRow = {
  issue: IssueView;
  state: 'ready' | 'blocked' | 'claimed';
  lane: number;
  through: number[];
  incoming: number[];
  outgoing: number[];
};

export type IssueGraph = { rows: IssueRow[]; lanes: number };

/**
 * GLOSSARY: Project dashboard. The Issues fold's rows: the open issues in dependency
 * order (no issue above one it waits on), each chain kept together, otherwise in the
 * tracker's order, with a git-log style gutter. A line runs from each issue down to
 * each issue it unblocks; an issue nothing connects to takes a free lane of its own.
 * `group` narrows the list to one parent issue or feature folder; waits on issues
 * outside it still show in the row but draw no line.
 */
export function issueGraph(list: IssueList, group?: string): IssueGraph {
  const issues = group === undefined ? list.issues : list.issues.filter((issue) => issue.group === group);
  const local = list.tracker?.kind === 'local';
  // Local issues name their blockers by number within their feature folder; GitHub ones by label.
  const blockerOf = (issue: IssueView, label: string) => issues.findIndex((other) => other !== issue && (local
    ? other.group === issue.group && /^\d+$/.test(label) && Number(other.label) === Number(label)
    : other.label === label));
  const waitsOn = issues.map((issue) => [...new Set(issue.blockedBy.map((label) => blockerOf(issue, label)).filter((i) => i >= 0))]);
  const unblocks = issues.map((_, i) => waitsOn.flatMap((blockers, j) => blockers.includes(i) ? [j] : []));

  // Depth-first topological order: after an issue, the issues it just freed, in tracker order.
  const order: number[] = [];
  const placed = new Set<number>();
  const free = (i: number) => !placed.has(i) && waitsOn[i]!.every((b) => placed.has(b));
  while (order.length < issues.length) {
    const fromChain = [...order].reverse().map((p) => unblocks[p]!.find(free)).find((i) => i !== undefined);
    // A cycle leaves nothing free; break it at the first unplaced issue.
    const next = fromChain ?? issues.findIndex((_, i) => free(i));
    const pick = next >= 0 ? next : issues.findIndex((_, i) => !placed.has(i));
    placed.add(pick);
    order.push(pick);
  }
  const rowOf = new Map(order.map((issue, row) => [issue, row]));

  // Each lane carries a line down to the issue it ends at, or is free.
  const lanes: (number | undefined)[] = [];
  const freeLane = () => { const i = lanes.indexOf(undefined); return i >= 0 ? i : lanes.length; };
  let width = 0;
  const rows = order.map((index): IssueRow => {
    const incoming = lanes.flatMap((target, lane) => target === index ? [lane] : []);
    const lane = incoming[0] ?? freeLane();
    for (const l of incoming) lanes[l] = undefined;
    const through = lanes.flatMap((target, l) => target === undefined ? [] : [l]);
    const outgoing: number[] = [];
    // Lines only run down: a broken cycle's edge back up is left out.
    const below = unblocks[index]!.filter((j) => rowOf.get(j)! > rowOf.get(index)!).sort((a, b) => rowOf.get(a)! - rowOf.get(b)!);
    for (const child of below) {
      // Join a line already heading to the same issue rather than drawing another beside it.
      const joined = lanes.indexOf(child);
      const target = joined >= 0 ? joined : !outgoing.includes(lane) && lanes[lane] === undefined ? lane : freeLane();
      lanes[target] = child;
      if (!outgoing.includes(target)) outgoing.push(target);
    }
    while (lanes.length && lanes.at(-1) === undefined) lanes.pop();
    width = Math.max(width, lane + 1, ...through.map((l) => l + 1), ...outgoing.map((l) => l + 1), ...incoming.map((l) => l + 1));
    const issue = issues[index]!;
    return { issue, state: issueState(issue), lane, through, incoming, outgoing };
  });
  return { rows, lanes: width };
}

/** The parent issues or feature folders the fold can narrow to, in tracker order. */
export function issueFilterGroups(list: IssueList) {
  return [...new Set(list.issues.flatMap((issue) => issue.group ? [issue.group] : []))];
}
