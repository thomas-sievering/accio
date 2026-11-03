import { readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp } from '../testing/testApp.js';

describe('machines on the hub', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  afterEach(() => t?.stop());

  it('lists this machine as connected, with the harnesses it has', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const here = await c.call('machine.get', {});
    const [machine, ...others] = await c.call('machines.list', {});
    expect(others).toEqual([]);
    expect(machine).toMatchObject({ id: here.id, name: here.name, connected: true, thisMachine: true, profileFolders: {} });
    expect(machine?.harnesses).toEqual([{ harnessId: 'claudeCode', version: expect.stringMatching(/^\d+\.\d+/) }]);

    const harnesses = await c.call('harnesses.list', {});
    expect(harnesses).toMatchObject([
      { id: 'claudeCode', name: 'Claude Code', providers: ['anthropic'], machines: [{ machineId: here.id, version: expect.any(String) }] },
    ]);
  });

  it('keeps each machine’s profile folders on the hub, and drops a deleted profile’s', async () => {
    t = await startTestApp();
    const a = await t.connect();
    const b = await t.connect();
    const { id: machineId } = await a.call('machine.get', {});
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
    expect((await c.call('machine.get', {})).id).toBe(machineId);
    expect((await c.call('machines.list', {}))[0]?.profileFolders).toEqual({ work: ['S:\\hrc'] });

    await c.call('profiles.delete', { id: 'work' });
    await c.waitFor('machines.changed', (list) => Object.keys(list[0]?.profileFolders ?? {}).length === 0);
  });

  it('refuses folders for a machine or profile the hub does not know', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const { id: machineId } = await c.call('machine.get', {});
    await expect(c.call('machines.setProfileFolders', { machineId, profileId: 'nope', folders: [] })).rejects.toThrow(/No profile/);
    await c.call('profiles.save', { name: 'Work' });
    await expect(c.call('machines.setProfileFolders', { machineId: 'other', profileId: 'work', folders: [] })).rejects.toThrow(
      /No such machine/,
    );
  });

  it('pushes hub machine connections and disconnections and keeps their folders separate', async () => {
    t = await startTestApp();
    const c = await t.connect();
    const { id: hereId } = await c.call('machine.get', {});
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

  it('moves the profiles this machine kept itself onto the hub, their folders under this machine', async () => {
    const home = await mkdtemp(join(tmpdir(), 'accio-test-'));
    await writeFile(
      join(home, 'profiles.json'),
      JSON.stringify([
        { id: 'personal', name: 'Personal', folders: ['S:\\'] },
        { id: 'hrc', name: 'HRC', roots: ['S:\\hrc'] },
      ]),
    );
    t = await startTestApp({}, home);
    const c = await t.connect();
    expect((await c.call('profiles.list', {})).map((p) => p.name)).toEqual(['Personal', 'HRC']);
    expect((await c.call('machines.list', {}))[0]?.profileFolders).toEqual({ personal: ['S:\\'], hrc: ['S:\\hrc'] });
    await expect(readFile(join(home, 'profiles.json'))).rejects.toThrow(/ENOENT/);
  });
});
