import { z } from 'zod';

/**
 * The parts of Codex app-server messages that drive a thread. Only fields Accio reads are checked,
 * so additions in a newer Codex change nothing; a read field that changes shape fails here, naming the message.
 */
const text = z.string().nullish();
const id = z.string();

export const CodexThreadResult = z.object({ thread: z.object({ id }) });
export const CodexTurnResult = z.object({ turn: z.object({ id }) });

/** Every notification is routed by these; either may be absent. */
export const CodexRouting = z.object({ threadId: text, turnId: text });
export const CodexTurnCompleted = z.object({ turn: z.object({ id, status: z.string(), error: z.object({ message: text }).nullish() }) });
export const CodexMessageDelta = z.object({ itemId: id, delta: z.string() });
export const CodexTokenUsage = z.object({
  tokenUsage: z.object({ last: z.object({ totalTokens: z.number().nullish() }).nullish(), modelContextWindow: z.number().nullish() }).nullish(),
});

const outcome = { status: text, success: z.boolean().nullish(), exitCode: z.number().nullish() };
const itemEvent = <T extends z.ZodRawShape>(shape: T) => z.object({ item: z.object({ id, ...shape }) });
/** Item types Accio shows; others are skipped without being read further. */
export const CodexItemType = z.object({ item: z.object({ type: z.string() }) });
export const CodexItems = {
  text: itemEvent({ text: z.string() }),
  commandExecution: itemEvent({ command: z.string(), cwd: text, aggregatedOutput: text, ...outcome }),
  fileChange: itemEvent({ changes: z.array(z.object({ path: z.string(), diff: text })), ...outcome }),
  mcpToolCall: itemEvent({ server: z.string(), tool: z.string(), arguments: z.unknown().optional(), error: z.unknown().optional(), result: z.unknown().optional(), ...outcome }),
  webSearch: itemEvent({ query: text, ...outcome }),
};

/** Throws a turn error naming the Codex message, rather than a later type error. */
export function parseCodex<T>(message: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const field = parsed.error.issues[0]?.path.join('.');
  throw new Error(`Codex sent ${message} in a form Accio does not recognize${field ? ` (${field})` : ''}.`);
}

/** GLOSSARY: Harness skill. What Codex's own skill discovery found, and where (`scope`: system, user, admin, repo). */
export const CodexSkillsList = z.object({ data: z.array(z.object({ skills: z.array(z.object({ name: z.string(), description: text, path: z.string(), scope: z.string(), enabled: z.boolean() })) })) });
