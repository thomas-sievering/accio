import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { optionalScope } from '@accio/hub';
import { FakeHarness, gate, replyWith } from '../testing/fakeHarness.js';
import { startTestApp } from '../testing/testApp.js';
import { runCommand } from './process.js';

describe('hub resource management', () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(() => stop?.());
  const definition = { id: 'playwright', name: 'Playwright CLI', package: '@playwright/cli', version: '1.0.0', executable: 'playwright-cli', checkArgs: ['--version'], scope: optionalScope() };
  async function installed(prefix: string) {
    const folder = join(prefix, 'node_modules', '@playwright', 'cli');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), JSON.stringify({ version: '1.0.0', bin: { 'playwright-cli': 'cli.js' } }));
    await writeFile(join(folder, 'cli.js'), '');
  }
  it('starts exactly one local repair thread on check failure and verifies after it completes', async () => {
    const held = gate(); let broken = true;
    const harness = new FakeHarness(async function* () { await held.opened; broken = false; yield* replyWith('Repaired'); });
    const t = await startTestApp({ harness, resourceCommand: async () => { if (broken) throw new Error('browser dependency missing'); return '1.0.0'; } }); stop = t.stop;
    const c = await t.connect(); await c.signedIn('Personal'); await installed(t.app.resources.tools.folder(definition));
    await c.call('tools.save', definition);
    const first = await c.call('tools.check', { id: definition.id });
    expect(first).toMatchObject({ status: 'error', repairThreadId: expect.any(String) });
    await c.call('tools.check', { id: definition.id });
    expect((await c.call('threads.list', {}))).toHaveLength(1);
    expect(harness.runs[0]?.prompt).toContain('browser dependency missing');
    expect(harness.runs[0]?.env.PATH).toContain(join(t.home, 'tools'));
    held.release();
    await c.waitFor('resources.changed', state => state.toolStatuses.some(s => s.toolId === definition.id && s.status === 'ready'));
    expect((await c.call('resources.get', {})).toolStatuses[0]?.status).toBe('ready');
  });
  it('keeps failed checks visible when no profile can run a repair', async () => {
    const t = await startTestApp({ resourceCommand: async () => { throw new Error('broken'); } }); stop = t.stop;
    const c = await t.connect(); await installed(t.app.resources.tools.folder(definition)); await c.call('tools.save', definition);
    const status = await c.call('tools.check', { id: definition.id });
    expect(status).toMatchObject({ status: 'error', repairError: expect.stringContaining('Sign in') });
    expect(await c.call('threads.list', {})).toEqual([]);
  });
  it('stores MCP tokens only on the hub and grants access only during an enabled turn', async () => {
    const held = gate(); const requests: RequestInit[] = [];
    const harness = new FakeHarness(async function* () { await held.opened; yield* replyWith('done'); });
    const t = await startTestApp({ harness, mcpFetch: async (_url, init) => { requests.push(init!); return Response.json({ result: 'ok' }); } }); stop = t.stop;
    const c = await t.connect(); await c.signedIn('Personal');
    await expect(c.call('mcp.save', { id: 'accio', name: 'Reserved', transport: 'http', url: 'https://example.test/mcp', auth: 'none', scope: optionalScope() })).rejects.toThrow('reserved');
    await expect(c.call('mcp.save', { id: 'accio_secrets', name: 'Reserved', transport: 'http', url: 'https://example.test/mcp', auth: 'none', scope: optionalScope() })).rejects.toThrow('reserved');
    await c.call('mcp.save', { id: 'mobbin', name: 'Mobbin', transport: 'http', url: 'https://mcp.example.test/mcp', auth: 'bearer', scope: { ...optionalScope(), global: true } });
    await c.call('mcp.setToken', { id: 'mobbin', token: 'private-mobbin-token' });
    expect(JSON.stringify(await c.call('resources.get', {}))).not.toContain('private-mobbin-token');
    expect(await readFile(join(t.home, 'hub', 'resources.json'), 'utf8')).not.toContain('private-mobbin-token');
    const thread = await c.call('threads.start', { profileId: 'personal', text: 'Use Mobbin' });
    await expect.poll(() => harness.runs.length).toBe(1);
    const mcp = harness.runs[0]!.mcps!.mobbin!; expect(mcp.type).toBe('http');
    if (mcp.type !== 'http') throw new Error('Expected HTTP');
    expect(JSON.stringify(mcp)).not.toContain('private-mobbin-token');
    const response = await fetch(mcp.url, { method: 'POST', headers: mcp.headers, body: '{}' });
    expect(response.status).toBe(200);
    expect(new Headers(requests[0]?.headers).get('authorization')).toBe('Bearer private-mobbin-token');
    await c.call('mcp.save', { id: 'mobbin', name: 'Mobbin', transport: 'http', url: 'https://mcp.example.test/mcp', auth: 'bearer', scope: optionalScope() });
    expect((await fetch(mcp.url, { headers: mcp.headers })).status).toBe(403);
    held.release(); await c.waitFor('threads.changed', threads => threads.some(x => x.id === thread.id && x.status === 'idle'));
    expect((await fetch(mcp.url, { headers: mcp.headers })).status).toBe(403);
  });
  it('imports real Git skills, applies project scope and copies without overwriting project content', async () => {
    const harness = new FakeHarness(); const t = await startTestApp({ harness }); stop = t.stop;
    const c = await t.connect(); await c.signedIn('Personal');
    const source = join(t.home, 'source'); const project = join(t.home, 'project');
    await mkdir(join(source, 'browser'), { recursive: true }); await mkdir(project);
    await writeFile(join(source, 'browser', 'SKILL.md'), '---\nname: browser\ndescription: Browser testing\n---\nUse the browser.');
    await runCommand('git', ['init', '--quiet', source]); await runCommand('git', ['add', '.'], { cwd: source });
    await runCommand('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'skill'], { cwd: source });
    const checkout = await c.call('checkouts.add', { path: project, profileId: 'personal' });
    await c.call('skills.addSource', { id: 'library', name: 'My skills', url: source });
    const skill = (await c.call('resources.get', {})).skills[0]!;
    expect(skill.scope).toEqual(optionalScope());
    await c.call('skills.setScope', { id: skill.id, scope: { ...optionalScope(), projectKeys: [`local:${checkout.projectId}`] } });
    const thread = await c.call('threads.start', { checkoutId: checkout.id, text: 'Test browser' });
    await c.waitFor('threads.changed', threads => threads.some(x => x.id === thread.id && x.status === 'idle'));
    expect(harness.runs[0]?.resourceInstructions).toContain(skill.revision);
    expect(harness.runs[0]?.resourceInstructions).toContain('browser');
    await writeFile(join(source, 'browser', 'SKILL.md'), '---\nname: browser\ndescription: Updated browser testing\n---\nNew instructions.');
    await runCommand('git', ['add', '.'], { cwd: source });
    await runCommand('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--quiet', '-m', 'update'], { cwd: source });
    const preview = await c.call('skills.previewUpdate', { id: 'library' });
    expect(preview[0]!.revision).not.toBe(skill.revision);
    expect((await c.call('resources.get', {})).skills[0]!.revision).toBe(skill.revision);
    await c.call('skills.applyUpdate', { id: 'library', revision: preview[0]!.revision });
    expect((await c.call('resources.get', {})).skills[0]!.scope.projectKeys).toEqual([`local:${checkout.projectId}`]);
    await c.call('skills.applyUpdate', { id: 'library', revision: skill.revision });
    expect((await c.call('resources.get', {})).skills[0]!.revision).toBe(skill.revision);
    const copy = await c.call('skills.copy', { id: skill.id, checkoutId: checkout.id });
    expect(await readFile(join(copy.path, 'SKILL.md'), 'utf8')).toContain('Use the browser.');
    await expect(c.call('skills.copy', { id: skill.id, checkoutId: checkout.id })).rejects.toThrow('already has');
  });
  it('completes MCP OAuth with PKCE, refreshes at the hub and rejects a replayed callback', async () => {
    const held = gate(); let refreshes = 0;
    const exchangeStarted = gate(); const exchangeFinish = gate(); let delayExchange = false;
    const harness = new FakeHarness(async function* () { await held.opened; yield* replyWith('done'); });
    const mcpFetch: typeof fetch = async (url, init) => {
      if (String(url).includes('oauth-protected-resource')) return Response.json({ authorization_servers: ['https://auth.example.test'] });
      if (String(url).includes('oauth-authorization-server')) return Response.json({ authorization_endpoint: 'https://auth.example.test/authorize', token_endpoint: 'https://auth.example.test/token', registration_endpoint: 'https://auth.example.test/register' });
      if (String(url).endsWith('/register')) return Response.json({ client_id: 'accio-public' });
      if (String(url).endsWith('/token')) {
        const body = new URLSearchParams(String(init?.body));
        if (body.get('grant_type') === 'authorization_code') { if (delayExchange) { exchangeStarted.release(); await exchangeFinish.opened; } expect(body.get('code_verifier')).toBeTruthy(); return Response.json({ access_token: 'oauth-private', refresh_token: 'refresh-private', expires_in: -1 }); }
        refreshes++; return Response.json({ access_token: 'refreshed-private', expires_in: 3600 });
      }
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer refreshed-private');
      return Response.json({ result: 'ok' });
    };
    const t = await startTestApp({ harness, mcpFetch }); stop = t.stop;
    const c = await t.connect(); await c.signedIn('Personal');
    await c.call('mcp.save', { id: 'mobbin', name: 'Mobbin', transport: 'http', url: 'https://mcp.example.test/mcp', auth: 'oauth', scope: { ...optionalScope(), global: true } });
    const { url } = await c.call('mcp.beginSignIn', { id: 'mobbin' });
    const auth = new URL(url); expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    const callback = new URL(auth.searchParams.get('redirect_uri')!); callback.searchParams.set('code', 'success'); callback.searchParams.set('state', auth.searchParams.get('state')!);
    await c.call('mcp.completeSignIn', { id: 'mobbin', callbackUrl: callback.href });
    await expect(c.call('mcp.completeSignIn', { id: 'mobbin', callbackUrl: callback.href })).rejects.toThrow('expired');
    const thread = await c.call('threads.start', { profileId: 'personal', text: 'Use Mobbin' });
    await expect.poll(() => harness.runs.length).toBe(1);
    const mcp = harness.runs[0]!.mcps!.mobbin!; if (mcp.type !== 'http') throw new Error('Expected HTTP');
    await Promise.all([fetch(mcp.url, { method: 'POST', headers: mcp.headers, body: '{}' }), fetch(mcp.url, { method: 'POST', headers: mcp.headers, body: '{}' })]);
    expect(refreshes).toBe(1);
    await c.call('mcp.signOut', { id: 'mobbin' });
    expect((await fetch(mcp.url, { headers: mcp.headers })).status).toBe(502);
    delayExchange = true;
    const next = new URL((await c.call('mcp.beginSignIn', { id: 'mobbin' })).url);
    const cancelledCallback = new URL(next.searchParams.get('redirect_uri')!);
    cancelledCallback.searchParams.set('state', next.searchParams.get('state')!); cancelledCallback.searchParams.set('code', 'cancelled');
    const cancelled = expect(c.call('mcp.completeSignIn', { id: 'mobbin', callbackUrl: cancelledCallback.href })).rejects.toThrow('cancelled');
    await exchangeStarted.opened; await c.call('mcp.signOut', { id: 'mobbin' }); exchangeFinish.release(); await cancelled;
    expect((await c.call('resources.get', {})).mcps[0]!.signedIn).toBe(false);
    held.release(); await c.waitFor('threads.changed', threads => threads.some(x => x.id === thread.id && x.status === 'idle'));
  });
});
