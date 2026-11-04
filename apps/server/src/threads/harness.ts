import type { ToolAccess } from '../tools/tools.js';
import type { BuiltinTool } from '../harnesses/builtinTools.js';
import type { WorkspaceSkill } from '@accio/protocol';

/**
 * The port between threads and the harness that runs their turns. Claude wraps
 * the Agent SDK; Codex wraps app-server. Tests can replace either adapter.
 *
 * Claude's existing messages stay structural; other adapters emit HarnessEvent.
 */

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean }
  | { type: string; [k: string]: unknown };

export type StreamEvent =
  | { type: 'message_start'; message: { id: string } }
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string; partial_json?: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: string; [k: string]: unknown };

/** Harness-neutral events used by adapters that do not emit Claude SDK messages. */
export type HarnessEvent =
  | { kind: 'session'; id: string }
  | { kind: 'text'; id: string; text: string; append?: boolean }
  | { kind: 'tool'; id: string; name: string; summary: string; status: 'running' | 'done' | 'error'; output?: string; input?: unknown }
  | { kind: 'end'; error?: string };

export type HarnessMessage =
  | { type: 'harness_event'; event: HarnessEvent }
  | { type: 'system'; subtype: string; session_id: string; [k: string]: unknown }
  | { type: 'stream_event'; event: StreamEvent; parent_tool_use_id: string | null; session_id: string }
  | {
      type: 'assistant';
      /** Envelope identity; message.id is shared by completed content-block fragments. */
      uuid?: string;
      message: { id: string; content: ContentBlock[] };
      parent_tool_use_id: string | null;
      session_id: string;
      error?: unknown;
    }
  | { type: 'user'; message: { content: string | ContentBlock[] }; parent_tool_use_id: string | null; session_id: string }
  | { type: 'result'; subtype: string; is_error: boolean; session_id: string; result?: string; errors?: string[] }
  | { type: string; session_id?: string; [k: string]: unknown };

export type HarnessTurn = {
  /** Registers the live input channel; unregister before the harness finishes. */
  registerSteer?: (send: ((text: string) => Promise<void>) | undefined) => void;
  resourceInstructions?: string;
  mcps?: Record<string, HarnessMcp>;
  cwd: string;
  prompt: string;
  /** Harness session to continue; null starts a new one. */
  sessionId: string | null;
  /** Harness model alias; omitted to use the account's default. */
  model?: string;
  /** GLOSSARY: Effort. One the model accepts; omitted to use the model's default. */
  effort?: string;
  /** The model's display name, when known; used in the system prompt. */
  modelName?: string;
  env: Record<string, string>;
  /** This turn's access to accio's MCP tools; omitted when the machine serves none. */
  tools?: ToolAccess;
  signal: AbortSignal;
  /** GLOSSARY: Built-in tools. The harness's own tools switched off for this turn. */
  toolsOff?: BuiltinTool[];
  /** Bound by the machine to this turn, project and profile; never accepts identity arguments. */
  requestSecret?: (input: import('../secrets/secrets.js').SecretToolArgs) => Promise<import('../secrets/secrets.js').SecretDelivery>;
  /** Authorized saved-purpose metadata lets a fresh harness reuse the exact stable key. */
  secretPurposes?: { slot: string; name: string }[];
};

export type HarnessMcp = { type: 'http'; url: string; headers: Record<string, string> } | { type: 'stdio'; command: string; args: string[] };
export type TurnResources = { env: Record<string, string>; instructions: string; mcps: Record<string, HarnessMcp>; skills?: WorkspaceSkill[]; snapshot: { tools: { id: string; version: string }[]; skills: { id: string; revision: string }[]; mcps: string[] }; release: () => void };

export interface Harness {
  run(run: HarnessTurn): AsyncIterable<HarnessMessage>;
  /** Isolated text generation: no session resume, tools, project instructions or transcript writes. */
  generateText?: (input: { cwd: string; prompt: string; model: string; effort?: string; env: Record<string, string>; signal: AbortSignal }) => Promise<string>;
}
