import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeCodex, testJWT } from '../testing/fakeCodex.js';
import { startTestApp, type TestClient } from '../testing/testApp.js';

describe('Codex and ChatGPT accounts', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(() => t?.stop());
  const codex = { harnessId: 'codex', modelId: 'test-codex' };

  async function signIn(client: TestClient, fake: FakeCodex, name = 'Personal') {
    const account = await client.call('accounts.save', { name: `${name} ChatGPT`, providerId: 'openai' });
    const login = await client.call('accounts.beginSignIn', { id: account.id });
    expect(new URL(login.url).pathname).toBe('/oauth/authorize');
    expect(new URL(login.url).searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback');
    expect(await client.call('accounts.signInStatus', { signInId: login.signInId })).toEqual({ status: 'pending' });
    await fake.latest.complete(name);
    expect(await client.call('accounts.signInStatus', { signInId: login.signInId })).toMatchObject({ status: 'complete', account: { providerId: 'openai', signedIn: true } });
    const profile = await client.call('profiles.save', { createHouse: true, name, accountIds: { openai: [account.id] } });
    return { profile, account, login };
  }

  it('generates a title through the profile proxy with an independently selected model', async () => {
    const fake = new FakeCodex();
    const requests: { headers: Headers; body: any }[] = [];
    t = await startTestApp({ codexFactory: fake.factory, openaiFetch: async (_url, init) => {
      requests.push({ headers: new Headers(init?.headers), body: JSON.parse(new TextDecoder().decode(init?.body as Uint8Array)) });
      return new Response('data: ' + JSON.stringify({ type: 'response.completed', response: { output: [{ content: [{ type: 'output_text', text: '{"title":"Fix login redirects"}' }] }] } }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
    } });
    const c = await t.connect();
    const { profile } = await signIn(c, fake);
    await c.call('threadNaming.save', { automatic: true, model: { harnessId: 'codex', modelId: 'test-fast', effort: 'low' }, instructions: '' });
    const thread = await c.call('threads.start', { profileId: profile.id, model: codex, text: 'Fix the login redirects' });
    await c.waitFor('threads.changed', list => list.some(item => item.id === thread.id && item.title === 'Fix login redirects'));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get('chatgpt-account-id')).toBe('Personal');
    expect(requests[0]!.body).toMatchObject({ model: 'test-fast', tools: [], reasoning: { effort: 'low' }, store: false });
    expect((await c.call('threads.list', {}))[0]!.model).toEqual(codex);
    expect((await c.call('threads.transcript', { threadId: thread.id })).filter(item => item.kind === 'user')).toHaveLength(1);
  });

  it('signs in, streams text and tools, and resumes the same Codex session after restart', async () => {
    const fake = new FakeCodex();
    t = await startTestApp({ codexFactory: fake.factory });
    let c = await t.connect();
    const { profile, account } = await signIn(c, fake);
    const available = await c.call('models.list', { profileId: profile.id });
    // The account's models, with no separate "Codex default" entry; the account default is flagged instead.
    expect(available.models.map((m) => [m.harnessId, m.id, m.isDefault])).toEqual([['codex', 'test-codex', true], ['codex', 'test-fast', false]]);
    await c.call('models.favorite', { profileId: profile.id, model: codex, favorite: true });
    // 'default' is no longer listed but still resolves to the account default, as clients and stored threads may send it.
    const viaAlias = await c.call('threads.start', { profileId: profile.id, model: { harnessId: 'codex', modelId: 'default' }, text: 'hello' });
    expect(viaAlias.model).toEqual(codex);
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === viaAlias.id && x.status === 'idle'));
    // A Codex-only profile chooses the account's default Codex model when the caller omits a model.
    const thread = await c.call('threads.start', { profileId: profile.id, text: 'hello' });
    expect(thread.model).toEqual(codex);
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'idle'));
    const transcript = await c.call('threads.transcript', { threadId: thread.id });
    expect(transcript.filter((i) => i.kind === 'assistant')).toHaveLength(1);
    expect(transcript).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'assistant', text: 'Hello world.' }),
      expect.objectContaining({ kind: 'tool', name: 'Shell', status: 'done', output: 'clean' }),
    ]));
    expect(c.events.some((e) => e.event === 'thread.delta')).toBe(true);
    const runner = fake.latest;
    expect(runner.options.home).toBe(join(t.home, 'profiles', profile.id, 'codex'));
    expect(runner.options.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
    expect(runner.options.env?.ACCIO_OPENAI_KEY).toMatch(/^hat-/);
    expect(runner.requests.find((r) => r.method === 'thread/start')?.params).toMatchObject({ approvalPolicy: 'never', sandbox: 'danger-full-access', model: 'test-codex', developerInstructions: expect.stringContaining('# Inline media') });
    expect(runner.closed).toBe(true);
    const exposed = JSON.stringify([await c.call('accounts.list', {}), await c.call('profiles.list', {}), transcript, available]);
    expect(exposed).not.toMatch(/refresh-Personal|private-id-token|access_token|accessKey/);
    await expect(c.call('accounts.delete', { id: account.id })).rejects.toThrow(/profiles/);
    await t.stop({ keepHome: true });
    t = await startTestApp({ codexFactory: fake.factory }, t.home);
    c = await t.connect();
    await c.call('threads.send', { threadId: thread.id, text: 'continue' });
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'idle'));
    expect(fake.latest.requests.find((r) => r.method === 'thread/resume')?.params.threadId).toBe('codex-session');
    expect((await c.call('models.list', { profileId: profile.id })).favorites).toEqual([codex]);
    await c.call('accounts.signOut', { id: account.id });
    await expect(c.call('threads.send', { threadId: thread.id, text: 'signed out' })).rejects.toThrow(/ChatGPT/);
    expect((await c.call('models.list', { profileId: profile.id })).models).toEqual([]);
  });

  it('runs the chosen effort, sends the model default otherwise, and refuses an effort the model does not accept', async () => {
    const fake = new FakeCodex();
    t = await startTestApp({ codexFactory: fake.factory });
    const c = await t.connect();
    const { profile } = await signIn(c, fake);
    const listed = (await c.call('models.list', { profileId: profile.id })).models.find((m) => m.id === 'test-codex');
    expect(listed).toMatchObject({ defaultEffort: 'medium', efforts: [{ id: 'low', description: 'Fast' }, { id: 'medium', description: 'Balanced' }, { id: 'high', description: 'Deep' }] });
    const thread = await c.call('threads.start', { profileId: profile.id, model: { ...codex, effort: 'high' }, text: 'hello' });
    expect(thread.model).toEqual({ ...codex, effort: 'high' });
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'idle'));
    expect(fake.latest.requests.find((r) => r.method === 'turn/start')?.params).toMatchObject({ model: 'test-codex', effort: 'high' });
    await expect(c.call('threads.setModel', { threadId: thread.id, model: { harnessId: 'codex', modelId: 'test-fast', effort: 'high' } })).rejects.toThrow(/does not accept high/);
    // Codex keeps a turn's effort for later turns, so going back to the default sends it explicitly.
    await c.call('threads.setModel', { threadId: thread.id, model: codex });
    await c.call('threads.send', { threadId: thread.id, text: 'again' });
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'idle' && x.model.effort === undefined));
    await expect.poll(() => fake.latest.requests.find((r) => r.method === 'turn/start')?.params.effort).toBe('medium');
  });

  it('reads the effort levels of accounts signed in before accio kept them', async () => {
    const fake = new FakeCodex();
    t = await startTestApp({ codexFactory: fake.factory });
    const c = await t.connect();
    const { profile } = await signIn(c, fake);
    await t.stop({ keepHome: true });
    const file = join(t.home, 'test-sorting-hat', 'sorting-hat.json');
    const stored = JSON.parse(await readFile(file, 'utf8'));
    for (const account of stored.accounts) for (const model of account.openai?.models ?? []) { delete model.efforts; delete model.defaultEffort; }
    await writeFile(file, JSON.stringify(stored));
    t = await startTestApp({ codexFactory: fake.factory }, t.home);
    const next = await t.connect();
    await expect.poll(async () => (await next.call('models.list', { profileId: profile.id })).models[0]?.efforts.map((e) => e.id)).toEqual(['low', 'medium', 'high']);
  });

  it('automatically resumes an interrupted Codex session after desktop shutdown', async () => {
    const fake = new FakeCodex();
    t = await startTestApp({ codexFactory: fake.factory });
    const c = await t.connect();
    const { profile } = await signIn(c, fake);
    fake.holdTurns = true;
    const thread = await c.call('threads.start', { profileId: profile.id, text: 'work' });
    await expect.poll(() => fake.latest.requests.some(r => r.method === 'turn/start')).toBe(true);
    await t.stop({ keepHome: true });
    fake.holdTurns = false;
    const previous = fake.clients.length;
    t = await startTestApp({ codexFactory: fake.factory }, t.home);
    await expect.poll(() => fake.clients.slice(previous).some(client => client.requests.some(r => r.method === 'thread/resume'))).toBe(true);
    const next = await t.connect();
    await expect.poll(async () => (await next.call('threads.list', {})).find(x => x.id === thread.id)?.status).toBe('idle');
    const runner = fake.clients.slice(previous).find(client => client.requests.some(r => r.method === 'thread/resume'))!;
    expect(runner.requests.find(r => r.method === 'thread/resume')?.params.threadId).toBe('codex-session');
    expect(runner.requests.filter(r => r.method === 'turn/start')).toHaveLength(1);
  });

  it('keeps Claude and ChatGPT selections independent and rejects accounts from the wrong provider', async () => {
    const fake = new FakeCodex(); t = await startTestApp({ codexFactory: fake.factory });
    const c = await t.connect();
    const claude = await c.signedIn('Personal');
    const { profile, account } = await signIn(c, fake, 'Other');
    await c.call('profiles.save', { id: claude.id, name: claude.name, accountIds: { openai: [account.id] } });
    const [selected] = (await c.call('profiles.list', {})).filter((p) => p.id === claude.id);
    expect(selected?.providers.flatMap((p) => p.accounts).map((a) => a.providerId)).toEqual(['anthropic', 'openai']);
    await expect(c.call('profiles.save', { id: profile.id, name: profile.name, accountIds: { anthropic: [account.id] } })).rejects.toThrow(/anthropic/);
    await expect(c.call('accounts.completeSignIn', { signInId: 'not-claude', code: 'code' })).rejects.toThrow(/expired/);
    expect((await c.call('profiles.list', {})).find((p) => p.id === profile.id)?.providers[0]?.accounts).toEqual([]);
  });

  it('cancels logins and refuses late completion after sign-out or deletion', async () => {
    const fake = new FakeCodex(); t = await startTestApp({ codexFactory: fake.factory }); const c = await t.connect();
    const account = await c.call('accounts.save', { name: 'Work', providerId: 'openai' });
    const first = await c.call('accounts.beginSignIn', { id: account.id });
    const pending = fake.latest;
    await c.call('accounts.cancelSignIn', { signInId: first.signInId });
    expect(pending.closed).toBe(true);
    await expect(c.call('accounts.signInStatus', { signInId: first.signInId })).rejects.toThrow(/cancelled/);
    const second = await c.call('accounts.beginSignIn', { id: account.id });
    await fake.latest.complete();
    await c.call('accounts.signOut', { id: account.id });
    await expect(c.call('accounts.signInStatus', { signInId: second.signInId })).rejects.toThrow(/cancelled/);
    expect((await c.call('accounts.list', {}))[0]?.signedIn).toBe(false);
    await c.call('accounts.delete', { id: account.id });
    expect(await c.call('accounts.list', {})).toEqual([]);
  });

  it('interrupts a Codex turn and resumes the same session', async () => {
    const fake = new FakeCodex(); t = await startTestApp({ codexFactory: fake.factory }); const c = await t.connect();
    const { profile } = await signIn(c, fake); fake.holdTurns = true;
    const thread = await c.call('threads.start', { profileId: profile.id, text: 'wait' });
    await c.waitFor('thread.item', (e) => e.threadId === thread.id && e.item.kind === 'user');
    // Wait for turn/start through the adapter, then interrupt through the public API.
    await expect.poll(() => fake.latest.requests.some((r) => r.method === 'turn/start')).toBe(true);
    await c.call('threads.stop', { threadId: thread.id });
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'interrupted'));
    expect(fake.latest.requests.some((r) => r.method === 'turn/interrupt')).toBe(true);
    fake.holdTurns = false; c.events.length = 0;
    await c.call('threads.resume', { threadId: thread.id });
    await c.waitFor('threads.changed', (ts) => ts.some((x) => x.id === thread.id && x.status === 'idle'));
    expect(fake.latest.requests.find((r) => r.method === 'thread/resume')?.params.threadId).toBe('codex-session');
  });

  it('proxies only the selected OpenAI account, replaces forged headers, and retries an expired token once', async () => {
    const fake = new FakeCodex(); const calls: { url: string; headers: Headers }[] = [];
    t = await startTestApp({ codexFactory: fake.factory, openaiFetch: async (url, init) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) });
      return calls.length === 1 ? new Response('', { status: 401 }) : new Response('data: ok\n\n', { headers: { 'content-type': 'text/event-stream' } });
    } });
    const c = await t.connect(); const { profile } = await signIn(c, fake, 'Work');
    const { key, url } = await t.app.profiles.client.call('machine.modelKey', { profileId: profile.id });
    const response = await fetch(`${url}/openai/responses`, { method: 'POST', headers: {
      authorization: `Bearer ${key}`, 'chatgpt-account-id': 'forged', 'openai-organization': 'forged-org', cookie: 'secret-cookie',
      'cf-connecting-ip': '203.0.113.1', 'cf-ray': 'edge-ray', 'cf-visitor': '{"scheme":"https"}',
      'x-forwarded-for': '203.0.113.1', forwarded: 'for=203.0.113.1', 'cdn-loop': 'cloudflare',
    }, body: '{}' });
    expect(await response.text()).toBe('data: ok\n\n');
    expect(calls.map((x) => x.url)).toEqual(['https://chatgpt.com/backend-api/codex/responses', 'https://chatgpt.com/backend-api/codex/responses']);
    // Compare the token's subject only: its expiry comes from the clock and can tick between sign-in and here.
    const subject = (header?: string | null) => JSON.parse(Buffer.from(header?.replace(/^Bearer /, '').split('.')[1] ?? '', 'base64url').toString()).sub;
    expect(calls.map((x) => subject(x.headers.get('authorization')))).toEqual(['Work', 'Work-refreshed']);
    for (const call of calls) {
      expect(call.headers.get('chatgpt-account-id')).toBe('Work');
      expect(call.headers.has('openai-organization')).toBe(false); expect(call.headers.has('cookie')).toBe(false);
      for (const header of ['cf-connecting-ip', 'cf-ray', 'cf-visitor', 'x-forwarded-for', 'forwarded', 'cdn-loop']) expect(call.headers.has(header)).toBe(false);
    }
    expect((await fetch(`${url}/openai/responses`, { method: 'POST', headers: { authorization: 'Bearer invalid' } })).status).toBe(401);
    const other = await c.call('profiles.save', { name: 'No login', createHouse: true });
    const { key: otherKey } = await t.app.profiles.client.call('machine.modelKey', { profileId: other.id });
    expect((await fetch(`${url}/openai/responses`, { method: 'POST', headers: { authorization: `Bearer ${otherKey}` } })).status).toBe(401);
    expect((await fetch(`${url}/openai/https://evil.test`, { method: 'POST', headers: { authorization: `Bearer ${key}` } })).status).toBe(404);
    expect(calls).toHaveLength(2);
  });

  it('shares concurrent refreshes for one account and does not expose its tokens in profile config', async () => {
    const forwarded: string[] = [];
    const fake = new FakeCodex(); t = await startTestApp({ codexFactory: fake.factory, openaiFetch: async (_url, init) => {
      forwarded.push(new Headers(init?.headers).get('authorization') ?? ''); return Response.json({});
    } }); const c = await t.connect();
    const { profile } = await signIn(c, fake);
    const loginClient = fake.clients[0]!;
    const authFile = join(loginClient.options.home, 'auth.json');
    const auth = JSON.parse(await readFile(authFile, 'utf8')); auth.tokens.access_token = testJWT('expired', true);
    await writeFile(authFile, JSON.stringify(auth));
    const { key, url } = await t.app.profiles.client.call('machine.modelKey', { profileId: profile.id });
    await Promise.all(Array.from({ length: 8 }, async () => (await fetch(`${url}/openai/responses`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: '{}' })).text()));
    expect(forwarded).toHaveLength(8);
    expect(forwarded.every((x) => x === forwarded[0] && x !== `Bearer ${auth.tokens.access_token}`)).toBe(true);
    expect(fake.clients.flatMap((x) => x.requests).filter((r) => r.method === 'account/read' && r.params.refreshToken)).toHaveLength(1);
    const config = await readFile(join(t.home, 'profiles', profile.id, 'claude', 'settings.json'), 'utf8');
    expect(config).not.toContain('refresh-Personal'); expect(config).not.toContain('private-id-token');
  });
});
