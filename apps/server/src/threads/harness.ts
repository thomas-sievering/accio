/**
 * The port between threads and the harness that runs their turns. The real adapter wraps
 * the Claude Agent SDK (claudeCode.ts); tests use a scripted fake.
 *
 * HarnessMessage is the subset of the SDK's message stream that the transcript
 * reads, kept structural so the domain does not depend on the SDK's types.
 */

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean }
  | { type: string; [k: string]: unknown };

export type StreamEvent =
  | { type: 'message_start'; message: { id: string } }
  | { type: 'content_block_start'; index: number; content_block: { type: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string } }
  | { type: string; [k: string]: unknown };

export type HarnessMessage =
  | { type: 'system'; subtype: string; session_id: string; [k: string]: unknown }
  | { type: 'stream_event'; event: StreamEvent; parent_tool_use_id: string | null; session_id: string }
  | {
      type: 'assistant';
      message: { id: string; content: ContentBlock[] };
      parent_tool_use_id: string | null;
      session_id: string;
      error?: unknown;
    }
  | { type: 'user'; message: { content: string | ContentBlock[] }; parent_tool_use_id: string | null; session_id: string }
  | { type: 'result'; subtype: string; is_error: boolean; session_id: string; result?: string; errors?: string[] }
  | { type: string; session_id?: string; [k: string]: unknown };

export type HarnessTurn = {
  cwd: string;
  prompt: string;
  /** Claude session to continue; null starts a new one. */
  sessionId: string | null;
  env: Record<string, string>;
  signal: AbortSignal;
};

export interface Harness {
  run(run: HarnessTurn): AsyncIterable<HarnessMessage>;
}
