import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonStore, privateDirectory, privateFile, privatePowerShell } from '@accio/persistence';
import type { SecretSummary } from '@accio/protocol';

/** A value encrypted with the vault's key. */
export type Sealed = { ciphertext: string; nonce: string; tag: string };
type StoredSecret = SecretSummary & Sealed;
export type SecretScope = { profileId: string; projectId: string | null; slot: string };
export type SecretsAccess = Pick<SecretsVault, 'status' | 'list' | 'inUse' | 'current' | 'save' | 'remove' | 'bind' | 'resolve' | 'used' | 'onChanged' | 'close'>;
export class SecretStoreError extends Error {}
const unavailable = 'Saved secrets are unavailable. Configure a 32-byte base64 ACCIO_SECRET_KEY on a headless Hub, or use Windows user-protected storage. You can still use a secret once.';

/** The Hub owns reusable values; machines receive only individually authorized deliveries. */
export class SecretsVault {
  private store: JsonStore<StoredSecret[]>;
  private key?: Promise<Buffer>;
  private listeners: ((id: string, profileId: string) => Promise<void> | void)[] = [];
  private directory: string;
  constructor(home: string, private suppliedKey = process.env.ACCIO_SECRET_KEY) {
    this.directory = join(home, 'hub', 'secrets');
    this.store = new JsonStore(join(this.directory, 'values.json'), () => []);
  }
  private get records() { return this.store.data; }
  async load() { await this.store.load(); }
  onChanged(listener: (id: string, profileId: string) => Promise<void> | void) { this.listeners.push(listener); }
  async status(): Promise<{ available: boolean; reason?: string }> {
    try { await this.masterKey(); return { available: true }; } catch { return { available: false, reason: unavailable }; }
  }
  list(profileId: string): SecretSummary[] { return this.records.filter(r => r.profileId === profileId).map(summary); }
  inUse(profileId: string) { return this.records.some(r => r.profileId === profileId); }
  async save(input: { id?: string; profileId: string; name: string; slot: string; projectIds: string[]; profileWide?: boolean; value?: string }): Promise<SecretSummary> {
    return this.change(async () => {
      const previous = input.id ? this.records.find(r => r.id === input.id && r.profileId === input.profileId) : undefined;
      if (input.id && !previous) throw new SecretStoreError('No such secret in this profile.');
      if (input.value === undefined && !previous) throw new SecretStoreError('Enter a value for the new secret.');
      if (input.value !== undefined) checkValue(input.value);
      const key = await this.masterKey();
      const projectIds = [...new Set(input.projectIds)]; const profileWide = input.profileWide ?? false;
      this.assertUnique(input.profileId, input.slot, projectIds, profileWide, previous?.id);
      const id = previous?.id ?? randomUUID(); const version = (previous?.version ?? 0) + 1;
      const value = input.value ?? this.decrypt(previous!, key);
      const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(`${id}\0${input.profileId}\0${version}`));
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64');
      const record: StoredSecret = { id, profileId: input.profileId, name: input.name, slot: input.slot, projectIds, profileWide,
        version, updatedAt: new Date().toISOString(), lastUsedAt: previous?.lastUsedAt ?? null,
        ciphertext, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
      await this.commit([...this.records.filter(r => r.id !== id), record]);
      await this.announce(record);
      return summary(record);
    });
  }
  async remove(id: string) {
    return this.change(async () => {
      const record = this.records.find(r => r.id === id);
      if (!record) throw new SecretStoreError('No such secret.');
      await this.commit(this.records.filter(r => r.id !== id)); await this.announce(record);
    });
  }
  /** A user selection, never an agent-selected widening of project access. */
  async bind(id: string, scope: SecretScope) {
    return this.change(async () => {
      const record = this.records.find(r => r.id === id && r.profileId === scope.profileId && r.slot === scope.slot);
      if (!record || !scope.projectId) throw new SecretStoreError('This secret cannot be assigned to this project.');
      const projectIds = [...new Set([...record.projectIds, scope.projectId])];
      this.assertUnique(record.profileId, record.slot, projectIds, record.profileWide, id);
      const updated = { ...record, projectIds };
      await this.commit(this.records.map(r => r.id === id ? updated : r)); await this.announce(updated);
    });
  }
  async resolve(scope: SecretScope): Promise<{ metadata: SecretSummary; value: string } | null> {
    await this.store.idle();
    const matches = this.records.filter(r => allowed(r, scope));
    if (matches.length !== 1) return null;
    const record = matches[0]!; const value = this.decrypt(record, await this.masterKey());
    if (!this.current(record.id, record.version, scope)) throw new SecretStoreError('The saved secret changed. Try again.');
    return { metadata: summary(record), value };
  }
  current(id: string, version: number, scope: SecretScope) { return this.records.some(r => r.id === id && r.version === version && allowed(r, scope)); }
  async used(id: string, version: number, scope: SecretScope) {
    return this.change(async () => {
      if (!this.current(id, version, scope)) throw new SecretStoreError('The saved secret changed. Try again.');
      await this.commit(this.records.map(r => r.id === id ? { ...r, lastUsedAt: new Date().toISOString() } : r));
      await this.announce(this.records.find(r => r.id === id)!);
    });
  }
  async close() { await this.store.idle(); }
  /** Encrypts a hub-only value, such as the Sorting Hat's admin token, with the vault's key; `purpose` binds it to one use. */
  async seal(purpose: string, value: string): Promise<Sealed> {
    const key = await this.masterKey();
    const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(`sealed\0${purpose}`));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64');
    return { ciphertext, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  }
  async unseal(purpose: string, sealed: Sealed): Promise<string> {
    const key = await this.masterKey();
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.nonce, 'base64'));
      decipher.setAAD(Buffer.from(`sealed\0${purpose}`));
      decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch { throw new SecretStoreError('A saved hub credential could not be unlocked. Check the Hub key.'); }
  }
  private assertUnique(profileId: string, slot: string, projectIds: string[], profileWide: boolean, except?: string) {
    if (this.records.some(r => r.id !== except && r.profileId === profileId && r.slot === slot &&
      (r.profileWide || profileWide || r.projectIds.some(id => projectIds.includes(id))))) {
      throw new SecretStoreError('A secret is already assigned to this purpose in one of these projects. Edit that secret instead.');
    }
  }
  private decrypt(record: StoredSecret, key: Buffer) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.nonce, 'base64'));
      decipher.setAAD(Buffer.from(`${record.id}\0${record.profileId}\0${record.version}`));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    } catch { throw new SecretStoreError('The saved secret could not be unlocked. Check the Hub key or replace the value.'); }
  }
  private masterKey(): Promise<Buffer> {
    if (!this.key) this.key = this.loadKey().catch(() => { this.key = undefined; throw new SecretStoreError(unavailable); });
    return this.key;
  }
  private async loadKey() {
    if (this.suppliedKey) {
      if (!/^[A-Za-z0-9+/]{43}=$/.test(this.suppliedKey)) throw new Error('Invalid key');
      const key = Buffer.from(this.suppliedKey, 'base64'); if (key.length !== 32) throw new Error('Invalid key');
      await privateDirectory(this.directory); return key;
    }
    if (process.platform !== 'win32') throw new Error('No key');
    await privateDirectory(this.directory);
    const path = join(this.directory, 'key.dpapi');
    const protect = `Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::`;
    let stored: Buffer;
    try {
      const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unsafe key');
      stored = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || this.records.length) throw error;
      const key = randomBytes(32);
      const encrypted = await privatePowerShell(`${protect}Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`, key.toString('base64'));
      try { await privateFile(path, Buffer.from(encrypted, 'base64')); return key; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; stored = await readFile(path); }
    }
    const key = Buffer.from(await privatePowerShell(`${protect}Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))`, stored.toString('base64')), 'base64');
    if (key.length !== 32) throw new Error('Invalid key'); return key;
  }
  private change<T>(fn: () => Promise<T>): Promise<T> { return this.store.change(fn); }
  private commit(records: StoredSecret[]) { return this.store.commit(records); }
  private async announce(record: SecretSummary) { for (const listener of this.listeners) await listener(record.id, record.profileId); }
}

function summary({ ciphertext: _ciphertext, nonce: _nonce, tag: _tag, ...metadata }: StoredSecret): SecretSummary {
  return { ...metadata, projectIds: [...metadata.projectIds] };
}
/** Whether a secret may be delivered for this scope. */
export function allowed(record: SecretSummary, scope: SecretScope) {
  return record.profileId === scope.profileId && record.slot === scope.slot && (record.profileWide || (scope.projectId !== null && record.projectIds.includes(scope.projectId)));
}
export function checkValue(value: string) {
  if (!value.length || Buffer.byteLength(value, 'utf8') > 16384 || /[\r\n\0]/.test(value)) throw new SecretStoreError('Enter a single-line token of at most 16 KiB.');
}
