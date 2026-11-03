import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import {
  SignInError,
  beginSignIn,
  exchangeCode,
  needsRefresh,
  readPastedCode,
  refreshAccount,
  type ClaudeAccount,
  type Fetch,
  type PendingSignIn,
} from './claudeOAuth.js';
import { JsonFile } from '@accio/persistence';
import { loadAccounts, type AccountData, type StoredAccount } from './migrateAccounts.js';

/**
 * GLOSSARY: Hub. Holds named Claude accounts selected by profiles and hands out one access
 * key per profile; a key only ever unlocks its own profile's account (ADR 0007).
 * Profiles here are just ids: names and rules live in accio. For now a profile
 * has at most one account, at Claude, with its tokens.
 */
export type HubProfile = {
  id: string;
  accessKey: string;
  accountId: string | null;
};

/** What the hub tells accio about a profile's sign-in. Never the tokens. */
export type AccountSummary = {
  signedIn: boolean;
  email: string | null;
  organization: string | null;
  claudeAccountId: string | null;
};

const SIGN_IN_TTL_MS = 15 * 60 * 1000;

export class Hub {
  private file: JsonFile<AccountData>;
  private queue: Promise<unknown> = Promise.resolve();
  private profiles: HubProfile[] = [];
  private accounts: StoredAccount[] = [];
  private pending = new Map<string, PendingSignIn & { accountId: string; startedAt: number }>();
  private refreshing = new Map<string, Promise<ClaudeAccount>>();

  constructor(
    home: string,
    private fetchImpl: Fetch = fetch,
  ) {
    this.file = new JsonFile(join(home, 'hub', 'profiles.json'), () => ({ profiles: [], accounts: [] }));
  }

  /** The file that holds the hub's profiles and accounts. */
  get storePath(): string {
    return this.file.path;
  }

  async load() {
    const data = await loadAccounts(this.file);
    this.profiles = data.profiles;
    this.accounts = data.accounts;
  }

  /** Creates the profile's access key on first use; returns it. */
  ensureProfile(id: string): Promise<string> {
    return this.change(async () => {
      const existing = this.profiles.find((p) => p.id === id);
      if (existing) return existing.accessKey;
      const profile = this.newProfile(id);
      await this.commit([...this.profiles, profile]);
      return profile.accessKey;
    });
  }

  /** Serializes selection with account deletion and prepares the machine before publication.
   * If preparation fails, restore the previous durable hub state without publishing it.
   */
  configureProfile(id: string, accountId: string | null | undefined, prepare: (key: string) => Promise<void>) {
    return this.change(async () => {
      if (accountId !== undefined && accountId !== null) this.requireAccount(accountId);
      const existing = this.profiles.find((p) => p.id === id);
      const profile = { ...(existing ?? this.newProfile(id)) };
      if (accountId !== undefined) profile.accountId = accountId;
      const next = existing ? this.profiles.map((p) => p.id === id ? profile : p) : [...this.profiles, profile];
      await this.prepareProfiles(next, () => prepare(profile.accessKey));
    });
  }

  removeProfile(id: string, prepare: () => Promise<void> = async () => {}) {
    return this.change(() => this.prepareProfiles(this.profiles.filter((p) => p.id !== id), prepare));
  }

  private newProfile(id: string): HubProfile {
    return { id, accessKey: `accio-${randomBytes(24).toString('base64url')}`, accountId: null };
  }

  private async prepareProfiles(next: HubProfile[], prepare: () => Promise<void>) {
    await this.file.write({ profiles: next, accounts: this.accounts });
    try {
      await prepare();
    } catch (error) {
      try {
        await this.file.write({ profiles: this.profiles, accounts: this.accounts });
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Profile preparation and restoring the hub store both failed.');
      }
      throw error;
    }
    this.profiles = next;
  }

  summary(id: string): AccountSummary {
    const account = this.accounts.find((a) => a.id === this.profiles.find((p) => p.id === id)?.accountId)?.account ?? null;
    return {
      signedIn: account !== null,
      email: account?.email ?? null,
      organization: account?.organization ?? null,
      claudeAccountId: account?.claudeAccountId ?? null,
    };
  }

  beginAccountSignIn(accountId: string): { signInId: string; url: string } {
    this.requireAccount(accountId);
    const now = Date.now();
    for (const [key, p] of this.pending) if (now - p.startedAt > SIGN_IN_TTL_MS || p.accountId === accountId) this.pending.delete(key);
    const signInId = randomUUID();
    const p = beginSignIn();
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
      this.pending.delete(signInId);
      return this.accountView(p.accountId);
    });
  }

  /** The profile a request's key belongs to, or undefined for an unknown key. */
  profileForKey(key: string): HubProfile | undefined {
    const given = Buffer.from(key);
    return this.profiles.find((a) => {
      const k = Buffer.from(a.accessKey);
      return k.length === given.length && timingSafeEqual(k, given);
    });
  }

  /** A usable access token for the profile, refreshed first when close to expiry (or when forced). */
  async accessToken(profileId: string, { force = false } = {}): Promise<string | null> {
    const accountId = this.require(profileId).accountId;
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
    // Sign-out, account switching, or a fresh sign-in may have happened during refresh.
    const currentId = this.profiles.find((p) => p.id === profileId)?.accountId;
    return this.accounts.find((a) => a.id === currentId)?.account?.accessToken ?? null;
  }

  async close(): Promise<void> {
    await this.queue.catch(() => {});
    await this.file.idle();
  }

  private require(id: string): HubProfile {
    const a = this.profiles.find((x) => x.id === id);
    if (!a) throw new SignInError(`The hub has no profile ${id}`);
    return a;
  }

  accountViews() {
    return this.accounts.map((a) => this.accountView(a.id));
  }

  accountView(id: string) {
    const a = this.requireAccount(id);
    return { id: a.id, name: a.name, providerId: 'anthropic' as const, signedIn: !!a.account, email: a.account?.email ?? null, organization: a.account?.organization ?? null };
  }

  selectedAccount(profileId: string) {
    const id = this.profiles.find((p) => p.id === profileId)?.accountId;
    return id ? this.accountView(id) : null;
  }

  saveAccount(name: string, id?: string) {
    return this.change(async () => {
      name = name.trim();
      if (!name || name.length > 80) throw new SignInError('Account name must have 1 to 80 characters.');
      if (id) this.requireAccount(id);
      const saved = id ?? randomUUID();
      const accounts = id ? this.accounts.map((a) => a.id === id ? { ...a, name } : a) : [...this.accounts, { id: saved, name, account: null }];
      await this.commit(this.profiles, accounts);
      return this.accountView(saved);
    });
  }

  selectAccount(profileId: string, accountId: string | null) {
    return this.change(async () => {
      if (accountId !== undefined && accountId !== null) this.requireAccount(accountId);
      this.require(profileId);
      await this.commit(this.profiles.map((p) => p.id === profileId ? { ...p, accountId } : p));
    });
  }

  deleteAccount(id: string) {
    return this.change(async () => {
      this.requireAccount(id);
      if (this.profiles.some((p) => p.accountId === id)) throw new SignInError('Remove this account from its profiles before deleting it.');
      await this.commit(this.profiles, this.accounts.filter((a) => a.id !== id));
      this.cancelSignIn(id);
    });
  }

  signOutAccount(id: string) {
    return this.change(async () => {
      await this.setAccount(id, null);
      this.cancelSignIn(id);
      return this.accountView(id);
    });
  }

  private cancelSignIn(id: string) {
    for (const [key, p] of this.pending) if (p.accountId === id) this.pending.delete(key);
  }

  private requireAccount(id: string) {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) throw new SignInError(`No account ${id}`);
    return account;
  }

  private setAccount(id: string, account: ClaudeAccount | null) {
    this.requireAccount(id);
    return this.commit(this.profiles, this.accounts.map((a) => a.id === id ? { ...a, account } : a));
  }

  private async commit(profiles: HubProfile[], accounts = this.accounts) {
    await this.file.write({ profiles, accounts });
    this.profiles = profiles;
    this.accounts = accounts;
  }

  private change<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
}
