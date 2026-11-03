import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import {
  SignInError,
  beginSignIn,
  exchangeCode,
  needsRefresh,
  readPastedCode,
  refreshLogin,
  type ClaudeLogin,
  type Fetch,
  type PendingSignIn,
} from './claudeOAuth.js';
import { SecretFile } from './store.js';

/**
 * GLOSSARY: Hub. Holds each account's provider login and hands out one access
 * key per account; a key only ever unlocks its own account's login (ADR 0007).
 * Accounts here are just ids: names, job flags and rules live in accio.
 */
export type HubAccount = {
  id: string;
  accessKey: string;
  login: ClaudeLogin | null;
};

/** What the hub tells accio about an account's sign-in. Never the tokens. */
export type SignInSummary = {
  signedIn: boolean;
  email: string | null;
  organization: string | null;
  claudeAccountId: string | null;
};

const SIGN_IN_TTL_MS = 15 * 60 * 1000;

export class Hub {
  private file: SecretFile<HubAccount[]>;
  private accounts: HubAccount[] = [];
  private pending = new Map<string, PendingSignIn & { accountId: string; startedAt: number }>();
  private refreshing = new Map<string, Promise<ClaudeLogin>>();

  constructor(
    home: string,
    private fetchImpl: Fetch = fetch,
  ) {
    this.file = new SecretFile(join(home, 'hub', 'accounts.json'), () => []);
  }

  async load() {
    this.accounts = await this.file.read();
  }

  /** Creates the account's access key on first use; returns it. */
  async ensureAccount(id: string): Promise<string> {
    const existing = this.accounts.find((a) => a.id === id);
    if (existing) return existing.accessKey;
    const account: HubAccount = { id, accessKey: `accio-${randomBytes(24).toString('base64url')}`, login: null };
    await this.commit([...this.accounts, account]);
    return account.accessKey;
  }

  async removeAccount(id: string) {
    await this.commit(this.accounts.filter((a) => a.id !== id));
  }

  summary(id: string): SignInSummary {
    const login = this.accounts.find((a) => a.id === id)?.login ?? null;
    return {
      signedIn: login !== null,
      email: login?.email ?? null,
      organization: login?.organization ?? null,
      claudeAccountId: login?.claudeAccountId ?? null,
    };
  }

  /** Starts a sign-in; open the returned URL, then paste Claude's code into completeSignIn. */
  beginSignIn(accountId: string): { signInId: string; url: string } {
    this.require(accountId);
    const now = Date.now();
    for (const [key, p] of this.pending) if (now - p.startedAt > SIGN_IN_TTL_MS || p.accountId === accountId) this.pending.delete(key);
    const signInId = randomUUID();
    const p = beginSignIn();
    this.pending.set(signInId, { ...p, accountId, startedAt: now });
    return { signInId, url: p.url };
  }

  /**
   * Exchanges the pasted code for a login. `accept` sees who signed in before
   * anything is stored and may refuse (accio's job-account rule).
   */
  async completeSignIn(
    signInId: string,
    pasted: string,
    accept: (who: SignInSummary, accountId: string) => void = () => {},
  ): Promise<string> {
    const p = this.pending.get(signInId);
    if (!p || Date.now() - p.startedAt > SIGN_IN_TTL_MS) throw new SignInError('This sign-in has expired. Start it again.');
    const code = readPastedCode(pasted, p);
    const login = await exchangeCode(this.fetchImpl, p, code);
    this.pending.delete(signInId);
    accept({ signedIn: true, email: login.email, organization: login.organization, claudeAccountId: login.claudeAccountId }, p.accountId);
    await this.setLogin(p.accountId, login);
    return p.accountId;
  }

  async signOut(accountId: string) {
    await this.setLogin(accountId, null);
  }

  /** The account a request's key belongs to, or undefined for an unknown key. */
  accountForKey(key: string): HubAccount | undefined {
    const given = Buffer.from(key);
    return this.accounts.find((a) => {
      const k = Buffer.from(a.accessKey);
      return k.length === given.length && timingSafeEqual(k, given);
    });
  }

  /** A usable access token for the account, refreshed first when close to expiry (or when forced). */
  async accessToken(accountId: string, { force = false } = {}): Promise<string | null> {
    const login = this.require(accountId).login;
    if (!login) return null;
    if (!force && !needsRefresh(login)) return login.accessToken;
    // One refresh per account at a time; concurrent requests share it.
    let pending = this.refreshing.get(accountId);
    if (!pending) {
      pending = refreshLogin(this.fetchImpl, login).then(async (fresh) => {
        await this.setLogin(accountId, fresh);
        return fresh;
      });
      this.refreshing.set(accountId, pending);
      void pending.then(
        () => this.refreshing.delete(accountId),
        () => this.refreshing.delete(accountId),
      );
    }
    return (await pending).accessToken;
  }

  close(): Promise<void> {
    return this.file.idle();
  }

  private require(id: string): HubAccount {
    const a = this.accounts.find((x) => x.id === id);
    if (!a) throw new SignInError(`The hub has no account ${id}`);
    return a;
  }

  private async setLogin(accountId: string, login: ClaudeLogin | null) {
    await this.commit(this.accounts.map((a) => (a.id === accountId ? { ...a, login } : a)));
  }

  private async commit(next: HubAccount[]) {
    this.accounts = next;
    await this.file.write(next);
  }
}
