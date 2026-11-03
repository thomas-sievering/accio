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
import { OpenAIAuth } from './openaiAuth.js';

/**
 * GLOSSARY: Hub. Holds named provider accounts selected by profiles and hands out one access
 * key per profile; a key only ever unlocks its own profile's account (ADR 0007).
 * Profiles here are just ids: names and rules live in accio. A profile selects
 * at most one Claude account and one ChatGPT account.
 */
export type HubProfile = {
  id: string;
  accessKey: string;
  accountId: string | null;
  openaiAccountId?: string | null;
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
  private openaiPending = new Map<string, string>();

  constructor(
    home: string,
    private fetchImpl: Fetch = fetch,
    private openai: OpenAIAuth = new OpenAIAuth(home),
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
  configureProfile(id: string, accountId: string | null | undefined, prepare: (key: string) => Promise<void>, openaiAccountId?: string | null) {
    return this.change(async () => {
      if (accountId != null) this.requireProvider(accountId, 'anthropic');
      if (openaiAccountId != null) this.requireProvider(openaiAccountId, 'openai');
      const existing = this.profiles.find((p) => p.id === id);
      const profile = { ...(existing ?? this.newProfile(id)) };
      if (accountId !== undefined) profile.accountId = accountId;
      if (openaiAccountId !== undefined) profile.openaiAccountId = openaiAccountId;
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
    this.requireProvider(accountId, 'anthropic');
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

  async beginOpenAISignIn(accountId: string) {
    return this.change(async () => {
      this.requireProvider(accountId, 'openai');
      await this.cancelOpenAISignIn(accountId);
      const result = await this.openai.begin();
      this.openaiPending.set(result.signInId, accountId);
      return result;
    });
  }

  openaiSignInStatus(signInId: string) {
    return this.change(async () => {
      const id = this.openaiPending.get(signInId);
      if (!id) throw new SignInError('This sign-in has expired or was cancelled. Start it again.');
      this.requireProvider(id, 'openai');
      const result = await this.openai.status(signInId);
      if (result.status === 'pending') return result;
      const previous = this.requireAccount(id).openai;
      await this.commit(this.profiles, this.accounts.map((a) => a.id === id ? { ...a, openai: result.account } : a));
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

  codexModels(profileId: string) {
    const id = this.profiles.find((p) => p.id === profileId)?.openaiAccountId;
    return this.accounts.find((a) => a.id === id)?.openai?.models ?? [];
  }

  async openaiCredentials(profileId: string, force = false) {
    const id = this.require(profileId).openaiAccountId;
    const account = this.accounts.find((a) => a.id === id)?.openai;
    if (!account) return null;
    const credentials = await this.openai.credentials(account, force);
    // A sign-out or account switch during refresh must not unlock the previous account.
    const current = this.profiles.find((p) => p.id === profileId)?.openaiAccountId;
    return current === id && this.accounts.find((a) => a.id === id)?.openai === account ? credentials : null;
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
    await this.openai.close();
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
    if (a.providerId === 'openai') return { id: a.id, name: a.name, providerId: 'openai' as const, signedIn: !!a.openai, email: a.openai?.email ?? null, organization: null };
    return { id: a.id, name: a.name, providerId: 'anthropic' as const, signedIn: !!a.account, email: a.account?.email ?? null, organization: a.account?.organization ?? null };
  }

  selectedAccount(profileId: string, providerId: 'anthropic' | 'openai' = 'anthropic') {
    const profile = this.profiles.find((p) => p.id === profileId);
    const id = providerId === 'openai' ? profile?.openaiAccountId : profile?.accountId;
    return id ? this.accountView(id) : null;
  }

  saveAccount(name: string, id?: string, providerId?: 'anthropic' | 'openai') {
    return this.change(async () => {
      name = name.trim();
      if (!name || name.length > 80) throw new SignInError('Account name must have 1 to 80 characters.');
      if (id) this.requireAccount(id);
      if (id && providerId && (this.requireAccount(id).providerId ?? 'anthropic') !== providerId) throw new SignInError('An account cannot change provider.');
      const saved = id ?? randomUUID();
      const accounts = id ? this.accounts.map((a) => a.id === id ? { ...a, name } : a) : [...this.accounts, { id: saved, name, providerId: providerId ?? 'anthropic', account: null }];
      await this.commit(this.profiles, accounts);
      return this.accountView(saved);
    });
  }

  selectAccount(profileId: string, accountId: string | null) {
    return this.change(async () => {
      if (accountId != null) this.requireProvider(accountId, 'anthropic');
      this.require(profileId);
      await this.commit(this.profiles.map((p) => p.id === profileId ? { ...p, accountId } : p));
    });
  }

  deleteAccount(id: string) {
    return this.change(async () => {
      const account = this.requireAccount(id);
      if (this.profiles.some((p) => p.accountId === id || p.openaiAccountId === id)) throw new SignInError('Remove this account from its profiles before deleting it.');
      await this.commit(this.profiles, this.accounts.filter((a) => a.id !== id));
      this.cancelSignIn(id);
      await this.cancelOpenAISignIn(id);
      if (account.openai) await this.openai.remove(account.openai.credentialId);
    });
  }

  signOutAccount(id: string) {
    return this.change(async () => {
      const account = this.requireAccount(id);
      await this.commit(this.profiles, this.accounts.map((a) => a.id === id ? { ...a, account: null, openai: null } : a));
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

  private requireProvider(id: string, providerId: 'anthropic' | 'openai') {
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
