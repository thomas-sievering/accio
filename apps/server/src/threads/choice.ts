import { z } from 'zod';
import type { ChoicePick, TranscriptItem } from '@accio/protocol';
import { ACCIO_MCP_SERVER, accioTool } from '../tools/tools.js';

/**
 * GLOSSARY: Choice. Screenshots a harness offers through accio's `offer_choice`
 * tool; you pick one, and the pick and your feedback go back as your next
 * message. The tool itself only records the offer: the turn ends and the
 * thread waits for you like after any other reply.
 */
export const CHOICE_TOOL = 'offer_choice';

export const MAX_OPTIONS = 6;

export const choiceInput = {
  question: z.string().trim().min(1).max(300).describe('What the user is choosing, as a short question, such as "Which empty state?"'),
  options: z.array(z.object({
    path: z.string().trim().min(1).max(4096).describe('Absolute path, or path relative to the working directory, of a PNG, JPEG, GIF, WebP or AVIF screenshot'),
    label: z.string().trim().min(1).max(80).describe('A few words naming what is different about this option, such as "Inline banner"'),
  })).min(2).max(MAX_OPTIONS),
};

const ChoiceInput = z.object(choiceInput);
export type ChoiceInput = z.infer<typeof ChoiceInput>;

export const CHOICE_DESCRIPTION = 'Show the user two or more screenshots of UI variants side by side so they can pick one. '
  + 'Use it instead of embedding the images when the user is choosing between options. '
  + 'Afterwards end your turn without repeating the images; the pick and any feedback arrive as the next user message.';

export const CHOICE_RESULT = 'The user sees the options now. End your turn; their pick arrives as their next message.';

/** The Accio tool. Accio reads the call from the transcript and shows it; the tool only acknowledges. */
export const offerChoice = accioTool({ name: CHOICE_TOOL, description: CHOICE_DESCRIPTION, input: choiceInput, call: () => CHOICE_RESULT });

/** Claude names MCP tools `mcp__accio__offer_choice`, Codex `accio/offer_choice`. */
export function isChoiceTool(name: string): boolean {
  return name === CHOICE_TOOL || name === `mcp__${ACCIO_MCP_SERVER}__${CHOICE_TOOL}` || name === `${ACCIO_MCP_SERVER}/${CHOICE_TOOL}`;
}

/** The offer, once the harness has sent complete, valid arguments; undefined while it streams or when invalid. */
export function parseChoice(input: unknown): ChoiceInput | undefined {
  const parsed = ChoiceInput.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

/** A, B, C… */
export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** What the harness reads for a message that picks an option: the pick on one line, then your text. Undefined when the option doesn't exist. */
export function pickPrompt(items: readonly TranscriptItem[], pick: ChoicePick, text: string): string | undefined {
  const choice = items.find((item): item is Extract<TranscriptItem, { kind: 'choice' }> => item.kind === 'choice' && item.id === pick.choiceId);
  const option = choice?.options[pick.option];
  if (!choice || !option) return undefined;
  const line = `I pick ${optionLetter(pick.option)} ("${option.label}") for "${choice.question}".`;
  return text ? `${line}\n\n${text}` : line;
}
