import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startHubService } from './service.js';
import { HubClient } from './client.js';
import { remoteSecrets } from './secretClient.js';
import { remoteResources } from './resourceClient.js';

describe('standalone hub trust and network boundary', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });
  async function fixture() {
    const home = await mkdtemp(join(tmpdir(), 'accio-hub-service-'));
    cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    const forwarded: string[] = [];
    const mcpForwarded: string[] = [];
    const service = await startHubService({ home, port: 0, secretKey: Buffer.alloc(32, 42).toString('base64'), claudeFetch: async (url, init) => {
      if (String(url).includes('/oauth/token')) return Response.json({ access_token: 'private-provider-token', refresh_token: 'private-refresh-token', expires_in: 3600, account: { uuid: 'me', email_address: 'me@example.com' } });
      if (String(url).endsWith('/api/oauth/usage')) return Response.json({});
      forwarded.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response('data: hello\n\n', { headers: { 'content-type': 'text/event-stream' } });
    }, mcpFetch: async (_url, init) => { mcpForwarded.push(new Headers(init?.headers).get('authorization') ?? ''); return Response.json({ result: 'ok' }); } });
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
    return { home, service, forwarded, mcpForwarded, pair };
  }
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
  it('rejects expired pairing codes and a changed hub identity', async () => {
    const { home, service, pair } = await fixture();
    const { code } = await service.createPairingCode();
    const file = join(home, 'hub', 'pairing.json'); const p = JSON.parse(await readFile(file, 'utf8')); p.expiresAt = 0; await writeFile(file, JSON.stringify(p));
    expect((await fetch(service.url + '/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machineId: 'late', code }) })).status).toBe(400);
    const { token } = await pair('first');
    const wrong = new HubClient(service.url, 'different', token, { id: 'first', name: 'first', platform: 'test', version: 'test', harnesses: [] });
    cleanup.push(() => wrong.close()); await wrong.start(); expect(wrong.status).toBe('offline'); expect(wrong.snapshot).toBeUndefined();
  });
  it('scopes model keys to one machine/profile, keeps provider tokens at the hub, and revokes access immediately', async () => {
    const { service, pair, forwarded } = await fixture();
    const first = await pair('first'); const second = await pair('second');
    const account = await first.client.call('accounts.save', { name: 'Claude' });
    const login = await first.client.call('accounts.beginSignIn', { id: account.id, redirectUri: 'http://localhost:12345/callback' });
    await expect(second.client.call('accounts.completeSignIn', { signInId: login.signInId, code: 'code' })).rejects.toThrow(/expired|cancelled/);
    await first.client.call('accounts.completeSignIn', { signInId: login.signInId, code: 'code' });
    const personal = await first.client.call('profiles.save', { name: 'Personal', accountId: account.id });
    const work = await first.client.call('profiles.save', { name: 'Work' });
    const { key } = await first.client.call('machine.modelKey', { profileId: personal.id });
    const { key: otherMachine } = await second.client.call('machine.modelKey', { profileId: personal.id });
    const { key: otherProfile } = await first.client.call('machine.modelKey', { profileId: work.id });
    expect(key).not.toBe(otherMachine); expect(key).not.toBe(otherProfile);
    expect((await fetch(service.url + '/rpc', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'accounts.list', params: {} }) })).status).toBe(401);
    const send = (key: string) => fetch(service.url + '/v1/messages', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' });
    const response = await send(key); expect(response.status).toBe(200); expect(await response.text()).toContain('hello');
    expect(forwarded).toEqual(['Bearer private-provider-token']);
    expect(JSON.stringify(first.client.snapshot)).not.toMatch(/private-provider-token|private-refresh-token/);
    await second.client.call('hub.revokeMachine', { machineId: 'first' });
    expect((await send(key)).status).toBe(401);
    expect((await fetch(service.url + '/state', { headers: { authorization: `Bearer ${first.token}` } })).status).toBe(401);
    const still = await send(otherMachine); expect(still.status).toBe(200); await still.body?.cancel();
  });
  it('protects profile references retained for an offline paired machine', async () => {
    const { pair } = await fixture(); const first = await pair('first'); const second = await pair('second');
    const profile = await first.client.call('profiles.save', { name: 'Personal' });
    await first.client.call('machine.references', { profiles: [profile.id] }); await first.client.close();
    await expect(second.client.call('profiles.delete', { id: profile.id })).rejects.toThrow(/still used/);
    await second.client.call('hub.revokeMachine', { machineId: 'first' });
    await second.client.call('profiles.delete', { id: profile.id }); expect(second.client.snapshot.profiles).toEqual([]);
  });
  it('rejects network-path and absolute request targets before forwarding model credentials', async () => {
    const { service, forwarded } = await fixture();
    for (const path of ['//attacker.invalid/v1/messages', 'http://attacker.invalid/v1/messages']) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(service.url, { method: 'POST', path }, (res) => { res.resume(); resolve(res.statusCode!); });
        req.on('error', reject); req.end('{}');
      });
      expect(status).toBe(404);
    }
    expect(forwarded).toEqual([]);
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
    await expect(first.client.call('resources.write', { method: 'setSkillProject', args: ['library:review', { projectKey: 'project', enabled: 'yes' }] })).rejects.toThrow('Invalid project skill selection');
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
    const { key } = await first.client.call('machine.modelKey', { profileId: personal.id });
    expect((await fetch(service.url + '/rpc', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ method: 'secrets.resolve', params: scope }) })).status).toBe(401);
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
