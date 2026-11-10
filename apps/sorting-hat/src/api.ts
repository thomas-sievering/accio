import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SIGN_IN_TTL_MS } from './claudeOAuth.js';
import { HatError } from './errors.js';
import type { AccountSelection, SortingHat } from './sortingHat.js';
import type { AccountView, ProviderId } from './types.js';
import { USAGE_DIMENSIONS, type UsageDimension, type UsageQuery } from './usage.js';

/** Where the management API lives; everything else on the server is a model route. */
export const API_PREFIX = '/api/';
const PROVIDERS: ProviderId[] = ['anthropic', 'openai'];
const MAX_BODY = 1024 * 1024;

type Reply = { status: number; body?: unknown };
type Route = (params: string[], body: any, query: URLSearchParams) => Promise<Reply> | Reply;

/**
 * The management API (API.md): accounts and their sign-in, houses, hat keys,
 * limits and usage, as JSON, for whoever holds the admin token.
 */
export function manageSortingHat(hat: SortingHat, adminToken: string) {
  const admin = digest(adminToken);
  /** Sign-ins that finished, so a late status poll still sees the account. */
  const completed = new Map<string, { account: AccountView; at: number }>();
  const complete = (signInId: string, account: AccountView) => {
    for (const [id, c] of completed) if (Date.now() - c.at > SIGN_IN_TTL_MS) completed.delete(id);
    completed.set(signInId, { account, at: Date.now() });
    return { status: 'complete' as const, account };
  };
  const ok = (body: unknown, status = 200): Reply => ({ status, body });
  const none: Reply = { status: 204 };

  const routes: Record<string, Route> = {
    // Accounts
    'GET accounts': () => ok(hat.accountViews()),
    'POST accounts': (_, b) => {
      if (!PROVIDERS.includes(b.providerId)) throw new HatError('providerId must be anthropic or openai.');
      return hat.saveAccount(text(b.name, 'name'), undefined, b.providerId).then((a) => ok(a, 201));
    },
    'GET accounts/:id': ([id]) => ok(hat.accountView(id!)),
    'PATCH accounts/:id': ([id], b) => (hat.accountView(id!), hat.saveAccount(text(b.name, 'name'), id).then(ok)),
    'DELETE accounts/:id': ([id]) => hat.deleteAccount(id!).then(() => none),
    'POST accounts/:id/sign-out': ([id]) => hat.signOutAccount(id!).then(ok),
    'POST accounts/:id/sign-in': async ([id], b) => {
      const account = hat.accountView(id!);
      if (account.providerId === 'openai') {
        if (b.flow !== undefined && b.flow !== 'browser' && b.flow !== 'device') throw new HatError('flow must be browser or device.');
        return ok({ providerId: 'openai', ...await hat.beginOpenAISignIn(id!, b.flow !== 'device') }, 201);
      }
      if (b.redirectUri !== undefined) claudeRedirect(b.redirectUri);
      return ok({ providerId: 'anthropic', ...hat.beginAccountSignIn(id!, b.redirectUri) }, 201);
    },

    // Sign-ins in progress
    'GET sign-ins/:id': async ([id]) => {
      const done = completed.get(id!);
      if (done) return ok({ status: 'complete', account: done.account });
      const provider = signInProvider(id!);
      if (provider === 'anthropic') return ok({ status: 'pending' });
      const result = await hat.openaiSignInStatus(id!);
      return ok(result.status === 'complete' ? complete(id!, result.account) : result);
    },
    'POST sign-ins/:id/complete': async ([id], b) => {
      if (completed.has(id!)) throw new HatError('This sign-in is already complete.', 409);
      if (signInProvider(id!) === 'anthropic') return ok(complete(id!, await hat.completeAccountSignIn(id!, text(b.code, 'code', 16_384))));
      // ChatGPT in the browser lands on a localhost page that may not exist here: paste its address, or its code and state.
      let { code, state } = b;
      if (typeof b.url === 'string') {
        let url: URL;
        try { url = new URL(b.url); } catch { throw new HatError('url is not an address.'); }
        code = url.searchParams.get('code'); state = url.searchParams.get('state');
      }
      await hat.completeOpenAICallback(id!, text(code, 'code', 16_384), text(state, 'state', 1024));
      return ok({ status: 'pending' });
    },
    'DELETE sign-ins/:id': ([id]) => hat.cancelAccountSignIn(id!).then(() => none),

    // Houses
    'GET houses': () => ok(hat.houseViews()),
    'POST houses': (_, b) => {
      if (b.id !== undefined && typeof b.id !== 'string') throw new HatError('id must be a string.');
      return hat.createHouse(text(b.name, 'name'), b.id).then(async (house) => {
        const selection = b.accounts === undefined ? {} : accountSelection(b.accounts);
        if (!Object.keys(selection).length) return ok(house, 201);
        try { return ok(await hat.setHouseAccounts(house.id, selection), 201); }
        catch (error) { await hat.removeHouse(house.id); throw error; }
      });
    },
    'GET houses/:id': ([id]) => ok(hat.houseView(id!)),
    'PATCH houses/:id': ([id], b) => hat.renameHouse(id!, text(b.name, 'name')).then(ok),
    'PUT houses/:id/accounts': ([id], b) => hat.setHouseAccounts(id!, accountSelection(b)).then(ok),
    'DELETE houses/:id': ([id]) => (hat.houseView(id!), hat.removeHouse(id!).then(() => none)),
    'GET houses/:id/hat-keys': ([id]) => ok(hat.hatKeyViews(id!)),

    // Hat keys
    'GET hat-keys': (_, __, q) => ok(hat.hatKeyViews(q.get('house') ?? undefined)),
    'POST hat-keys': (_, b) => hat.createHatKey(text(b.houseId, 'houseId'), text(b.name, 'name')).then((k) => ok(k, 201)),
    'GET hat-keys/:id': ([id]) => ok(hat.hatKeyView(id!)),
    'PATCH hat-keys/:id': ([id], b) => hat.renameHatKey(id!, text(b.name, 'name')).then(ok),
    'POST hat-keys/:id/revoke': ([id]) => hat.revokeHatKey(id!).then(ok),
    'DELETE hat-keys/:id': ([id]) => hat.deleteHatKey(id!).then(() => none),

    // Limits
    'GET limits': () => ok(hat.limitViews()),
    'POST limits/refresh': (_, b) => {
      if (b.accountIds !== undefined && (!Array.isArray(b.accountIds) || b.accountIds.some((a: unknown) => typeof a !== 'string'))) throw new HatError('accountIds must be a list of account ids.');
      return hat.refreshLimits(b.accountIds, b.force === true).then(() => ok(hat.limitViews()));
    },

    // Usage
    'GET usage': (_, __, q) => ok(hat.usageReport(usageQuery(q))),
  };

  function signInProvider(id: string) {
    const provider = hat.signInProvider(id);
    if (!provider) throw new HatError('This sign-in has expired or was cancelled. Start it again.', 404);
    return provider;
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://sorting-hat');
    const given = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]?.trim();
    if (!given || !timingSafeEqual(digest(given), admin)) return send(res, 401, error('authentication_error', 'This needs the Sorting Hat’s admin token.'));
    const segments = url.pathname.slice(API_PREFIX.length).split('/').filter(Boolean).map(decodeURIComponent);
    const match = findRoute(routes, req.method ?? 'GET', segments);
    if (!match) return send(res, 404, error('not_found_error', `No ${req.method} ${url.pathname}`));
    if (match === 'method') return send(res, 405, error('invalid_request_error', `${req.method} is not allowed on ${url.pathname}`));
    const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req);
    const reply = await match.route(match.params, body, url.searchParams);
    send(res, reply.status, reply.body);
  }

  return (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return void res.destroy();
      if (err instanceof HatError) return send(res, err.status, error(err.status === 404 ? 'not_found_error' : err.status === 409 ? 'conflict_error' : 'invalid_request_error', err.message));
      console.error('[sorting-hat] management error', err);
      send(res, 500, error('api_error', 'The Sorting Hat could not do that. Try again.'));
    });
  };
}

function findRoute(routes: Record<string, Route>, method: string, segments: string[]) {
  let pathMatched = false;
  for (const [key, route] of Object.entries(routes)) {
    const [verb, pattern] = key.split(' ') as [string, string];
    const parts = pattern.split('/');
    if (parts.length !== segments.length) continue;
    const params: string[] = [];
    if (!parts.every((p, i) => p.startsWith(':') ? (params.push(segments[i]!), true) : p === segments[i])) continue;
    pathMatched = true;
    if (verb === method) return { route, params };
  }
  return pathMatched ? 'method' as const : undefined;
}

function accountSelection(value: unknown): AccountSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HatError('accounts must map providers to lists of account ids.');
  const selection: AccountSelection = {};
  for (const [provider, ids] of Object.entries(value)) {
    if (!PROVIDERS.includes(provider as ProviderId)) throw new HatError(`Unknown provider ${provider}.`);
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new HatError(`${provider} must be a list of account ids.`);
    selection[provider as ProviderId] = ids;
  }
  return selection;
}

/**
 * `from` and `to` are times; `groupBy` and `bucket` say how to split; house,
 * hatKey, account, model and provider filter (hatKey `embedded` is the
 * embedding app's). `groupBy` may repeat or list several, comma-separated.
 */
function usageQuery(q: URLSearchParams): UsageQuery {
  const time = (field: string) => {
    const value = q.get(field);
    if (value === null || value === '') return undefined;
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) throw new HatError(`${field} must be a time, such as 2026-11-01T00:00:00Z.`);
    return ms;
  };
  const groupBy = q.getAll('groupBy').flatMap((g) => g.split(',')).map((g) => g.trim()).filter(Boolean);
  for (const g of groupBy) if (!USAGE_DIMENSIONS.includes(g as UsageDimension)) throw new HatError(`groupBy must be among ${USAGE_DIMENSIONS.join(', ')}.`);
  const bucket = q.get('bucket') || undefined;
  if (bucket !== undefined && bucket !== 'hour' && bucket !== 'day') throw new HatError('bucket must be hour or day.');
  const where: UsageQuery['where'] = {};
  for (const d of USAGE_DIMENSIONS) {
    const value = q.get(d);
    if (value !== null) where[d] = d === 'hatKey' && value === 'embedded' ? null : value;
  }
  return { from: time('from'), to: time('to'), groupBy: groupBy as UsageDimension[], bucket, where };
}

/** The hub's rule for Claude's browser callback: a localhost page on the caller's own machine. */
function claudeRedirect(value: unknown) {
  let u: URL;
  try { u = new URL(String(value)); } catch { throw new HatError('redirectUri is not an address.'); }
  if (u.protocol !== 'http:' || u.hostname !== 'localhost' || u.pathname !== '/callback' || !u.port || u.search || u.hash || u.username || u.password) throw new HatError('redirectUri must be http://localhost:<port>/callback.');
}

function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HatError(`${field} must be a non-empty string.`);
  return value;
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HatError('The request body is too large.');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HatError('The request body is not JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HatError('The request body must be a JSON object.');
  return body;
}

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function error(type: string, message: string) {
  return { error: { type, message } };
}

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) return void res.writeHead(status, { 'cache-control': 'no-store' }).end();
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
