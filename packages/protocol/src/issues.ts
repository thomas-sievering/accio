import { z } from 'zod';
import { method } from './rpc.js';

/**
 * GLOSSARY: Issue tracker. Where a project's open issues live, as its agent skills
 * describe it: GitHub Issues, or markdown files under `.scratch/`.
 */
export type IssueTrackerView = { kind: 'github'; repository: string } | { kind: 'local'; folder: string };

/**
 * GLOSSARY: Issue. One open issue a new thread can pick up. `ref` is what the first
 * message names (`#208`, or the file's path in the checkout); `label` is how the
 * picker shows it (`#208`, `01`).
 */
export type IssueView = {
  ref: string;
  label: string;
  title: string;
  /** The triage role, when the issue carries one of the default triage labels or a `Status:` line. */
  status?: 'ready-for-agent' | 'needs-triage' | 'needs-info' | 'ready-for-human' | 'claimed';
  /** Open issues this one waits for, by label. */
  blockedBy: string[];
  /** The parent issue's title, or a local issue's feature folder. */
  group?: string;
  labels: string[];
  assignees: string[];
  url?: string;
};

/** A checkout's open issues, or why there are none to show. A project with no tracker has neither tracker nor issues. */
export type IssueList = { tracker?: IssueTrackerView; issues: IssueView[]; unavailable?: string };

const CheckoutIssues = z.object({ checkoutId: z.string().min(1) });
export const issueMethods = {
  /** The open issues of a checkout's tracker, for a new thread to pick up. */
  'threads.issues': method<typeof CheckoutIssues, IssueList>(CheckoutIssues),
};

/** The first message for a picked issue: its reference and title, then any notes. */
export function issueMessage(issue: Pick<IssueView, 'ref' | 'title'>, notes: string) {
  const line = `Work on ${issue.ref}: ${issue.title}`;
  return notes.trim() ? `${line}\n\n${notes.trim()}` : line;
}
