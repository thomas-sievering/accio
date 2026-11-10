/** Tokens one request used, as the provider reported them. `input` excludes cached input at both providers. */
export type Tokens = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type Reported = { model: string | null; tokens: Tokens };
export type UsageFormat = 'anthropic' | 'openai';

/** Past this, a response is not read for usage any further; what it reported so far still counts. */
const MAX_HELD = 32 * 1024 * 1024;
const ANTHROPIC_EVENTS = new Set(['message_start', 'message_delta']);
/** The Responses events that carry the response's final usage. */
const OPENAI_EVENTS = new Set(['response.completed', 'response.failed', 'response.incomplete', 'response.done']);

/**
 * Reads the usage a provider reports from a copy of its response, as it passes
 * through: Anthropic's `message_start` and `message_delta` events or a Messages
 * body, and the Responses API's `response.completed` event or a JSON body with
 * `usage` (such as compaction's). It never throws and never holds the response
 * back: `write` takes each chunk after it was forwarded, and `end` (called at
 * most once, whenever the response finishes, fails or is cut off) reports what
 * was seen, possibly nothing.
 */
export function usageTap(format: UsageFormat, contentType: string | null, done: (reported: Reported) => void) {
  const sse = /text\/event-stream/i.test(contentType ?? '');
  const decoder = new TextDecoder();
  const reported: Reported = { model: null, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  let held = '';
  let gaveUp = false;
  let ended = false;

  const read = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (format === 'anthropic') readAnthropic(value as Record<string, any>, reported);
    else readOpenAI(value as Record<string, any>, reported);
  };

  const events = (final: boolean) => {
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(held);
      if (!boundary) break;
      const block = held.slice(0, boundary.index);
      held = held.slice(boundary.index + boundary[0].length);
      event(block);
    }
    if (final && held.trim()) { event(held); held = ''; }
  };

  const event = (block: string) => {
    let name = '';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(line[5] === ' ' ? 6 : 5));
    }
    const text = data.join('\n');
    const wanted = format === 'anthropic' ? ANTHROPIC_EVENTS : OPENAI_EVENTS;
    // Only the few events that carry usage are parsed; text deltas are skipped.
    if (name ? !wanted.has(name) : ![...wanted].some((type) => text.includes(`"${type}"`))) return;
    try { read(JSON.parse(text)); } catch {}
  };

  return {
    write(chunk: Uint8Array) {
      if (ended || gaveUp) return;
      try {
        held += decoder.decode(chunk, { stream: true });
        if (sse) events(false);
        if (held.length > MAX_HELD) { gaveUp = true; held = ''; }
      } catch { gaveUp = true; held = ''; }
    },
    end() {
      if (ended) return;
      ended = true;
      try {
        if (!gaveUp) {
          held += decoder.decode();
          if (sse) events(true);
          else if (held.trim()) { try { read(JSON.parse(held)); } catch {} }
        }
      } catch {}
      held = '';
      try { done(reported); } catch (error) { console.error('[sorting-hat] could not record usage', (error as Error).message); }
    },
  };
}

const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

/** `message_start` holds the message with its starting usage; `message_delta` and a whole Messages body hold usage that replaces it. */
function readAnthropic(value: Record<string, any>, reported: Reported) {
  const message = value.type === 'message_start' ? value.message : value;
  if (message && typeof message.model === 'string') reported.model = message.model;
  const usage = value.type === 'message_start' ? message?.usage : value.usage;
  if (!usage || typeof usage !== 'object') return;
  // Later events report running totals: each field present replaces the last.
  if ('input_tokens' in usage) reported.tokens.input = count(usage.input_tokens);
  if ('output_tokens' in usage) reported.tokens.output = count(usage.output_tokens);
  if ('cache_read_input_tokens' in usage) reported.tokens.cacheRead = count(usage.cache_read_input_tokens);
  if ('cache_creation_input_tokens' in usage) reported.tokens.cacheWrite = count(usage.cache_creation_input_tokens);
}

/** A Responses event holds the response; a JSON body is the response itself. Its input counts cached input too. */
function readOpenAI(value: Record<string, any>, reported: Reported) {
  const response = value.response && typeof value.response === 'object' ? value.response : value;
  if (typeof response.model === 'string') reported.model = response.model;
  const usage = response.usage;
  if (!usage || typeof usage !== 'object') return;
  const cached = count(usage.input_tokens_details?.cached_tokens);
  reported.tokens = { input: Math.max(0, count(usage.input_tokens) - cached), output: count(usage.output_tokens), cacheRead: cached, cacheWrite: 0 };
}
