import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import {
  SIGN_IN_TTL_MS,
  SignInError,
  beginSignIn,
  exchangeCode,
  needsRefresh,
  readPastedCode,
  refreshAccount,
  type ClaudeAccount,
  type PendingSignIn,
} from './claudeOAuth.js';
import { JsonStore } from './store.js';
import type { AccountLimitsView, AccountView, Fetch, ProviderId } from './types.js';
import { STATE_FILE, emptyState, loadState, type HatState, type StoredAccount, type StoredHatKey, type StoredHouse } from './state.js';
import { HatError } from './errors.js';
import { OpenAIAuth } from './openaiAuth.js';
import { AccountLimits, LimitsReadError } from './limits.js';
import { anthropicLimits, openaiLimits, retryAfterMs } from './providerLimits.js';
import { chooseAccount } from './accountChoice.js';
import type { Forwarding } from './proxy.js';
import { ClaudeModelLists, type AnthropicModel } from './models.js';
import { USAGE_FILE, UsageLedger, type UsageEntry, type UsageQuery, type UsageReport } from './usage.js';

/** Per provider, the accounts a house uses in order; a provider left out keeps its accounts. */
export type AccountSelection = Partial<Record<ProviderId, string[]>>;

/** GLOSSARY: House, as the management API shows it. */
export type HouseView = {
  id: string;
  name: string;
  /** Per provider, the house's account ids in order of use. */
  accounts: Record<ProviderId, string[]>;
  /** Per provider, the account in use, or null when none is signed in. */
  inUse: Record<ProviderId, string | null>;
};
/** GLOSSARY: Hat key, without its secret. */
export type HatKeyView = Omit<StoredHatKey, 'hash'>;
/** An account as sorting-hat.json stores it, with a ChatGPT account's Codex auth.json. */
export type ImportedAccount = StoredAccount & { codexAuth?: unknown };

const PROVIDERS: ProviderId[] = ['anthropic', 'openai'];
const HOUSE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * GLOSSARY: Sorting Hat. Holds named provider accounts, groups them into houses
 * and issues hat keys; a key only ever unlocks its own house's accounts (ADR
 * 0007, 0018). A house has any number of accounts per provider, in order;
 * chooseAccount picks which signed-in one serves each request.
 *
 * An app embedding the Sorting Hat in-process (Accio's hub, until it calls it
 * over HTTP) gets one key per house from `ensureHouse`, held only in memory.
 */
export class SortingHat implements Forwarding {
  private readonly limits: AccountLimits;
  private readonly claudeModelLists: ClaudeModelLists;
  private readonly usage: UsageLedger;
  private store: JsonStore<HatState>;
  private pending = new Map<string, PendingSignIn & { accountId: string; startedAt: number }>();
  private refreshing = new Map<string, Promise<ClaudeAccount>>();
  private openaiPending = new Map<string, string>();
  /** The embedding app's key per house; never stored. */
  private embeddedKeys = new Map<string, string>();

  /** `dir` holds the Sorting Hat's state: sorting-hat.json and each ChatGPT account's credential home. */
  constructor(
    dir: string,
    private fetchImpl: Fetch = fetch,
    private openai: OpenAIAuth = new OpenAIAuth(dir),
  ) {
    this.store = new JsonStore(join(dir, STATE_FILE), emptyState);
    this.usage = new UsageLedger(join(dir, USAGE_FILE));
    this.limits = new AccountLimits(() => this.accountViews(), (id, signal) => this.readAccountLimits(id, signal));
    this.claudeModelLists = new ClaudeModelLists(fetchImpl, (id, force) => this.accountAccessToken(id, force));
  }

  private get houses() { return this.store.data.houses; }
  private get hatKeys() { return this.store.data.hatKeys; }
  private get accounts() { return this.store.data.accounts; }

  async load() {
    await this.store.commit(await loadState(this.store.file));
    await this.usage.load();
  }

  // Houses

  houseViews(): HouseView[] {
    return this.houses.map((h) => this.houseView(h.id));
  }

  houseView(id: string): HouseView {
    const house = this.requireHouse(id);
    const per = <T>(f: (p: ProviderId) => T) => Object.fromEntries(PROVIDERS.map((p) => [p, f(p)])) as Record<ProviderId, T>;
    return { id: house.id, name: house.name, accounts: per((p) => this.selectedIds(id, p)), inUse: per((p) => this.accountIdInUse(id, p)) };
  }

  /** A new house without accounts. Its id is chosen from the name unless given. */
  createHouse(name: string, id?: string) {
    return this.change(async () => {
      name = houseName(name);
      if (id !== undefined && !HOUSE_ID.test(id)) throw new HatError('A house id has 1 to 64 lowercase letters, digits, - or _, starting with a letter or digit.');
      if (id !== undefined && this.houses.some((h) => h.id === id)) throw new HatError(`There is already a house ${id}.`, 409);
      const chosen = id ?? this.freeHouseId(name);
      await this.commit({ houses: [...this.houses, { id: chosen, name, accountIds: [] }] });
      return this.houseView(chosen);
    });
  }

  renameHouse(id: string, name: string) {
    return this.change(async () => {
      this.requireHouse(id);
      name = houseName(name);
      await this.commit({ houses: this.houses.map((h) => h.id === id ? { ...h, name } : h) });
      return this.houseView(id);
    });
  }

  /** Sets the house's accounts at the providers given, in order. */
  setHouseAccounts(id: string, selection: AccountSelection) {
    return this.change(async () => {
      this.requireHouse(id);
      await this.prepareHouses(this.selecting(id, selection), async () => {});
      return this.houseView(id);
    });
  }

  /**
   * For an embedding app: creates the house (named by its id) on first use and
   * returns the app's key for it, which lasts until this process stops.
   */
  async ensureHouse(id: string): Promise<string> {
    if (!this.houses.some((h) => h.id === id)) {
      await this.change(async () => {
        if (!this.houses.some((h) => h.id === id)) await this.commit({ houses: [...this.houses, { id, name: id, accountIds: [] }] });
      });
    }
    let key = this.embeddedKeys.get(id);
    if (!key) this.embeddedKeys.set(id, key = `hat-${randomBytes(32).toString('base64url')}`);
    return key;
  }

  /** Serializes selection with account deletion and lets the caller prepare before publication.
   * Creates the house, named by its id, if it is new. If preparation fails,
   * restore the previous durable state without publishing it.
   */
  configureHouse(id: string, selection: AccountSelection, prepare: () => Promise<void>) {
    return this.change(() => this.prepareHouses(this.selecting(id, selection), prepare));
  }

  /** Deletes the house and every hat key it has. */
  removeHouse(id: string, prepare: () => Promise<void> = async () => {}) {
    return this.change(async () => {
      await this.prepareHouses(this.houses.filter((p) => p.id !== id), prepare, this.hatKeys.filter((k) => k.houseId !== id));
      this.embeddedKeys.delete(id);
    });
  }

  private selecting(id: string, selection: AccountSelection): StoredHouse[] {
    for (const [providerId, ids] of Object.entries(selection) as [ProviderId, string[]][]) for (const accountId of ids) this.requireProvider(accountId, providerId);
    const existing = this.houses.find((p) => p.id === id);
    const house = { ...(existing ?? { id, name: id, accountIds: [] }) };
    // Each provider keeps its place relative to the others; only its own accounts change.
    for (const [providerId, ids] of Object.entries(selection) as [ProviderId, string[]][]) {
      house.accountIds = [...house.accountIds.filter((a) => this.providerOf(a) !== providerId), ...new Set(ids)];
    }
    return existing ? this.houses.map((p) => p.id === id ? house : p) : [...this.houses, house];
  }

  private freeHouseId(name: string) {
    const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56) || 'house';
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      if (!this.houses.some((h) => h.id === id)) return id;
    }
  }

  private async prepareHouses(houses: StoredHouse[], prepare: () => Promise<void>, hatKeys = this.hatKeys) {
    const next = { ...this.store.data, houses, hatKeys };
    await this.store.file.write(next);
    try {
      await prepare();
    } catch (error) {
      try {
        await this.store.file.write(this.store.data);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Preparing the house change and restoring the Sorting Hat’s state both failed.');
      }
      throw error;
    }
    this.store.data = next;
  }

  // Hat keys

  hatKeyViews(houseId?: string): HatKeyView[] {
    if (houseId !== undefined) this.requireHouse(houseId);
    return this.hatKeys.filter((k) => houseId === undefined || k.houseId === houseId).map(hatKeyView);
  }

  hatKeyView(id: string): HatKeyView {
    return hatKeyView(this.requireHatKey(id));
  }

  /** Issues a key for the house. Its secret is returned here only; the Sorting Hat keeps a hash. */
  createHatKey(houseId: string, name: string) {
    return this.change(async () => {
      this.requireHouse(houseId);
      const secret = `hat-${randomBytes(32).toString('base64url')}`;
      const key: StoredHatKey = { id: randomUUID(), houseId, name: keyName(name), createdAt: new Date().toISOString(), hash: hashKey(secret), revokedAt: null };
      await this.commit({ hatKeys: [...this.hatKeys, key] });
      return { ...hatKeyView(key), secret };
    });
  }

  renameHatKey(id: string, name: string) {
    return this.change(async () => {
      this.requireHatKey(id);
      name = keyName(name);
      await this.commit({ hatKeys: this.hatKeys.map((k) => k.id === id ? { ...k, name } : k) });
      return this.hatKeyView(id);
    });
  }

  /** From now on the key gets 401. It stays listed, marked revoked. */
  revokeHatKey(id: string) {
    return this.change(async () => {
      if (this.requireHatKey(id).revokedAt) return this.hatKeyView(id);
      await this.commit({ hatKeys: this.hatKeys.map((k) => k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k) });
      return this.hatKeyView(id);
    });
  }

  deleteHatKey(id: string) {
    return this.change(async () => {
      this.requireHatKey(id);
      await this.commit({ hatKeys: this.hatKeys.filter((k) => k.id !== id) });
    });
  }

  beginAccountSignIn(accountId: string, redirectUri?: string): { signInId: string; url: string } {
    this.requireProvider(accountId, 'anthropic');
    const now = Date.now();
    for (const [key, p] of this.pending) if (now - p.startedAt > SIGN_IN_TTL_MS || p.accountId === accountId) this.pending.delete(key);
    const signInId = randomUUID();
    const p = beginSignIn(undefined, redirectUri);
    this.pending.set(signInId, { ...p, accountId, startedAt: now });
    return { signInId, url: p.url };
  }

  async completeAccountSignIn(signInId: string, pasted: string) {
    const p = this.pending.get(signInId);
    if (!p || Date.now() - p.startedAt > SIGN_IN_TTL_MS) throw new SignInError('This sign-in has expired. Start it again.');
    const code = readPastedCode(pasted, p);
    const account = await exchangeCode(this.fetchImpl, p, code);
    return this.change(async () => {
      if (this.pending.get(signInId) !== p) throw new SignInError('This sign-in was cancelled. Start it again.');
      await this.setAccount(p.accountId, account);
      this.signInChanged(p.accountId);
      this.pending.delete(signInId);
      return this.accountView(p.accountId);
    });
  }

  async beginOpenAISignIn(accountId: string, browser = false) {
    return this.change(async () => {
      this.requireProvider(accountId, 'openai');
      await this.cancelOpenAISignIn(accountId);
      const result = await this.openai.begin(browser);
      this.openaiPending.set(result.signInId, accountId);
      return result;
    });
  }

  async completeOpenAICallback(signInId: string, code: string, state: string) {
    if (!this.openaiPending.has(signInId)) throw new SignInError('This sign-in has expired or was cancelled. Start it again.');
    await this.openai.callback(signInId, code, state);
  }

  openaiSignInStatus(signInId: string) {
    return this.change(async () => {
      const id = this.openaiPending.get(signInId);
      if (!id) throw new SignInError('This sign-in has expired or was cancelled. Start it again.');
      this.requireProvider(id, 'openai');
      const result = await this.openai.status(signInId);
      if (result.status === 'pending') return result;
      const previous = this.requireAccount(id).openai;
      await this.commit({ accounts: this.accounts.map((a) => a.id === id ? { ...a, openai: result.account } : a) });
      this.signInChanged(id);
      this.openaiPending.delete(signInId);
      await this.openai.finish(signInId);
      if (previous) await this.openai.remove(previous.credentialId);
      return { status: 'complete' as const, account: this.accountView(id) };
    });
  }

  /** Which provider a sign-in still in progress belongs to, if any. */
  signInProvider(signInId: string): ProviderId | undefined {
    if (this.pending.has(signInId)) return 'anthropic';
    if (this.openaiPending.has(signInId)) return 'openai';
    return undefined;
  }

  cancelAccountSignIn(signInId: string) {
    return this.change(async () => {
      this.pending.delete(signInId);
      this.openaiPending.delete(signInId);
      await this.openai.cancel(signInId);
    });
  }

  /** The models the house's Claude account in use can use, as Anthropic lists them; empty without a signed-in one. */
  async claudeModels(houseId: string): Promise<AnthropicModel[]> {
    this.requireHouse(houseId);
    const id = this.accountIdInUse(houseId, 'anthropic');
    return id ? this.claudeModelLists.models(id) : [];
  }

  /** The models the house's ChatGPT account in use offers. */
  codexModels(houseId: string) {
    const id = this.accountIdInUse(houseId, 'openai');
    return this.accounts.find((a) => a.id === id)?.openai?.models ?? [];
  }

  /**
   * Asks each signed-in ChatGPT account again which models it offers, since they
   * change over time and older sign-ins stored no effort levels. True when any changed.
   */
  async refreshCodexModels(): Promise<boolean> {
    const results = await Promise.all(this.accounts.flatMap((a) => a.openai ? [{ id: a.id, openai: a.openai }] : []).map(async ({ id, openai }) => {
      let models;
      try { models = await this.openai.models(openai); } catch (error) {
        console.error('[sorting-hat] could not read ChatGPT models', (error as Error).message);
        return false;
      }
      if (JSON.stringify(models) === JSON.stringify(openai.models)) return false;
      return this.change(async () => {
        // A sign-out or new sign-in meanwhile has its own models.
        const current = this.accounts.find((a) => a.id === id)?.openai;
        if (current?.credentialId !== openai.credentialId) return false;
        await this.commit({ accounts: this.accounts.map((a) => a.id === id ? { ...a, openai: { ...current, models } } : a) });
        return true;
      });
    }));
    return results.some(Boolean);
  }

  /** The house's ChatGPT account in use (`accountId`), its token and ChatGPT's own id for it. */
  async openaiCredentials(houseId: string, force = false): Promise<{ accountId: string; accessToken: string; chatgptAccountId: string } | null> {
    this.requireHouse(houseId);
    // An automatic switch while refreshing moves on to the new account, once.
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = this.accountIdInUse(houseId, 'openai');
      const account = this.accounts.find((a) => a.id === id)?.openai;
      if (!account) return null;
      const credentials = await this.openai.credentials(account, force);
      // A sign-out or account switch during refresh must not unlock the previous account.
      if (this.accountIdInUse(houseId, 'openai') === id && this.accounts.find((a) => a.id === id)?.openai === account) return { accountId: id!, accessToken: credentials.accessToken, chatgptAccountId: credentials.accountId };
    }
    return null;
  }

  /**
   * The house a request's key belongs to, and which hat key it is; undefined
   * for an unknown or revoked key. An embedding app's key has no hat key id.
   */
  houseForKey(key: string): { id: string; hatKeyId: string | null } | undefined {
    const hash = Buffer.from(hashKey(key), 'hex');
    const hatKey = this.hatKeys.find((k) => timingSafeEqual(Buffer.from(k.hash, 'hex'), hash));
    if (hatKey) return hatKey.revokedAt || !this.houses.some((h) => h.id === hatKey.houseId) ? undefined : { id: hatKey.houseId, hatKeyId: hatKey.id };
    for (const [id, embedded] of this.embeddedKeys) if (safeEqual(embedded, key) && this.houses.some((h) => h.id === id)) return { id, hatKeyId: null };
    return undefined;
  }

  /** A usable access token for the house, refreshed first when close to expiry (or when forced). */
  async accessToken(houseId: string, { force = false } = {}): Promise<string | null> {
    return (await this.claudeAccess(houseId, force))?.token ?? null;
  }

  /** The house's Claude account in use and its token. */
  async claudeAccess(houseId: string, force = false): Promise<{ accountId: string; token: string } | null> {
    this.requireHouse(houseId);
    const accountId = this.accountIdInUse(houseId, 'anthropic');
    if (!accountId) return null;
    await this.accountAccessToken(accountId, force);
    // Preserve the house's routing if its accounts changed while the token refreshed.
    const currentId = this.accountIdInUse(houseId, 'anthropic');
    const token = this.accounts.find((a) => a.id === currentId)?.account?.accessToken;
    return currentId && token ? { accountId: currentId, token } : null;
  }

  private async accountAccessToken(accountId: string, force = false): Promise<string | null> {
    const account = this.accounts.find((a) => a.id === accountId)?.account;
    if (!account) return null;
    if (!force && !needsRefresh(account)) return account.accessToken;
    // One refresh per account at a time; concurrent requests share it.
    let pending = this.refreshing.get(accountId!);
    if (!pending) {
      pending = refreshAccount(this.fetchImpl, account).then(async (fresh) => {
        await this.change(async () => {
          if (this.accounts.find((a) => a.id === accountId)?.account === account) await this.setAccount(accountId!, fresh);
        });
        return fresh;
      });
      this.refreshing.set(accountId!, pending);
      void pending.then(
        () => this.refreshing.delete(accountId!),
        () => this.refreshing.delete(accountId!),
      );
    }
    await pending;
    return this.accounts.find((a) => a.id === accountId)?.account?.accessToken ?? null;
  }

  /** Every account's last known limits. */
  limitViews(): AccountLimitsView[] {
    return this.limits.views();
  }

  /** Called whenever any account's limits view changes; returns an unsubscribe. */
  onLimitsChanged(listener: (views: AccountLimitsView[]) => void) {
    return this.limits.subscribe(listener);
  }

  refreshLimits(ids = this.accounts.map((a) => a.id), force = false) {
    for (const id of ids) this.requireAccount(id);
    return this.limits.refresh(ids, force);
  }

  private async readAccountLimits(id: string, signal: AbortSignal) {
    const account = this.requireAccount(id);
    if (account.providerId === 'openai') {
      if (!account.openai) throw new LimitsReadError('signInRequired', 'Sign in to this ChatGPT account to read its limits.');
      return openaiLimits(await this.openai.rateLimits(account.openai, signal));
    }
    const send = async (force = false) => {
      const token = await this.accountAccessToken(id, force);
      signal.throwIfAborted();
      if (!token) throw new LimitsReadError('signInRequired', 'Sign in to this Claude account to read its limits.');
      return this.fetchImpl('https://api.anthropic.com/api/oauth/usage', { signal, headers: {
        authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json',
      } });
    };
    let response = await send();
    if (response.status === 401) { await response.body?.cancel(); response = await send(true); }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new LimitsReadError('signInRequired', 'Sign in to this Claude account again to read its limits.');
      if (response.status === 429) throw new LimitsReadError('rateLimited', 'Anthropic is limiting usage checks. Try again later.', retryAfterMs(response.headers.get('retry-after')));
      throw new LimitsReadError('unavailable', 'Anthropic could not provide this account’s limits. Try again.', retryAfterMs(response.headers.get('retry-after')));
    }
    return anthropicLimits(await response.json());
  }

  /** Counts one model request's tokens; never throws into forwarding. */
  recordUsage(entry: UsageEntry) {
    try { this.usage.record(entry); } catch (error) { console.error('[sorting-hat] could not record usage', (error as Error).message); }
  }

  /** GLOSSARY: Usage, for a time range, grouped and split as asked. */
  usageReport(query?: UsageQuery): UsageReport {
    return this.usage.report(query);
  }

  /**
   * Takes accounts, with their credentials, and houses as another Sorting Hat
   * stored them, such as the one Accio's hub embedded (API.md, "Import"). Those
   * with an id already here are replaced, so it can be repeated; hat keys stay.
   */
  importState(accounts: ImportedAccount[], houses: StoredHouse[]) {
    return this.change(async () => {
      const known = new Map(this.accounts.map((a) => [a.id, a]));
      for (const a of accounts) {
        if (typeof a?.id !== 'string' || !a.id || a.id.length > 200) throw new HatError('Each account needs an id.');
        if (!PROVIDERS.includes(a.providerId ?? 'anthropic')) throw new HatError('providerId must be anthropic or openai.');
        if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80) throw new HatError('Account name must have 1 to 80 characters.');
        const claude = a.account;
        if (claude && (typeof claude.accessToken !== 'string' || typeof claude.refreshToken !== 'string' || typeof claude.expiresAt !== 'number')) throw new HatError(`Account ${a.id} has incomplete Claude credentials.`);
        if (a.openai && (!a.codexAuth || typeof a.codexAuth !== 'object')) throw new HatError(`Account ${a.id} needs its Codex auth.json as codexAuth.`);
        known.set(a.id, a);
      }
      for (const h of houses) {
        if (typeof h?.id !== 'string' || !HOUSE_ID.test(h.id)) throw new HatError('A house id has 1 to 64 lowercase letters, digits, - or _, starting with a letter or digit.');
        houseName(h.name);
        if (!Array.isArray(h.accountIds) || h.accountIds.some((id) => !known.has(id))) throw new HatError(`House ${h.id} lists an account that is neither here nor imported.`);
      }
      for (const a of accounts) if (a.openai) await this.openai.restore(a.openai.credentialId, a.codexAuth);
      const ids = new Set(accounts.map((a) => a.id));
      const stored = accounts.map(({ codexAuth: _auth, ...a }) => ({ ...a, account: a.account ?? null, openai: a.openai ?? null }));
      const replaced = houses.filter((h) => this.houses.some((x) => x.id === h.id));
      const previous = this.accounts.filter((a) => ids.has(a.id));
      await this.commit({
        accounts: [...this.accounts.filter((a) => !ids.has(a.id)), ...stored],
        houses: [...this.houses.map((h) => replaced.find((r) => r.id === h.id) ?? h), ...houses.filter((h) => !replaced.includes(h))].map(({ id, name, accountIds }) => ({ id, name, accountIds: [...new Set(accountIds)] })),
      });
      for (const a of previous) if (a.openai && a.openai.credentialId !== known.get(a.id)?.openai?.credentialId) await this.openai.remove(a.openai.credentialId);
      for (const id of ids) this.signInChanged(id);
      return { accounts: [...ids].map((id) => this.accountView(id)), houses: houses.map((h) => this.houseView(h.id)) };
    });
  }

  async close(): Promise<void> {
    await this.limits.close();
    await this.usage.close();
    // A refresh still under way stores its rotated token before the state is final.
    await Promise.allSettled(this.refreshing.values());
    await this.store.idle();
    await this.openai.close();
  }

  /** After an account signed in again, out, or was deleted: what was read with its old sign-in is stale. */
  private signInChanged(id: string) {
    this.limits.invalidate(id);
    this.claudeModelLists.forget(id);
  }

  private requireHouse(id: string): StoredHouse {
    const house = this.houses.find((x) => x.id === id);
    if (!house) throw new HatError(`No house ${id}`, 404);
    return house;
  }

  private requireHatKey(id: string): StoredHatKey {
    const key = this.hatKeys.find((k) => k.id === id);
    if (!key) throw new HatError(`No hat key ${id}`, 404);
    return key;
  }

  accountViews(): AccountView[] {
    return this.accounts.map((a) => this.accountView(a.id));
  }

  accountView(id: string): AccountView {
    const a = this.requireAccount(id);
    if (a.providerId === 'openai') return { id: a.id, name: a.name, providerId: 'openai' as const, signedIn: !!a.openai, email: a.openai?.email ?? null, organization: null };
    return { id: a.id, name: a.name, providerId: 'anthropic' as const, signedIn: !!a.account, email: a.account?.email ?? null, organization: a.account?.organization ?? null };
  }

  /** The house's accounts at this provider, in order of use. */
  selectedAccounts(houseId: string, providerId: ProviderId) {
    return this.selectedIds(houseId, providerId).map((id) => this.accountView(id));
  }

  /** The account serving the house's requests at this provider. */
  selectedAccount(houseId: string, providerId: ProviderId = 'anthropic') {
    const id = this.accountIdInUse(houseId, providerId);
    return id ? this.accountView(id) : null;
  }

  /** The signed-in account chosen for the house's next request at this provider (see chooseAccount). */
  accountIdInUse(houseId: string, providerId: ProviderId, now = Date.now()) {
    return chooseAccount(this.signedInIds(houseId, providerId).map((id) => ({ id, snapshot: this.limits.snapshot(id) })), now);
  }

  /**
   * Keeps the limits behind the choice current while a house is in use. The
   * cache reads each account at most about once a minute, and right after a
   * shown reset passes.
   */
  noteRequest(houseId: string, providerId: ProviderId) {
    void this.limits.refresh(this.signedInIds(houseId, providerId)).catch((error) => console.error('[sorting-hat] limits refresh failed', (error as Error).message));
  }

  /**
   * After a provider refused a request for limits: reads this account's limits
   * again, so the next choice can move to another account. True when it would.
   */
  async recheckAfterLimit(houseId: string, providerId: ProviderId, accountId: string) {
    await Promise.race([this.limits.refresh([accountId], true), new Promise((r) => setTimeout(r, 5_000).unref())]);
    const next = this.accountIdInUse(houseId, providerId);
    return next !== null && next !== accountId;
  }

  private signedInIds(houseId: string, providerId: ProviderId) {
    return this.selectedIds(houseId, providerId).filter((id) => {
      const a = this.accounts.find((x) => x.id === id);
      return providerId === 'openai' ? !!a?.openai : !!a?.account;
    });
  }

  private selectedIds(houseId: string, providerId: ProviderId) {
    return (this.houses.find((p) => p.id === houseId)?.accountIds ?? []).filter((id) => this.providerOf(id) === providerId);
  }

  private providerOf(id: string): ProviderId | undefined {
    const account = this.accounts.find((a) => a.id === id);
    return account && (account.providerId ?? 'anthropic');
  }

  saveAccount(name: string, id?: string, providerId?: ProviderId) {
    return this.change(async () => {
      name = name.trim();
      if (!name || name.length > 80) throw new HatError('Account name must have 1 to 80 characters.');
      if (id) this.requireAccount(id);
      if (id && providerId && (this.requireAccount(id).providerId ?? 'anthropic') !== providerId) throw new HatError('An account cannot change provider.');
      const saved = id ?? randomUUID();
      const accounts = id ? this.accounts.map((a) => a.id === id ? { ...a, name } : a) : [...this.accounts, { id: saved, name, providerId: providerId ?? 'anthropic', account: null }];
      await this.commit({ accounts });
      return this.accountView(saved);
    });
  }

  deleteAccount(id: string) {
    return this.change(async () => {
      const account = this.requireAccount(id);
      if (this.houses.some((p) => p.accountIds.includes(id))) throw new HatError('Remove this account from its houses before deleting it.', 409);
      await this.commit({ accounts: this.accounts.filter((a) => a.id !== id) });
      this.signInChanged(id);
      this.cancelSignIn(id);
      await this.cancelOpenAISignIn(id);
      if (account.openai) await this.openai.remove(account.openai.credentialId);
    });
  }

  signOutAccount(id: string) {
    return this.change(async () => {
      const account = this.requireAccount(id);
      await this.commit({ accounts: this.accounts.map((a) => a.id === id ? { ...a, account: null, openai: null } : a) });
      this.signInChanged(id);
      this.cancelSignIn(id);
      await this.cancelOpenAISignIn(id);
      if (account.openai) await this.openai.remove(account.openai.credentialId);
      return this.accountView(id);
    });
  }

  private cancelSignIn(id: string) {
    for (const [key, p] of this.pending) if (p.accountId === id) this.pending.delete(key);
  }

  private async cancelOpenAISignIn(id: string) {
    for (const [key, accountId] of this.openaiPending) if (accountId === id) {
      this.openaiPending.delete(key); await this.openai.cancel(key);
    }
  }

  private requireProvider(id: string, providerId: ProviderId) {
    const account = this.requireAccount(id);
    if ((account.providerId ?? 'anthropic') !== providerId) throw new HatError(`Choose a ${providerId} account.`);
    return account;
  }

  private requireAccount(id: string) {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) throw new HatError(`No account ${id}`, 404);
    return account;
  }

  private setAccount(id: string, account: ClaudeAccount | null) {
    this.requireAccount(id);
    return this.commit({ accounts: this.accounts.map((a) => a.id === id ? { ...a, account } : a) });
  }

  private commit(patch: Partial<Omit<HatState, 'version'>>) {
    return this.store.commit({ ...this.store.data, ...patch });
  }

  private change<T>(run: () => Promise<T>): Promise<T> {
    return this.store.change(run);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function hashKey(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

function hatKeyView({ hash: _hash, ...view }: StoredHatKey): HatKeyView {
  return view;
}

function houseName(name: unknown) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed.length > 80) throw new HatError('A house name has 1 to 80 characters.');
  return trimmed;
}

function keyName(name: unknown) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed.length > 80) throw new HatError('A hat key name has 1 to 80 characters.');
  return trimmed;
}
