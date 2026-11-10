import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { ACCESS_COOKIE, ACCESS_JWT_HEADER, AccessVerifier, type AccessConfig } from './access.js';
import type { Fetch } from './types.js';

/** Paths the dashboard owns: `/` and everything under this prefix. No provider's model path starts so. */
export const DASHBOARD_PREFIX = '/dashboard/';
/** The header the dashboard's own API calls carry. A cross-origin page cannot send it without a CORS preflight, which is never granted. */
export const DASHBOARD_HEADER = 'x-sorting-hat-dashboard';

/** The dashboard's files, next to `src` and `dist` alike, so both the built and the tsx-run server find them. */
const ROOT = fileURLToPath(new URL('../dashboard/', import.meta.url));
const FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/dashboard/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/dashboard/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
};
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};
const READS = new Set(['GET', 'HEAD']);

export type Refusal = { status: 401 | 403; message: string };

export function isDashboardPath(path: string) {
  return path === '/' || path === DASHBOARD_PREFIX.slice(0, -1) || path.startsWith(DASHBOARD_PREFIX);
}

/**
 * Who may open the dashboard and use the management API without the admin
 * token (README.md, "Dashboard"):
 *
 * - With Cloudflare Access configured, a request needs a valid Access token
 *   (`Cf-Access-Jwt-Assertion`, or its `CF_Authorization` cookie), wherever it comes from: a tunnel reaches the
 *   server over loopback too.
 * - Without it, only a request made to a loopback address (Host header) from a
 *   loopback address, so neither the network nor a DNS-rebinding page can reach it.
 *
 * API calls also need the dashboard header, and changes need an Origin equal
 * to the Host, so another site open in the same browser cannot drive the API.
 */
export class DashboardGate {
  private readonly verifier: AccessVerifier | undefined;

  constructor(access?: AccessConfig, accessFetch?: Fetch) {
    this.verifier = access ? new AccessVerifier(access, accessFetch) : undefined;
  }

  get mode() { return this.verifier ? 'access' as const : 'loopback' as const; }

  /** For the dashboard's pages: null when allowed. */
  async page(req: IncomingMessage): Promise<Refusal | null> {
    return this.who(req).then((who) => who.refusal ?? null);
  }

  /** For a management API request without a valid admin token: null when allowed. */
  async api(req: IncomingMessage): Promise<Refusal | null> {
    const who = await this.who(req);
    if (who.refusal) return { status: 401, message: 'This needs the Sorting Hat’s admin token.' };
    if (req.headers[DASHBOARD_HEADER] !== '1') return { status: 401, message: 'This needs the Sorting Hat’s admin token.' };
    if (!READS.has(req.method ?? 'GET') && !sameOrigin(req)) return { status: 403, message: 'This change must come from the Sorting Hat’s own dashboard.' };
    return null;
  }

  private async who(req: IncomingMessage): Promise<{ refusal?: Refusal; email?: string | null }> {
    if (this.verifier) {
      const raw = req.headers[ACCESS_JWT_HEADER];
      // The header on paths Access guards; its cookie where Access is bypassed at the edge, such as /api/ for the hub.
      const identity = await this.verifier.verify((Array.isArray(raw) ? raw[0] : raw) ?? cookie(req, ACCESS_COOKIE));
      if (!identity) return { refusal: { status: 401, message: 'Sign in through Cloudflare Access to open the Sorting Hat.' } };
      return { email: identity.email };
    }
    if (!isLoopbackAddress(req.socket.remoteAddress) || !isLoopbackHost(req.headers.host)) {
      return { refusal: { status: 403, message: 'Without Cloudflare Access, the Sorting Hat’s dashboard opens only on this machine, at a loopback address such as http://127.0.0.1.' } };
    }
    return {};
  }

  /** Serves the dashboard's pages and `/dashboard/session` to whoever `page` allows. */
  async serve(req: IncomingMessage, res: ServerResponse, path: string) {
    const who = await this.who(req);
    if (who.refusal) return sendText(res, who.refusal.status, who.refusal.message);
    if (!READS.has(req.method ?? 'GET')) return sendText(res, 405, `${req.method} is not allowed on ${path}`, { allow: 'GET, HEAD' });
    if (path === '/dashboard/session') {
      const body = JSON.stringify({ mode: this.mode, email: who.email ?? null });
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'application/json' });
      return void res.end(req.method === 'HEAD' ? undefined : body);
    }
    const entry = FILES[path];
    if (!entry) return sendText(res, 404, `No ${path} here.`);
    const content = await readFile(ROOT + entry.file);
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': entry.type });
    res.end(req.method === 'HEAD' ? undefined : content);
  }
}

export function isLoopbackAddress(address: string | undefined) {
  if (!address) return false;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return address === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** A Host header naming this machine: localhost, 127.x.x.x or [::1], with any port. */
export function isLoopbackHost(host: string | undefined) {
  if (!host) return false;
  let hostname: string;
  try { hostname = new URL(`http://${host}`).hostname; } catch { return false; }
  return hostname === 'localhost' || hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function sameOrigin(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function cookie(req: IncomingMessage, name: string) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

function sendText(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(message);
}
