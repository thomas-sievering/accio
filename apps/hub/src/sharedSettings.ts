import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { JsonStore } from '@accio/persistence';
import { DEFAULT_THREAD_NAMING, type ThreadNamingSettings, type HarnessInstall, type MachineInfo, type OfflineSnooze, type SaveSpace, type Space } from '@accio/protocol';
import { HubError } from './errors.js';

export type { HarnessInstall };

/** A profile as the hub stores it; `houseId` links it to one of the Sorting Hat's houses. */
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

type FavoriteModel = { harnessId: string; modelId: string };
type Data = {
  profiles: SharedProfile[];
  machines: MachineRecord[];
  threadNaming?: ThreadNamingSettings;
  modelFavorites?: Record<string, FavoriteModel[]>;
  /** GLOSSARY: Built-in tools. Harness id → switch id → on, only where it differs from accio's default. */
  harnessTools?: Record<string, Record<string, boolean>>;
  /** GLOSSARY: Snooze. Thread id → snooze until its offline machine is back. */
  offlineSnoozes?: Record<string, OfflineSnooze>;
  /** GLOSSARY: Space. Not tied to profiles, so deleting a profile leaves them as they are (ADR 0019). */
  spaces?: Space[];
};

/** Far more than anyone snoozes; keeps one store from growing without bound. */
const MAX_OFFLINE_SNOOZES = 10_000;

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

  spaces(): Space[] { return structuredClone(this.data.spaces ?? []); }

  /**
   * GLOSSARY: Space. Adds a space, or replaces one whole. Every save keeps the rules: a name,
   * each project in at most one space, and a home among the space's own projects.
   * Removing the home's project from the space clears its home (GLOSSARY: Home).
   */
  async saveSpace(input: SaveSpace): Promise<Space> {
    return this.change(async () => {
      const spaces = this.data.spaces ?? [];
      const before = input.id === undefined ? undefined : spaces.find((s) => s.id === input.id);
      if (input.id !== undefined && !before) throw new HubError('This space no longer exists.');
      const name = input.name.trim();
      if (!name) throw new HubError('Enter a name for the space.');
      const projectKeys = [...new Set(input.projectKeys.map((key) => key.trim()))];
      for (const key of projectKeys) {
        const other = spaces.find((s) => s.id !== input.id && s.projectKeys.includes(key));
        if (other) throw new HubError(`${key} is already in the space ${other.name}. Remove it there first.`);
      }
      let home = input.homeProjectKey?.trim();
      // Keeping the home while removing its project means the project left: the space goes on without a home.
      if (home && !projectKeys.includes(home) && home === before?.homeProjectKey && before.projectKeys.includes(home)) home = undefined;
      if (home && !projectKeys.includes(home)) throw new HubError('The home must be one of the space’s projects.');
      const saved: Space = { id: before?.id ?? randomUUID(), name, projectKeys, ...(home ? { homeProjectKey: home } : {}) };
      await this.commit({ ...this.data, spaces: before ? spaces.map((s) => (s.id === saved.id ? saved : s)) : [...spaces, saved] });
      return structuredClone(saved);
    });
  }

  /** Deletes only the grouping: projects, checkouts and threads stay as they are. */
  async deleteSpace(id: string) {
    return this.change(async () => {
      const spaces = this.data.spaces ?? [];
      if (!spaces.some((s) => s.id === id)) throw new HubError('This space no longer exists.');
      await this.commit({ ...this.data, spaces: spaces.filter((s) => s.id !== id) });
    });
  }

  /** Connected clients observe the same machine registry and folder settings. */
  onMachinesChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async load() { await this.store.load(); }

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

  /** Snoozes still waiting: their machine is offline and the fallback has not passed. */
  offlineSnoozes(now = new Date()): Record<string, OfflineSnooze> {
    return Object.fromEntries(Object.entries(this.data.offlineSnoozes ?? {})
      .filter(([, s]) => !this.connected.has(s.machineId) && new Date(s.until) > now)
      .map(([id, s]) => [id, { ...s }]));
  }

  /** Snoozes another machine's thread until that machine is back, or wakes it with null. */
  async setOfflineSnooze(threadId: string, snooze: OfflineSnooze | null) {
    return this.change(async () => {
      const { [threadId]: _previous, ...others } = this.offlineSnoozes();
      if (snooze) {
        const machine = this.machine(snooze.machineId);
        if (!machine) throw new Error(`No machine ${snooze.machineId}`);
        if (this.connected.has(snooze.machineId)) throw new Error(`${machine.name} is online. Snooze the thread there.`);
        if (Object.keys(others).length >= MAX_OFFLINE_SNOOZES) throw new Error('Too many snoozed threads.');
      }
      await this.commit({ ...this.data, offlineSnoozes: snooze ? { ...others, [threadId]: { ...snooze } } : others });
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
      // Its threads snoozed until it was back wake now, on every machine.
      const offlineSnoozes = Object.fromEntries(Object.entries(this.data.offlineSnoozes ?? {}).filter(([, s]) => s.machineId !== hello.id));
      await this.commit({
        ...this.data,
        offlineSnoozes,
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
