import { join } from 'node:path';
import { JsonStore } from '@accio/persistence';
import type { AccountLimitsView, AccountView, ProviderId, SortingHatView } from '@accio/protocol';
import type { CodexModel } from '@accio/sorting-hat';
import { HubError } from './errors.js';
import { SecretStoreError, type Sealed, type SecretsVault } from './secrets.js';
import { SortingHatClient, SortingHatError, sortingHatAddress, type RemoteHouse } from './sortingHatClient.js';

/** A hat key the hub made for one machine and profile; its secret is sealed with the vault's key. */
type StoredKey = { id: string; machineId: string; profileId: string; houseId: string; secret: Sealed };
type Data = {
  url: string | null;
  hubName: string;
  token: Sealed | null;
  keys: StoredKey[];
  /** Hat keys to delete on the Sorting Hat, kept until it confirms, such as after unpairing while it was unreachable. */
  deleting: string[];
};
type Cache = { houses: RemoteHouse[]; accounts: AccountView[]; limits: AccountLimitsView[]; models: Record<string, CodexModel[]> };

const TOKEN = 'sorting-hat-admin-token';
const keyPurpose = (id: string) => `sorting-hat-hat-key\0${id}`;
const POLL_MS = 15_000;
/** How long a hat key counts as still live on the Sorting Hat before a turn asks again. */
const VERIFY_MS = 60_000;
const empty = (): Cache => ({ houses: [], accounts: [], limits: [], models: {} });

/**
 * GLOSSARY: Sorting Hat (ADR 0018). The hub's link to a Sorting Hat of its own:
 * its address and admin token, which stay on the hub; a copy of its houses,
 * accounts, limits and models, read again every few seconds; and the hat keys
 * the hub made for each machine and profile, reused until that machine is
 * unpaired or the profile links to another house.
 */
export class SortingHatLink {
  private store: JsonStore<Data>;
  private client?: SortingHatClient;
  private cache = empty();
  private problem: string | null = null;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;
  private verified = new Map<string, number>();
  private polling?: Promise<void>;

  constructor(home: string, private vault: SecretsVault, private linkedHouses: () => string[], private fetchImpl?: typeof fetch) {
    this.store = new JsonStore(join(home, 'hub', 'sorting-hat-link.json'), () => ({ url: null, hubName: '', token: null, keys: [], deleting: [] }));
  }
  private get data() { return this.store.data; }

  async load() {
    await this.store.load();
    if (!this.data.url || !this.data.token) return;
    try { this.client = new SortingHatClient(this.data.url, await this.vault.unseal(TOKEN, this.data.token), this.fetchImpl); }
    catch (error) { this.problem = (error as Error).message; return; }
    await this.poll();
    this.start();
  }

  /** Configured: threads run through the Sorting Hat. Not configured: the hub's embedded one. */
  get configured() { return !!this.data.url; }
  get url() { return this.data.url ?? undefined; }

  onChanged(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  view(): SortingHatView | undefined {
    if (!this.data.url) return undefined;
    return { url: this.data.url, hubName: this.data.hubName, houses: this.cache.houses.map(({ id, name }) => ({ id, name })), problem: this.problem };
  }

  /** Links this hub to a Sorting Hat, checking the address and token first. A new address forgets the keys made on the old one. */
  configure(input: { url: string; adminToken?: string; hubName: string }) {
    return this.store.change(async () => {
      const url = sortingHatAddress(input.url);
      const same = url === this.data.url && !!this.data.token;
      const token = input.adminToken ?? (same ? await this.vault.unseal(TOKEN, this.data.token!) : undefined);
      if (!token) throw new HubError('Paste the admin token from the Sorting Hat’s dashboard.');
      const client = new SortingHatClient(url, token, this.fetchImpl);
      await client.houses();
      let sealed: Sealed;
      try { sealed = await this.vault.seal(TOKEN, token); }
      catch (error) { throw error instanceof SecretStoreError ? new HubError('The hub can’t store the admin token: its saved-secret storage is unavailable. Configure ACCIO_SECRET_KEY on a headless hub.') : error; }
      if (!same) await this.forgetAll();
      await this.store.commit({ ...this.data, url, hubName: input.hubName.trim(), token: sealed, ...(same ? {} : { keys: [], deleting: [] }) });
      if (!same) this.cache = empty();
      this.client = client; this.problem = null;
      this.start();
    }).then(() => this.poll()).then(() => { this.changed(); return this.view()!; });
  }

  /** Back to the embedded Sorting Hat. The keys made on this one are deleted there while it answers. */
  disconnect() {
    return this.store.change(async () => {
      await this.forgetAll();
      await this.store.commit({ url: null, hubName: '', token: null, keys: [], deleting: [] });
      this.client = undefined; this.cache = empty(); this.problem = null;
      clearInterval(this.timer); this.timer = undefined;
    }).then(() => this.changed());
  }

  // Read views, from the copy last read.
  house(id: string) { return this.cache.houses.find((h) => h.id === id); }
  accountViews() { return this.cache.accounts; }
  selectedAccounts(houseId: string, providerId: ProviderId): AccountView[] {
    return (this.house(houseId)?.accounts[providerId] ?? []).flatMap((id) => this.cache.accounts.filter((a) => a.id === id));
  }
  accountIdInUse(houseId: string, providerId: ProviderId) { return this.house(houseId)?.inUse[providerId] ?? null; }
  codexModels(houseId: string) { return this.cache.models[houseId] ?? []; }
  limitViews() { return this.cache.limits; }

  async refreshLimits(accountIds?: string[], force = false) {
    const limits = await this.require().refreshLimits(accountIds, force);
    this.cache = { ...this.cache, limits }; this.changed();
    return limits;
  }

  /** Sets a house's accounts on the Sorting Hat, for every app that uses it. */
  async setHouseAccounts(houseId: string, selection: Partial<Record<ProviderId, string[]>>) {
    const house = await this.require().setHouseAccounts(houseId, selection);
    this.cache = { ...this.cache, houses: this.cache.houses.map((h) => h.id === house.id ? house : h) }; this.changed();
  }

  /**
   * GLOSSARY: Hat key. The secret of this machine's key for the profile's house,
   * made on first use and reused across restarts. A key deleted or revoked on the
   * dashboard, or for another house, is replaced.
   */
  hatKey(machine: { id: string; name: string }, profile: { id: string; name: string }, houseId: string): Promise<string> {
    return this.store.change(async () => {
      const client = this.require();
      const name = `Accio · ${this.data.hubName} · ${profile.name} · ${machine.name}`.slice(0, 200);
      const existing = this.data.keys.find((k) => k.machineId === machine.id && k.profileId === profile.id);
      if (existing?.houseId === houseId) {
        const secret = await this.vault.unseal(keyPurpose(existing.id), existing.secret);
        if (Date.now() - (this.verified.get(existing.id) ?? 0) < VERIFY_MS) return secret;
        const live = await client.hatKey(existing.id).catch((error) => {
          // While the Sorting Hat can't say, the key stays: the turn then fails there in its own words.
          if (error instanceof SortingHatError && error.status === 404) return null;
          return undefined;
        });
        if (live === undefined) return secret;
        if (live && !live.revokedAt) {
          if (live.name !== name) await client.renameHatKey(live.id, name).catch(() => {});
          this.verified.set(existing.id, Date.now());
          return secret;
        }
      }
      const created = await client.createHatKey(houseId, name);
      const secret = await this.vault.seal(keyPurpose(created.id), created.secret);
      await this.store.commit({
        ...this.data,
        keys: [...this.data.keys.filter((k) => k !== existing), { id: created.id, machineId: machine.id, profileId: profile.id, houseId, secret }],
        deleting: existing ? [...this.data.deleting, existing.id] : this.data.deleting,
      });
      this.verified.set(created.id, Date.now());
      return created.secret;
    }).finally(() => { if (this.data.deleting.length) void this.flushDeletes(); });
  }

  /** Unpairing: the machine's hat keys are deleted on the Sorting Hat, now or as soon as it answers. */
  forgetMachine(machineId: string) { return this.forget((k) => k.machineId === machineId); }
  /** A deleted profile's keys go; its house stays, since other apps may use it. */
  forgetProfile(profileId: string) { return this.forget((k) => k.profileId === profileId); }

  /** Profiles whose link moved to another house keep no key for the old one. */
  forgetStale(houseOf: (profileId: string) => string | null | undefined) { return this.forget((k) => houseOf(k.profileId) !== k.houseId); }

  async close() { clearInterval(this.timer); await this.polling; await this.store.idle(); }

  private forget(match: (k: StoredKey) => boolean) {
    return this.store.change(async () => {
      const gone = this.data.keys.filter(match);
      if (!gone.length) return;
      await this.store.commit({ ...this.data, keys: this.data.keys.filter((k) => !match(k)), deleting: [...this.data.deleting, ...gone.map((k) => k.id)] });
    }).then(() => this.flushDeletes());
  }

  /** Deletes the listed keys on the Sorting Hat; those it can't reach stay listed for the next poll. */
  private async flushDeletes() {
    if (!this.client || !this.data.deleting.length) return;
    const client = this.client;
    const done = new Set<string>();
    for (const id of this.data.deleting) {
      try { await client.deleteHatKey(id); done.add(id); }
      catch (error) { if (error instanceof SortingHatError && error.status === 404) done.add(id); }
    }
    if (!done.size) return;
    await this.store.change(() => this.store.commit({ ...this.data, deleting: this.data.deleting.filter((id) => !done.has(id)) }));
  }

  /** Inside a change: deletes every key made on the current Sorting Hat, as far as it answers. */
  private async forgetAll() {
    const ids = [...this.data.deleting, ...this.data.keys.map((k) => k.id)];
    if (this.client) for (const id of ids) await this.client.deleteHatKey(id).catch(() => {});
    this.verified.clear();
  }

  private require() {
    if (!this.client) throw new HubError(this.problem ?? 'This hub has no Sorting Hat. Add one in Settings / Hubs.');
    return this.client;
  }

  private start() {
    if (this.timer) return;
    this.timer = setInterval(() => { if (!this.polling) void this.poll(); }, POLL_MS);
    this.timer.unref();
  }

  /** Reads houses, accounts, limits and the linked houses' models again; announces only what changed. */
  poll(): Promise<void> {
    const run = (this.polling ?? Promise.resolve()).then(() => this.read());
    const tracked: Promise<void> = run.finally(() => { if (this.polling === tracked) this.polling = undefined; });
    return this.polling = tracked;
  }

  private async read() {
    {
      const client = this.client;
      if (!client) return;
      const before = JSON.stringify([this.cache, this.problem]);
      try {
        const [houses, accounts, limits] = await Promise.all([client.houses(), client.accounts(), client.limits()]);
        const models: Record<string, CodexModel[]> = {};
        for (const id of new Set(this.linkedHouses())) if (houses.some((h) => h.id === id)) models[id] = (await client.houseModels(id)).openai;
        if (client !== this.client) return;
        this.cache = { houses, accounts, limits, models }; this.problem = null;
      } catch (error) {
        if (client !== this.client) return;
        this.problem = error instanceof HubError ? error.message : 'The Sorting Hat could not be read.';
      }
      await this.flushDeletes().catch(() => {});
      if (JSON.stringify([this.cache, this.problem]) !== before) this.changed();
    }
  }

  private changed() { for (const listener of this.listeners) listener(); }
}
