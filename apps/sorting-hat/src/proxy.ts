import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { anthropicList, openaiList, openaiModel, type AnthropicModel } from './models.js';
import type { CodexModel } from './openaiAuth.js';
import type { UsageEntry } from './usage.js';
import { usageTap, type Reported } from './usageTap.js';
import type { Fetch, ProviderId } from './types.js';

const ANTHROPIC_API = 'https://api.anthropic.com';
const OAUTH_BETA = 'oauth-2025-04-20';

/** Headers that belong to one hop, or that carry the caller's credentials. */
const DROP_REQUEST = new Set([
  'host',
  'connection',
  'content-length',
  'authorization',
  'x-api-key',
  'accept-encoding',
  'keep-alive',
  'transfer-encoding',
  'forwarded',
  'via',
  'x-real-ip',
  'true-client-ip',
  'cdn-loop',
]);
const dropRequestHeader = (name: string) => DROP_REQUEST.has(name.toLowerCase()) || /^(cf-|x-forwarded-)/i.test(name);
const DROP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

/** What forwarding needs from the accounts: everything else about them stays behind this seam. */
export interface Forwarding {
  /** The house a request's key belongs to, or undefined for an unknown or revoked key. */
  houseForKey(key: string): { id: string; hatKeyId: string | null } | undefined;
  /** The house's Claude account in use and its token, refreshed first when close to expiry or forced. */
  claudeAccess(houseId: string, force?: boolean): Promise<{ accountId: string; token: string } | null>;
  /** The house's ChatGPT account in use's credentials, refreshed first when close to expiry or forced. */
  openaiCredentials(houseId: string, force?: boolean): Promise<{ accountId: string; accessToken: string; chatgptAccountId: string } | null>;
  accountIdInUse(houseId: string, providerId: ProviderId): string | null;
  /** Keeps the limits behind the account choice current while the house is in use. */
  noteRequest(houseId: string, providerId: ProviderId): void;
  /** After a provider refused a request for limits; true when the next request would use another account. */
  recheckAfterLimit(houseId: string, providerId: ProviderId, accountId: string): Promise<boolean>;
  /** The models the house's Claude account in use can use, in Anthropic's shape. */
  claudeModels(houseId: string): Promise<AnthropicModel[]>;
  /** The models the house's ChatGPT account in use offers. */
  codexModels(houseId: string): CodexModel[];
  /** Counts one model request's tokens. */
  recordUsage(entry: UsageEntry): void;
}

export type ForwardingOptions = { accounts: Forwarding; upstream?: string; fetchImpl?: Fetch; openaiUpstream?: string; openaiFetch?: Fetch };
export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * The Sorting Hat's front door for model requests. Claude Code calls it with a
 * hat key (ANTHROPIC_AUTH_TOKEN, or an API key header); it swaps that key for
 * the house's account in use's OAuth token and forwards to Anthropic. The caller
 * is the real Claude Code, so nothing else about the request changes (ADR 0007).
 * Codex calls the /openai/ routes the same way.
 */
export function forwardModelRequests({ accounts, upstream = ANTHROPIC_API, fetchImpl = fetch, openaiUpstream = 'https://chatgpt.com/backend-api/codex', openaiFetch = fetch }: ForwardingOptions): RequestHandler {
  return (req, res) => {
    handle(req, res).catch((err) => {
      if (res.destroyed) return;
      console.error('[sorting-hat] forwarding error', err);
      if (!res.headersSent) sendError(res, 502, 'api_error', 'The Sorting Hat could not reach the provider. Check the account sign-in and connection.');
      else res.destroy();
    });
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const key = keyOf(req);
    const house = key ? accounts.houseForKey(key) : undefined;
    if (!house) return sendError(res, 401, 'authentication_error', 'Unknown or revoked hat key');
    const listing = modelListing(req.url ?? '/');
    if (listing) return listModels(req, res, house.id, listing);
    if (req.url?.startsWith('/openai/')) return handleOpenAI(req, res, house);

    const at = Date.now();
    accounts.noteRequest(house.id, 'anthropic');
    let access = await accounts.claudeAccess(house.id);
    if (!access) return sendError(res, 401, 'authentication_error', `House ${house.id} has no signed-in Claude account`);

    const body = await readBody(req);
    const send = (accessToken: string) =>
      fetchImpl(new URL(req.url ?? '/', upstream), {
        method: req.method,
        headers: upstreamHeaders(req, accessToken),
        body: body.length ? new Uint8Array(body) : undefined,
      });

    let upstreamRes = await send(access.token);
    if (upstreamRes.status === 401) {
      // The token may have been revoked or rotated early: refresh once and retry.
      await upstreamRes.body?.cancel();
      access = await accounts.claudeAccess(house.id, true);
      if (!access) return sendError(res, 401, 'authentication_error', 'This house’s Claude account is no longer signed in');
      upstreamRes = await send(access.token);
    }
    if (upstreamRes.status === 429 && await accounts.recheckAfterLimit(house.id, 'anthropic', access.accountId)) {
      // This account ran out; the request moves to the house's next account once.
      const next = await accounts.claudeAccess(house.id);
      if (next) { await upstreamRes.body?.cancel(); upstreamRes = await send(next.token); access = next; }
    }

    // Messages are counted; other paths, such as count_tokens, use no tokens.
    const counted = req.method === 'POST' && (req.url ?? '').split('?')[0] === '/v1/messages';
    const accountId = access.accountId;
    relay(upstreamRes, res, new Set(), counted ? usageTap('anthropic', upstreamRes.headers.get('content-type'), (reported) =>
      record({ at, providerId: 'anthropic', house, accountId, body, reported })) : undefined);
  }

  /** Counts a request's usage once its response is done, failed or cut off. */
  function record({ at, providerId, house, accountId, body, reported }: { at: number; providerId: ProviderId; house: { id: string; hatKeyId: string | null }; accountId: string; body: Buffer; reported: Reported }) {
    accounts.recordUsage({ at, providerId, houseId: house.id, hatKeyId: house.hatKeyId, accountId, model: reported.model ?? requestedModel(body), tokens: reported.tokens });
  }

  /** The house's models, answered here rather than forwarded: each provider's list shape, for the account in use. */
  async function listModels(req: IncomingMessage, res: ServerResponse, houseId: string, { providerId, modelId }: Listing) {
    if (req.method !== 'GET') return sendError(res, 405, 'invalid_request_error', `${req.method} is not allowed on ${req.url}`);
    if (providerId === 'anthropic') {
      const models = await accounts.claudeModels(houseId);
      if (modelId === undefined) return sendJson(res, anthropicList(models));
      const model = models.find((m) => m.id === modelId);
      return model ? sendJson(res, model) : sendError(res, 404, 'not_found_error', `House ${houseId} has no Claude model ${modelId}`);
    }
    const models = accounts.codexModels(houseId);
    if (modelId === undefined) return sendJson(res, openaiList(models));
    const model = models.find((m) => m.id === modelId);
    if (model) return sendJson(res, openaiModel(model));
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'model_not_found', param: null, message: `House ${houseId} has no ChatGPT model ${modelId}` } }));
  }

  async function handleOpenAI(req: IncomingMessage, res: ServerResponse, house: { id: string; hatKeyId: string | null }) {
    const houseId = house.id;
    const path = req.url?.split('?')[0];
    if (req.method !== 'POST' || !['/openai/responses', '/openai/responses/compact'].includes(path ?? '')) return sendError(res, 404, 'invalid_request_error', 'Unknown Codex endpoint');
    const at = Date.now();
    accounts.noteRequest(houseId, 'openai');
    const used = accounts.accountIdInUse(houseId, 'openai');
    let credentials = await accounts.openaiCredentials(houseId);
    if (!credentials) return sendError(res, 401, 'authentication_error', `House ${houseId} has no signed-in ChatGPT account`);
    const body = await readBody(req);
    const controller = new AbortController();
    res.once('close', () => controller.abort());
    const send = (auth: NonNullable<typeof credentials>) => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined || dropRequestHeader(key) || /^(chatgpt-|openai-organization$|openai-project$|cookie$|anthropic-)/i.test(key)) continue;
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
      headers.set('authorization', `Bearer ${auth.accessToken}`);
      headers.set('chatgpt-account-id', auth.chatgptAccountId);
      return openaiFetch(`${openaiUpstream}${path!.slice('/openai'.length)}`, {
        method: 'POST', headers, body: new Uint8Array(body), signal: controller.signal,
      });
    };
    let response = await send(credentials);
    if (response.status === 401) {
      await response.body?.cancel();
      credentials = await accounts.openaiCredentials(houseId, true);
      if (!credentials) return sendError(res, 401, 'authentication_error', 'This house’s ChatGPT account is no longer signed in');
      response = await send(credentials);
    }
    if (response.status === 429 && used && await accounts.recheckAfterLimit(houseId, 'openai', used)) {
      const next = await accounts.openaiCredentials(houseId);
      if (next) { await response.body?.cancel(); response = await send(next); credentials = next; }
    }
    const accountId = credentials.accountId;
    relay(response, res, new Set(['set-cookie']), usageTap('openai', response.headers.get('content-type'), (reported) =>
      record({ at, providerId: 'openai', house, accountId, body, reported })));
  }
}

/**
 * Sends the provider's answer on as it arrives. A usage tap reads a copy of
 * each chunk after it was passed on, and is ended once the answer is done,
 * fails, or the caller goes away.
 */
function relay(response: Response, res: ServerResponse, dropHeaders: Set<string>, tap?: ReturnType<typeof usageTap>) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => { if (!DROP_RESPONSE.has(key) && !dropHeaders.has(key)) headers[key] = value; });
  res.writeHead(response.status, headers);
  if (!response.body) { res.end(); return tap?.end(); }
  const stream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  stream.once('error', () => res.destroy());
  stream.pipe(res);
  if (!tap) return;
  // Added after pipe, in the same tick: the caller gets each chunk first, and nothing flows before pipe does.
  stream.on('data', (chunk: Buffer) => tap.write(chunk));
  const end = () => tap.end();
  stream.once('end', end);
  stream.once('error', end);
  res.once('close', end);
}

/** The model a request asked for, read only after its answer is done. */
function requestedModel(body: Buffer): string | null {
  try {
    const model = JSON.parse(body.toString('utf8'))?.model;
    return typeof model === 'string' ? model : null;
  } catch { return null; }
}

/** Serves only the model routes, on their own port. */
export function startForwarding({ host, port, ...options }: ForwardingOptions & { host: string; port: number }) {
  return listen(createServer(forwardModelRequests(options)), host, port);
}

export async function listen(server: Server, host: string, port: number) {
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => { server.off('error', fail); done(); });
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  const shown = host.includes(':') ? `[${host}]` : host === '0.0.0.0' ? '127.0.0.1' : host;
  return {
    url: `http://${shown}:${boundPort}`,
    port: boundPort,
    close: () => new Promise<void>((done) => { server.close(() => done()); }),
  };
}

type Listing = { providerId: ProviderId; modelId?: string };

/**
 * The model lists: `/v1/models` as Anthropic's API has it, and OpenAI's under
 * `/openai/`, both as `/openai/models` (a client whose base address is
 * `<hat>/openai`, as Codex's is) and `/openai/v1/models` (one that adds `/v1`).
 */
function modelListing(url: string): Listing | undefined {
  const path = url.split('?')[0]!;
  const match = /^(\/v1|\/openai(?:\/v1)?)\/models(?:\/([^/]+))?\/?$/.exec(path);
  if (!match) return undefined;
  let modelId: string | undefined;
  try { modelId = match[2] === undefined ? undefined : decodeURIComponent(match[2]); } catch { modelId = match[2]; }
  return { providerId: match[1] === '/v1' ? 'anthropic' : 'openai', modelId };
}

function sendJson(res: ServerResponse, body: unknown) {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function keyOf(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const apiKey = req.headers['x-api-key'];
  return typeof apiKey === 'string' ? apiKey : null;
}

function upstreamHeaders(req: Pick<IncomingMessage, 'headers'>, accessToken: string): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || dropRequestHeader(k)) continue;
    h.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  h.set('authorization', `Bearer ${accessToken}`);
  const betas = (h.get('anthropic-beta') ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  if (!betas.includes(OAUTH_BETA)) betas.push(OAUTH_BETA);
  h.set('anthropic-beta', betas.join(','));
  return h;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export function sendError(res: ServerResponse, status: number, type: string, message: string) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type, message } }));
}
