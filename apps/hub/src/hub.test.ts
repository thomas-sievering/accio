import { createServer, type IncomingHttpHeaders } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLAUDE_OAUTH, type Fetch } from './claudeOAuth.js';
import { Hub } from './hub.js';
import { startHubProxy } from './proxy.js';

/** Anthropic's token endpoint, faked: every code or refresh yields a new numbered token. */
function fakeAnthropicAuth() {
  let n = 0;
  const grants: string[] = [];
  const f: Fetch = async (url, init) => {
    if (String(url) !== CLAUDE_OAUTH.tokenUrl) return fetch(url, init);
    const body = JSON.parse(String(init?.body));
    grants.push(body.grant_type);
    if (body.code === 'bad') return new Response(JSON.stringify({ error_description: 'Invalid code' }), { status: 400 });
    n++;
    return Response.json({
      access_token: `token-${n}`,
      refresh_token: `refresh-${n}`,
      expires_in: body.code === 'short' ? 60 : 3600,
      account: { uuid: body.code === 'job' ? 'claude-job' : 'claude-me', email_address: 'me@example.com' },
    });
  };
  return { f, grants };
}

/** Anthropic's API, faked: records what arrives and streams a reply. */
async function fakeAnthropicApi() {
  const seen: { url: string; headers: IncomingHttpHeaders; body: string }[] = [];
  let rejectNext = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ url: req.url ?? '', headers: req.headers, body });
    if (rejectNext > 0) {
      rejectNext--;
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"type":"error"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('event: a\n\n');
    setTimeout(() => res.end('event: b\n\n'), 10);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    rejectNextWith401: (count = 1) => (rejectNext = count),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('hub', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const c of cleanup.splice(0).reverse()) await c();
  });

  async function setup() {
    const home = await mkdtemp(join(tmpdir(), 'accio-hub-'));
    const auth = fakeAnthropicAuth();
    const api = await fakeAnthropicApi();
    const hub = new Hub(home, auth.f);
    await hub.load();
    const proxy = await startHubProxy({ hub, host: '127.0.0.1', port: 0, upstream: api.url, fetchImpl: auth.f });
    cleanup.push(
      () => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
      () => hub.close(),
      api.close,
      proxy.close,
    );
    const call = (key: string, headers: Record<string, string> = {}) =>
      fetch(`${proxy.url}/v1/messages?beta=true`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...headers },
        body: '{"model":"x"}',
      });
    return { home, hub, auth, api, call };
  }

  it('signs an account in from a pasted code and stores only on the hub', async () => {
    const { hub, home } = await setup();
    await hub.ensureAccount('personal');
    const { signInId, url } = hub.beginSignIn('personal');
    const state = new URL(url).searchParams.get('state');
    await hub.completeSignIn(signInId, `good#${state}`);
    expect(hub.summary('personal')).toEqual({ signedIn: true, email: 'me@example.com', organization: null, claudeAccountId: 'claude-me' });
    await hub.close();
    const stored = JSON.parse(await readFile(join(home, 'hub', 'accounts.json'), 'utf8'));
    expect(stored[0].login.accessToken).toBe('token-1');
    // A sign-in is used once.
    await expect(hub.completeSignIn(signInId, 'good')).rejects.toThrow(/expired/);
  });

  it('lets accio refuse a login before it is stored', async () => {
    const { hub } = await setup();
    await hub.ensureAccount('hrc');
    const { signInId } = hub.beginSignIn('hrc');
    await expect(
      hub.completeSignIn(signInId, 'job', () => {
        throw new Error('already used by Personal');
      }),
    ).rejects.toThrow(/Personal/);
    expect(hub.summary('hrc').signedIn).toBe(false);
  });

  it('forwards an account’s requests with its own token, and only its own', async () => {
    const { hub, api, call } = await setup();
    const personalKey = await hub.ensureAccount('personal');
    const hrcKey = await hub.ensureAccount('hrc');
    const a = hub.beginSignIn('personal');
    await hub.completeSignIn(a.signInId, 'good');
    const b = hub.beginSignIn('hrc');
    await hub.completeSignIn(b.signInId, 'job');

    const res = await call(personalKey, { 'anthropic-beta': 'claude-code-20250219', 'user-agent': 'claude-cli/2.1' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('event: a\n\nevent: b\n\n');
    await (await call(hrcKey)).text();

    expect(api.seen[0]).toMatchObject({ url: '/v1/messages?beta=true', body: '{"model":"x"}' });
    expect(api.seen[0]!.headers).toMatchObject({
      authorization: 'Bearer token-1',
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
      'user-agent': 'claude-cli/2.1',
    });
    expect(api.seen[0]!.headers['x-api-key']).toBeUndefined();
    expect(api.seen[1]!.headers.authorization).toBe('Bearer token-2');
  });

  it('refuses unknown keys and accounts that are not signed in', async () => {
    const { hub, api, call } = await setup();
    const key = await hub.ensureAccount('personal');
    expect((await call('nope')).status).toBe(401);
    const notSignedIn = await call(key);
    expect(notSignedIn.status).toBe(401);
    expect(await notSignedIn.text()).toMatch(/not signed in/);
    expect(api.seen).toHaveLength(0);
  });

  it('refreshes a token close to expiry, and retries once after a 401', async () => {
    const { hub, auth, api, call } = await setup();
    const key = await hub.ensureAccount('personal');
    const s = hub.beginSignIn('personal');
    await hub.completeSignIn(s.signInId, 'short'); // expires within the refresh margin

    await (await call(key)).text();
    expect(auth.grants).toEqual(['authorization_code', 'refresh_token']);
    expect(api.seen[0]!.headers.authorization).toBe('Bearer token-2');

    api.rejectNextWith401();
    const res = await call(key);
    expect(res.status).toBe(200);
    await res.text();
    expect(api.seen.slice(1).map((s) => s.headers.authorization)).toEqual(['Bearer token-2', 'Bearer token-3']);
  });
});
