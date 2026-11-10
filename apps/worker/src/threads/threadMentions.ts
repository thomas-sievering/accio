import { findMentionedThread, MENTION, threadHandle, type ThreadView, type TranscriptItem } from '@accio/protocol';
import { READ_THREAD_TOOL, readThreadPage } from './handoff.js';

/** The threads a message mentions with @ that its thread may read: the same profile's, other than itself, in order of mention. */
export function mentionedThreads(text: string, threads: readonly ThreadView[], caller: { id: string; profileId: string }): ThreadView[] {
  const readable = threads.filter((t) => t.profileId === caller.profileId && t.id !== caller.id);
  const found: ThreadView[] = [];
  for (const match of text.matchAll(MENTION)) {
    const thread = findMentionedThread(readable, match[1]!);
    if (thread && !found.includes(thread)) found.push(thread);
  }
  return found;
}

/** Where the thread sits for the user, in the sidebar's words. */
function placeOf(t: ThreadView, now: Date): string {
  if (t.settledAt) return `settled ${t.settledAt.slice(0, 10)}`;
  if (t.snoozedUntil && new Date(t.snoozedUntil) > now) return `snoozed until ${t.snoozedUntil.slice(0, 10)}`;
  if (t.status === 'running') return 'working';
  if (t.status === 'failed') return 'open, last turn failed';
  if (t.status === 'interrupted') return 'open, last turn interrupted';
  return 'open';
}

function line(t: ThreadView, now: Date): string {
  const facts = [placeOf(t, now)];
  if (t.machine) facts.push(`on ${t.machine.name}${t.machine.online ? '' : ' (offline)'}`);
  if (t.projectName) facts.push(`project ${t.projectName}`);
  if (t.workspace?.branch) facts.push(`branch ${t.workspace.branch}`);
  const pr = t.delivery?.pullRequest?.url ?? t.delivery?.pullRequestUrl;
  if (pr) facts.push(`PR ${pr}${t.delivery?.pullRequest ? `, ${t.delivery.pullRequest.state}` : ''}`);
  else if (t.delivery?.status === 'delivered') facts.push(`delivered to ${t.delivery.baseBranch}`);
  return `- @${threadHandle(t)}: "${t.title || 'Untitled'}" (${facts.join('; ')})`;
}

/**
 * GLOSSARY: Thread mention. What the harness reads about the threads a message mentions:
 * a line each, after the message. Their conversations stay out of the prompt; the
 * agent reads them with the read_thread accio tool when it needs to. Empty when none.
 */
export function threadMentionContext(text: string, threads: readonly ThreadView[], caller: { id: string; profileId: string }, now = new Date()): string {
  const found = mentionedThreads(text, threads, caller);
  if (!found.length) return '';
  return `[Threads mentioned with @, from accio. Read a conversation with the accio ${READ_THREAD_TOOL} tool, passing its handle, when you need it.\n`
    + `${found.map((t) => line(t, now)).join('\n')}]`;
}

/** The message with the mentioned threads noted after it, as image files are. */
export function withThreadMentions(text: string, context: string) {
  if (!context) return text;
  return text ? `${text}\n\n${context}` : context;
}

export type ReadMentionedDeps = {
  /** Every thread this machine knows, other machines' included. */
  threads: () => readonly ThreadView[];
  /** A thread's transcript, through the relay when another machine has it. */
  transcript: (threadId: string) => Promise<readonly TranscriptItem[]>;
};

/** read_thread for a thread the user mentioned: one of the caller's profile, found by its handle or id. */
export async function readMentionedThread(deps: ReadMentionedDeps, callerId: string, handle: string, offset: number | undefined, limit: number): Promise<string> {
  const all = deps.threads();
  const caller = all.find((t) => t.id === callerId);
  if (!caller) throw new Error('This thread is not on this machine.');
  const readable = all.filter((t) => t.profileId === caller.profileId);
  const thread = findMentionedThread(readable, handle);
  if (!thread) throw new Error(`No thread ${handle} in this profile. Use the handle the user mentioned, such as @fix-login-redirect-3f2a9c.`);
  return readThreadPage(await deps.transcript(thread.id), offset, limit, `"${thread.title || 'Untitled'}" (@${threadHandle(thread)})`);
}
