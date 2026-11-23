import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { noSortingHatMessage } from '@accio/protocol';
import { startHubService } from './service.js';
import { CLIENT_TTL_MS, HubTrust } from './trust.js';
import { HubClient } from './client.js';
import { remoteSecrets } from './secretClient.js';
import { remoteResources } from './resourceClient.js';

describe('standalone hub trust and network boundary', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => { vi.restoreAllMocks(); for (const stop of cleanup.splice(0).reverse()) await stop(); });
  async function fixture() {
    const home = await mkdtemp(join(tmpdir(), 'accio-hub-service-'));
    cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    const mcpForwarded: string[] = [];
    const service = await startHubService({ home, port: 0, secretKey: Buffer.alloc(32, 42).toString('base64'), mcpFetch: async (_url, init) => { mcpForwarded.push(new Headers(init?.headers).get('authorization') ?? ''); return Response.json({ result: 'ok' }); } });
    cleanup.push(() => service.close());
    async function pair(id: string) {
      const { code } = await service.createPairingCode();
      const response = await fetch(service.url + '/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machineId: id, code }) });
      expect(response.status).toBe(200);
      const p = await response.json() as any;
      const client = new HubClient(service.url, p.hubId, p.token, { id, name: id, platform: 'test', version: 'test', harnesses: [] });
      await client.start(); cleanup.push(() => client.close());
      return { client, token: p.token as string, code };
    }
    function form(path: string, params: Record<string, string>, headers: Record<string, string> = {}) {
      return fetch(service.url + path, { method: 'POST', redirect: 'manual', headers: { origin: service.url, 'user-agent': 'iPhone Version/18.0 Safari/604.1', ...headers }, body: new URLSearchParams(params) });
    }
    return { home, service, mcpForwarded, pair, form };
  }
  it('pairs a browser separately, with a one-use code and an opaque secure cookie', async () => {
    const { home, service, pair, form } = await fixture();
    const page = (cookie?: string) => fetch(service.url, { headers: cookie ? { cookie } : {} });
    expect(await (await page()).text()).toContain('Pair this browser');
    const { client } = await pair('desktop');
    const { code: machineCode } = await service.createPairingCode();
    const { code } = await client.call('clients.createPairingCode');
    expect((await form('/client/pair', { code: machineCode })).status).toBe(400);
    expect((await fetch(service.url + '/pair', { method: 'POST', body: JSON.stringify({ machineId: 'other', code }) })).status).toBe(400);
    expect((await form('/client/pair', { code }, { origin: 'https://other.example' })).status).toBe(403);
    const response = await form('/client/pair', { code });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    const header = response.headers.get('set-cookie')!;
    expect(header).toMatch(/^__Host-accio-client=[\w-]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000$/);
    const cookie = header.split(';')[0]!;
    const signedIn = await (await page(cookie)).text();
    expect(signedIn).toContain("You're paired with Accio");
    expect(signedIn).toContain('iPhone Safari');
    expect(signedIn).not.toContain('Pair this browser');
    expect(signedIn).not.toContain(cookie);
    expect(service.snapshot().clients).toEqual([{ id: expect.any(String), name: 'iPhone Safari' }]);
    expect(service.snapshot().machines.map((machine) => machine.id)).toEqual(['desktop']);
    const stored = await readFile(join(home, 'hub', 'trust.json'), 'utf8');
    expect(JSON.parse(stored)).toMatchObject({ devices: [{ kind: 'machine', id: 'desktop' }], clients: [{ kind: 'client', name: 'iPhone Safari' }] });
    expect(stored).not.toContain(cookie.slice(cookie.indexOf('=') + 1));
    expect((await form('/client/pair', { code })).status).toBe(400);
  });
  it('expires browser codes after ten minutes and shares the machine pairing rate limit', async () => {
    const { service, pair, form } = await fixture();
    const { client } = await pair('desktop');
    const { code, expiresAt } = await client.call('clients.createPairingCode');
    vi.spyOn(Date, 'now').mockReturnValue(expiresAt);
    const expired = await form('/client/pair', { code });
    expect(expired.status).toBe(400);
    expect(await expired.text()).toContain('invalid or expired');
    for (let attempt = 1; attempt < 10; attempt++) expect((await form('/client/pair', { code: 'wrong' })).status).toBe(400);
    expect((await fetch(service.url + '/pair', { method: 'POST', body: '{}' })).status).toBe(429);
    expect((await form('/client/pair', { code })).status).toBe(429);
  });
  it('extends a used browser credential but requires pairing after 30 days of inactivity', async () => {
    const { service, pair, form } = await fixture();
    const { client } = await pair('desktop');
    const initial = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(initial);
    const { code } = await client.call('clients.createPairingCode');
    const cookie = (await form('/client/pair', { code })).headers.get('set-cookie')!.split(';')[0]!;
    const page = () => fetch(service.url, { headers: { cookie } });
    clock.mockReturnValue(initial + CLIENT_TTL_MS - 60_000);
    const renewed = await page();
    expect(await renewed.text()).toContain("You're paired with Accio");
    expect(renewed.headers.get('set-cookie')).toContain('Max-Age=2592000');
    clock.mockReturnValue(initial + CLIENT_TTL_MS);
    expect(await (await page()).text()).toContain("You're paired with Accio");
    clock.mockReturnValue(initial + 2 * CLIENT_TTL_MS - 60_000);
    const ws = new WebSocket(service.url.replace('http:', 'ws:') + '/client/events', { headers: { origin: service.url, cookie } });
    cleanup.push(async () => ws.terminate());
    const [[upgrade]] = await Promise.all([once(ws, 'upgrade'), once(ws, 'open')]);
    expect(upgrade.headers['set-cookie']).toEqual([expect.stringContaining('Max-Age=2592000')]);
    clock.mockReturnValue(initial + 2 * CLIENT_TTL_MS);
    expect(await (await page()).text()).toContain("You're paired with Accio");
    clock.mockReturnValue(initial + 3 * CLIENT_TTL_MS);
    const expired = await page();
    expect(await expired.text()).toContain('Pair this browser');
    expect(expired.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(service.snapshot().clients).toEqual([]);
  });
  it('refuses browser credentials on machine routes and closes sockets when either kind of client unpairs a browser', async () => {
    const { service, pair, form } = await fixture();
    const { client } = await pair('desktop');
    async function browser() {
      const { code } = await client.call('clients.createPairingCode');
      const before = new Set(service.snapshot().clients!.map(({ id }) => id));
      const cookie = (await form('/client/pair', { code })).headers.get('set-cookie')!.split(';')[0]!;
      const id = service.snapshot().clients!.find((item) => !before.has(item.id))!.id;
      return { cookie, id, authorization: `Bearer ${cookie.slice(cookie.indexOf('=') + 1)}` };
    }
    const first = await browser();
    const second = await browser();
    function socket(path: string, headers: Record<string, string>) {
      const ws = new WebSocket(service.url.replace('http:', 'ws:') + path, { headers: { origin: service.url, ...headers } });
      cleanup.push(async () => ws.terminate());
      return ws;
    }
    for (const headers of [{ cookie: first.cookie }, { authorization: first.authorization }]) {
      const denial = await fetch(service.url + '/rpc', { method: 'POST', headers, body: JSON.stringify({ method: 'profiles.save', params: { name: 'Forbidden' } }) });
      expect(denial.status).toBe(401);
      expect((await fetch(service.url + '/state', { headers })).status).toBe(401);
      await expect(once(socket('/relay', headers), 'open')).rejects.toThrow('Unexpected server response: 401');
    }
    expect(service.snapshot().profiles).toEqual([]);
    const firstSocket = socket('/client/events', { cookie: first.cookie });
    const firstRelay = socket('/client/relay', { cookie: first.cookie });
    const secondSocket = socket('/client/events', { cookie: second.cookie });
    await Promise.all([once(firstSocket, 'open'), once(firstRelay, 'open'), once(secondSocket, 'open')]);
    await expect(once(socket('/client/relay', { origin: 'https://other.example', cookie: first.cookie }), 'open')).rejects.toThrow('Unexpected server response: 401');
    await expect(once(socket('/client/relay', { authorization: first.authorization }), 'open')).rejects.toThrow('Unexpected server response: 401');
    expect((await fetch(service.url + '/client/state')).status).toBe(401);
    const state = await (await fetch(service.url + '/client/state', { headers: { cookie: first.cookie } })).json();
    expect(state.clientId).toBe(first.id);
    expect(state).toMatchObject({ profiles: [], projects: [], spaces: [], machines: [expect.objectContaining({ id: 'desktop' })] });
    expect(state).not.toHaveProperty('secrets');
    const firstClosed = once(firstSocket, 'close');
    const relayClosed = once(firstRelay, 'close');
    expect((await form('/client/unpair', { id: first.id }, { cookie: second.cookie, origin: 'https://other.example' })).status).toBe(403);
    expect((await form('/client/unpair', { id: first.id }, { cookie: second.cookie })).status).toBe(303);
    expect((await firstClosed)[0]).toBe(4001);
    expect((await relayClosed)[0]).toBe(4001);
    expect(secondSocket.readyState).toBe(WebSocket.OPEN);
    expect(await (await fetch(service.url, { headers: { cookie: first.cookie } })).text()).toContain('Pair this browser');
    await expect(once(socket('/client/events', { cookie: first.cookie }), 'open')).rejects.toThrow('Unexpected server response: 401');
    const secondClosed = once(secondSocket, 'close');
    await client.call('clients.unpair', { clientId: second.id });
    expect((await secondClosed)[0]).toBe(4001);
    expect(service.snapshot().clients).toEqual([]);
  });
  it('bootstraps a first device with a one-time code and stores only its credential hash', async () => {
    const { home, service, pair } = await fixture();
    expect((await fetch(service.url + '/state')).status).toBe(401);
    const { client, token, code } = await pair('first');
    expect(client.snapshot.hubId).toBe(service.trust.id);
    const again = await fetch(service.url + '/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machineId: 'second', code }) });
    expect(again.status).toBe(400);
    const stored = await readFile(join(home, 'hub', 'trust.json'), 'utf8');
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(code);
    expect(JSON.stringify(client.snapshot)).not.toContain(token);
  });
  it('limits pairing per forwarded client address only when the hub trusts that header', async () => {
    async function statuses(clientAddressHeader: string | undefined, client: string) {
      const home = await mkdtemp(join(tmpdir(), 'accio-hub-pairing-'));
      cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
      const service = await startHubService({ home, port: 0, clientAddressHeader });
      cleanup.push(() => service.close());
      const attempt = (from: string) => fetch(service.url + '/pair', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': from }, body: JSON.stringify({ machineId: 'm', code: 'WRONG' }) }).then((r) => r.status);
      for (let i = 0; i < 10; i++) expect(await attempt('203.0.113.1')).toBe(400);
      return [await attempt('203.0.113.1'), await attempt(client)];
    }
    expect(await statuses('CF-Connecting-IP', '203.0.113.2')).toEqual([429, 400]);
    expect(await statuses(undefined, '203.0.113.2')).toEqual([429, 429]);
  });
  it('rejects expired pairing codes and a changed hub identity', async () => {
    const { home, service, pair } = await fixture();
    const { code } = await service.createPairingCode();
    const file = join(home, 'hub', 'pairing.json'); const p = JSON.parse(await readFile(file, 'utf8')); p.expiresAt = 0; await writeFile(file, JSON.stringify(p));
    expect((await fetch(service.url + '/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machineId: 'late', code }) })).status).toBe(400);
    const { token } = await pair('first');
    const wrong = new HubClient(service.url, 'different', token, { id: 'first', name: 'first', platform: 'test', version: 'test', harnesses: [] });
    cleanup.push(() => wrong.close()); await wrong.start(); expect(wrong.status).toBe('offline'); expect(wrong.snapshot).toBeUndefined();
  });
  it('has no accounts and no model routes without a Sorting Hat', async () => {
    const { service, pair } = await fixture();
    const { client } = await pair('first');
    const profile = await client.call('profiles.save', { name: 'Personal' });
    expect(profile).toMatchObject({ house: null, providers: [{ accountIds: [], inUseId: null }, { accountIds: [], inUseId: null }] });
    expect(client.snapshot).toMatchObject({ accounts: [], limits: [], models: { [profile.id]: [] } });
    expect(client.snapshot.sortingHat).toBeUndefined();
    await expect(client.call('accounts.save', { name: 'Claude' })).rejects.toThrow(noSortingHatMessage);
    await expect(client.call('machine.modelKey', { profileId: profile.id })).rejects.toThrow(noSortingHatMessage);
    for (const path of ['/v1/messages', '/openai/responses']) expect((await fetch(service.url + path, { method: 'POST', body: '{}' })).status).toBe(404);
  });
  it('drops the model keys hubs kept before the Sorting Hat when it loads', async () => {
    const home = await mkdtemp(join(tmpdir(), 'accio-hub-trust-'));
    cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    await mkdir(join(home, 'hub'));
    await writeFile(join(home, 'hub', 'trust.json'), JSON.stringify({ id: 'hub-1', devices: [{ id: 'laptop', tokenHash: 'hash', keys: { personal: 'accio-old-model-key' }, references: ['personal'] }] }));
    const trust = new HubTrust(home); await trust.load(); await trust.close();
    expect(JSON.parse(await readFile(join(home, 'hub', 'trust.json'), 'utf8'))).toEqual({ id: 'hub-1', devices: [{ kind: 'machine', id: 'laptop', tokenHash: 'hash', references: ['personal'] }] });
  });
  it('protects profile references retained for an offline paired machine', async () => {
    const { pair } = await fixture(); const first = await pair('first'); const second = await pair('second');
    const profile = await first.client.call('profiles.save', { name: 'Personal' });
    await first.client.call('machine.references', { profiles: [profile.id] }); await first.client.close();
    await expect(second.client.call('profiles.delete', { id: profile.id })).rejects.toThrow(/still used/);
    await second.client.call('hub.revokeMachine', { machineId: 'first' });
    await second.client.call('profiles.delete', { id: profile.id }); expect(second.client.snapshot.profiles).toEqual([]);
  });
  it('keeps a sleeping machine away until it really wakes', async () => {
    const { pair } = await fixture(); const mac = await pair('mac'); const pc = await pair('pc');
    const connected = async () => { await pc.client.refresh(true); return pc.client.snapshot.machines.find((m) => m.id === 'mac')?.connected; };
    mac.client.setAsleep(true);
    await expect.poll(connected).toBe(false);

    // A dark wake: the worker runs for a moment, its retry reconnects and its machine reports in.
    await mac.client.start();
    await mac.client.call('machine.hello', { id: 'mac', name: 'mac', platform: 'test', version: 'test', harnesses: [] });
    expect(await connected()).toBe(false);

    // Really awake: back online.
    mac.client.setAsleep(false);
    await expect.poll(connected).toBe(true);
  });
  it('answers malformed input to any hub method as a client error naming the problem, leaving the hub as it was', async () => {
    const { home, service, pair } = await fixture();
    const first = await pair('first'); await pair('second');
    const profile = await first.client.call('profiles.save', { name: 'Personal' });
    await first.client.call('machine.references', { profiles: [profile.id] });
    const files = async () => Promise.all(['trust.json', 'settings.json', 'resources.json', 'mcp-credentials.json', 'pairing.json'].map(file => readFile(join(home, 'hub', file), 'utf8').catch(() => '')));
    const before = await files(); const state = JSON.stringify({ ...service.snapshot(), revision: 0 });
    const rpc = async (method: string, params: unknown) => {
      const response = await fetch(service.url + '/rpc', { method: 'POST', headers: { authorization: `Bearer ${first.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) });
      return { status: response.status, error: (await response.json() as { error: string }).error };
    };
    const malformed: [string, unknown, string][] = [
      ['machine.hello', { id: 'first', name: 'first', platform: 'test', version: 'test', harnesses: 'none' }, 'harnesses'],
      ['machine.hello', { id: 'first', name: 'first', platform: 'test', version: 'test', harnesses: [], githubAccounts: ['not a login'] }, 'githubAccounts.0'],
      ['machine.references', { profiles: [42] }, 'profiles.0'],
      ['machine.modelKey', { profileId: { id: profile.id } }, 'profileId'],
      ['hub.revokeMachine', { machineId: ['second'] }, 'machineId'],
      ['resources.write', { method: 'dropTables', args: [] }, 'method'],
      ['resources.write', { method: 'saveMcp', args: [{ id: 'bad id', name: 'Remote', transport: 'http' }] }, 'args.0.id'],
      ['resources.write', { method: 'setSkillScope', args: ['library:review', { global: 'yes' }] }, 'args.1.global'],
      ['resources.write', { method: 'stageSkills', args: ['library', [{ id: 'library:review' }]] }, 'args.1.0.sourceId'],
      ['resources.write', { method: 'setToolStatus', args: [{ toolId: 'tool', machineId: 'first', status: 'broken' }] }, 'args.0.status'],
      ['mcp.grant', { id: 'remote', profileId: 7 }, 'profileId'],
      ['mcp.release', { token: null }, 'token'],
      ['accounts.beginSignIn', { id: 'claude', redirectUri: 'not a url' }, 'Invalid browser callback'],
      ['accounts.beginSignIn', { id: 'claude', redirectUri: 'https://attacker.example/callback' }, 'Invalid browser callback'],
      ['accounts.callback', { signInId: 'sign-in', code: 5 }, 'code'],
      ['profiles.save', { name: '' }, 'Name is required'],
      ['secrets.resolve', { profileId: profile.id }, 'projectId'],
    ];
    for (const [method, params, problem] of malformed) {
      const answer = await rpc(method, params);
      expect(answer, `${method} ${JSON.stringify(params)}`).toEqual({ status: 400, error: expect.stringContaining('Invalid hub request parameters') });
      expect(answer.error, method).toContain(problem);
    }
    expect(await rpc('hub.pairingCode', [])).toEqual({ status: 400, error: 'Invalid hub request' });
    expect(await rpc('hub.unknown', {})).toEqual({ status: 400, error: 'Unknown hub method hub.unknown' });
    expect(await files()).toEqual(before);
    expect(JSON.stringify({ ...service.snapshot(), revision: 0 })).toBe(state);
    expect(first.client.snapshot.machines.map((m: { id: string }) => m.id).sort()).toEqual(['first', 'second']);
  });
  it('rejects network-path and absolute request targets', async () => {
    const { service } = await fixture();
    for (const path of ['//attacker.invalid/v1/messages', 'http://attacker.invalid/v1/messages']) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(service.url, { method: 'POST', path }, (res) => { res.resume(); resolve(res.statusCode!); });
        req.on('error', reject); req.end('{}');
      });
      expect(status).toBe(404);
    }
  });
  it('shares resource definitions while retaining MCP credentials and revocable grants on the hub', async () => {
    const { service, pair, mcpForwarded } = await fixture();
    const first = await pair('first'); const second = await pair('second');
    const profile = await first.client.call('profiles.save', { name: 'Personal' });
    await first.client.call('resources.write', { method: 'saveMcp', args: [{ id: 'remote', name: 'Remote', transport: 'http', url: 'https://mcp.example.test', args: [], auth: 'bearer', scope: { global: false, profileIds: [profile.id], projectKeys: [] } }] });
    await first.client.call('resources.write', { method: 'setCredential', args: ['remote', { accessToken: 'private-mcp-token' }] });
    await second.client.refresh(true);
    expect(second.client.snapshot.resources.mcps[0]).toMatchObject({ id: 'remote', signedIn: true });
    expect(JSON.stringify(second.client.snapshot)).not.toContain('private-mcp-token');
    const { token } = await first.client.call('mcp.grant', { id: 'remote', profileId: profile.id });
    const send = () => fetch(service.url + '/mcp/access/remote', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' });
    expect((await send()).status).toBe(200); expect(mcpForwarded).toEqual(['Bearer private-mcp-token']);
    await second.client.call('hub.revokeMachine', { machineId: 'first' });
    expect((await send()).status).toBe(403);
    expect(second.client.snapshot.resources.mcps[0]?.signedIn).toBe(true);
  });
  it('updates project skill selections through paired machines without losing other scopes', async () => {
    const { service, pair } = await fixture();
    const first = await pair('first'); const second = await pair('second');
    const scope = { global: false, profileIds: ['personal'], projectKeys: ['existing'] };
    await service.resources.saveSource({ id: 'library', name: 'Library', url: 'https://example.test/skills.git', ref: 'HEAD' }, [
      { id: 'library:review', sourceId: 'library', name: 'review', description: 'Review changes', path: '/hub/skills/review', revision: 'abc', scope },
    ]);
    await service.resources.setSkillScope('library:review', scope);
    const one = remoteResources(first.client); const two = remoteResources(second.client);
    await Promise.all([
      one.setSkillProject('library:review', { projectKey: 'project-one', enabled: true }),
      two.setSkillProject('library:review', { projectKey: 'project-two', enabled: true }),
    ]);
    await first.client.refresh(true);
    expect(one.state().skills[0]?.scope).toEqual({ ...scope, projectKeys: expect.arrayContaining(['existing', 'project-one', 'project-two']) });
    await one.setSkillProject('library:review', { projectKey: 'project-one', enabled: false });
    expect(one.state().skills[0]?.scope).toEqual({ ...scope, projectKeys: expect.arrayContaining(['existing', 'project-two']) });
    expect(one.state().skills[0]?.scope.projectKeys).not.toContain('project-one');
    await expect(first.client.call('resources.write', { method: 'setSkillProject', args: ['library:review', { projectKey: 'project', enabled: 'yes' }] })).rejects.toThrow('Invalid hub request parameters (args.1.enabled:');
  });
  it('shares secret metadata, authorizes values by scope, and invalidates remote copies after rotation and revocation', async () => {
    const { home, service, pair } = await fixture();
    const first = await pair('first'); const second = await pair('second');
    const personal = await first.client.call('profiles.save', { name: 'Personal' });
    const work = await first.client.call('profiles.save', { name: 'Work' });
    const vault = remoteSecrets(first.client); cleanup.push(() => vault.close());
    const scope = { profileId: personal.id, projectId: 'docs', slot: 'pages.deploy:docs' };
    const saved = await vault.save({ profileId: personal.id, name: 'Deploy', slot: scope.slot, projectIds: ['docs'], value: 'private-secret-marker' });
    const changes: string[] = []; vault.onChanged(id => { changes.push(id); });
    expect((await vault.resolve(scope))?.value).toBe('private-secret-marker');
    expect(await vault.resolve({ ...scope, profileId: work.id })).toBeNull();
    expect(await vault.resolve({ ...scope, projectId: 'other' })).toBeNull();
    await expect(vault.bind(saved.id, { ...scope, profileId: work.id })).rejects.toThrow('cannot be assigned');
    await expect(second.client.call('profiles.delete', { id: personal.id })).rejects.toThrow('saved secrets');
    expect(JSON.stringify(first.client.snapshot)).not.toContain('private-secret-marker');
    expect(await readFile(join(home, 'hub/secrets/values.json'), 'utf8')).not.toContain('private-secret-marker');
    await second.client.call('secrets.save', { ...saved, value: 'replacement-secret-marker' });
    await expect.poll(() => vault.current(saved.id, saved.version, scope)).toBe(false);
    await expect(vault.used(saved.id, saved.version, scope)).rejects.toThrow('changed');
    expect(changes).toContain(saved.id);
    const replacement = await vault.resolve(scope); expect(replacement?.value).toBe('replacement-secret-marker');
    await second.client.call('hub.revokeMachine', { machineId: 'first' });
    await expect.poll(() => first.client.status).toBe('offline');
    expect(vault.current(saved.id, replacement!.metadata.version, scope)).toBe(false);
    await expect(vault.resolve(scope)).rejects.toThrow('not paired');
    expect(JSON.stringify(first.client.snapshot)).not.toContain('replacement-secret-marker');
  });
});
