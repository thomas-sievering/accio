import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startHubService } from './service.js';
import { HubClient } from './client.js';

/** GLOSSARY: Space. Stored with the hub's shared settings and the same on every paired machine. */
describe('spaces on the hub', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });
  async function pairedClients() {
    const home = await mkdtemp(join(tmpdir(), 'accio-hub-spaces-'));
    cleanup.push(() => rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
    const service = await startHubService({ home, port: 0 });
    cleanup.push(() => service.close());
    async function pair(id: string) {
      const { code } = await service.createPairingCode();
      const response = await fetch(service.url + '/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machineId: id, code }) });
      const p = await response.json() as any;
      const client = new HubClient(service.url, p.hubId, p.token, { id, name: id, platform: 'test', version: 'test', harnesses: [] });
      await client.start(); cleanup.push(() => client.close());
      return client;
    }
    return { desk: await pair('desk'), laptop: await pair('laptop') };
  }
  /** The other machine hears of a change through the hub's events. */
  async function eventually(check: () => void) {
    for (let i = 0; ; i++) {
      try { return check(); } catch (error) { if (i > 100) throw error; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it('saves a space on one machine and shows it on the other', async () => {
    const { desk, laptop } = await pairedClients();
    const saved = await desk.call('spaces.save', { name: ' hrc ', projectKeys: ['github.com/me/hrc_mcp', 'local:notes'] });
    expect(saved).toEqual({ id: expect.any(String), name: 'hrc', projectKeys: ['github.com/me/hrc_mcp', 'local:notes'] });
    await eventually(() => expect(laptop.snapshot.spaces).toEqual([saved]));
    expect(await laptop.call('spaces.list', {})).toEqual([saved]);

    const renamed = await laptop.call('spaces.save', { ...saved, name: 'hrc agents', projectKeys: ['github.com/me/hrc_mcp'] });
    expect(renamed).toEqual({ id: saved.id, name: 'hrc agents', projectKeys: ['github.com/me/hrc_mcp'] });
    await eventually(() => expect(desk.snapshot.spaces).toEqual([renamed]));
  });

  it('refuses a project that is already in another space, and an empty name', async () => {
    const { desk, laptop } = await pairedClients();
    const hrc = await desk.call('spaces.save', { name: 'hrc', projectKeys: ['github.com/me/hrc_mcp'] });
    await expect(laptop.call('spaces.save', { name: 'agents', projectKeys: ['github.com/me/agent', 'github.com/me/hrc_mcp'] }))
      .rejects.toThrow('github.com/me/hrc_mcp is already in the space hrc');
    await expect(laptop.call('spaces.save', { id: hrc.id, name: '  ', projectKeys: [] })).rejects.toThrow('Enter a name for the space.');
    expect(await laptop.call('spaces.list', {})).toEqual([hrc]);
  });

  it('marks, changes and clears a home, and refuses one outside the space', async () => {
    const { desk, laptop } = await pairedClients();
    const space = await desk.call('spaces.save', { name: 'hrc', projectKeys: ['github.com/me/hrc', 'github.com/me/hrc_mcp'], homeProjectKey: 'github.com/me/hrc' });
    expect(space.homeProjectKey).toBe('github.com/me/hrc');
    await eventually(() => expect(laptop.snapshot.spaces?.[0]?.homeProjectKey).toBe('github.com/me/hrc'));

    await expect(laptop.call('spaces.save', { ...space, homeProjectKey: 'github.com/me/elsewhere' })).rejects.toThrow('The home must be one of the space’s projects.');
    expect((await laptop.call('spaces.save', { ...space, homeProjectKey: 'github.com/me/hrc_mcp' })).homeProjectKey).toBe('github.com/me/hrc_mcp');
    expect(await laptop.call('spaces.save', { ...space, homeProjectKey: undefined })).toEqual({ id: space.id, name: 'hrc', projectKeys: space.projectKeys });
  });

  it('clears the home when its project leaves the space', async () => {
    const { desk, laptop } = await pairedClients();
    const space = await desk.call('spaces.save', { name: 'hrc', projectKeys: ['github.com/me/hrc', 'github.com/me/hrc_mcp'], homeProjectKey: 'github.com/me/hrc' });
    const saved = await desk.call('spaces.save', { ...space, projectKeys: ['github.com/me/hrc_mcp'] });
    expect(saved).toEqual({ id: space.id, name: 'hrc', projectKeys: ['github.com/me/hrc_mcp'] });
    await eventually(() => expect(laptop.snapshot.spaces).toEqual([saved]));
  });

  it('deletes only the space, so its projects can join another one', async () => {
    const { desk, laptop } = await pairedClients();
    const space = await desk.call('spaces.save', { name: 'hrc', projectKeys: ['github.com/me/hrc_mcp'] });
    const other = await desk.call('spaces.save', { name: 'agents', projectKeys: ['github.com/me/agent'] });
    await laptop.call('spaces.delete', { id: space.id });
    await eventually(() => expect(desk.snapshot.spaces).toEqual([other]));
    await expect(desk.call('spaces.delete', { id: space.id })).rejects.toThrow('This space no longer exists.');
    expect((await desk.call('spaces.save', { name: 'hrc again', projectKeys: ['github.com/me/hrc_mcp'] })).projectKeys).toEqual(['github.com/me/hrc_mcp']);
  });

  it('leaves spaces as they are when a profile is deleted', async () => {
    const { desk, laptop } = await pairedClients();
    const profile = await desk.call('profiles.save', { name: 'Work' });
    const space = await desk.call('spaces.save', { name: 'hrc', projectKeys: ['github.com/me/hrc', 'local:notes'], homeProjectKey: 'github.com/me/hrc' });
    await laptop.call('profiles.delete', { id: profile.id });
    await eventually(() => expect(desk.snapshot.profiles).toEqual([]));
    expect(desk.snapshot.spaces).toEqual([space]);
    expect(await laptop.call('spaces.list', {})).toEqual([space]);
  });
});
