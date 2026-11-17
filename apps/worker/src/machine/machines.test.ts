import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp } from '../testing/testApp.js';

describe('machines on the hub', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(() => t?.stop());

  it('lists this machine as connected, with the harnesses it has', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const [here, ...others] = await c.call('machines.list', {});
    expect(others).toEqual([]);
    expect(here).toMatchObject({ name: expect.any(String), connected: true, thisMachine: true, profileFolders: {} });
    expect(here!.harnesses).toEqual([
      { harnessId: 'claudeCode', version: expect.stringMatching(/^\d+\.\d+/) },
      { harnessId: 'codex', version: expect.stringMatching(/^\d+\.\d+/) },
    ]);

    const harnesses = await c.call('harnesses.list', {});
    expect(harnesses).toMatchObject([
      { id: 'claudeCode', name: 'Claude Code', providers: ['anthropic'], machines: [{ machineId: here!.id, version: expect.any(String) }] },
      { id: 'codex', name: 'Codex', providers: ['openai'], machines: [{ machineId: here!.id, version: expect.any(String) }] },
    ]);
  });

  it('keeps each machine’s profile folders on the hub, and drops a deleted profile’s', async () => {
    t = await startTestApp();
    const a = await t.connect();
    const b = await t.connect();
    const { id: machineId } = await a.thisMachine();
    await a.call('profiles.save', { name: 'Work' });
    const saved = await a.call('machines.setProfileFolders', { machineId, profileId: 'work', folders: ['S:\\hrc', 'S:\\hrc'] });
    expect(saved.profileFolders).toEqual({ work: ['S:\\hrc'] });
    await b.waitFor('machines.changed', (list) => list[0]?.profileFolders.work?.length === 1);

    const shared = JSON.parse(await readFile(join(t.home, 'hub', 'settings.json'), 'utf8'));
    expect(shared.machines[0].profileFolders).toEqual({ work: ['S:\\hrc'] });

    // Same machine after a restart: same id, same folders.
    const home = t.home;
    await t.stop({ keepHome: true });
    t = await startTestApp({}, home);
    const c = await t.connect();
    expect((await c.thisMachine()).id).toBe(machineId);
    expect((await c.call('machines.list', {}))[0]?.profileFolders).toEqual({ work: ['S:\\hrc'] });

    await c.call('profiles.delete', { id: 'work' });
    await c.waitFor('machines.changed', (list) => Object.keys(list[0]?.profileFolders ?? {}).length === 0);
  });

  it('reports gh’s accounts and keeps each profile’s GitHub account on the hub', async () => {
    const gh = async (args: string[]) => {
      if (args[1] === 'status') return JSON.stringify({ hosts: { 'github.com': [{ login: 'me' }, { login: 'work_hrc' }] } });
      throw new Error('unexpected');
    };
    t = await startTestApp({ github: gh });
    const c = await t.connect();
    const work = await c.call('profiles.save', { name: 'Work' });
    expect(work.githubLogin).toBeNull();
    expect((await c.call('machines.list', {}))[0]).toMatchObject({ githubAccounts: ['me', 'work_hrc'] });
    expect((await c.call('profiles.save', { id: work.id, name: 'Work', githubLogin: 'work_hrc' })).githubLogin).toBe('work_hrc');
    // A save that leaves it out keeps it.
    expect((await c.call('profiles.save', { id: work.id, name: 'Work' })).githubLogin).toBe('work_hrc');
    await expect(c.call('profiles.save', { id: work.id, name: 'Work', githubLogin: 'not a login' })).rejects.toThrow();
    expect((await c.call('profiles.save', { id: work.id, name: 'Work', githubLogin: null })).githubLogin).toBeNull();
  });

  it('refuses folders for a machine or profile the hub does not know', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const { id: machineId } = await c.thisMachine();
    await expect(c.call('machines.setProfileFolders', { machineId, profileId: 'nope', folders: [] })).rejects.toThrow(/No profile/);
    await c.call('profiles.save', { name: 'Work' });
    await expect(c.call('machines.setProfileFolders', { machineId: 'other', profileId: 'work', folders: [] })).rejects.toThrow(
      /No such machine/,
    );
  });

  it('shares renamed machines with clients and preserves their names after reconnecting and restarting', async () => {
    t = await startTestApp();
    const a = await t.connect();
    const b = await t.connect();
    const { id: machineId } = await a.thisMachine();
    const renamed = await a.call('machines.rename', { machineId, name: '  Work desktop  ' });
    expect(renamed).toMatchObject({ id: machineId, name: 'Work desktop', connected: true });
    await b.waitFor('machines.changed', (list) => list.some((m) => m.id === machineId && m.name === 'Work desktop'));
    expect((await b.thisMachine()).name).toBe('Work desktop');

    const laptop = { id: 'laptop', name: 'hostname', platform: 'linux', version: '0.1.0', harnesses: [] };
    await t.app.settings.machineConnected(laptop);
    await t.app.settings.machineDisconnected(laptop.id);
    expect(await a.call('machines.rename', { machineId: laptop.id, name: 'Travel laptop' })).toMatchObject({ name: 'Travel laptop', connected: false });
    await t.app.settings.machineConnected({ ...laptop, name: 'new-hostname', version: '0.1.1' });
    expect((await a.call('machines.list', {})).find((m) => m.id === laptop.id)).toMatchObject({ name: 'Travel laptop', version: '0.1.1', connected: true });

    const home = t.home;
    await t.stop({ keepHome: true });
    t = await startTestApp({}, home);
    const c = await t.connect();
    expect((await c.thisMachine()).name).toBe('Work desktop');
    expect((await c.call('machines.list', {})).find((m) => m.id === laptop.id)).toMatchObject({ name: 'Travel laptop', connected: false });
  });

  it('rejects invalid names and unknown machines without changing the registry', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const { id: machineId } = await c.thisMachine();
    const before = await c.call('machines.list', {});
    for (const name of ['', '   ', 'x'.repeat(101)]) {
      await expect(c.call('machines.rename', { machineId, name })).rejects.toThrow(/Invalid params/);
    }
    await expect(c.call('machines.rename', { machineId: 'unknown', name: 'Desktop' })).rejects.toThrow(/No such machine/);
    expect(await c.call('machines.list', {})).toEqual(before);
  });

  it('pushes hub machine connections and disconnections and keeps their folders separate', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const { id: hereId } = await c.thisMachine();
    await c.call('profiles.save', { name: 'Work' });
    await t.app.settings.machineConnected({ id: 'laptop', name: 'Laptop', platform: 'linux', version: '0.1.0', harnesses: [] });
    const connected = await c.waitFor('machines.changed', (list) => list.some((m) => m.id === 'laptop' && m.connected));
    expect(connected.find((m) => m.id === 'laptop')?.thisMachine).toBe(false);
    await c.call('machines.setProfileFolders', { machineId: 'laptop', profileId: 'work', folders: ['/work'] });
    expect(t.app.machines.profileFoldersHere()).toEqual([{ id: 'work', folders: [] }]);
    await c.call('machines.setProfileFolders', { machineId: hereId, profileId: 'work', folders: ['C:\\work'] });
    await t.app.settings.machineDisconnected('laptop');
    const offline = await c.waitFor('machines.changed', (list) => list.some((m) => m.id === 'laptop' && !m.connected));
    expect(offline.find((m) => m.id === 'laptop')?.profileFolders).toEqual({ work: ['/work'] });
    await t.app.settings.machineConnected({ id: 'laptop', name: 'Laptop', platform: 'linux', version: '0.1.1', harnesses: [] });
    expect((await c.call('machines.list', {})).find((m) => m.id === 'laptop')).toMatchObject({ connected: true, version: '0.1.1', profileFolders: { work: ['/work'] } });

    const home = t.home;
    await t.stop({ keepHome: true });
    t = await startTestApp({}, home);
    const restarted = await t.connect();
    expect((await restarted.call('machines.list', {})).find((m) => m.id === 'laptop')).toMatchObject({ connected: false, profileFolders: { work: ['/work'] } });
    await restarted.call('profiles.delete', { id: 'work' });
    expect((await restarted.call('machines.list', {})).every((m) => Object.keys(m.profileFolders).length === 0)).toBe(true);
  });

});
