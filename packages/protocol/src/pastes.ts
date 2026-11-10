/**
 * GLOSSARY: Pasted text. A long paste the composer keeps out of the message box. It travels inside
 * the message text as a fenced block tagged `pasted`, so every harness reads it as plain text, and
 * the thread shows it folded. Pastes go before what was typed: long material first, the ask last.
 */

/** A paste this long, in characters or lines, folds into Pasted text. Ctrl+Shift+V keeps it in the box. */
export const PASTE_FOLD_CHARS = 4000;
export const PASTE_FOLD_LINES = 60;

import { reactionInfo, reactionKindOf, reactionLabel, type Reaction } from './reactions.js';

const INFO = 'pasted';

/** GLOSSARY: Pasted text, Reaction. The pieces a sent message is made of. */
export type MessagePart = { kind: 'text'; text: string } | { kind: 'paste'; text: string } | { kind: 'reaction'; reaction: Reaction };

export function foldsPaste(text: string): boolean {
  return text.length >= PASTE_FOLD_CHARS || lineCount(text) >= PASTE_FOLD_LINES;
}

export function lineCount(text: string): number {
  const body = text.replace(/\n+$/, '');
  return body ? body.split('\n').length : 0;
}

/** Line endings as the message keeps them, without the trailing blank lines a fence would not keep. */
export function normalizePaste(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
}

/** The fence is longer than any run of backticks inside, so nothing pasted can close it. */
function fenced(text: string, info = INFO): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${info}\n${text}\n${fence}`;
}

/** The message as sent: each paste in its own fence, then each reaction, then the typed text. */
export function joinPastes(pastes: readonly string[], typed: string, reactions: readonly Reaction[] = []): string {
  return [
    ...pastes.map((paste) => fenced(normalizePaste(paste))),
    ...reactions.map((reaction) => fenced(reaction.quote, reactionInfo(reaction.kind))),
    typed.trim(),
  ].filter(Boolean).join('\n\n');
}

/** A message split back into what was typed, pasted and reacted to, in order. An unclosed fence stays text. */
export function splitPastes(message: string): MessagePart[] {
  if (!message.includes(`\`\`\`${INFO}`) && !message.includes('```reaction: ')) return message ? [{ kind: 'text', text: message }] : [];
  const lines = message.split('\n');
  const parts: MessagePart[] = [];
  let typed: string[] = [];
  const flush = () => {
    const text = typed.join('\n').replace(/^\n+|\n+$/g, '');
    if (text) parts.push({ kind: 'text', text });
    typed = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})(.+)$/.exec(lines[i]!);
    const reaction = open ? reactionKindOf(open[2]!) : undefined;
    const close = open && (open[2] === INFO || reaction) ? lines.indexOf(open[1]!, i + 1) : -1;
    if (!open || close < 0) { typed.push(lines[i]!); continue; }
    flush();
    const text = lines.slice(i + 1, close).join('\n');
    parts.push(reaction ? { kind: 'reaction', reaction: { kind: reaction, quote: text } } : { kind: 'paste', text });
    i = close;
  }
  flush();
  return parts;
}

/** What was typed, without the pastes. */
export function typedText(message: string): string {
  return splitPastes(message).filter((part) => part.kind === 'text').map((part) => part.text).join('\n\n');
}

/** The pastes alone, in order. */
export function pastesIn(message: string): string[] {
  return splitPastes(message).flatMap((part) => part.kind === 'paste' ? [part.text] : []);
}

/** The reactions alone, in order. */
export function reactionsIn(message: string): Reaction[] {
  return splitPastes(message).flatMap((part) => part.kind === 'reaction' ? [part.reaction] : []);
}

/** The message with its typed text replaced, keeping its pastes and reactions. */
export function retypeMessage(message: string, typed: string): string {
  return joinPastes(pastesIn(message), typed, reactionsIn(message));
}

/** "Pasted text · 412 lines": how a paste reads where its text does not fit. */
export function pasteLabel(text: string): string {
  const lines = lineCount(text);
  return `Pasted text · ${lines === 1 ? '1 line' : `${lines.toLocaleString('en-US')} lines`}`;
}

/** The message with each paste shortened to its label, for titles, previews and naming. */
export function summarizePastes(message: string): string {
  return splitPastes(message).map((part) => part.kind === 'text' ? part.text
    : part.kind === 'paste' ? `[${pasteLabel(part.text)}]` : `[${reactionLabel(part.reaction)}]`).join('\n\n');
}

/** The first line of a paste with something on it, to recognize it by. */
export function pasteGist(text: string): string {
  return text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
}
