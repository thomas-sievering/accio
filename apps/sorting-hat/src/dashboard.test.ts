import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccessVerifier, accessFromEnv, accessIssuer } from './access.js';
import { isLoopbackAddress, isLoopbackHost } from './dashboard.js';
import { startStandalone } from './standalone.js';
import { fakeAnthropicApi, fakeAnthropicAuth } from './testing/fakeProviders.js';
import type { Fetch } from './types.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

const TEAM = 'hats.cloudflareaccess.com';
const ISSUER = `https://${TEAM}`;
const AUD = 'aud-tag-1234';

/** A Cloudflare Access team: RSA keys it signs with, and its certs endpoint, faked at the fetch boundary. */
function fakeAccess() {
  const keys = new Map<string, { privateKey: KeyObject; publicKey: KeyObject }>();
  let published: string[] = [];
  const reads: string[] = [];
  const addKey = (kid: string) => { keys.set(kid, generateKeyPairSync('rsa', { modulusLength: 2048 })); published.push(kid); };
  const fetch: Fetch = async (url) => {
    reads.push(String(url));
    if (String(url) !== `${ISSUER}/cdn-cgi/access/certs`) return new Response('not found', { status: 404 });
    return Response.json({ keys: published.map((kid) => ({ ...keys.get(kid)!.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' })) });
  };
  const token = (claims: Record<string, unknown> = {}, { kid = published[0]!, alg = 'RS256', signWith = kid } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const head = Buffer.from(JSON.stringify({ alg, kid, typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ aud: [AUD], iss: ISSUER, email: 'owner@example.com', sub: 'user-1', iat: now, nbf: now, exp: now + 600, ...claims })).toString('base64url');
    const signature = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), keys.get(signWith)!.privateKey).toString('base64url');
    return `${head}.${body}.${signature}`;
  };
  return { fetch, token, addKey, reads, rotate: (kid: string) => { published = []; addKey(kid); } };
}

describe('Cloudflare Access tokens', () => {
  it('accepts a token signed by the team for this application, and refuses everything else', async () => {
    const access = fakeAccess();
    access.addKey('k1');
    access.addKey('other');
    const verifier = new AccessVerifier({ teamDomain: TEAM, aud: AUD }, access.fetch);
    expect(await verifier.verify(access.token())).toEqual({ email: 'owner@example.com', sub: 'user-1' });
    expect(await verifier.verify(access.token({ aud: AUD }))).toMatchObject({ email: 'owner@example.com' });

    const now = Math.floor(Date.now() / 1000);
    const refused = {
      'another application': access.token({ aud: ['someone-else'] }),
      'another team': access.token({ iss: 'https://evil.cloudflareaccess.com' }),
      'expired': access.token({ exp: now - 120 }),
      'not yet valid': access.token({ nbf: now + 600 }),
      'without exp': access.token({ exp: undefined }),
      'signed with another key': access.token({}, { kid: 'k1', signWith: 'other' }),
      'an unknown key': access.token({}, { kid: 'nobody', signWith: 'k1' }),
      'HS256': access.token({}, { alg: 'HS256' }),
      'none': access.token({}, { alg: 'none' }),
    };
    for (const [why, token] of Object.entries(refused)) expect(await verifier.verify(token), why).toBeUndefined();
    const [head, body] = access.token().split('.');
    const tampered = Buffer.from(JSON.stringify({ aud: [AUD], iss: ISSUER, email: 'intruder@example.com', exp: now + 600 })).toString('base64url');
    expect(await verifier.verify(`${head}.${tampered}.${access.token().split('.')[2]}`)).toBeUndefined();
    for (const junk of [undefined, '', 'a.b', 'a.b.c', `${head}.${body}`]) expect(await verifier.verify(junk)).toBeUndefined();
  });

  it('reads the certs again when Access rotates its key, but not for every unknown key', async () => {
    const access = fakeAccess();
    access.addKey('old');
    let now = Date.now();
    const verifier = new AccessVerifier({ teamDomain: `https://${TEAM}/`, aud: AUD }, access.fetch, () => now);
    expect(await verifier.verify(access.token())).toBeDefined();
    expect(await verifier.verify(access.token())).toBeDefined();
    expect(access.reads).toEqual([`${ISSUER}/cdn-cgi/access/certs`]);

    access.rotate('new');
    // Just after a read, an unknown key waits for the cooldown instead of reading again.
    expect(await verifier.verify(access.token({}, { kid: 'new' }))).toBeUndefined();
    expect(access.reads).toHaveLength(1);
    now += 31_000;
    expect(await verifier.verify(access.token({}, { kid: 'new' }))).toBeDefined();
    expect(access.reads).toHaveLength(2);
    // The rotated-out key no longer verifies.
    expect(await verifier.verify(access.token({}, { kid: 'old', signWith: 'old' }))).toBeUndefined();
  });

  it('reads its settings from the environment, both or neither', () => {
    expect(accessFromEnv({})).toBeUndefined();
    expect(accessFromEnv({ SORTING_HAT_ACCESS_TEAM_DOMAIN: TEAM, SORTING_HAT_ACCESS_AUD: AUD })).toEqual({ teamDomain: TEAM, aud: AUD });
    expect(() => accessFromEnv({ SORTING_HAT_ACCESS_TEAM_DOMAIN: TEAM })).toThrow(/both/);
    expect(accessIssuer('hats.cloudflareaccess.com')).toBe(ISSUER);
    expect(accessIssuer('https://hats.cloudflareaccess.com/')).toBe(ISSUER);
    expect(() => accessIssuer('https://hats.cloudflareaccess.com/cdn-cgi/access/certs')).toThrow();
  });
});

describe('loopback addresses', () => {
  it('knows this machine from other hosts', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(a), a).toBe(true);
    for (const a of [undefined, '10.0.0.2', '::ffff:192.168.1.4', '172.17.0.1', 'fe80::1']) expect(isLoopbackAddress(a), a).toBe(false);
    for (const h of ['127.0.0.1:47330', 'localhost:1', 'localhost', '[::1]:8080']) expect(isLoopbackHost(h), h).toBe(true);
    for (const h of [undefined, '', 'evil.example', 'localhost.evil.example', '127.0.0.1.nip.io', 'sortinghat.mediatom.cc']) expect(isLoopbackHost(h), h).toBe(false);
  });
});

/** A raw HTTP request, so the test can choose the Host header. */
function call(url: string, { method = 'GET', headers = {}, body }: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; text: string }>((resolve, reject) => {
    const req = request(url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function standalone(withAccess: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'sorting-hat-dashboard-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const access = fakeAccess();
  access.addKey('k1');
  const auth = fakeAnthropicAuth();
  const anthropic = await fakeAnthropicApi();
  const hat = await startStandalone({ dir, claudeFetch: auth.fetch, anthropicUrl: anthropic.url, ...(withAccess ? { access: { teamDomain: TEAM, aud: AUD }, accessFetch: access.fetch } : {}) });
  cleanup.push(anthropic.close, hat.close);
  const admin = { authorization: `Bearer ${hat.adminToken}` };
  return { hat, access, admin, origin: hat.url };
}

describe('the dashboard behind Cloudflare Access', () => {
  it('needs a valid Access token for the dashboard and the API, or the admin token, while model routes take hat keys', async () => {
    const { hat, access, admin, origin } = await standalone(true);
    const jwt = { 'cf-access-jwt-assertion': access.token() };
    const dash = { ...jwt, 'x-sorting-hat-dashboard': '1' };

    // Loopback is not trusted here: a tunnel reaches the server over loopback too.
    expect((await call(`${hat.url}/`)).status).toBe(401);
    expect((await call(`${hat.url}/dashboard/app.js`)).status).toBe(401);
    expect((await call(`${hat.url}/`, { headers: { 'cf-access-jwt-assertion': access.token({ aud: ['other'] }) } })).status).toBe(401);
    const page = await call(`${hat.url}/`, { headers: jwt });
    expect(page.status).toBe(200);
    expect(page.text).toContain('<title>Sorting Hat</title>');
    expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(JSON.parse((await call(`${hat.url}/dashboard/session`, { headers: jwt })).text)).toEqual({ mode: 'access', email: 'owner@example.com' });

    expect((await call(`${hat.url}/api/houses`, { headers: { 'x-sorting-hat-dashboard': '1' } })).status).toBe(401);
    expect((await call(`${hat.url}/api/houses`, { headers: jwt })).status).toBe(401);
    expect((await call(`${hat.url}/api/houses`, { headers: dash })).status).toBe(200);
    // Changes need the dashboard's own origin as well.
    expect((await call(`${hat.url}/api/houses`, { method: 'POST', headers: dash, body: { name: 'Personal' } })).status).toBe(403);
    expect((await call(`${hat.url}/api/houses`, { method: 'POST', headers: { ...dash, origin: 'https://evil.example' }, body: { name: 'Personal' } })).status).toBe(403);
    expect((await call(`${hat.url}/api/houses`, { method: 'POST', headers: { ...dash, origin }, body: { name: 'Personal' } })).status).toBe(201);
    // Where Access is bypassed at the edge (so the hub can reach /api/), the browser still sends Access's cookie.
    const cookie = { cookie: `theme=dark; CF_Authorization=${access.token()}`, 'x-sorting-hat-dashboard': '1' };
    expect((await call(`${hat.url}/api/houses`, { headers: cookie })).status).toBe(200);
    expect((await call(`${hat.url}/api/houses`, { headers: { ...cookie, cookie: `CF_Authorization=${access.token({ exp: 1 })}` } })).status).toBe(401);

    // The hub's admin token needs no Access token.
    expect((await call(`${hat.url}/api/houses`, { headers: admin })).status).toBe(200);
    const account = JSON.parse((await call(`${hat.url}/api/accounts`, { method: 'POST', headers: admin, body: { name: 'Mine', providerId: 'anthropic' } })).text);
    const signIn = JSON.parse((await call(`${hat.url}/api/accounts/${account.id}/sign-in`, { method: 'POST', headers: admin })).text);
    const state = new URL(signIn.url).searchParams.get('state');
    expect((await call(`${hat.url}/api/sign-ins/${signIn.signInId}/complete`, { method: 'POST', headers: admin, body: { code: `pasted#${state}` } })).status).toBe(200);
    expect((await call(`${hat.url}/api/houses/personal/accounts`, { method: 'PUT', headers: admin, body: { anthropic: [account.id] } })).status).toBe(200);
    const key = JSON.parse((await call(`${hat.url}/api/hat-keys`, { method: 'POST', headers: admin, body: { houseId: 'personal', name: 'pi' } })).text);

    // Model routes stay open to hat keys, without Access, and refuse an Access token alone.
    expect((await call(`${hat.url}/v1/messages`, { method: 'POST', headers: { authorization: `Bearer ${key.secret}` }, body: { model: 'claude-test', messages: [] } })).status).toBe(200);
    expect((await call(`${hat.url}/v1/messages`, { method: 'POST', headers: jwt, body: {} })).status).toBe(401);
    expect((await call(`${hat.url}/healthz`)).status).toBe(200);
  });
});

describe('the dashboard without Cloudflare Access', () => {
  it('opens on loopback only, and its API calls must come from the dashboard itself', async () => {
    const { hat, origin } = await standalone(false);
    const host = new URL(hat.url).host;
    const dash = { 'x-sorting-hat-dashboard': '1' };

    const page = await call(`${hat.url}/`);
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect((await call(`${hat.url}/dashboard/app.js`)).headers['content-type']).toContain('javascript');
    expect((await call(`${hat.url}/dashboard/app.css`)).status).toBe(200);
    expect((await call(`${hat.url}/dashboard/../src/main.ts`)).status).not.toBe(200);
    expect((await call(`${hat.url}/dashboard/nothing.js`)).status).toBe(404);
    expect((await call(`${hat.url}/`, { method: 'POST' })).status).toBe(405);
    expect(JSON.parse((await call(`${hat.url}/dashboard/session`)).text)).toEqual({ mode: 'loopback', email: null });
    // DNS rebinding: a page at another name that resolves here is refused.
    expect((await call(`${hat.url}/`, { headers: { host: 'evil.example' } })).status).toBe(403);
    expect((await call(`${hat.url}/api/houses`, { headers: { ...dash, host: 'evil.example' } })).status).toBe(401);

    expect((await call(`${hat.url}/api/houses`)).status).toBe(401);
    expect((await call(`${hat.url}/api/houses`, { headers: dash })).status).toBe(200);
    expect((await call(`${hat.url}/api/houses`, { method: 'POST', headers: dash, body: { name: 'Personal' } })).status).toBe(403);
    expect((await call(`${hat.url}/api/houses`, { method: 'POST', headers: { ...dash, origin: 'http://evil.example' }, body: { name: 'Personal' } })).status).toBe(403);
    expect((await call(`${hat.url}/api/houses`, { method: 'POST', headers: { ...dash, origin: `http://localhost:${hat.port}` }, body: { name: 'Personal' } })).status).toBe(403);
    expect((await call(`${hat.url}/api/houses`, { method: 'POST', headers: { ...dash, origin }, body: { name: 'Personal' } })).status).toBe(201);
    expect(host).toMatch(/^127\.0\.0\.1:/);

    // Model paths are still model routes.
    expect((await call(`${hat.url}/v1/messages`, { method: 'POST', headers: dash, body: {} })).status).toBe(401);
  });
});
