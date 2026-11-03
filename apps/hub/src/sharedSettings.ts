import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';

/** A profile as the hub stores it. Its accounts are in the hub's secret store (hub.ts). */
export type SharedProfile = { id: string; name: string };

export type HarnessInstall = { harnessId: string; version: string | null };

/** What a machine tells the hub about itself when it connects. */
export type MachineHello = { id: string; name: string; platform: string; version: string; harnesses: HarnessInstall[] };

/** GLOSSARY: Machine, as the hub records it, with the settings that apply to it alone. */
export type MachineRecord = MachineHello & {
  /** A name chosen on the hub, preserved when the machine reports its hostname. */
  customName?: string;
  lastSeen: string;
  /** Profile id → this machine's profile folders. */
  profileFolders: Record<string, string[]>;
};

/** What a store seeds itself with when it does not exist yet. */
export type SharedSeed = { profiles: SharedProfile[]; machines: MachineRecord[] };

type FavoriteModel = { harnessId: string; modelId: string };
/** GLOSSARY: Preset. What one level was set to in settings. */
export type PresetChoice = { modelId: string; effort?: string };
type Data = SharedSeed & {
  modelFavorites?: Record<string, FavoriteModel[]>;
  /** Harness id → level → choice. Levels left out use accio's defaults. */
  presets?: Record<string, Record<string, PresetChoice>>;
};

/** GLOSSARY: Provider. The ones accio knows; only Anthropic can be signed in to so far. */
export const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', accountName: 'Claude account', available: true },
  { id: 'openai', name: 'OpenAI', accountName: 'ChatGPT account', available: true },
] as const;

/** GLOSSARY: Harness. The ones accio knows and the providers each can use. */
export const HARNESSES = [{ id: 'claudeCode', name: 'Claude Code', providers: ['anthropic'] }, { id: 'codex', name: 'Codex', providers: ['openai'] }] as const;

/**
 * GLOSSARY: Shared settings (ADR 0004). Profiles, the paired machines and the
 * settings that apply to one machine only. Plain storage: the rules about
 * profiles still live in accio's server in v0.1.
 */
export class SharedSettings {
  private queue: Promise<unknown> = Promise.resolve();
  private file: JsonFile<Data>;
  private data: Data = { profiles: [], machines: [] };
  private connected = new Set<string>();
  private listeners = new Set<() => void>();

  constructor(home: string) {
    this.file = new JsonFile(join(home, 'hub', 'settings.json'), () => ({ profiles: [], machines: [] }));
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
    return this.change(async () => {
      const ids = new Set(profiles.map((p) => p.id));
      // A deleted profile's folders go with it, on every machine.
      const machines = this.data.machines.map((m) => ({
        ...m,
        profileFolders: Object.fromEntries(Object.entries(m.profileFolders).filter(([id]) => ids.has(id))),
      }));
      const modelFavorites = Object.fromEntries(Object.entries(this.data.modelFavorites ?? {}).filter(([id]) => ids.has(id)));
      await this.commit({ ...this.data, profiles, machines, modelFavorites });
    });
  }

  modelFavorites(profileId: string): FavoriteModel[] {
    return (this.data.modelFavorites?.[profileId] ?? []).map((m) => ({ ...m }));
  }

  async setModelFavorite(profileId: string, model: FavoriteModel, favorite: boolean) {
    return this.change(async () => {
      this.requireProfile(profileId);
      const remaining = this.modelFavorites(profileId).filter((m) => m.harnessId !== model.harnessId || m.modelId !== model.modelId);
      await this.commit({
        ...this.data,
        modelFavorites: { ...this.data.modelFavorites, [profileId]: favorite ? [...remaining, model] : remaining },
      });
    });
  }

  /** The levels set for a harness; the rest use accio's defaults. */
  presets(harnessId: string): Record<string, PresetChoice> {
    return { ...this.data.presets?.[harnessId] };
  }

  async setPreset(harnessId: string, level: string, choice: PresetChoice | null) {
    return this.change(async () => {
      const { [level]: _, ...rest } = this.presets(harnessId);
      await this.commit({ ...this.data, presets: { ...this.data.presets, [harnessId]: choice ? { ...rest, [level]: { ...choice } } : rest } });
    });
  }

  machines(): (MachineRecord & { connected: boolean })[] {
    return this.data.machines.map((m) => ({ ...m, connected: this.connected.has(m.id) }));
  }

  machine(id: string): MachineRecord | undefined {
    return this.data.machines.find((m) => m.id === id);
  }

  /** Records the machine (pairing is not built yet, so any machine that connects is known) and marks it connected. */
  async machineConnected(hello: MachineHello) {
    return this.change(async () => {
      const existing = this.machine(hello.id);
      const record: MachineRecord = { profileFolders: {}, ...existing, ...hello, name: existing?.customName ?? hello.name, lastSeen: new Date().toISOString() };
      await this.commit({
        ...this.data,
        machines: existing ? this.data.machines.map((m) => (m.id === hello.id ? record : m)) : [...this.data.machines, record],
      }, () => this.connected.add(hello.id));
    });
  }

  async machineDisconnected(id: string) {
    return this.change(async () => {
      if (!this.machine(id)) { this.connected.delete(id); return; }
      await this.commit({ ...this.data, machines: this.data.machines.map((m) => m.id === id ? { ...m, lastSeen: new Date().toISOString() } : m) }, () => this.connected.delete(id));
    });
  }

  async setProfileFolders(machineId: string, profileId: string, folders: string[]) {
    await this.updateMachine(machineId, (m) => {
      this.requireProfile(profileId);
      return { ...m, profileFolders: { ...m.profileFolders, [profileId]: [...new Set(folders)] } };
    });
  }

  async renameMachine(machineId: string, name: string) {
    await this.updateMachine(machineId, (m) => ({ ...m, name, customName: name }));
  }

  async close(): Promise<void> {
    await this.queue.catch(() => {});
    await this.file.idle();
  }

  private async updateMachine(id: string, fn: (m: MachineRecord) => MachineRecord) {
    return this.change(async () => {
      await this.commit({ ...this.data, machines: this.data.machines.map((m) => (m.id === id ? fn(m) : m)) });
    });
  }

  private change<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  private requireProfile(id: string) {
    if (!this.data.profiles.some((p) => p.id === id)) throw new Error(`No profile ${id}`);
  }

  private async commit(next: Data, afterWrite: () => void = () => {}) {
    await this.file.write(next);
    this.data = next;
    afterWrite();
    for (const listener of this.listeners) listener();
  }
}
