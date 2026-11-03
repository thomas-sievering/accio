import type { Harness, HarnessMessage, HarnessTurn } from '../threads/harness.js';

type Script = (run: HarnessTurn, turn: number) => AsyncIterable<HarnessMessage> | Iterable<HarnessMessage>;

/** A harness that plays a script per turn and records how it was called. */
export class FakeHarness implements Harness {
  readonly runs: HarnessTurn[] = [];
  constructor(private script: Script = (_r, n) => replyWith(`reply ${n}`)) {}

  async *run(run: HarnessTurn): AsyncIterable<HarnessMessage> {
    this.runs.push(run);
    yield* this.script(run, this.runs.length);
  }
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
