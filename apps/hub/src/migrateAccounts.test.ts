import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';
import { afterEach, expect, it, vi } from 'vitest';
import { Hub } from './hub.js';
import type { ClaudeAccount } from './claudeOAuth.js';

let home: string;
afterEach(async () => { vi.restoreAllMocks(); if (home) await rm(home, { recursive: true, force: true }); });
const account: ClaudeAccount = { accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 3600000, email: 'me@example.com', organization: null, claudeAccountId: 'claude-me' };

it('migrates the original filename and login field, preserving signed-out profiles and keys', async () => {
  home = await mkdtemp(join(tmpdir(), 'accio-accounts-migration-'));
  await mkdir(join(home, 'hub'));
  await writeFile(join(home, 'hub', 'accounts.json'), JSON.stringify([
    { id: 'work', accessKey: 'work-key', login: account },
    { id: 'personal', accessKey: 'personal-key', login: null },
  ]));
  const hub = new Hub(home);
  await hub.load();
  expect(await hub.ensureProfile('work')).toBe('work-key');
  expect(await hub.ensureProfile('personal')).toBe('personal-key');
  expect(hub.selectedAccount('personal')).toBeNull();
  expect(hub.selectedAccount('work')).toMatchObject({ id: 'account-work', name: 'me@example.com', signedIn: true });
  expect(await hub.accessToken('work')).toBe('token');
  const stored = await readFile(join(home, 'hub', 'profiles.json'), 'utf8');
  await hub.close();
  const reloaded = new Hub(home);
  await reloaded.load();
  expect(reloaded.accountViews()).toEqual(hub.accountViews());
  expect(await readFile(join(home, 'hub', 'profiles.json'), 'utf8')).toBe(stored);
});

it('keeps legacy credentials readable when conversion persistence fails', async () => {
  home = await mkdtemp(join(tmpdir(), 'accio-accounts-migration-'));
  await mkdir(join(home, 'hub'));
  const path = join(home, 'hub', 'profiles.json');
  const legacy = JSON.stringify([{ id: 'work', accessKey: 'kept-key', account }]);
  await writeFile(path, legacy);
  vi.spyOn(JsonFile.prototype, 'write').mockRejectedValueOnce(new Error('disk full'));
  const failed = new Hub(home);
  await expect(failed.load()).rejects.toThrow('disk full');
  expect(failed.accountViews()).toEqual([]);
  expect(await readFile(path, 'utf8')).toBe(legacy);
  const retry = new Hub(home);
  await retry.load();
  expect(await retry.ensureProfile('work')).toBe('kept-key');
  expect(await retry.accessToken('work')).toBe('token');
});

it('turns single-account selections into ordered account lists, keeping each provider', async () => {
  home = await mkdtemp(join(tmpdir(), 'accio-accounts-migration-'));
  await mkdir(join(home, 'hub'));
  const openai = { credentialId: 'c', email: 'gpt@example.com', plan: null, models: [] };
  await writeFile(join(home, 'hub', 'profiles.json'), JSON.stringify({
    profiles: [{ id: 'work', accessKey: 'work-key', accountId: 'claude', openaiAccountId: 'gpt' }, { id: 'personal', accessKey: 'personal-key', accountId: null }],
    accounts: [{ id: 'claude', name: 'Claude', account }, { id: 'gpt', name: 'GPT', providerId: 'openai', account: null, openai }],
  }));
  const hub = new Hub(home);
  await hub.load();
  expect(hub.selectedAccounts('work', 'anthropic').map((a) => a.id)).toEqual(['claude']);
  expect(hub.selectedAccounts('work', 'openai').map((a) => a.id)).toEqual(['gpt']);
  expect(hub.selectedAccounts('personal', 'anthropic')).toEqual([]);
  expect(JSON.parse(await readFile(join(home, 'hub', 'profiles.json'), 'utf8')).profiles).toEqual([
    { id: 'work', accessKey: 'work-key', accountIds: ['claude', 'gpt'] },
    { id: 'personal', accessKey: 'personal-key', accountIds: [] },
  ]);
  await hub.close();
});
