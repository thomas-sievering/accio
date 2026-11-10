import { afterEach, describe, expect, it } from 'vitest';
import { FakeCodex } from '../testing/fakeCodex.js';
import { fakeClaudeFetch, startTestApp } from '../testing/testApp.js';

describe('account limits RPC and hub ownership', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(async () => { await t?.stop(); });
  const usage = { five_hour: { utilization: 48, resets_at: '2027-01-01T12:00:00Z' }, seven_day: { utilization: 100, resets_at: '2027-01-07T12:00:00Z' } };

  it('publishes one credential-free account snapshot shared across profiles and clients', async () => {
    const upstream: { authorization: string | null; beta: string | null }[] = [];
    t = await startTestApp({ claudeFetch: async (url, init) => {
      if (!String(url).endsWith('/api/oauth/usage')) return fakeClaudeFetch(url, init);
      const headers = new Headers(init?.headers);
      upstream.push({ authorization: headers.get('authorization'), beta: headers.get('anthropic-beta') });
      return Response.json(usage);
    } });
    const a = await t.connect(), b = await t.connect();
    const personal = await a.signedIn('Personal');
    const account = personal.providers[0]!.accounts[0]!;
    await a.call('profiles.save', { createHouse: true, name: 'Work', accountIds: { anthropic: [account.id] } });
    const out = await a.call('accounts.save', { name: 'Signed out' });
    expect((await a.call('accounts.limits', {})).find((v) => v.accountId === out.id)?.status).toBe('signedOut');
    const [first, second] = await Promise.all([
      a.call('accounts.refreshLimits', { accountIds: [account.id, account.id] }), b.call('accounts.refreshLimits', { accountIds: [account.id] }),
    ]);
    expect(upstream).toEqual([{ authorization: 'Bearer oauth-claude-personal', beta: 'oauth-2025-04-20' }]);
    expect(first).toEqual(second);
    expect(first.find((v) => v.accountId === account.id)).toMatchObject({ status: 'ready', snapshot: { windows: [
      { id: 'five_hour', usedPercent: 48 }, { id: 'seven_day', usedPercent: 100 },
    ] } });
    const pushed = await b.waitFor('accounts.limitsChanged', (views) => views.some((v) => v.accountId === account.id && v.status === 'ready'));
    expect(JSON.stringify(pushed)).not.toMatch(/oauth-|refresh-|accessToken|credentialId|accio-/);
    await a.call('profiles.save', { id: personal.id, name: personal.name, accountIds: { anthropic: [] } });
    expect((await a.call('accounts.limits', {})).find((v) => v.accountId === account.id)?.snapshot).toEqual(first.find((v) => v.accountId === account.id)?.snapshot);
    await a.call('accounts.signOut', { id: account.id });
    expect((await b.call('accounts.limits', {})).find((v) => v.accountId === account.id)).toMatchObject({ status: 'signedOut', snapshot: null });
    await expect(a.call('accounts.refreshLimits', { accountIds: ['missing'] })).rejects.toThrow(/No account/);
    await expect(a.call('accounts.refreshLimits', { accountIds: new Array(101).fill(account.id) })).rejects.toThrow(/Invalid params/);
  });

  it('refreshes an unselected account on the hub, retries a rejected token once, and clears data on reauthentication/deletion', async () => {
    let calls = 0;
    const tokens: string[] = [];
    t = await startTestApp({ claudeFetch: async (url, init) => {
      if (!String(url).endsWith('/api/oauth/usage')) return fakeClaudeFetch(url, init);
      tokens.push(new Headers(init?.headers).get('authorization')!);
      calls++;
      return calls === 1 ? new Response('private provider error', { status: 401 }) : Response.json(usage);
    } });
    const c = await t.connect();
    const account = await c.call('accounts.save', { name: 'Unused Claude' });
    let start = await c.call('accounts.beginSignIn', { id: account.id });
    await c.call('accounts.completeSignIn', { signInId: start.signInId, code: 'first' });
    const result = await c.call('accounts.refreshLimits', { accountIds: [account.id] });
    expect(tokens).toEqual(['Bearer oauth-first', 'Bearer oauth-refreshed']);
    expect(result[0]?.status).toBe('ready');
    expect(await c.call('profiles.list', {})).toEqual([]);
    start = await c.call('accounts.beginSignIn', { id: account.id });
    await c.call('accounts.completeSignIn', { signInId: start.signInId, code: 'different-identity' });
    expect((await c.call('accounts.limits', {}))[0]).toMatchObject({ status: 'idle', snapshot: null });
    await c.call('accounts.refreshLimits', { accountIds: [account.id] });
    expect(tokens.at(-1)).toBe('Bearer oauth-different-identity');
    await c.call('accounts.delete', { id: account.id });
    expect(await c.call('accounts.limits', {})).toEqual([]);
  });

  it('never lets a late old-identity response republish after sign-in changes', async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((r) => { entered = r; });
    const held = new Promise<void>((r) => { release = r; });
    let count = 0;
    t = await startTestApp({ claudeFetch: async (url, init) => {
      if (!String(url).endsWith('/api/oauth/usage')) return fakeClaudeFetch(url, init);
      if (++count === 1) { entered(); await held; return Response.json(usage); }
      return Response.json({ five_hour: { utilization: 7, resets_at: null } });
    } });
    const c = await t.connect(), other = await t.connect();
    const p = await c.signedIn('Personal');
    const id = p.providers[0]!.accounts[0]!.id;
    const reading = c.call('accounts.refreshLimits', { accountIds: [id] });
    await started;
    try {
      const start = await other.call('accounts.beginSignIn', { id });
      await other.call('accounts.completeSignIn', { signInId: start.signInId, code: 'new-identity' });
      await other.call('accounts.refreshLimits', { accountIds: [id] });
    } finally { release(); }
    await reading;
    expect((await c.call('accounts.limits', {}))[0]?.snapshot?.windows[0]?.usedPercent).toBe(7);
  });

  it('keeps HTTP error bodies private and reports explicit sign-in and retry states', async () => {
    t = await startTestApp({ claudeFetch: async (url, init) => String(url).endsWith('/api/oauth/usage')
      ? new Response('secret upstream diagnostic', { status: 429, headers: { 'retry-after': '120' } }) : fakeClaudeFetch(url, init) });
    const c = await t.connect();
    const p = await c.signedIn('Personal');
    const result = await c.call('accounts.refreshLimits', {});
    expect(result[0]).toMatchObject({ status: 'error', snapshot: null, problem: { code: 'rateLimited' } });
    expect(Date.parse(result[0]!.retryAt!) - Date.now()).toBeGreaterThan(115_000);
    expect(JSON.stringify(result)).not.toContain('secret');
    await c.call('accounts.signOut', { id: p.providers[0]!.accounts[0]!.id });
  });

  it('queries ChatGPT limits only in its Sorting Hat credential home and never starts a turn', async () => {
    const codex = new FakeCodex();
    codex.rateLimitsResponse = { rateLimits: { limitId: 'codex', primary: { usedPercent: 39, windowDurationMins: 300 }, secondary: { usedPercent: 19, windowDurationMins: 10080 } } };
    t = await startTestApp({ codexFactory: codex.factory });
    const c = await t.connect();
    const account = await c.call('accounts.save', { name: 'Shared ChatGPT', providerId: 'openai' });
    const start = await c.call('accounts.beginSignIn', { id: account.id });
    await codex.latest.complete();
    await c.call('accounts.signInStatus', { signInId: start.signInId });
    const before = codex.clients.length;
    const result = await c.call('accounts.refreshLimits', { accountIds: [account.id] });
    expect(result[0]).toMatchObject({ providerId: 'openai', status: 'ready', snapshot: { windows: [{ usedPercent: 39 }, { usedPercent: 19 }] } });
    expect(codex.clients).toHaveLength(before + 1);
    const reader = codex.latest;
    expect(reader.options.home).toContain('test-sorting-hat');
    expect(reader.options.home).not.toContain('profiles');
    expect(reader.requests.map((r) => r.method)).toEqual(['account/read', 'account/rateLimits/read']);
    expect(reader.closed).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/access_token|refresh_token|credentialId|private-id-token/);
    await c.call('accounts.signOut', { id: account.id });
    expect((await c.call('accounts.limits', {}))[0]).toMatchObject({ status: 'signedOut', snapshot: null });
  });

  it('sanitizes native app-server failures and closes its client', async () => {
    const codex = new FakeCodex();
    codex.rateLimitsError = new Error('private native diagnostic');
    t = await startTestApp({ codexFactory: codex.factory });
    const c = await t.connect();
    const account = await c.call('accounts.save', { name: 'ChatGPT', providerId: 'openai' });
    const start = await c.call('accounts.beginSignIn', { id: account.id });
    await codex.latest.complete();
    await c.call('accounts.signInStatus', { signInId: start.signInId });
    const result = await c.call('accounts.refreshLimits', {});
    expect(result[0]).toMatchObject({ status: 'error', problem: { code: 'unavailable' } });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(codex.latest.closed).toBe(true);
  });
});
