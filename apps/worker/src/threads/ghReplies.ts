import { z } from 'zod';

/**
 * The parts of gh's JSON replies that delivery reads. Only those fields are checked, so fields
 * gh adds later change nothing; a field Accio reads that changes shape fails here, naming the command.
 */
const text = z.string().nullish();

/** One entry of a PR's statusCheckRollup, a check run or a commit status. */
export const GhCheck = z.object({
  name: text, context: text, conclusion: text, status: text, state: text,
  html_url: text, detailsUrl: text, target_url: text, targetUrl: text,
});
export type GhCheck = z.infer<typeof GhCheck>;

/** `gh pr view|list --json` with delivery's PR fields. */
export const GhPullRequest = z.object({
  url: z.string(),
  state: z.string(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  isDraft: z.boolean().nullish(),
  mergeCommit: z.object({ oid: z.string() }).nullish(),
  mergedAt: text,
  statusCheckRollup: z.array(GhCheck).nullish(),
  reviewDecision: text,
  autoMergeRequest: z.unknown().optional(),
  mergeStateStatus: text,
  mergeable: text,
});
export type GhPullRequest = z.infer<typeof GhPullRequest>;
export const GhPullRequests = z.array(GhPullRequest);

export const GhCheckRuns = z.object({ total_count: z.number(), check_runs: z.array(GhCheck) });
export const GhCommitStatus = z.object({ total_count: z.number(), statuses: z.array(GhCheck) });
export const GhWorkflows = z.object({ workflows: z.array(z.object({ state: z.string(), path: z.string().nullish() })) });
export const GhJob = z.object({ status: text, conclusion: text, steps: z.array(z.object({ name: z.string(), status: z.string() })).nullish() });
export const GhBranchRules = z.array(z.object({ type: z.string() }));
export const GhBranch = z.object({ protection: z.object({ enabled: z.boolean().nullish() }).nullish() });
