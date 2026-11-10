import { join } from 'node:path';
import { JsonStore } from '@accio/persistence';
import { DEFAULT_THREAD_NAMING, type ThreadNamingSettings, type HarnessInstall, type MachineInfo } from '@accio/protocol';

export type { HarnessInstall };

/**
 * A profile as the hub stores it. With a Sorting Hat of its own, `houseId` links
 * it to one of its houses; otherwise its accounts are kept by the embedded
 * Sorting Hat's house of the same id.
 */
export type SharedProfile = { id: string; name: string; houseId?: string };

/** What a machine tells the hub about itself when it connects. */
export type MachineHello = MachineInfo & { harnesses: HarnessInstall[]; githubAccounts?: string[] };

/** GLOSSARY: Machine, as the hub records it, with the settings that apply to it alone. */
export type MachineRecord = MachineHello & {
  /** A name chosen on the hub, preserved when the machine reports its hostname. */
  customName?: string;
  lastSeen: string;
  /** Profile id → this machine's profile folders. */
  profileFolders: Record<string, string[]>;
  /** Profile id → the GitHub login this machine uses for it (GLOSSARY: GitHub account). */
  profileGitHub?: Record<string, string>;
};

/** What a store seeds itself with when it does not exist yet. */
export type SharedSeed = { profiles: SharedProfile[]; machines: MachineRecord[] };

type FavoriteModel = { harnessId: string; modelId: string };
type Data = SharedSeed & {
  threadNaming?: ThreadNamingSettings;
  modelFavorites?: Record<string, FavoriteModel[]>;
  /** GLOSSARY: Built-in tools. Harness id → switch id → on, only where it differs from accio's default. */
  harnessTools?: Record<string, Record<string, boolean>>;
};

/** GLOSSARY: Provider. Both Anthropic and OpenAI support named account sign-in. */
export const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', accountName: 'Claude account', available: true },
  { id: 'openai', name: 'OpenAI', accountName: 'ChatGPT account', available: true },
] as const;

/** GLOSSARY: Harness. The ones accio knows and the providers each can use. */
export const HARNESSES = [{ id: 'claudeCode', name: 'Claude Code', providers: ['anthropic'] }, { id: 'codex', name: 'Codex', providers: ['openai'] }] as const;

/**
 * GLOSSARY: Shared settings (ADR 0004). Profiles, the paired machines and the
 * settings that apply to one machine only.
 */
export class SharedSettings {
  private store: JsonStore<Data>;
  private connected = new Set<string>();
  private listeners = new Set<() => void>();

  constructor(home: string) {
    this.store = new JsonStore(join(home, 'hub', 'settings.json'), () => ({ profiles: [], machines: [] }));
  }

  private get data() { return this.store.data; }

  threadNaming(): ThreadNamingSettings { return structuredClone(this.data.threadNaming ?? DEFAULT_THREAD_NAMING); }

  async setThreadNaming(threadNaming: ThreadNamingSettings) {
    await this.change(() => this.commit({ ...this.data, threadNaming }));
  }

  /** Connected clients observe the same machine registry and folder settings. */
  onMachinesChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** `seed` runs only on the first start, when there is no store yet. */
  async load(seed?: () => Promise<SharedSeed>) {
    if (await this.store.file.exists()) {
      await this.store.load();
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
        ...(m.profileGitHub ? { profileGitHub: Object.fromEntries(Object.entries(m.profileGitHub).filter(([id]) => ids.has(id))) } : {}),
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

  harnessTools(): Record<string, Record<string, boolean>> {
    return Object.fromEntries(Object.entries(this.data.harnessTools ?? {}).map(([id, tools]) => [id, { ...tools }]));
  }

  /** Replaces one harness's overrides; the machine checks them against its catalogue first. */
  async setHarnessTools(harnessId: string, tools: Record<string, boolean>) {
    return this.change(async () => {
      if (!HARNESSES.some((h) => h.id === harnessId)) throw new Error(`No harness ${harnessId}`);
      await this.commit({ ...this.data, harnessTools: { ...this.data.harnessTools, [harnessId]: { ...tools } } });
    });
  }

  machines(): (MachineRecord & { connected: boolean })[] {
    return this.data.machines.map((m) => ({ ...m, connected: this.connected.has(m.id) }));
  }

  machine(id: string): MachineRecord | undefined {
    return this.data.machines.find((m) => m.id === id);
  }

  /** Records a machine admitted by the hub's connection handler and marks it connected. */
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

  /** Null returns the profile to the account git uses for each repository. */
  async setProfileGitHub(machineId: string, profileId: string, login: string | null) {
    await this.updateMachine(machineId, (m) => {
      this.requireProfile(profileId);
      const { [profileId]: _previous, ...others } = m.profileGitHub ?? {};
      return { ...m, profileGitHub: login ? { ...others, [profileId]: login } : others };
    });
  }

  async renameMachine(machineId: string, name: string) {
    await this.updateMachine(machineId, (m) => ({ ...m, name, customName: name }));
  }

  async close(): Promise<void> {
    await this.store.idle();
  }

  private async updateMachine(id: string, fn: (m: MachineRecord) => MachineRecord) {
    return this.change(async () => {
      await this.commit({ ...this.data, machines: this.data.machines.map((m) => (m.id === id ? fn(m) : m)) });
    });
  }

  private change<T>(run: () => Promise<T>): Promise<T> {
    return this.store.change(run);
  }

  private requireProfile(id: string) {
    if (!this.data.profiles.some((p) => p.id === id)) throw new Error(`No profile ${id}`);
  }

  private async commit(next: Data, afterWrite: () => void = () => {}) {
    await this.store.commit(next);
    afterWrite();
    for (const listener of this.listeners) listener();
  }
}
