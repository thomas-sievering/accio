import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { McpDefinition } from '@accio/protocol';
import { enabled, type McpCredential, type Resources } from './resources.js';

type Pending = { id: string; verifier: string; redirect: string; endpoint: string; clientId: string; clientSecret?: string; expires: number; resource: string; epoch: number };
type Grant = { id: string; profileId: string; projectKey?: string };
/** Remote MCP credentials never enter a machine's harness configuration. */
export class McpGateway {
  private pending = new Map<string, Pending>();
  private grants = new Map<string, Grant>();
  private epochs = new Map<string, number>();
  private refreshing = new Map<string, Promise<McpCredential>>();
  private baseUrl = '';
  constructor(private resources: Resources, private fetchImpl: typeof fetch = fetch) {}
  setUrl(url: string) { this.baseUrl = url; }
  grant(id: string, profileId: string, projectKey?: string) {
    const token = randomBytes(32).toString('hex');
    this.grants.set(token, { id, profileId, projectKey });
    return { url: `${this.baseUrl}/mcp/access/${id}`, token, release: () => { this.grants.delete(token); } };
  }
  private require(id: string): McpDefinition {
    const mcp = this.resources.state().mcps.find(m => m.id === id);
    if (!mcp || mcp.transport !== 'http' || !mcp.url) throw new Error('Select a remote MCP server with a URL');
    return mcp;
  }
  private async json(url: string, init?: RequestInit): Promise<any> {
    const response = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`MCP sign-in request failed (${response.status})`); }
    return response.json();
  }
  async beginSignIn(id: string) {
    const mcp = this.require(id);
    if (mcp.auth !== 'oauth') throw new Error('Choose OAuth authentication for this server');
    const resource = new URL(mcp.url!);
    const metadataUrl = new URL(`/.well-known/oauth-protected-resource${resource.pathname === '/' ? '' : resource.pathname}`, resource.origin);
    let issuer = resource.origin;
    let scope: string | undefined;
    try { const metadata = await this.json(metadataUrl.href); issuer = metadata.authorization_servers?.[0] ?? issuer; scope = metadata.scopes_supported?.join(' '); } catch { /* Older MCPs expose only authorization-server metadata. */ }
    const issuerUrl = new URL(issuer);
    const metadata = await this.json(new URL(`/.well-known/oauth-authorization-server${issuerUrl.pathname === '/' ? '' : issuerUrl.pathname}`, issuerUrl.origin).href);
    if (!metadata.authorization_endpoint || !metadata.token_endpoint) throw new Error('MCP server does not publish OAuth endpoints');
    const redirect = `${this.baseUrl}/mcp/oauth/callback`;
    let clientId = mcp.oauthClientId;
    let clientSecret: string | undefined;
    if (!clientId) {
      if (!metadata.registration_endpoint) throw new Error('This service requires an OAuth client ID. Set it in the MCP server settings.');
      const client = await this.json(metadata.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'accio', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
      clientId = client.client_id; clientSecret = client.client_secret;
    }
    if (!clientId) throw new Error('MCP service did not return an OAuth client ID');
    for (const [key, item] of this.pending) if (item.expires < Date.now() || item.id === id) this.pending.delete(key);
    const state = randomBytes(24).toString('hex');
    const verifier = randomBytes(48).toString('base64url');
    const epoch = (this.epochs.get(id) ?? 0) + 1;
    this.epochs.set(id, epoch);
    this.pending.set(state, { id, verifier, redirect, endpoint: metadata.token_endpoint, clientId, clientSecret, expires: Date.now() + 600_000, resource: mcp.url!, epoch });
    const url = new URL(metadata.authorization_endpoint);
    Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirect, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', resource: mcp.url!, ...(scope ? { scope } : {}) }).forEach(([k, v]) => url.searchParams.set(k, v));
    return { url: url.href };
  }
  async completeSignIn(callbackUrl: string, expectedId?: string) {
    const url = new URL(callbackUrl);
    const state = url.searchParams.get('state') ?? '';
    const pending = this.pending.get(state);
    if (!pending || pending.expires < Date.now() || expectedId && expectedId !== pending.id) throw new Error('This sign-in expired or does not match');
    if (url.origin + url.pathname !== pending.redirect) throw new Error('This is not the expected callback URL');
    const code = url.searchParams.get('code');
    if (!code) throw new Error('The MCP service did not complete sign-in');
    this.pending.delete(state);
    const token = await this.json(pending.endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: pending.redirect, client_id: pending.clientId, code_verifier: pending.verifier, resource: pending.resource, ...(pending.clientSecret ? { client_secret: pending.clientSecret } : {}) }) });
    if (typeof token.access_token !== 'string') throw new Error('MCP service did not return an access token');
    if (this.epochs.get(pending.id) !== pending.epoch) throw new Error('MCP sign-in was cancelled');
    if (this.require(pending.id).url !== pending.resource) throw new Error('MCP server changed during sign-in; sign in again');
    await this.resources.setCredential(pending.id, { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined, tokenEndpoint: pending.endpoint, clientId: pending.clientId, clientSecret: pending.clientSecret });
  }
  async signOut(id: string) { this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1); for (const [state, pending] of this.pending) if (pending.id === id) this.pending.delete(state); await this.resources.setCredential(id); }
  private async credential(id: string, force = false): Promise<McpCredential | undefined> {
    const current = this.resources.credential(id);
    if (!current || !force && (!current.expiresAt || current.expiresAt > Date.now() + 30_000)) return current;
    if (!current.refreshToken || !current.tokenEndpoint || !current.clientId) throw new Error('Sign in to this MCP server again');
    const existing = this.refreshing.get(id); if (existing) return existing;
    const refresh = (async () => {
      const token = await this.json(current.tokenEndpoint!, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refreshToken!, client_id: current.clientId!, ...(current.clientSecret ? { client_secret: current.clientSecret } : {}) }) });
      if (typeof token.access_token !== 'string') throw new Error('MCP service did not return an access token');
      const next = { ...current, accessToken: token.access_token, refreshToken: token.refresh_token ?? current.refreshToken, expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined };
      // A sign-out during refresh cannot restore the credentials.
      if (this.resources.credential(id)?.accessToken === current.accessToken) await this.resources.setCredential(id, next);
      else throw new Error('MCP account changed while refreshing');
      return next;
    })().finally(() => this.refreshing.delete(id));
    this.refreshing.set(id, refresh); return refresh;
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!req.url?.startsWith('/mcp/')) return false;
    if (req.url.startsWith('/mcp/oauth/callback')) {
      try { await this.completeSignIn(`${this.baseUrl}${req.url}`); res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); res.end('Signed in to the MCP server. You can close this page.'); }
      catch { res.writeHead(400, { 'content-type': 'text/plain' }); res.end('MCP sign-in failed or expired. Start sign-in again in accio.'); }
      return true;
    }
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const grant = this.grants.get(token);
    const mcp = grant && this.resources.state().mcps.find(m => m.id === grant.id);
    if (!grant || !mcp || req.url.split('?')[0] !== `/mcp/access/${mcp.id}` || !enabled(mcp.scope, grant.profileId, grant.projectKey)) { res.writeHead(403); res.end('MCP access is not enabled for this thread'); return true; }
    if (mcp.transport !== 'http' || !mcp.url) { res.writeHead(404); res.end(); return true; }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 10 * 1024 * 1024) throw new Error('MCP request too large'); chunks.push(chunk); }
      const controller = new AbortController(); res.once('close', () => controller.abort());
      const send = async (force = false) => {
        const auth = mcp.auth === 'none' ? undefined : await this.credential(mcp.id, force);
        if (mcp.auth !== 'none' && !auth) throw new Error('Sign in to this MCP server in accio');
        const headers = new Headers();
        for (const key of ['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']) { const value = req.headers[key]; if (typeof value === 'string') headers.set(key, value); }
        if (auth) headers.set('authorization', `Bearer ${auth.accessToken}`);
        return this.fetchImpl(mcp.url!, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, signal: controller.signal, redirect: 'error' });
      };
      let response = await send();
      if (response.status === 401 && this.resources.credential(mcp.id)?.refreshToken) { await response.body?.cancel(); response = await send(true); }
      const headers: Record<string, string> = {};
      for (const key of ['content-type', 'mcp-session-id', 'mcp-protocol-version', 'cache-control']) { const value = response.headers.get(key); if (value) headers[key] = value; }
      res.writeHead(response.status, headers);
      if (response.body) { const stream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream); stream.once('error', () => res.destroy()); stream.pipe(res); } else res.end();
    } catch { if (!res.headersSent) res.writeHead(502); res.end('MCP connection failed. Check its sign-in and connection in accio.'); }
    return true;
  }
}
