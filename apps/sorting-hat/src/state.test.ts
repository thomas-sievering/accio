import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFile } from './store.js';
import { afterEach, expect, it, vi } from 'vitest';
import { SortingHat } from './sortingHat.js';
import type { ClaudeAccount } from './claudeOAuth.js';

let home: string;
afterEach(async () => { vi.restoreAllMocks(); if (home) await rm(home, { recursive: true, force: true }); });
const account: ClaudeAccount = { accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 3600000, email: 'me@example.com', organization: null, claudeAccountId: 'claude-me' };
const exists = (path: string) => readFile(path).then(() => true, () => false);

it('migrates the original filename and login field into houses, preserving signed-out ones and dropping their keys', async () => {
  home = await mkdtemp(join(tmpdir(), 'sorting-hat-migration-'));
  await mkdir(join(home, 'hub'));
  await writeFile(join(home, 'hub', 'accounts.json'), JSON.stringify([
    { id: 'work', accessKey: 'work-key', login: account },
    { id: 'personal', accessKey: 'personal-key', login: null },
  ]));
  const hat = new SortingHat(join(home, 'hub'));
  await hat.load();
  expect(hat.houseViews().map((h) => [h.id, h.name])).toEqual([['work', 'work'], ['personal', 'personal']]);
  expect(hat.selectedAccount('personal')).toBeNull();
  expect(hat.selectedAccount('work')).toMatchObject({ id: 'account-work', name: 'me@example.com', signedIn: true });
  expect(await hat.accessToken('work')).toBe('token');
  // The hub's stored key is not a hat key: it asks for one in memory instead.
  expect(hat.houseForKey('work-key')).toBeUndefined();
  expect(hat.houseForKey(await hat.ensureHouse('work'))).toEqual({ id: 'work', hatKeyId: null });
  expect(await exists(join(home, 'hub', 'accounts.json'))).toBe(false);
  const stored = await readFile(join(home, 'hub', 'sorting-hat.json'), 'utf8');
  expect(stored).not.toContain('work-key');
  await hat.close();
  const reloaded = new SortingHat(join(home, 'hub'));
  await reloaded.load();
  expect(reloaded.accountViews()).toEqual(hat.accountViews());
  expect(await readFile(join(home, 'hub', 'sorting-hat.json'), 'utf8')).toBe(stored);
});

it('keeps legacy credentials readable when conversion persistence fails', async () => {
  home = await mkdtemp(join(tmpdir(), 'sorting-hat-migration-'));
  await mkdir(join(home, 'hub'));
  const path = join(home, 'hub', 'profiles.json');
  const legacy = JSON.stringify([{ id: 'work', accessKey: 'kept-key', account }]);
  await writeFile(path, legacy);
  vi.spyOn(JsonFile.prototype, 'write').mockRejectedValueOnce(new Error('disk full'));
  const failed = new SortingHat(join(home, 'hub'));
  await expect(failed.load()).rejects.toThrow('disk full');
  expect(failed.accountViews()).toEqual([]);
  expect(await readFile(path, 'utf8')).toBe(legacy);
  const retry = new SortingHat(join(home, 'hub'));
  await retry.load();
  expect(await retry.accessToken('work')).toBe('token');
  expect(await exists(path)).toBe(false);
});

it('turns the hub’s profiles into houses with ordered account lists, keeping each provider', async () => {
  home = await mkdtemp(join(tmpdir(), 'sorting-hat-migration-'));
  await mkdir(join(home, 'hub'));
  const openai = { credentialId: 'c', email: 'gpt@example.com', plan: null, models: [] };
  await writeFile(join(home, 'hub', 'profiles.json'), JSON.stringify({
    profiles: [
      { id: 'work', accessKey: 'work-key', accountId: 'claude', openaiAccountId: 'gpt' },
      { id: 'personal', accessKey: 'personal-key', accountId: null },
      { id: 'ordered', accessKey: 'ordered-key', accountIds: ['gpt', 'claude'] },
    ],
    accounts: [{ id: 'claude', name: 'Claude', account }, { id: 'gpt', name: 'GPT', providerId: 'openai', account: null, openai }],
  }));
  const hat = new SortingHat(join(home, 'hub'));
  await hat.load();
  expect(hat.selectedAccounts('work', 'anthropic').map((a) => a.id)).toEqual(['claude']);
  expect(hat.selectedAccounts('work', 'openai').map((a) => a.id)).toEqual(['gpt']);
  expect(hat.selectedAccounts('personal', 'anthropic')).toEqual([]);
  const stored = JSON.parse(await readFile(join(home, 'hub', 'sorting-hat.json'), 'utf8'));
  expect(stored).toMatchObject({ version: 1, hatKeys: [], houses: [
    { id: 'work', name: 'work', accountIds: ['claude', 'gpt'] },
    { id: 'personal', name: 'personal', accountIds: [] },
    { id: 'ordered', name: 'ordered', accountIds: ['gpt', 'claude'] },
  ] });
  expect(stored.accounts.map((a: { id: string }) => a.id)).toEqual(['claude', 'gpt']);
  expect(await exists(join(home, 'hub', 'profiles.json'))).toBe(false);
  await hat.close();
});
