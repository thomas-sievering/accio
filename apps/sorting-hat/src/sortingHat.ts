import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
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
import { loadAccounts, type AccountData, type StoredHouse } from './migrateAccounts.js';
import { OpenAIAuth } from './openaiAuth.js';
import { AccountLimits, LimitsReadError } from './limits.js';
import { anthropicLimits, openaiLimits, retryAfterMs } from './providerLimits.js';
import { chooseAccount } from './accountChoice.js';
import type { Forwarding } from './proxy.js';

/** Per provider, the accounts a house uses in order; a provider left out keeps its accounts. */
export type AccountSelection = Partial<Record<ProviderId, string[]>>;

/**
 * GLOSSARY: Sorting Hat. Holds named provider accounts, groups them into houses
 * and gives each house one key; a key only ever unlocks its own house's accounts
 * (ADR 0007, 0018). A house has any number of accounts per provider, in order;
 * chooseAccount picks which signed-in one serves each request.
 */
export class SortingHat implements Forwarding {
  private readonly limits: AccountLimits;
  private store: JsonStore<AccountData>;
  private pending = new Map<string, PendingSignIn & { accountId: string; startedAt: number }>();
  private refreshing = new Map<string, Promise<ClaudeAccount>>();
  private openaiPending = new Map<string, string>();

  /** `dir` holds the Sorting Hat's state: profiles.json and each ChatGPT account's credential home. */
  constructor(
    dir: string,
    private fetchImpl: Fetch = fetch,
    private openai: OpenAIAuth = new OpenAIAuth(dir),
  ) {
    this.store = new JsonStore(join(dir, 'profiles.json'), () => ({ profiles: [], accounts: [] }));
    this.limits = new AccountLimits(() => this.accountViews(), (id, signal) => this.readAccountLimits(id, signal));
  }

  private get houses() { return this.store.data.profiles; }
  private get accounts() { return this.store.data.accounts; }

  async load() {
    await this.store.commit(await loadAccounts(this.store.file));
  }

  /** Creates the house and its key on first use; returns the key. */
  ensureHouse(id: string): Promise<string> {
    return this.change(async () => {
      const existing = this.houses.find((p) => p.id === id);
      if (existing) return existing.accessKey;
      const house = this.newHouse(id);
      await this.commit([...this.houses, house]);
      return house.accessKey;
    });
  }

  /** Serializes selection with account deletion and lets the caller prepare before publication.
   * If preparation fails, restore the previous durable state without publishing it.
   */
  configureHouse(id: string, selection: AccountSelection, prepare: (key: string) => Promise<void>) {
    return this.change(async () => {
      for (const [providerId, ids] of Object.entries(selection) as [ProviderId, string[]][]) for (const accountId of ids) this.requireProvider(accountId, providerId);
      const existing = this.houses.find((p) => p.id === id);
      const house = { ...(existing ?? this.newHouse(id)) };
      // Each provider keeps its place relative to the others; only its own accounts change.
      for (const [providerId, ids] of Object.entries(selection) as [ProviderId, string[]][]) {
        house.accountIds = [...house.accountIds.filter((a) => this.providerOf(a) !== providerId), ...new Set(ids)];
      }
      const next = existing ? this.houses.map((p) => p.id === id ? house : p) : [...this.houses, house];
      await this.prepareHouses(next, () => prepare(house.accessKey));
    });
  }

  removeHouse(id: string, prepare: () => Promise<void> = async () => {}) {
    return this.change(() => this.prepareHouses(this.houses.filter((p) => p.id !== id), prepare));
  }

  private newHouse(id: string): StoredHouse {
    return { id, accessKey: `accio-${randomBytes(24).toString('base64url')}`, accountIds: [] };
  }

  private async prepareHouses(next: StoredHouse[], prepare: () => Promise<void>) {
    await this.store.file.write({ profiles: next, accounts: this.accounts });
    try {
      await prepare();
    } catch (error) {
      try {
        await this.store.file.write(this.store.data);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Profile preparation and restoring the hub store both failed.');
      }
      throw error;
    }
    this.store.data = { profiles: next, accounts: this.accounts };
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
      this.limits.invalidate(p.accountId);
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
      await this.commit(this.houses, this.accounts.map((a) => a.id === id ? { ...a, openai: result.account } : a));
      this.limits.invalidate(id);
      this.openaiPending.delete(signInId);
      await this.openai.finish(signInId);
      if (previous) await this.openai.remove(previous.credentialId);
      return { status: 'complete' as const, account: this.accountView(id) };
    });
  }

  cancelAccountSignIn(signInId: string) {
    return this.change(async () => {
      this.pending.delete(signInId);
      this.openaiPending.delete(signInId);
      await this.openai.cancel(signInId);
    });
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
        await this.commit(this.houses, this.accounts.map((a) => a.id === id ? { ...a, openai: { ...current, models } } : a));
        return true;
      });
    }));
    return results.some(Boolean);
  }

  async openaiCredentials(houseId: string, force = false) {
    this.require(houseId);
    // An automatic switch while refreshing moves on to the new account, once.
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = this.accountIdInUse(houseId, 'openai');
      const account = this.accounts.find((a) => a.id === id)?.openai;
      if (!account) return null;
      const credentials = await this.openai.credentials(account, force);
      // A sign-out or account switch during refresh must not unlock the previous account.
      if (this.accountIdInUse(houseId, 'openai') === id && this.accounts.find((a) => a.id === id)?.openai === account) return credentials;
    }
    return null;
  }

  /** The house a request's key belongs to, or undefined for an unknown key. */
  houseForKey(key: string): { id: string } | undefined {
    const house = this.houses.find((p) => safeEqual(p.accessKey, key));
    return house && { id: house.id };
  }

  /** A usable access token for the house, refreshed first when close to expiry (or when forced). */
  async accessToken(houseId: string, { force = false } = {}): Promise<string | null> {
    return (await this.claudeAccess(houseId, force))?.token ?? null;
  }

  /** The house's Claude account in use and its token. */
  async claudeAccess(houseId: string, force = false): Promise<{ accountId: string; token: string } | null> {
    this.require(houseId);
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

  async close(): Promise<void> {
    await this.limits.close();
    await this.store.idle();
    await this.openai.close();
  }

  private require(id: string): StoredHouse {
    const a = this.houses.find((x) => x.id === id);
    if (!a) throw new SignInError(`The hub has no profile ${id}`);
    return a;
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
      if (!name || name.length > 80) throw new SignInError('Account name must have 1 to 80 characters.');
      if (id) this.requireAccount(id);
      if (id && providerId && (this.requireAccount(id).providerId ?? 'anthropic') !== providerId) throw new SignInError('An account cannot change provider.');
      const saved = id ?? randomUUID();
      const accounts = id ? this.accounts.map((a) => a.id === id ? { ...a, name } : a) : [...this.accounts, { id: saved, name, providerId: providerId ?? 'anthropic', account: null }];
      await this.commit(this.houses, accounts);
      return this.accountView(saved);
    });
  }

  deleteAccount(id: string) {
    return this.change(async () => {
      const account = this.requireAccount(id);
      if (this.houses.some((p) => p.accountIds.includes(id))) throw new SignInError('Remove this account from its profiles before deleting it.');
      await this.commit(this.houses, this.accounts.filter((a) => a.id !== id));
      this.limits.invalidate(id);
      this.cancelSignIn(id);
      await this.cancelOpenAISignIn(id);
      if (account.openai) await this.openai.remove(account.openai.credentialId);
    });
  }

  signOutAccount(id: string) {
    return this.change(async () => {
      const account = this.requireAccount(id);
      await this.commit(this.houses, this.accounts.map((a) => a.id === id ? { ...a, account: null, openai: null } : a));
      this.limits.invalidate(id);
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
    if ((account.providerId ?? 'anthropic') !== providerId) throw new SignInError(`Choose a ${providerId} account.`);
    return account;
  }

  private requireAccount(id: string) {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) throw new SignInError(`No account ${id}`);
    return account;
  }

  private setAccount(id: string, account: ClaudeAccount | null) {
    this.requireAccount(id);
    return this.commit(this.houses, this.accounts.map((a) => a.id === id ? { ...a, account } : a));
  }

  private commit(houses: StoredHouse[], accounts = this.accounts) {
    return this.store.commit({ profiles: houses, accounts });
  }

  private change<T>(run: () => Promise<T>): Promise<T> {
    return this.store.change(run);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
