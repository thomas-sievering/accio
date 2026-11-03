import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { SecretFile } from './store.js';

/** A profile as the hub stores it. Its accounts are in the hub's secret store (hub.ts). */
export type SharedProfile = { id: string; name: string };

export type HarnessInstall = { harnessId: string; version: string | null };

/** What a machine tells the hub about itself when it connects. */
export type MachineHello = { id: string; name: string; platform: string; version: string; harnesses: HarnessInstall[] };

/** GLOSSARY: Machine, as the hub records it, with the settings that apply to it alone. */
export type MachineRecord = MachineHello & {
  lastSeen: string;
  /** Profile id → this machine's profile folders. */
  profileFolders: Record<string, string[]>;
};

/** What a store seeds itself with when it does not exist yet. */
export type SharedSeed = { profiles: SharedProfile[]; machines: MachineRecord[] };

type Data = SharedSeed;

/** GLOSSARY: Provider. The ones accio knows; only Anthropic can be signed in to so far. */
export const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', accountName: 'Claude account', available: true },
  { id: 'openai', name: 'OpenAI', accountName: 'ChatGPT account', available: false },
] as const;

/** GLOSSARY: Harness. The ones accio knows and the providers each can use. */
export const HARNESSES = [{ id: 'claudeCode', name: 'Claude Code', providers: ['anthropic'] }] as const;

/**
 * GLOSSARY: Shared settings (ADR 0004). Profiles, the paired machines and the
 * settings that apply to one machine only. Plain storage: the rules about
 * profiles still live in accio's server in v0.1.
 */
export class SharedSettings {
  private file: SecretFile<Data>;
  private data: Data = { profiles: [], machines: [] };
  private connected = new Set<string>();
  private listeners = new Set<() => void>();

  constructor(home: string) {
    this.file = new SecretFile(join(home, 'hub', 'settings.json'), () => ({ profiles: [], machines: [] }));
  }

  get storePath(): string {
    return this.file.path;
  }

  /** Connected clients observe the same machine registry and folder settings. */
  onMachinesChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** `seed` runs only on the first start, when there is no store yet. */
  async load(seed?: () => Promise<SharedSeed>) {
    const found = await access(this.file.path).then(
      () => true,
      () => false,
    );
    if (found) {
      this.data = await this.file.read();
    } else if (seed) {
      await this.commit(await seed());
    }
  }

  profiles(): readonly SharedProfile[] {
    return this.data.profiles;
  }

  async setProfiles(profiles: SharedProfile[]) {
    const ids = new Set(profiles.map((p) => p.id));
    // A deleted profile's folders go with it, on every machine.
    const machines = this.data.machines.map((m) => ({
      ...m,
      profileFolders: Object.fromEntries(Object.entries(m.profileFolders).filter(([id]) => ids.has(id))),
    }));
    await this.commit({ profiles, machines });
  }

  machines(): (MachineRecord & { connected: boolean })[] {
    return this.data.machines.map((m) => ({ ...m, connected: this.connected.has(m.id) }));
  }

  machine(id: string): MachineRecord | undefined {
    return this.data.machines.find((m) => m.id === id);
  }

  /** Records the machine (pairing is not built yet, so any machine that connects is known) and marks it connected. */
  async machineConnected(hello: MachineHello) {
    this.connected.add(hello.id);
    const existing = this.machine(hello.id);
    const record: MachineRecord = { profileFolders: {}, ...existing, ...hello, lastSeen: new Date().toISOString() };
    await this.commit({
      ...this.data,
      machines: existing ? this.data.machines.map((m) => (m.id === hello.id ? record : m)) : [...this.data.machines, record],
    });
  }

  async machineDisconnected(id: string) {
    this.connected.delete(id);
    if (this.machine(id)) await this.updateMachine(id, (m) => ({ ...m, lastSeen: new Date().toISOString() }));
  }

  async setProfileFolders(machineId: string, profileId: string, folders: string[]) {
    await this.updateMachine(machineId, (m) => ({ ...m, profileFolders: { ...m.profileFolders, [profileId]: [...new Set(folders)] } }));
  }

  close(): Promise<void> {
    return this.file.idle();
  }

  private async updateMachine(id: string, fn: (m: MachineRecord) => MachineRecord) {
    await this.commit({ ...this.data, machines: this.data.machines.map((m) => (m.id === id ? fn(m) : m)) });
  }

  private async commit(next: Data) {
    this.data = next;
    await this.file.write(next);
    for (const listener of this.listeners) listener();
  }
}
