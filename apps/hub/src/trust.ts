import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { JsonFile, JsonStore } from '@accio/persistence';
import { HubError } from './errors.js';

type Machine = { kind: 'machine'; id: string; tokenHash: string; references: string[] };
type Client = { kind: 'client'; id: string; tokenHash: string; name: string; expiresAt: number };
type DeviceKind = Machine['kind'] | Client['kind'];
type Data = { id: string; devices: Machine[]; clients?: Client[] };
export const CLIENT_TTL_MS = 30 * 24 * 60 * 60_000;
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const pairingFile = (home: string, kind: DeviceKind) => new JsonFile(join(home, 'hub', kind === 'machine' ? 'pairing.json' : 'client-pairing.json'), () => ({ hash: '', expiresAt: 0 }));

/** Constant-time comparison of two secrets. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Hub identity and device grants. Provider tokens are held by the Sorting Hat. */
export class HubTrust {
  private store: JsonStore<Data>;
  constructor(private home: string) {
    this.store = new JsonStore(join(home, 'hub', 'trust.json'), () => ({ id: randomUUID(), devices: [] }));
  }
  private get data() { return this.store.data; }
  get id() { return this.data.id; }
  private get browserClients() { return this.data.clients ?? []; }
  get paired() { return this.data.devices.length > 0; }
  /** Writes the store back so a newly created hub id is durable, without the model keys hubs kept before the Sorting Hat. */
  async load() {
    const data = await this.store.file.read();
    await this.store.commit({ ...data, devices: data.devices.map(({ id, tokenHash, references }) => ({ kind: 'machine', id, tokenHash, references })) });
  }
  static async createCode(home: string, kind: DeviceKind = 'machine') {
    const code = randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g)!.join('-');
    const expiresAt = Date.now() + 10 * 60_000;
    await pairingFile(home, kind).write({ hash: digest(code.replaceAll('-', '')), expiresAt });
    return { code, expiresAt };
  }
  createClientCode() { return this.change(() => HubTrust.createCode(this.home, 'client')); }
  private async consume(code: string, kind: DeviceKind) {
    const file = pairingFile(this.home, kind);
    const pending = await file.read();
    if (Date.now() >= pending.expiresAt || !safeEqual(pending.hash, digest(code.replace(/[-\s]/g, '').toUpperCase()))) throw new HubError('Pairing code is invalid or expired. Generate a new code on the hub.');
    await file.write({ hash: '', expiresAt: 0 });
  }
  pair(code: string, id: string) {
    return this.change(async () => {
      await this.consume(code, 'machine');
      const previous = this.data.devices.find((d) => d.id === id);
      const token = `accio-device-${randomBytes(32).toString('base64url')}`;
      await this.save([...this.data.devices.filter((d) => d.id !== id), { kind: 'machine', id, tokenHash: digest(token), references: previous?.references ?? [] }]);
      return { hubId: this.id, token };
    });
  }
  pairClient(code: string, name: string) {
    return this.change(async () => {
      await this.consume(code, 'client');
      const token = randomBytes(32).toString('base64url');
      await this.saveClients([...this.browserClients, { kind: 'client', id: randomUUID(), tokenHash: digest(token), name, expiresAt: Date.now() + CLIENT_TTL_MS }]);
      return token;
    });
  }
  authenticate(token: string): string | undefined {
    const hash = digest(token);
    return this.data.devices.find((d) => safeEqual(d.tokenHash, hash))?.id;
  }
  authenticateClient(token: string) {
    const hash = digest(token);
    return this.browserClients.find((d) => d.expiresAt > Date.now() && safeEqual(d.tokenHash, hash));
  }
  useClient(token: string) {
    return this.change(async () => {
      const client = this.authenticateClient(token);
      if (!client) return undefined;
      await this.saveClients(this.browserClients.map((d) => d === client ? { ...client, expiresAt: Date.now() + CLIENT_TTL_MS } : d));
      return client.id;
    });
  }
  clients() {
    return this.browserClients.flatMap((d) => d.expiresAt > Date.now() ? [{ id: d.id, name: d.name }] : []);
  }
  references(machineId: string, profiles: string[]) { return this.change(() => this.save(this.data.devices.map((d) => d.id === machineId ? { ...d, references: [...new Set(profiles)] } : d))); }
  referenced(profileId: string) { return this.data.devices.some((d) => d.references.includes(profileId)); }
  revoke(machineId: string) { return this.change(() => this.save(this.data.devices.filter((d) => d.id !== machineId))); }
  revokeClient(id: string, by?: string) {
    return this.change(async () => {
      if (by && !this.clients().some((client) => client.id === by)) throw new HubError('Pairing has been revoked.');
      await this.saveClients(this.browserClients.filter((d) => d.id !== id));
    });
  }
  expireClients() {
    return this.change(async () => {
      const now = Date.now();
      const active = this.browserClients.filter((client) => client.expiresAt > now);
      if (active.length === this.browserClients.length) return false;
      await this.saveClients(active);
      return true;
    });
  }
  private save(devices: Machine[]) { return this.store.commit({ ...this.data, devices }); }
  private saveClients(clients: Client[]) { return this.store.commit({ ...this.data, clients }); }
  private change<T>(fn: () => Promise<T>): Promise<T> { return this.store.change(fn); }
  async close() { await this.store.idle(); }
}
