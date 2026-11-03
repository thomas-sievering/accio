import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Fetch } from './claudeOAuth.js';
import type { Hub } from './hub.js';

export const ANTHROPIC_API = 'https://api.anthropic.com';
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
]);
const DROP_RESPONSE = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

export type ProxyOptions = { hub: Hub; host: string; port: number; upstream?: string; fetchImpl?: Fetch };

/**
 * The hub's front door for threads. Claude Code calls it with a profile's access
 * key (ANTHROPIC_AUTH_TOKEN, or an API key header); the hub swaps that key for the
 * profile's OAuth token and forwards to Anthropic. The caller is the real Claude
 * Code, so nothing else about the request changes (ADR 0007).
 */
export async function startHubProxy({ hub, host, port, upstream = ANTHROPIC_API, fetchImpl = fetch }: ProxyOptions) {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[hub] proxy error', err);
      if (!res.headersSent) sendError(res, 502, 'api_error', `accio hub could not reach Anthropic: ${(err as Error).message}`);
      else res.destroy();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const key = keyOf(req);
    const profile = key ? hub.profileForKey(key) : undefined;
    if (!profile) return sendError(res, 401, 'authentication_error', 'Unknown accio hub key');

    let token = await hub.accessToken(profile.id);
    if (!token) return sendError(res, 401, 'authentication_error', `accio profile ${profile.id} is not signed in with Claude`);

    const body = await readBody(req);
    const send = (accessToken: string) =>
      fetchImpl(new URL(req.url ?? '/', upstream), {
        method: req.method,
        headers: upstreamHeaders(req, accessToken),
        body: body.length ? new Uint8Array(body) : undefined,
      });

    let upstreamRes = await send(token);
    if (upstreamRes.status === 401) {
      // The token may have been revoked or rotated early: refresh once and retry.
      await upstreamRes.body?.cancel();
      token = await hub.accessToken(profile.id, { force: true });
      upstreamRes = await send(token!);
    }

    const headers: Record<string, string> = {};
    upstreamRes.headers.forEach((v, k) => {
      if (!DROP_RESPONSE.has(k)) headers[k] = v;
    });
    res.writeHead(upstreamRes.status, headers);
    if (!upstreamRes.body) return void res.end();
    Readable.fromWeb(upstreamRes.body as import('node:stream/web').ReadableStream).pipe(res);
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

export function upstreamHeaders(req: Pick<IncomingMessage, 'headers'>, accessToken: string): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || DROP_REQUEST.has(k.toLowerCase())) continue;
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
