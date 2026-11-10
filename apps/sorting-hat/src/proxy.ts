import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
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
  /** The house a request's key belongs to, or undefined for an unknown key. */
  houseForKey(key: string): { id: string } | undefined;
  /** The house's Claude account in use and its token, refreshed first when close to expiry or forced. */
  claudeAccess(houseId: string, force?: boolean): Promise<{ accountId: string; token: string } | null>;
  /** The house's ChatGPT account in use's credentials, refreshed first when close to expiry or forced. */
  openaiCredentials(houseId: string, force?: boolean): Promise<{ accessToken: string; accountId: string } | null>;
  accountIdInUse(houseId: string, providerId: ProviderId): string | null;
  /** Keeps the limits behind the account choice current while the house is in use. */
  noteRequest(houseId: string, providerId: ProviderId): void;
  /** After a provider refused a request for limits; true when the next request would use another account. */
  recheckAfterLimit(houseId: string, providerId: ProviderId, accountId: string): Promise<boolean>;
}

type ForwardingOptions = { accounts: Forwarding; host: string; port: number; upstream?: string; fetchImpl?: Fetch; openaiUpstream?: string; openaiFetch?: Fetch };

/**
 * The Sorting Hat's front door for model requests. Claude Code calls it with a
 * house's key (ANTHROPIC_AUTH_TOKEN, or an API key header); it swaps that key
 * for the account in use's OAuth token and forwards to Anthropic. The caller is
 * the real Claude Code, so nothing else about the request changes (ADR 0007).
 * Codex calls the /openai/ routes the same way.
 */
export async function startForwarding({ accounts, host, port, upstream = ANTHROPIC_API, fetchImpl = fetch, openaiUpstream = 'https://chatgpt.com/backend-api/codex', openaiFetch = fetch }: ForwardingOptions) {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.destroyed) return;
      console.error('[sorting-hat] forwarding error', err);
      if (!res.headersSent) sendError(res, 502, 'api_error', 'accio hub could not reach the provider. Check the account sign-in and connection.');
      else res.destroy();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const key = keyOf(req);
    const house = key ? accounts.houseForKey(key) : undefined;
    if (!house) return sendError(res, 401, 'authentication_error', 'Unknown accio hub key');
    if (req.url?.startsWith('/openai/')) return handleOpenAI(req, res, house.id);

    accounts.noteRequest(house.id, 'anthropic');
    let access = await accounts.claudeAccess(house.id);
    if (!access) return sendError(res, 401, 'authentication_error', `accio profile ${house.id} is not signed in with Claude`);

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
      if (!access) return sendError(res, 401, 'authentication_error', 'This profile is no longer signed in');
      upstreamRes = await send(access.token);
    }
    if (upstreamRes.status === 429 && await accounts.recheckAfterLimit(house.id, 'anthropic', access.accountId)) {
      // This account ran out; the request moves to the house's next account once.
      const next = await accounts.claudeAccess(house.id);
      if (next) { await upstreamRes.body?.cancel(); upstreamRes = await send(next.token); }
    }

    const headers: Record<string, string> = {};
    upstreamRes.headers.forEach((v, k) => {
      if (!DROP_RESPONSE.has(k)) headers[k] = v;
    });
    res.writeHead(upstreamRes.status, headers);
    if (!upstreamRes.body) return void res.end();
    Readable.fromWeb(upstreamRes.body as import('node:stream/web').ReadableStream).pipe(res);
  }

  async function handleOpenAI(req: IncomingMessage, res: ServerResponse, houseId: string) {
    const path = req.url?.split('?')[0];
    if (req.method !== 'POST' || !['/openai/responses', '/openai/responses/compact'].includes(path ?? '')) return sendError(res, 404, 'invalid_request_error', 'Unknown Codex endpoint');
    accounts.noteRequest(houseId, 'openai');
    const used = accounts.accountIdInUse(houseId, 'openai');
    let credentials = await accounts.openaiCredentials(houseId);
    if (!credentials) return sendError(res, 401, 'authentication_error', 'Select a signed-in ChatGPT account for this profile');
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
      headers.set('chatgpt-account-id', auth.accountId);
      return openaiFetch(`${openaiUpstream}${path!.slice('/openai'.length)}`, {
        method: 'POST', headers, body: new Uint8Array(body), signal: controller.signal,
      });
    };
    let response = await send(credentials);
    if (response.status === 401) {
      await response.body?.cancel();
      credentials = await accounts.openaiCredentials(houseId, true);
      if (!credentials) return sendError(res, 401, 'authentication_error', 'This profile is no longer signed in');
      response = await send(credentials);
    }
    if (response.status === 429 && used && await accounts.recheckAfterLimit(houseId, 'openai', used)) {
      const next = await accounts.openaiCredentials(houseId);
      if (next) { await response.body?.cancel(); response = await send(next); }
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { if (!DROP_RESPONSE.has(key) && key !== 'set-cookie') headers[key] = value; });
    res.writeHead(response.status, headers);
    if (!response.body) return void res.end();
    const stream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    stream.once('error', () => res.destroy());
    stream.pipe(res);
  }

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => done());
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;

  return {
    url: `http://${host}:${boundPort}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
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

function sendError(res: ServerResponse, status: number, type: string, message: string) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type, message } }));
}
