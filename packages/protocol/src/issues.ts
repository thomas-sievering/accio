import { z } from 'zod';
import { method } from './rpc.js';
import type { ThreadView } from './threads.js';

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

/**
 * GLOSSARY: Issue offer. One issue a thread offered through the offer_issues accio tool,
 * as the tracker had it then; `threadId` once a thread was started from it there.
 */
export type OfferedIssue = { ref: string; label: string; title: string; url?: string; threadId?: string };

/** Each offered issue as the tracker has it now; no `issue` once it is closed or no longer listed. */
export type IssueOfferStatus = { issues: { ref: string; issue?: IssueView }[]; unavailable?: string };

/** GLOSSARY: Issue. One open issue's body as its tracker has it: the GitHub issue's markdown, or a local issue file without its title line. */
export type IssueBody = { ref: string; body: string };

const CheckoutIssues = z.object({ checkoutId: z.string().min(1) });
const CheckoutIssue = CheckoutIssues.extend({ ref: z.string().min(1).max(4096) });
const Offer = z.object({ threadId: z.string(), offerId: z.string().min(1).max(512) });
const OfferIssue = Offer.extend({ ref: z.string().min(1).max(4096) });
export const issueMethods = {
  /** The open issues of a checkout's tracker, for a new thread to pick up. */
  'threads.issues': method<typeof CheckoutIssues, IssueList>(CheckoutIssues),
  /** GLOSSARY: Issue. One open issue's body, read when it is opened rather than with the list. */
  'threads.issueBody': method<typeof CheckoutIssue, IssueBody>(CheckoutIssue),
  /** GLOSSARY: Issue offer. How the tracker has the issues of one offer now. */
  'threads.offeredIssues': method<typeof Offer, IssueOfferStatus>(Offer),
  /** GLOSSARY: Issue offer. Starts a thread on one ready issue of an offer, claiming it like the picker. */
  'threads.implementIssue': method<typeof OfferIssue, ThreadView>(OfferIssue),
};

/**
 * GLOSSARY: Issue. The GitHub issue a first message works on: the first `#123` in its
 * first line, as in `Work on #208: …` or `Implement GitHub issue #196 (…)`.
 */
export function issueNamedIn(text: string) {
  return /(?<![\w&/])#([1-9]\d*)\b/.exec(text.trimStart().split('\n')[0]!)?.[0];
}

/** The first message for a picked issue: its reference and title, then any notes. */
export function issueMessage(issue: Pick<IssueView, 'ref' | 'title'>, notes: string) {
  const line = `Work on ${issue.ref}: ${issue.title}`;
  return notes.trim() ? `${line}\n\n${notes.trim()}` : line;
}

/**
 * GLOSSARY: Issue offer. The first message of a thread started from an offer: the issue,
 * the implement skill when the project has one, and the thread that planned it.
 */
export function implementMessage(issue: Pick<IssueView, 'ref' | 'title'>, plannedIn: string) {
  return issueMessage(issue, `Use the implement skill if it is enabled. This issue was planned in @${plannedIn}; read that thread when the issue leaves something open.`);
}
