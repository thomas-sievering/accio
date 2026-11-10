/**
 * GLOSSARY: Reaction. A 👍, ❓ or 👎 on a passage you selected in an assistant message. It travels
 * inside the message text as a fenced block whose info string says what it means, so every harness
 * reads the quote and the reaction as plain text, and the thread shows it as a quote card.
 */

export const REACTION_KINDS = ['agree', 'unclear', 'disagree'] as const;
export type ReactionKind = typeof REACTION_KINDS[number];
export type Reaction = { kind: ReactionKind; quote: string };

/** A longer selection is too much to react to as one thing. */
export const REACTION_QUOTE_CHARS = 4000;

const INFO_PREFIX = 'reaction: ';

/** How each reaction looks, and the sentence the harness reads after `reaction: `. */
export const REACTIONS: Record<ReactionKind, { emoji: string; label: string; meaning: string }> = {
  agree: { emoji: '👍', label: 'Agree', meaning: '👍 yes, I agree with this' },
  unclear: { emoji: '❓', label: 'Unclear', meaning: "❓ I don't follow this; explain it again in plainer words" },
  disagree: { emoji: '👎', label: 'Disagree', meaning: '👎 no, I disagree with this' },
};

/** A quote as the message keeps it: one paragraph of text with its own line breaks, trimmed. */
export function normalizeQuote(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function reactionInfo(kind: ReactionKind): string {
  return `${INFO_PREFIX}${REACTIONS[kind].meaning}`;
}

/** The kind a fence's info string names, if it is a reaction's. */
export function reactionKindOf(info: string): ReactionKind | undefined {
  if (!info.startsWith(INFO_PREFIX)) return undefined;
  return REACTION_KINDS.find((kind) => reactionInfo(kind) === info);
}

/** `👍 "the first words of the quote…"`: a reaction where its quote does not fit. */
export function reactionLabel(reaction: Reaction, chars = 60): string {
  const flat = reaction.quote.replace(/\s+/g, ' ');
  return `${REACTIONS[reaction.kind].emoji} "${flat.length > chars ? `${flat.slice(0, chars).trimEnd()}…` : flat}"`;
}
