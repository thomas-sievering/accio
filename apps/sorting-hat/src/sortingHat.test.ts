import { createServer, type IncomingHttpHeaders } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLAUDE_OAUTH } from './claudeOAuth.js';
import type { Fetch } from './types.js';
import { JsonFile } from './store.js';
import { SortingHat } from './sortingHat.js';
import { startForwarding } from './proxy.js';

/**
 * Anthropic's token and usage endpoints, faked: every code or refresh yields a
 * new numbered token, and `usage` holds what each token's account reports.
 */
function fakeAnthropicAuth() {
  let n = 0;
  const grants: string[] = [];
  const usage: Record<string, unknown> = {};
  const f: Fetch = async (url, init) => {
    if (String(url) === 'https://api.anthropic.com/api/oauth/usage') {
      return Response.json(usage[new Headers(init?.headers).get('authorization')!.slice('Bearer '.length)] ?? {});
    }
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
  return { f, grants, usage };
}

/** Anthropic's API, faked: records what arrives and streams a reply. */
async function fakeAnthropicApi() {
  const seen: { url: string; headers: IncomingHttpHeaders; body: string }[] = [];
  /** Tokens whose account has run out of allowance. */
  const limited = new Set<string>();
  let rejectNext = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ url: req.url ?? '', headers: req.headers, body });
    if (limited.has(req.headers.authorization?.slice('Bearer '.length) ?? '')) {
      res.writeHead(429, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"rate_limit_error"}}');
      return;
    }
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
    limited,
    rejectNextWith401: (count = 1) => (rejectNext = count),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('sorting hat', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const c of cleanup.splice(0).reverse()) await c();
  });

  async function setup(fetchImpl?: Fetch) {
    const home = await mkdtemp(join(tmpdir(), 'accio-hub-'));
    const auth = fakeAnthropicAuth();
    const api = await fakeAnthropicApi();
    const hub = new SortingHat(join(home, 'hub'), fetchImpl ?? auth.f);
    await hub.load();
    const proxy = await startForwarding({ accounts: hub, host: '127.0.0.1', port: 0, upstream: api.url, fetchImpl: auth.f });
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

  it('signs a named account in from a pasted code and stores only on the hub', async () => {
    const { hub, home } = await setup();
    await hub.ensureHouse('personal');
    const { signInId, url } = await beginForHouse(hub, 'personal');
    const state = new URL(url).searchParams.get('state');
    await hub.completeAccountSignIn(signInId, `good#${state}`);
    expect(hub.selectedAccount('personal')).toMatchObject({ signedIn: true, email: 'me@example.com', organization: null });
    await hub.close();
    const stored = JSON.parse(await readFile(join(home, 'hub', 'profiles.json'), 'utf8'));
    expect(stored.accounts[0].account.accessToken).toBe('token-1');
    // A sign-in is used once.
    await expect(hub.completeAccountSignIn(signInId, 'good')).rejects.toThrow(/expired/);
  });

  it('migrates inline logins, preserving profile keys and account selections', async () => {
    const { hub, home } = await setup();
    const key = await hub.ensureHouse('personal');
    const start = await beginForHouse(hub, 'personal');
    await hub.completeAccountSignIn(start.signInId, 'good');
    await hub.close();
    const store = join(home, 'hub', 'profiles.json');
    const data = JSON.parse(await readFile(store, 'utf8'));
    await writeFile(store, JSON.stringify([{ id: 'personal', accessKey: key, account: data.accounts[0].account }]));
    const migrated = new SortingHat(join(home, 'hub'));
    await migrated.load();
    expect(await migrated.ensureHouse('personal')).toBe(key);
    expect(migrated.selectedAccount('personal')).toMatchObject({ name: 'me@example.com', signedIn: true });
    expect(await migrated.accessToken('personal')).toBe('token-1');
    await migrated.close();
    const reloaded = new SortingHat(join(home, 'hub'));
    await reloaded.load();
    expect(reloaded.accountViews()).toEqual(migrated.accountViews());
    await reloaded.close();
  });

  it('shares a single refresh across profiles selecting the same account', async () => {
    const { hub, auth } = await setup();
    const account = await hub.saveAccount('Family account');
    const start = hub.beginAccountSignIn(account.id);
    await hub.completeAccountSignIn(start.signInId, 'short');
    for (const id of ['personal', 'work']) {
      await hub.ensureHouse(id);
      await selectAccount(hub, id, account.id);
    }
    expect(await Promise.all([hub.accessToken('personal'), hub.accessToken('work')])).toEqual(['token-2', 'token-2']);
    expect(auth.grants).toEqual(['authorization_code', 'refresh_token']);
  });

  it('forwards a profile’s requests with its own token, and only its own', async () => {
    const { hub, api, call } = await setup();
    const personalKey = await hub.ensureHouse('personal');
    const hrcKey = await hub.ensureHouse('hrc');
    const a = await beginForHouse(hub, 'personal');
    await hub.completeAccountSignIn(a.signInId, 'good');
    const b = await beginForHouse(hub, 'hrc');
    await hub.completeAccountSignIn(b.signInId, 'job');

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

  it('refuses unknown keys and profiles that are not signed in', async () => {
    const { hub, api, call } = await setup();
    const key = await hub.ensureHouse('personal');
    expect((await call('nope')).status).toBe(401);
    const notSignedIn = await call(key);
    expect(notSignedIn.status).toBe(401);
    expect(await notSignedIn.text()).toMatch(/not signed in/);
    expect(api.seen).toHaveLength(0);
  });

  it('refreshes a token close to expiry, and retries once after a 401', async () => {
    const { hub, auth, api, call } = await setup();
    const key = await hub.ensureHouse('personal');
    const s = await beginForHouse(hub, 'personal');
    await hub.completeAccountSignIn(s.signInId, 'short'); // expires within the refresh margin

    await (await call(key)).text();
    expect(auth.grants).toEqual(['authorization_code', 'refresh_token']);
    expect(api.seen[0]!.headers.authorization).toBe('Bearer token-2');

    api.rejectNextWith401();
    const res = await call(key);
    expect(res.status).toBe(200);
    await res.text();
    expect(api.seen.slice(1).map((s) => s.headers.authorization)).toEqual(['Bearer token-2', 'Bearer token-3']);
  });
  it('does not publish account writes that fail and keeps its mutation queue usable', async () => {
    const { hub, home } = await setup();
    const account = await hub.saveAccount('Original');
    await hub.ensureHouse('personal');
    vi.spyOn(JsonFile.prototype, 'write').mockRejectedValueOnce(new Error('disk full'));
    await expect(hub.saveAccount('Changed', account.id)).rejects.toThrow('disk full');
    expect(hub.accountView(account.id).name).toBe('Original');
    vi.spyOn(JsonFile.prototype, 'write').mockRejectedValueOnce(new Error('disk full'));
    await expect(selectAccount(hub, 'personal', account.id)).rejects.toThrow('disk full');
    expect(hub.selectedAccount('personal')).toBeNull();
    await Promise.all([hub.saveAccount('Second'), hub.saveAccount('Third')]);
    expect(hub.accountViews().map((a) => a.name)).toEqual(['Original', 'Second', 'Third']);
    const reloaded = new SortingHat(join(home, 'hub'));
    await reloaded.load();
    expect(reloaded.accountViews()).toEqual(hub.accountViews());
    await reloaded.close();
  });

  it('serializes account deletion against a prepared profile selection', async () => {
    const { hub } = await setup();
    const account = await hub.saveAccount('Shared');
    let release!: () => void;
    let preparing!: () => void;
    const ready = new Promise<void>((r) => { preparing = r; });
    const wait = new Promise<void>((r) => { release = r; });
    const save = hub.configureHouse('personal', { anthropic: [account.id] }, async () => { preparing(); await wait; });
    await ready;
    const deletion = hub.deleteAccount(account.id);
    const result = expect(deletion).rejects.toThrow(/profiles/);
    release();
    await save;
    await result;
    expect(hub.selectedAccounts('personal', 'anthropic').map((a) => a.id)).toEqual([account.id]);
    await hub.removeHouse('personal');
    await hub.deleteAccount(account.id);
    expect(hub.accountViews()).toEqual([]);
  });

  it('cancels an in-flight sign-in on sign-out or account deletion', async () => {
    const auth = fakeAnthropicAuth();
    let release!: () => void;
    let exchanged!: () => void;
    let entered = new Promise<void>((r) => { exchanged = r; });
    let wait = new Promise<void>((r) => { release = r; });
    const { hub } = await setup(async (url, init) => {
      exchanged();
      await wait;
      return auth.f(url, init);
    });
    const account = await hub.saveAccount('Personal');
    let start = hub.beginAccountSignIn(account.id);
    let completion = hub.completeAccountSignIn(start.signInId, 'good');
    await entered;
    await hub.signOutAccount(account.id);
    release();
    await expect(completion).rejects.toThrow(/cancelled/);
    expect(hub.accountView(account.id).signedIn).toBe(false);

    entered = new Promise<void>((r) => { exchanged = r; });
    wait = new Promise<void>((r) => { release = r; });
    start = hub.beginAccountSignIn(account.id);
    completion = hub.completeAccountSignIn(start.signInId, 'good');
    await entered;
    await hub.deleteAccount(account.id);
    release();
    await expect(completion).rejects.toThrow(/cancelled/);
    expect(hub.accountViews()).toEqual([]);
  });

  it('does not let a late refresh undo sign-out, sign-in, selection, or profile removal', async () => {
    const auth = fakeAnthropicAuth();
    let release!: () => void;
    let refreshing!: () => void;
    let entered = new Promise<void>((r) => { refreshing = r; });
    let wait = new Promise<void>((r) => { release = r; });
    const { hub } = await setup(async (url, init) => {
      if (JSON.parse(String(init?.body)).grant_type === 'refresh_token') {
        refreshing(); await wait;
      }
      return auth.f(url, init);
    });
    const account = await hub.saveAccount('Shared');
    const other = await hub.saveAccount('Other');
    for (const id of ['personal', 'work', 'removed']) {
      await hub.ensureHouse(id);
      await selectAccount(hub, id, account.id);
    }
    const signIn = async (id: string, code: string) => hub.completeAccountSignIn(hub.beginAccountSignIn(id).signInId, code);
    await signIn(account.id, 'short');
    const token = hub.accessToken('personal');
    const removed = hub.accessToken('removed');
    await entered;
    await hub.signOutAccount(account.id);
    await hub.removeHouse('removed');
    release();
    expect(await token).toBeNull();
    expect(await removed).toBeNull();
    expect(hub.selectedAccounts('work', 'anthropic').map((a) => a.signedIn)).toEqual([false]);
    expect(hub.selectedAccount('work')).toBeNull();

    entered = new Promise<void>((r) => { refreshing = r; });
    wait = new Promise<void>((r) => { release = r; });
    await signIn(account.id, 'short');
    const pending = hub.accessToken('personal');
    const shared = hub.accessToken('work');
    await entered;
    await signIn(account.id, 'good');
    const fresh = await hub.accessToken('work');
    await signIn(other.id, 'job');
    await selectAccount(hub, 'personal', other.id);
    const switched = await hub.accessToken('personal');
    release();
    expect(await pending).toBe(switched);
    expect(await shared).toBe(fresh);
    expect(await hub.accessToken('work')).toBe(fresh);
  });

  it('uses the account whose weekly allowance resets soonest, and moves on when it runs out', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    cleanup.push(async () => vi.useRealTimers());
    const { hub, auth, api, call } = await setup();
    const later = await hub.saveAccount('Later');
    const sooner = await hub.saveAccount('Sooner');
    await hub.configureHouse('personal', { anthropic: [later.id, sooner.id] }, async () => {});
    const key = await hub.ensureHouse('personal');
    await hub.completeAccountSignIn(hub.beginAccountSignIn(later.id).signInId, 'good');
    await hub.completeAccountSignIn(hub.beginAccountSignIn(sooner.id).signInId, 'good');
    const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
    const report = (session: number, weeklyResetHours: number) => ({ five_hour: { utilization: session, resets_at: at(2) }, seven_day: { utilization: 30, resets_at: at(weeklyResetHours) } });
    auth.usage['token-1'] = report(10, 100);
    auth.usage['token-2'] = report(10, 30);
    await hub.refreshLimits();
    expect(hub.selectedAccount('personal')?.id).toBe(sooner.id);
    expect((await call(key)).status).toBe(200);

    // Sooner is refused for limits: the hub reads its limits again and the same request moves to Later.
    api.limited.add('token-2');
    auth.usage['token-2'] = report(97, 30);
    vi.setSystemTime(Date.now() + 10_000);
    const response = await call(key);
    expect(response.status).toBe(200);
    expect(api.seen.map((r) => r.headers.authorization)).toEqual(['Bearer token-2', 'Bearer token-2', 'Bearer token-1']);
    expect(hub.selectedAccount('personal')?.id).toBe(later.id);

    // Once Sooner's 5-hour window resets, it is preferred again.
    vi.setSystemTime(Date.now() + 2 * 3_600_000);
    expect(hub.selectedAccount('personal')?.id).toBe(sooner.id);
  });

  it('routes a profile to its first signed-in account per provider, in the order chosen', async () => {
    const { hub } = await setup();
    const first = await hub.saveAccount('First');
    const second = await hub.saveAccount('Second');
    const gpt = await hub.saveAccount('GPT', undefined, 'openai');
    const signIn = async (id: string) => hub.completeAccountSignIn(hub.beginAccountSignIn(id).signInId, 'good');
    await hub.configureHouse('personal', { anthropic: [first.id, second.id, first.id], openai: [gpt.id] }, async () => {});
    expect(hub.selectedAccounts('personal', 'anthropic').map((a) => a.name)).toEqual(['First', 'Second']);
    expect(await hub.accessToken('personal')).toBeNull();

    await signIn(second.id);
    const secondToken = await hub.accessToken('personal');
    expect(hub.selectedAccount('personal')?.id).toBe(second.id);
    await signIn(first.id);
    const firstToken = await hub.accessToken('personal');
    expect(firstToken).not.toBe(secondToken);
    expect(hub.selectedAccount('personal')?.id).toBe(first.id);

    // Putting an account first switches to it; one provider's order leaves the other's alone.
    await hub.configureHouse('personal', { anthropic: [second.id, first.id] }, async () => {});
    expect(await hub.accessToken('personal')).toBe(secondToken);
    expect(hub.selectedAccounts('personal', 'openai').map((a) => a.id)).toEqual([gpt.id]);
    await hub.signOutAccount(second.id);
    expect(await hub.accessToken('personal')).toBe(firstToken);

    await expect(hub.configureHouse('personal', { anthropic: [gpt.id] }, async () => {})).rejects.toThrow(/anthropic/);
    await expect(hub.deleteAccount(second.id)).rejects.toThrow(/profiles/);
    await hub.configureHouse('personal', { anthropic: [first.id] }, async () => {});
    await hub.deleteAccount(second.id);
  });

});

/** Selects a Claude account for a house, creating the house if needed. */
function selectAccount(hub: SortingHat, houseId: string, accountId: string) {
  return hub.configureHouse(houseId, { anthropic: [accountId] }, async () => {});
}

async function beginForHouse(hub: SortingHat, houseId: string) {
  const account = await hub.saveAccount(`${houseId} Claude`);
  await selectAccount(hub, houseId, account.id);
  return hub.beginAccountSignIn(account.id);
}
