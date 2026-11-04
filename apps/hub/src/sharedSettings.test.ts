import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';
import { afterEach, expect, it, vi } from 'vitest';
import { SharedSettings } from './sharedSettings.js';

let home: string;
afterEach(async () => { vi.restoreAllMocks(); if (home) await rm(home, { recursive: true, force: true }); });
const hello = { id: 'here', name: 'Desktop', platform: 'win32', version: 'test', harnesses: [] };
const model = { harnessId: 'claudeCode', modelId: 'one' };

async function setup() {
  home = await mkdtemp(join(tmpdir(), 'accio-settings-'));
  const settings = new SharedSettings(home);
  await settings.load();
  await settings.setProfiles([{ id: 'work', name: 'Work' }]);
  await settings.machineConnected(hello);
  return settings;
}

it('preserves concurrent settings from different slices and reloads them', async () => {
  const settings = await setup();
  await Promise.all([
    settings.setProfiles([{ id: 'work', name: 'Work renamed' }, { id: 'personal', name: 'Personal' }]),
    settings.setModelFavorite('work', model, true),
    settings.renameMachine('here', 'My desktop'),
    settings.setProfileFolders('here', 'work', ['/work']),
    settings.setModelFavorite('work', { ...model, modelId: 'two' }, true),
    settings.setThreadNaming({ automatic: false, model: { harnessId: 'claudeCode', modelId: 'haiku' }, instructions: 'Use sentence case' }),
  ]);
  const reloaded = new SharedSettings(home);
  await reloaded.load();
  expect(reloaded.profiles()).toEqual([{ id: 'work', name: 'Work renamed' }, { id: 'personal', name: 'Personal' }]);
  expect(reloaded.machine('here')).toMatchObject({ name: 'My desktop', profileFolders: { work: ['/work'] } });
  expect(reloaded.modelFavorites('work')).toEqual([model, { ...model, modelId: 'two' }]);
  expect(reloaded.threadNaming()).toEqual({ automatic: false, model: { harnessId: 'claudeCode', modelId: 'haiku' }, instructions: 'Use sentence case' });
});

it('does not publish failed settings or notify observers and recovers its queue', async () => {
  const settings = await setup();
  const changed = vi.fn();
  settings.onMachinesChanged(changed);
  vi.spyOn(JsonFile.prototype, 'write').mockRejectedValueOnce(new Error('disk full'));
  const failed = settings.setProfiles([{ id: 'personal', name: 'Personal' }]);
  await expect(failed).rejects.toThrow('disk full');
  expect(settings.profiles()).toEqual([{ id: 'work', name: 'Work' }]);
  expect(changed).not.toHaveBeenCalled();
  await settings.setModelFavorite('work', model, true);
  expect(changed).toHaveBeenCalledOnce();
});

it('does not recreate deleted profile folders or favorites from queued mutations', async () => {
  const settings = await setup();
  await settings.setProfileFolders('here', 'work', ['/work']);
  await settings.setModelFavorite('work', model, true);
  const deletion = settings.setProfiles([]);
  const folders = settings.setProfileFolders('here', 'work', ['/stale']);
  const favorite = settings.setModelFavorite('work', model, true);
  const results = await Promise.allSettled([deletion, folders, favorite]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
  expect(settings.machine('here')?.profileFolders).toEqual({});
  expect(settings.modelFavorites('work')).toEqual([]);
});

it('orders connection and disconnection even when the first write is pending', async () => {
  const settings = await setup();
  await Promise.all([settings.machineConnected({ ...hello, id: 'other' }), settings.machineDisconnected('other')]);
  expect(settings.machines().find((m) => m.id === 'other')?.connected).toBe(false);
});

it('keeps built-in tool overrides per harness and rejects unknown harnesses', async () => {
  const settings = await setup();
  await settings.setHarnessTools('claudeCode', { web: false });
  await settings.setHarnessTools('codex', { goals: true });
  await expect(settings.setHarnessTools('other', {})).rejects.toThrow('No harness other');
  const reloaded = new SharedSettings(home);
  await reloaded.load();
  expect(reloaded.harnessTools()).toEqual({ claudeCode: { web: false }, codex: { goals: true } });
});
