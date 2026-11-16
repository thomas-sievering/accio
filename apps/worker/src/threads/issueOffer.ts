import { z } from 'zod';
import type { IssueList, IssueView, OfferedIssue } from '@accio/protocol';
import { ACCIO_MCP_SERVER, accioTool } from '../tools/tools.js';

/**
 * GLOSSARY: Issue offer. Issues a harness has just published, offered through accio's
 * `offer_issues` tool so you can start a thread on each ready one, like the issue
 * picker does. The call checks the references against the project's tracker; Accio
 * then shows the offer in place of the tool row.
 */
const ISSUE_OFFER_TOOL = 'offer_issues';

const MAX_OFFERED = 20;

const issueOfferInput = {
  refs: z.array(z.string().trim().min(1).max(4096)).min(1).max(MAX_OFFERED)
    .describe("The issues to implement, in the order to do them: GitHub issues as '#207', local issues by their path in the checkout, such as '.scratch/search/issues/01-index.md'. Leave out a parent spec that its tickets cover."),
};

const IssueOfferInput = z.object(issueOfferInput);

const ISSUE_OFFER_DESCRIPTION = 'Offer issues you just published to the project\'s issue tracker, so the user can start a thread that implements each one. '
  + 'Call it once after creating the tickets, with every issue meant to be implemented; Accio shows which are ready and which wait on others. '
  + 'Afterwards don\'t list the issues again in full; a short summary is enough.';

/** Claude names MCP tools `mcp__accio__offer_issues`, Codex `accio/offer_issues`. */
export function isIssueOfferTool(name: string): boolean {
  return name === ISSUE_OFFER_TOOL || name === `mcp__${ACCIO_MCP_SERVER}__${ISSUE_OFFER_TOOL}` || name === `${ACCIO_MCP_SERVER}/${ISSUE_OFFER_TOOL}`;
}

/** The offered references, once the harness has sent complete, valid arguments. */
export function parseIssueOffer(input: unknown): string[] | undefined {
  const parsed = IssueOfferInput.safeParse(input);
  return parsed.success ? parsed.data.refs : undefined;
}

/** The open issue a reference names: `#207`, `207`, its URL, or a local path with either slash. */
export function findIssue(issues: readonly IssueView[], ref: string): IssueView | undefined {
  const wanted = ref.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const number = /^#?([1-9]\d*)$/.exec(wanted)?.[1] ?? /\/issues\/([1-9]\d*)\/?$/.exec(wanted)?.[1];
  return issues.find((issue) => issue.ref === wanted || issue.url === wanted || (number !== undefined && issue.ref === `#${number}`));
}

/**
 * The offer as the tracker lists it, each issue once. Throws when a reference isn't
 * an open issue there, so the harness sees its mistake and can call again.
 */
export function offeredIssues(list: IssueList, refs: readonly string[]): OfferedIssue[] {
  if (list.unavailable) throw new Error(list.unavailable);
  if (!list.tracker) throw new Error('This project has no issue tracker Accio can read, so it can\'t offer issues.');
  const where = list.tracker.kind === 'github' ? list.tracker.repository : `${list.tracker.folder} in the project's checkout`;
  const missing = refs.filter((ref) => !findIssue(list.issues, ref));
  if (missing.length) throw new Error(`Not an open issue in ${where}: ${missing.join(', ')}.`);
  const offered = new Map<string, OfferedIssue>();
  for (const ref of refs) {
    const issue = findIssue(list.issues, ref)!;
    if (!offered.has(issue.ref)) offered.set(issue.ref, { ref: issue.ref, label: issue.label, title: issue.title, ...(issue.url ? { url: issue.url } : {}) });
  }
  return [...offered.values()];
}

/** Whether a thread can start on an issue now; otherwise why not, in the card's words. */
export function implementable(issue: IssueView | undefined): { ok: true } | { ok: false; reason: string } {
  if (!issue) return { ok: false, reason: 'closed' };
  if (issue.blockedBy.length) return { ok: false, reason: `waits on ${issue.blockedBy.join(', ')}` };
  if (issue.status === 'claimed' || issue.assignees.length) return { ok: false, reason: 'claimed' };
  return { ok: true };
}

/**
 * The accio tool, listed only for threads in a project. `check` reads the thread's
 * tracker afresh and throws for references it doesn't list.
 */
export function issueOfferTool(check: (threadId: string, refs: string[]) => Promise<OfferedIssue[]>, inProject: (threadId: string) => boolean) {
  return accioTool({
    name: ISSUE_OFFER_TOOL,
    description: ISSUE_OFFER_DESCRIPTION,
    input: issueOfferInput,
    available: inProject,
    call: async ({ refs }, { threadId }) => {
      const offered = await check(threadId, refs);
      return `The user sees ${offered.map((issue) => issue.label).join(', ')} with a button to implement each ready one in a new thread.`;
    },
  });
}
