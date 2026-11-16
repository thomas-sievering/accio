// Provider boundaries, faked for the Sorting Hat's own tests: Anthropic's OAuth
// and usage endpoints, Anthropic's API, ChatGPT's Responses API and the Codex
// app-server used for ChatGPT accounts. No developer account is ever used.
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CLAUDE_OAUTH } from '../claudeOAuth.js';
import type { CodexClient, CodexFactory, CodexNotification } from '../codex.js';
import type { Fetch } from '../types.js';

/**
 * Anthropic's token and usage endpoints: every code or refresh yields a new
 * numbered token (`token-1`, ...), and `usage` holds what each token's account reports.
 * A sign-in with the code `ended` is one Anthropic has since ended: its token and refresh token are refused.
 */
export function fakeAnthropicAuth() {
  let n = 0;
  const usage: Record<string, unknown> = {};
  /** Per token, the models Anthropic lists for it, or the status it refuses with; unset tokens get 404. */
  const models: Record<string, { id: string; display_name: string }[] | number> = {};
  /** The headers of every model list request. */
  const modelRequests: Headers[] = [];
  /** The refresh token of every refresh. */
  const refreshed: string[] = [];
  /** Access and refresh tokens Anthropic refuses. */
  const ended = new Set<string>();
  const fetch: Fetch = async (url, init) => {
    if (String(url) === 'https://api.anthropic.com/api/oauth/usage') {
      if (ended.has(new Headers(init?.headers).get('authorization')!.slice('Bearer '.length))) return Response.json({ type: 'error' }, { status: 401 });
      return Response.json(usage[new Headers(init?.headers).get('authorization')!.slice('Bearer '.length)] ?? {});
    }
    if (String(url).startsWith('https://api.anthropic.com/v1/models')) {
      const headers = new Headers(init?.headers);
      modelRequests.push(headers);
      const listed = models[headers.get('authorization')!.slice('Bearer '.length)] ?? 404;
      if (typeof listed === 'number') return Response.json({ type: 'error', error: { type: 'error', message: 'refused' } }, { status: listed });
      return Response.json({ data: listed.map((m) => ({ type: 'model', created_at: '2026-01-01T00:00:00Z', ...m })), has_more: false });
    }
    // Anything else, such as the faked API the Sorting Hat forwards to, goes out as usual.
    if (String(url) !== CLAUDE_OAUTH.tokenUrl) return globalThis.fetch(url, init);
    const body = JSON.parse(String(init?.body));
    if (body.refresh_token) refreshed.push(body.refresh_token);
    if (body.code === 'bad') return new Response(JSON.stringify({ error_description: 'Invalid code' }), { status: 400 });
    if (ended.has(body.refresh_token)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
    n++;
    if (body.code === 'ended') { ended.add(`token-${n}`); ended.add(`refresh-${n}`); }
    return Response.json({ access_token: `token-${n}`, refresh_token: `refresh-${n}`, expires_in: 3600, account: { uuid: `claude-${n}`, email_address: `claude-${n}@example.com` } });
  };
  return { fetch, usage, models, modelRequests, refreshed, ended };
}

/**
 * Anthropic's API: records each request, refuses tokens in `limited` with 429,
 * and otherwise streams a complete Messages reply that Claude Code accepts,
 * or answers it whole when the request has `"stream": false`. With `cutOff`
 * set, a stream stops after its first event. With `hold` set, any request gets
 * a stream's first event and then nothing more until its caller hangs up; the
 * URLs of requests hung up on are in `aborted`.
 */
export async function fakeAnthropicApi() {
  const seen: { url: string; headers: IncomingHttpHeaders; body: string }[] = [];
  const limited = new Set<string>();
  const aborted: string[] = [];
  const control = { cutOff: false, hold: false };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ url: req.url ?? '', headers: req.headers, body });
    if (control.hold) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const reply = anthropicReply('claude-test', `msg_${seen.length}`, 'Held.');
      res.write(reply.slice(0, reply.indexOf('\n\n') + 2));
      res.once('close', () => { if (!res.writableFinished) aborted.push(req.url ?? ''); });
      return;
    }
    if (limited.has(req.headers.authorization?.slice('Bearer '.length) ?? '')) {
      res.writeHead(429, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"rate_limit_error","message":"limited"}}');
      return;
    }
    if (req.url?.startsWith('/v1/messages/count_tokens')) return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":10}');
    if (!req.url?.startsWith('/v1/messages')) return void res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    let request: { model?: string; stream?: boolean } = {};
    try { request = JSON.parse(body); } catch {}
    const model = request.model ?? 'claude-test';
    if (request.stream === false) {
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: `msg_${seen.length}`, type: 'message', role: 'assistant', model,
        content: [{ type: 'text', text: 'Hello from the fake provider.' }], stop_reason: 'end_turn', stop_sequence: null, usage: ANTHROPIC_USAGE }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const reply = anthropicReply(model, `msg_${seen.length}`, 'Hello from the fake provider.');
    if (!control.cutOff) return void res.end(reply);
    res.write(reply.slice(0, reply.indexOf('\n\n') + 2));
    setTimeout(() => res.destroy(), 20);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    seen,
    limited,
    aborted,
    control,
    close: () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }),
  };
}

/** What every fake Claude reply used, whole: the stream reports output 1 at its start and 8 at its end. */
const ANTHROPIC_USAGE = { input_tokens: 10, cache_creation_input_tokens: 4, cache_read_input_tokens: 6, output_tokens: 8 };

export function anthropicReply(model: string, id: string, text: string) {
  const events = [
    { type: 'message_start', message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...ANTHROPIC_USAGE, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } },
    { type: 'message_stop' },
  ];
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/**
 * ChatGPT's Responses API (as Codex calls it): records each request and streams
 * a completed reply; compaction answers whole, with its usage. With `hold`
 * set, a stream sends its first event and then nothing more until the request
 * is aborted; the URLs of aborted requests are in `aborted`.
 */
export function fakeChatGPT() {
  const seen: { url: string; headers: Headers; body: string }[] = [];
  const limited = new Set<string>();
  const aborted: string[] = [];
  const control = { hold: false };
  const fetch: Fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    const body = new TextDecoder().decode(init?.body as Uint8Array);
    seen.push({ url: String(url), headers, body });
    if (control.hold) {
      const reply = responsesReply('Held.');
      const signal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(reply.slice(0, reply.indexOf('\n\n') + 2)));
          signal?.addEventListener('abort', () => { aborted.push(String(url)); c.error(signal.reason); }, { once: true });
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    }
    if (limited.has(headers.get('chatgpt-account-id') ?? '')) return Response.json({ error: { type: 'usage_limit_reached' } }, { status: 429 });
    if (String(url).endsWith('/responses/compact')) {
      return Response.json({ output: [{ type: 'compaction', encrypted_content: 'summary' }], usage: { input_tokens: 30, input_tokens_details: { cached_tokens: 20 }, output_tokens: 5, total_tokens: 35 } });
    }
    let model = 'gpt-test';
    let request: { model?: string; tools?: { type?: string }[]; input?: { content?: { type: string; text?: string }[] }[] } = {};
    try { request = JSON.parse(body); model = request.model ?? model; } catch {}
    if (request.tools?.some((t) => t.type === 'image_generation')) {
      const prompt = request.input?.[0]?.content?.find((c) => c.type === 'input_text')?.text ?? '';
      // A prompt of "refuse" gets a text answer and no image, as ChatGPT gives for a prompt it won't draw.
      return new Response(prompt === 'refuse' ? responsesReply('I can’t make that image.', model) : imageGenerationReply(prompt, model), { headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(responsesReply('Hello from the fake ChatGPT.', model), { headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetch, seen, limited, aborted, control };
}

export function responsesReply(text: string, model = 'gpt-test') {
  const message = { id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
  const events = [
    { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...message, status: 'in_progress', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta: text },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.completed', response: { id: 'resp_1', model, status: 'completed', output: [message], usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18, input_tokens_details: { cached_tokens: 4 }, output_tokens_details: { reasoning_tokens: 0 } } } },
  ];
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

/** The bytes of every fake image: a PNG signature, enough for a test to tell it apart. */
export const FAKE_IMAGE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A Responses stream in which the image tool made one image, with the image tool's usage apart. */
export function imageGenerationReply(prompt: string, model = 'gpt-test') {
  const item = { id: 'ig_1', type: 'image_generation_call', status: 'completed', action: 'generate', background: 'opaque', output_format: 'png', quality: 'low',
    revised_prompt: prompt, size: '1024x1024', result: FAKE_IMAGE.toString('base64') };
  const events = [
    { type: 'response.created', response: { id: 'resp_1', status: 'in_progress', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', result: undefined } },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: { id: 'resp_1', model, status: 'completed', output: [item],
      usage: { input_tokens: 20, output_tokens: 3, total_tokens: 23, input_tokens_details: { cached_tokens: 0 } },
      tool_usage: { image_gen: { input_tokens: 7, output_tokens: 300, total_tokens: 307, input_tokens_details: { text_tokens: 7, image_tokens: 0 } } } } },
  ];
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

export function testJWT(who: string) {
  return `header.${Buffer.from(JSON.stringify({ sub: who, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
}

/** The Codex app-server, scripted: ChatGPT sign-in completes when the test calls `complete(who)`. */
export class FakeCodex {
  clients: FakeCodexClient[] = [];
  factory: CodexFactory = async (options) => {
    const client = new FakeCodexClient(options.home);
    this.clients.push(client);
    return client;
  };
  get latest() { return this.clients.at(-1)!; }
}

class FakeCodexClient implements CodexClient {
  private listeners = new Set<(event: CodexNotification) => void>();
  constructor(readonly home: string) {}
  async complete(who: string) {
    await mkdir(this.home, { recursive: true });
    await writeFile(join(this.home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: testJWT(who), account_id: who, refresh_token: `refresh-${who}` } }));
    for (const listener of this.listeners) listener({ method: 'account/login/completed', params: { loginId: 'login-id', success: true, error: null } });
  }
  async request<T = any>(method: string, params: any = {}): Promise<T> {
    switch (method) {
      case 'account/login/start': return (params.type === 'chatgpt'
        ? { loginId: 'login-id', authUrl: 'https://auth.openai.com/oauth/authorize?state=test-state&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback' }
        : { loginId: 'login-id', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-1234' }) as T;
      case 'account/read': {
        const auth = JSON.parse(await readFile(join(this.home, 'auth.json'), 'utf8'));
        return { account: { type: 'chatgpt', email: `${auth.tokens.account_id}@example.com`, planType: 'pro' } } as T;
      }
      case 'model/list': return { data: [{ model: 'gpt-test', displayName: 'GPT Test', isDefault: true }], nextCursor: null } as T;
      case 'account/rateLimits/read': return { rateLimits: null } as T;
      default: return {} as T;
    }
  }
  onNotification(listener: (event: CodexNotification) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onExit() { return () => {}; }
  async close() {}
}
