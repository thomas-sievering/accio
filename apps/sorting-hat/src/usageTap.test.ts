import { describe, expect, it } from 'vitest';
import { usageTap, type Reported, type UsageFormat } from './usageTap.js';
import { anthropicReply, responsesReply } from './testing/fakeProviders.js';

/** Feeds the text in chunks of `size` bytes, so events and characters split anywhere. */
function tapped(format: UsageFormat, contentType: string, text: string, size = 7, end = true) {
  let reported: Reported | undefined;
  let calls = 0;
  const tap = usageTap(format, contentType, (r) => { reported = r; calls++; });
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += size) tap.write(bytes.slice(i, i + size));
  if (end) { tap.end(); tap.end(); }
  return { reported, calls, tap };
}

describe('reading usage from a response', () => {
  it('counts a streamed Claude reply from message_start and message_delta, however it is split', () => {
    for (const size of [1, 5, 64, 100_000]) {
      const { reported, calls } = tapped('anthropic', 'text/event-stream; charset=utf-8', anthropicReply('claude-opus-5-5', 'msg_1', 'Héllo ✓'), size);
      expect(calls).toBe(1);
      expect(reported).toEqual({ model: 'claude-opus-5-5', tokens: { input: 10, output: 8, cacheRead: 6, cacheWrite: 4 } });
    }
  });

  it('takes later running totals from message_delta, with CRLF line ends', () => {
    const events = [
      { type: 'message_start', message: { model: 'claude-x', usage: { input_tokens: 3, output_tokens: 1 } } },
      { type: 'message_delta', usage: { input_tokens: 5, output_tokens: 40, cache_read_input_tokens: 7 } },
    ].map((e) => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join('');
    expect(tapped('anthropic', 'text/event-stream', events).reported).toEqual({ model: 'claude-x', tokens: { input: 5, output: 40, cacheRead: 7, cacheWrite: 0 } });
  });

  it('counts a whole Claude reply', () => {
    const body = JSON.stringify({ type: 'message', model: 'claude-y', content: [], usage: { input_tokens: 12, output_tokens: 3, cache_creation_input_tokens: 2, cache_read_input_tokens: 1 } });
    expect(tapped('anthropic', 'application/json', body).reported).toEqual({ model: 'claude-y', tokens: { input: 12, output: 3, cacheRead: 1, cacheWrite: 2 } });
  });

  it('counts a cut-off Claude stream as far as it got', () => {
    const reply = anthropicReply('claude-z', 'msg_1', 'Hello');
    const { reported } = tapped('anthropic', 'text/event-stream', reply.slice(0, reply.indexOf('content_block_delta') + 20));
    expect(reported).toEqual({ model: 'claude-z', tokens: { input: 10, output: 1, cacheRead: 6, cacheWrite: 4 } });
  });

  it('counts ChatGPT from response.completed, with cached input apart', () => {
    expect(tapped('openai', 'text/event-stream', responsesReply('Hi', 'gpt-5')).reported).toEqual({ model: 'gpt-5', tokens: { input: 6, output: 8, cacheRead: 4, cacheWrite: 0 } });
  });

  it('counts a ChatGPT response that failed or stopped short from its event', () => {
    const failed = `event: response.failed\ndata: ${JSON.stringify({ type: 'response.failed', response: { model: 'gpt-5', status: 'failed', usage: { input_tokens: 9, output_tokens: 2 } } })}\n\n`;
    expect(tapped('openai', 'text/event-stream', failed).reported).toEqual({ model: 'gpt-5', tokens: { input: 9, output: 2, cacheRead: 0, cacheWrite: 0 } });
  });

  it('counts compaction’s whole answer', () => {
    const body = JSON.stringify({ output: [], usage: { input_tokens: 30, input_tokens_details: { cached_tokens: 20 }, output_tokens: 5 } });
    expect(tapped('openai', 'application/json', body).reported).toEqual({ model: null, tokens: { input: 10, output: 5, cacheRead: 20, cacheWrite: 0 } });
  });

  it('reports nothing, without throwing, for errors and garbage', () => {
    const zero = { model: null, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    expect(tapped('anthropic', 'application/json', '{"type":"error","error":{"type":"overloaded_error"}}').reported).toEqual(zero);
    expect(tapped('anthropic', 'text/event-stream', 'event: message_start\ndata: {not json\n\n').reported).toEqual(zero);
    expect(tapped('openai', 'application/json', '<html>').reported).toEqual(zero);
    expect(tapped('openai', 'text/event-stream', '').reported).toEqual(zero);
    const { tap } = tapped('anthropic', 'text/event-stream', '', 1, true);
    expect(() => tap.write(new Uint8Array([0xff, 0xfe]))).not.toThrow();
  });

  it('keeps the response going when recording fails', () => {
    const tap = usageTap('anthropic', 'application/json', () => { throw new Error('disk full'); });
    tap.write(new TextEncoder().encode('{}'));
    expect(() => tap.end()).not.toThrow();
  });
});
