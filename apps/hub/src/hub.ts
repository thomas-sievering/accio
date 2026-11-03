import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { access, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
import { SecretFile } from './store.js';

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

type StoredAccount = { id: string; name: string; account: ClaudeAccount | null };
type Data = { profiles: HubProfile[]; accounts: StoredAccount[] };

const SIGN_IN_TTL_MS = 15 * 60 * 1000;

export class Hub {
  private file: SecretFile<Data | (HubProfile & { account?: ClaudeAccount; login?: ClaudeAccount })[]>;
  private profiles: HubProfile[] = [];
  private accounts: StoredAccount[] = [];
  private pending = new Map<string, PendingSignIn & { accountId: string; startedAt: number }>();
  private refreshing = new Map<string, Promise<ClaudeAccount>>();

  constructor(
    home: string,
    private fetchImpl: Fetch = fetch,
  ) {
    this.file = new SecretFile(join(home, 'hub', 'profiles.json'), () => ({ profiles: [], accounts: [] }));
  }

  /** The file that holds the hub's profiles and accounts. */
  get storePath(): string {
    return this.file.path;
  }

  async load() {
    // Before the Account → Profile rename this file was hub/accounts.json.
    const old = join(dirname(this.file.path), 'accounts.json');
    if (!(await exists(this.file.path)) && (await exists(old))) await rename(old, this.file.path);
    const stored = await this.file.read();
    if (Array.isArray(stored)) {
      this.accounts = stored.flatMap((p) => {
        const account = p.account ?? p.login;
        return account ? [{ id: `account-${p.id}`, name: account.email ?? p.id, account }] : [];
      });
      this.profiles = stored.map((p) => ({ id: p.id, accessKey: p.accessKey, accountId: this.accounts.some((a) => a.id === `account-${p.id}`) ? `account-${p.id}` : null }));
      await this.commit(this.profiles);
    } else {
      this.profiles = stored.profiles;
      this.accounts = stored.accounts;
    }
  }

  /** Creates the profile's access key on first use; returns it. */
  async ensureProfile(id: string): Promise<string> {
    const existing = this.profiles.find((a) => a.id === id);
    if (existing) return existing.accessKey;
    const profile: HubProfile = { id, accessKey: `accio-${randomBytes(24).toString('base64url')}`, accountId: null };
    await this.commit([...this.profiles, profile]);
    return profile.accessKey;
  }

  async removeProfile(id: string) {
    await this.commit(this.profiles.filter((a) => a.id !== id));
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

  /** Starts a sign-in; open the returned URL, then paste Claude's code into completeSignIn. */
  beginSignIn(profileId: string): { signInId: string; url: string } {
    const profile = this.require(profileId);
    if (!profile.accountId) {
      const id = `account-${profileId}`;
      if (!this.accounts.some((a) => a.id === id)) this.accounts.push({ id, name: profileId, account: null });
      profile.accountId = id;
    }
    return this.beginAccountSignIn(profile.accountId);
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

  /**
   * Exchanges the pasted code for an account. `accept` sees who signed in before
   * anything is stored and may refuse it.
   */
  async completeSignIn(
    signInId: string,
    pasted: string,
    accept: (who: AccountSummary, profileId: string) => void = () => {},
  ): Promise<string> {
    const p = this.pending.get(signInId);
    if (!p || Date.now() - p.startedAt > SIGN_IN_TTL_MS) throw new SignInError('This sign-in has expired. Start it again.');
    const code = readPastedCode(pasted, p);
    const account = await exchangeCode(this.fetchImpl, p, code);
    if (this.pending.get(signInId) !== p) throw new SignInError('This sign-in was cancelled. Start it again.');
    this.pending.delete(signInId);
    const profileId = this.profiles.find((profile) => profile.accountId === p.accountId)?.id ?? p.accountId;
    accept({ signedIn: true, email: account.email, organization: account.organization, claudeAccountId: account.claudeAccountId }, profileId);
    await this.setAccount(p.accountId, account);
    return profileId;
  }

  async completeAccountSignIn(signInId: string, code: string) {
    const id = this.pending.get(signInId)?.accountId;
    await this.completeSignIn(signInId, code);
    return this.accountView(id!);
  }

  async signOut(profileId: string) {
    const id = this.require(profileId).accountId;
    if (id) await this.signOutAccount(id);
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
        if (this.accounts.find((a) => a.id === accountId)?.account === account) await this.setAccount(accountId!, fresh);
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
    const currentId = this.require(profileId).accountId;
    return this.accounts.find((a) => a.id === currentId)?.account?.accessToken ?? null;
  }

  close(): Promise<void> {
    return this.file.idle();
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

  async saveAccount(name: string, id?: string) {
    if (id) this.requireAccount(id).name = name;
    else { id = randomUUID(); this.accounts.push({ id, name, account: null }); }
    await this.commit(this.profiles);
    return this.accountView(id);
  }

  async selectAccount(profileId: string, accountId: string | null) {
    if (accountId) this.requireAccount(accountId);
    this.require(profileId).accountId = accountId;
    await this.commit(this.profiles);
  }

  async deleteAccount(id: string) {
    this.requireAccount(id);
    if (this.profiles.some((p) => p.accountId === id)) throw new SignInError('Remove this account from its profiles before deleting it.');
    this.accounts = this.accounts.filter((a) => a.id !== id);
    for (const [key, p] of this.pending) if (p.accountId === id) this.pending.delete(key);
    await this.commit(this.profiles);
  }

  async signOutAccount(id: string) {
    for (const [key, p] of this.pending) if (p.accountId === id) this.pending.delete(key);
    await this.setAccount(id, null);
    return this.accountView(id);
  }

  private requireAccount(id: string) {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) throw new SignInError(`No account ${id}`);
    return account;
  }

  private async setAccount(id: string, account: ClaudeAccount | null) {
    this.requireAccount(id).account = account;
    await this.commit(this.profiles);
  }

  private async commit(next: HubProfile[]) {
    this.profiles = next;
    await this.file.write({ profiles: next, accounts: this.accounts });
  }
}

function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}
