import { z } from 'zod';
import type { ToolStep } from '@accio/protocol';
import { ACCIO_MCP_SERVER, accioTool } from '../tools/tools.js';
import type { Harness, HarnessTurn } from './harness.js';
import { TurnTranscript } from './transcript.js';

/**
 * GLOSSARY: Sub-agent. A helper turn a thread's harness starts through accio's
 * `agent` tool for one self-contained task. It runs on the same harness, model,
 * profile and working folder, with a fresh context, and returns only its final
 * reply. It is not a thread: it has no transcript of its own, and its latest
 * step shows on the parent's tool row while it works. Sub-agents get no accio
 * tools, so they cannot start sub-agents of their own.
 */
export const AGENT_TOOL = 'agent';
/** How long a harness waits on one accio tool call, so a sub-agent can work for a while. Codex's default is 60 seconds. */
export const SUBAGENT_TIMEOUT_SEC = 2 * 60 * 60;

/** How the parent's transcript names the call, whichever harness made it. */
export const AGENT_TOOL_LABEL = 'Agent';

export const agentInput = {
  description: z.string().trim().min(1).max(80).describe('A few words naming the task, such as "Find where deliveries retry"'),
  prompt: z.string().trim().min(1).max(20_000).describe('The complete task. The sub-agent sees nothing else: include the goal, relevant paths and what to report back.'),
};
export type AgentInput = z.infer<z.ZodObject<typeof agentInput>>;

export const AGENT_DESCRIPTION = 'Start a sub-agent with a fresh context for one self-contained task, and get back only its final reply. '
  + 'It works in the same folder with the same shell and file tools. '
  + 'Use it for independent research or for a black-box check of finished work; call it several times in parallel for independent tasks. '
  + 'Do the work yourself when it needs this conversation\'s context or is quick.';

/** Claude names MCP tools `mcp__accio__agent`, Codex `accio/agent`. */
export function isAgentTool(name: string): boolean {
  return name === `mcp__${ACCIO_MCP_SERVER}__${AGENT_TOOL}` || name === `${ACCIO_MCP_SERVER}/${AGENT_TOOL}`;
}

/** What a sub-agent inherits from the parent turn that is running when it starts. */
export type SubagentTurn = { harness: Harness; run: Omit<HarnessTurn, 'prompt' | 'sessionId' | 'signal' | 'tools' | 'registerSteer' | 'requestSecret'>; signal: AbortSignal };

/**
 * Runs one sub-agent to completion. Each of its tool calls is reported as the
 * latest step; the reply is its last assistant message.
 */
export async function runSubagent(turn: SubagentTurn, input: AgentInput, signal: AbortSignal, onStep: (step: ToolStep) => void | Promise<void>): Promise<string> {
  const stop = AbortSignal.any([turn.signal, signal]);
  const transcript = new TurnTranscript('subagent');
  const replies = new Map<string, string>();
  let last: string | undefined;
  let error: string | undefined;
  // Accio helpers start independent SDK queries, so select the helper duration
  // explicitly instead of inheriting the main conversation's one-hour default.
  const env = turn.run.env.CLAUDE_CODE_PROMPT_CACHE_TTL ? { ...turn.run.env,
    CLAUDE_CODE_PROMPT_CACHE_TTL: turn.run.env.CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL ?? '5m',
  } : turn.run.env;
  for await (const msg of turn.harness.run({ ...turn.run, env, prompt: input.prompt, sessionId: null, signal: stop })) {
    for (const change of transcript.accept(msg)) {
      if (change.type === 'tool') await onStep({ name: change.item.name, summary: change.item.summary });
      else if (change.type === 'item' && change.item.kind === 'assistant') { replies.set(change.item.id, change.item.text); last = change.item.id; }
      else if (change.type === 'delta') { replies.set(change.itemId, (replies.get(change.itemId) ?? '') + change.text); last = change.itemId; }
      else if (change.type === 'end' && change.outcome === 'failed') error = change.error ?? 'The sub-agent failed.';
    }
  }
  if (stop.aborted) throw new Error('The sub-agent was stopped.');
  if (error) throw new Error(error);
  const reply = last ? replies.get(last)?.trim() : undefined;
  if (!reply) throw new Error('The sub-agent finished without a reply.');
  return reply;
}

/** The accio tool; `start` finds the calling thread's running turn and runs the sub-agent in it. */
export function agentTool(start: (threadId: string, input: AgentInput, signal: AbortSignal) => Promise<string>) {
  return accioTool({ name: AGENT_TOOL, description: AGENT_DESCRIPTION, input: agentInput, call: (input, { threadId, signal }) => start(threadId, input, signal) });
}
