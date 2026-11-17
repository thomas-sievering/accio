import type { Harness, HarnessMessage, HarnessTurn } from '../threads/harness.js';
import type { SecretDelivery, SecretToolArgs } from '../secrets/secrets.js';

/**
 * A turn as a script sees it. `requestSecret` calls request_secret through the
 * turn's accio tools, as a real harness does, and is there only when the turn
 * has them.
 */
export type FakeTurn = HarnessTurn & { requestSecret?: (input: SecretToolArgs) => Promise<SecretDelivery> };

type Script = (run: FakeTurn, turn: number) => AsyncIterable<HarnessMessage> | Iterable<HarnessMessage>;

/** A harness that plays a script per turn and records how it was called. */
export class FakeHarness implements Harness {
  readonly runs: FakeTurn[] = [];
  constructor(private script: Script = (_r, n) => replyWith(`reply ${n}`)) {}

  async *run(run: HarnessTurn): AsyncIterable<HarnessMessage> {
    const tools = run.tools;
    const turn: FakeTurn = tools ? { ...run, requestSecret: (input) => requestSecret(tools, input) } : run;
    this.runs.push(turn);
    yield* this.script(turn, this.runs.length);
  }
}

async function requestSecret(tools: NonNullable<HarnessTurn['tools']>, input: SecretToolArgs): Promise<SecretDelivery> {
  const response = await fetch(tools.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: tools.authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'request_secret', arguments: input } }) });
  if (!response.ok) throw new Error(`request_secret failed: HTTP ${response.status}`);
  const answer = await response.json() as { result?: { isError?: boolean; content: { text: string }[] }; error?: { message: string } };
  if (answer.error) throw new Error(answer.error.message);
  const text = answer.result!.content[0]!.text;
  if (answer.result!.isError) throw new Error(text);
  return JSON.parse(text) as SecretDelivery;
}

export const SESSION = 'session-abc';

/** A normal, streamed reply. */
export function* replyWith(text: string, sessionId = SESSION): Iterable<HarnessMessage> {
  const m = `msg-${text}`;
  yield { type: 'system', subtype: 'init', session_id: sessionId };
  yield { type: 'stream_event', parent_tool_use_id: null, session_id: sessionId, event: { type: 'message_start', message: { id: m } } };
  yield {
    type: 'stream_event',
    parent_tool_use_id: null,
    session_id: sessionId,
    event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
  };
  yield {
    type: 'stream_event',
    parent_tool_use_id: null,
    session_id: sessionId,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  };
  yield { type: 'assistant', parent_tool_use_id: null, session_id: sessionId, message: { id: m, content: [{ type: 'text', text }] } };
  yield { type: 'result', subtype: 'success', is_error: false, session_id: sessionId };
}

/** Resolves when `release()` is called; for holding a turn open. */
export function gate() {
  let release!: () => void;
  const opened = new Promise<void>((r) => (release = r));
  return { opened, release };
}

/** One completed tool call, as Claude Code reports it. */
export function* toolCall(name: string, input: unknown = {}, id = `tool-${name}`, sessionId = SESSION): Iterable<HarnessMessage> {
  yield { type: 'assistant', parent_tool_use_id: null, session_id: sessionId, message: { id: `msg-${id}`, content: [{ type: 'tool_use', id, name, input }] } };
  yield { type: 'user', parent_tool_use_id: null, session_id: sessionId, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } };
}
