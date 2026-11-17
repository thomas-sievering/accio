import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { SecretsVault } from './secrets.js';

const key = Buffer.alloc(32, 42).toString('base64');
// Written by the vault before its record encryption and sealing shared one cipher pair.
const savedRecord = { id: 'c272c6c6-cd2b-4d86-98e7-9298c8c83806', profileId: 'personal', name: 'Deploy token', slot: 'cloudflare.pages.deploy:docs',
  projectIds: ['p1'], profileWide: false, version: 1, updatedAt: '2026-11-17T09:32:10.495Z', lastUsedAt: null,
  ciphertext: 'lpjaRS5flZy+/CGYU9Xcrqg8mVK0ZY0=', nonce: 'a/PGGB09Cj57AXVd', tag: 'BUq/zwwOfeoFP0dW9W3TtA==' };
const sealedToken = { ciphertext: 'KX1DUx9zNBmQE6iPRi3cHsC83HJVGLiI', nonce: 'mmX7RlQTWGadT91r', tag: 'CDKdJMkUQhyT3xZirxDi+g==' };
const scope = { profileId: 'personal', projectId: 'p1', slot: 'cloudflare.pages.deploy:docs' };

let home: string | undefined;
afterEach(async () => { if (home) await rm(home, { recursive: true, force: true }); home = undefined; });

async function vaultWithSavedRecord() {
  home = await mkdtemp(join(tmpdir(), 'accio-vault-'));
  await mkdir(join(home, 'hub', 'secrets'), { recursive: true });
  await writeFile(join(home, 'hub', 'secrets', 'values.json'), JSON.stringify([savedRecord]));
  const vault = new SecretsVault(home, key);
  await vault.load();
  return vault;
}

it('decrypts a secret and unseals a value saved before the change', async () => {
  const vault = await vaultWithSavedRecord();
  expect((await vault.resolve(scope))?.value).toBe('saved-before-the-change');
  expect(await vault.unseal('sorting-hat-admin', sealedToken)).toBe('sealed-before-the-change');
  await expect(vault.unseal('another-purpose', sealedToken)).rejects.toThrow('could not be unlocked');
});

it('keeps an old secret’s value when only its metadata is edited', async () => {
  const vault = await vaultWithSavedRecord();
  await vault.save({ id: savedRecord.id, profileId: 'personal', name: 'Renamed', slot: savedRecord.slot, projectIds: ['p1'] });
  expect(await vault.resolve(scope)).toMatchObject({ metadata: { name: 'Renamed', version: 2 }, value: 'saved-before-the-change' });
  await vault.close();
});
