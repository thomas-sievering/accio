import { typedText, type TranscriptItem } from '@accio/protocol';

/**
 * What you last typed in this thread, for Up in an empty composer to bring back.
 * Turns accio started itself (a Goal continuing, a Wait met, a resume) are not yours;
 * Pasted text, Reactions and images stay behind.
 */
export function lastSentText(items: readonly TranscriptItem[] | undefined): string | undefined {
  const last = items?.findLast((item) => item.kind === 'user' && !item.resume && !item.wake && !item.goal);
  return last?.kind === 'user' ? typedText(last.text) || undefined : undefined;
}
