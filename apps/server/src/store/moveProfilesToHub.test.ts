import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedSettings } from '@accio/hub';
import { afterEach, expect, it } from 'vitest';
import { moveProfilesToHub } from './moveProfilesToHub.js';

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

it('keeps legacy profiles usable if writing their hub replacement fails', async () => {
  const home = await mkdtemp(join(tmpdir(), 'accio-migration-'));
  homes.push(home);
  const original = JSON.stringify([{ id: 'work', name: 'Work', folders: ['C:\\work'] }]);
  await writeFile(join(home, 'profiles.json'), original);
  // A file where the hub directory belongs makes its first write fail.
  await writeFile(join(home, 'hub'), 'blocked');
  const here = { id: 'here', name: 'Desktop', platform: 'win32', version: '0.1.0' };
  const failed = new SharedSettings(home);
  await expect(moveProfilesToHub(home, here, failed)).rejects.toThrow();
  await failed.close();
  expect(await readFile(join(home, 'profiles.json'), 'utf8')).toBe(original);

  await rm(join(home, 'hub'));
  const retry = new SharedSettings(home);
  await moveProfilesToHub(home, here, retry);
  expect(retry.profiles()).toEqual([{ id: 'work', name: 'Work' }]);
  expect(retry.machine('here')?.profileFolders).toEqual({ work: ['C:\\work'] });
  expect(await readFile(join(home, 'profiles.json.moved-to-hub'), 'utf8')).toBe(original);
  await retry.close();
});
