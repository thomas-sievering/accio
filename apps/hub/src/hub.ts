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
 * GLOSSARY: Hub. Holds each profile's Claude account and hands out one access
 * key per profile; a key only ever unlocks its own profile's account (ADR 0007).
 * Profiles here are just ids: names and rules live in accio. For now a profile
 * has at most one account, at Claude, with its tokens.
 */
export type HubProfile = {
  id: string;
  accessKey: string;
  account: ClaudeAccount | null;
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
  private file: SecretFile<HubProfile[]>;
  private profiles: HubProfile[] = [];
  private pending = new Map<string, PendingSignIn & { profileId: string; startedAt: number }>();
  private refreshing = new Map<string, Promise<ClaudeAccount>>();

  constructor(
    home: string,
    private fetchImpl: Fetch = fetch,
  ) {
    this.file = new SecretFile(join(home, 'hub', 'profiles.json'), () => []);
  }

  async load() {
    // Before the Account → Profile rename this file was hub/accounts.json.
    const old = join(dirname(this.file.path), 'accounts.json');
    if (!(await exists(this.file.path)) && (await exists(old))) await rename(old, this.file.path);
    // Before the Account wording settled, a profile's account was stored as `login`.
    type Stored = HubProfile & { login?: ClaudeAccount | null };
    this.profiles = ((await this.file.read()) as Stored[]).map(({ login, ...p }) => ({ ...p, account: p.account ?? login ?? null }));
  }

  /** Creates the profile's access key on first use; returns it. */
  async ensureProfile(id: string): Promise<string> {
    const existing = this.profiles.find((a) => a.id === id);
    if (existing) return existing.accessKey;
    const profile: HubProfile = { id, accessKey: `accio-${randomBytes(24).toString('base64url')}`, account: null };
    await this.commit([...this.profiles, profile]);
    return profile.accessKey;
  }

  async removeProfile(id: string) {
    await this.commit(this.profiles.filter((a) => a.id !== id));
  }

  summary(id: string): AccountSummary {
    const account = this.profiles.find((a) => a.id === id)?.account ?? null;
    return {
      signedIn: account !== null,
      email: account?.email ?? null,
      organization: account?.organization ?? null,
      claudeAccountId: account?.claudeAccountId ?? null,
    };
  }

  /** Starts a sign-in; open the returned URL, then paste Claude's code into completeSignIn. */
  beginSignIn(profileId: string): { signInId: string; url: string } {
    this.require(profileId);
    const now = Date.now();
    for (const [key, p] of this.pending) if (now - p.startedAt > SIGN_IN_TTL_MS || p.profileId === profileId) this.pending.delete(key);
    const signInId = randomUUID();
    const p = beginSignIn();
    this.pending.set(signInId, { ...p, profileId, startedAt: now });
    return { signInId, url: p.url };
  }

  /**
   * Exchanges the pasted code for an account. `accept` sees who signed in before
   * anything is stored and may refuse (accio's one-profile-per-account rule).
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
    this.pending.delete(signInId);
    accept({ signedIn: true, email: account.email, organization: account.organization, claudeAccountId: account.claudeAccountId }, p.profileId);
    await this.setAccount(p.profileId, account);
    return p.profileId;
  }

  async signOut(profileId: string) {
    await this.setAccount(profileId, null);
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
    const account = this.require(profileId).account;
    if (!account) return null;
    if (!force && !needsRefresh(account)) return account.accessToken;
    // One refresh per profile at a time; concurrent requests share it.
    let pending = this.refreshing.get(profileId);
    if (!pending) {
      pending = refreshAccount(this.fetchImpl, account).then(async (fresh) => {
        await this.setAccount(profileId, fresh);
        return fresh;
      });
      this.refreshing.set(profileId, pending);
      void pending.then(
        () => this.refreshing.delete(profileId),
        () => this.refreshing.delete(profileId),
      );
    }
    return (await pending).accessToken;
  }

  close(): Promise<void> {
    return this.file.idle();
  }

  private require(id: string): HubProfile {
    const a = this.profiles.find((x) => x.id === id);
    if (!a) throw new SignInError(`The hub has no profile ${id}`);
    return a;
  }

  private async setAccount(profileId: string, account: ClaudeAccount | null) {
    await this.commit(this.profiles.map((a) => (a.id === profileId ? { ...a, account } : a)));
  }

  private async commit(next: HubProfile[]) {
    this.profiles = next;
    await this.file.write(next);
  }
}

function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}
