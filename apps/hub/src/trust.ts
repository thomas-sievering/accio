import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { JsonFile, JsonStore } from '@accio/persistence';
import { HubError } from './errors.js';

type Device = { id: string; tokenHash: string; references: string[] };
type Data = { id: string; devices: Device[] };
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const pairingFile = (home: string) => new JsonFile(join(home, 'hub', 'pairing.json'), () => ({ hash: '', expiresAt: 0 }));

/** Constant-time comparison of two secrets. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Hub identity and device grants. Provider tokens are held by the Sorting Hat. */
export class HubTrust {
  private store: JsonStore<Data>;
  private pairing: ReturnType<typeof pairingFile>;
  constructor(home: string) {
    this.store = new JsonStore(join(home, 'hub', 'trust.json'), () => ({ id: randomUUID(), devices: [] }));
    this.pairing = pairingFile(home);
  }
  private get data() { return this.store.data; }
  get id() { return this.data.id; }
  get paired() { return this.data.devices.length > 0; }
  /** Writes the store back so a newly created hub id is durable, without the model keys hubs kept before the Sorting Hat. */
  async load() {
    const data = await this.store.file.read();
    await this.store.commit({ ...data, devices: data.devices.map(({ id, tokenHash, references }) => ({ id, tokenHash, references })) });
  }
  static async createCode(home: string) {
    const code = randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g)!.join('-');
    const expiresAt = Date.now() + 10 * 60_000;
    await pairingFile(home).write({ hash: digest(code.replaceAll('-', '')), expiresAt });
    return { code, expiresAt };
  }
  pair(code: string, id: string) {
    return this.change(async () => {
      const pending = await this.pairing.read();
      if (Date.now() >= pending.expiresAt || !safeEqual(pending.hash, digest(code.replace(/[-\s]/g, '').toUpperCase()))) throw new HubError('Pairing code is invalid or expired. Generate a new code on the hub.');
      const previous = this.data.devices.find((d) => d.id === id);
      const token = `accio-device-${randomBytes(32).toString('base64url')}`;
      await this.pairing.write({ hash: '', expiresAt: 0 });
      const devices = [...this.data.devices.filter((d) => d.id !== id), { id, tokenHash: digest(token), references: previous?.references ?? [] }];
      await this.save(devices);
      return { hubId: this.id, token };
    });
  }
  authenticate(token: string): string | undefined { return this.data.devices.find((d) => safeEqual(d.tokenHash, digest(token)))?.id; }
  references(machineId: string, profiles: string[]) { return this.change(() => this.save(this.data.devices.map((d) => d.id === machineId ? { ...d, references: [...new Set(profiles)] } : d))); }
  referenced(profileId: string) { return this.data.devices.some((d) => d.references.includes(profileId)); }
  revoke(machineId: string) { return this.change(() => this.save(this.data.devices.filter((d) => d.id !== machineId))); }
  private save(devices: Device[]) { return this.store.commit({ ...this.data, devices }); }
  private change<T>(fn: () => Promise<T>): Promise<T> { return this.store.change(fn); }
  async close() { await this.store.idle(); }
}
