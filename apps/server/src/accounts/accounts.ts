import { join } from 'node:path';
import type { AccountView } from '@accio/protocol';
import { SignInError, type Hub } from '@accio/hub';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { JsonFile } from '../store/jsonFile.js';
import { assertLoginKeptApart, saveAccount, toView, type Account } from './account.js';
import { writeConfigFolder, type HubAccess } from './claudeConfigFolder.js';

/** Other slices that hold on to an account (projects, threads) veto its deletion here. */
export type AccountInUse = (accountId: string) => string | undefined;

/** The accounts on this machine: persistence, the rules in account.ts, and their sign-in on the hub. */
export class Accounts {
  private file: JsonFile<Account[]>;
  private list: Account[] = [];
  private inUseChecks: AccountInUse[] = [];

  constructor(
    private home: string,
    private hub: Hub,
    private hubUrl: string,
    private broadcast: Broadcast,
  ) {
    this.file = new JsonFile(join(home, 'accounts.json'), () => []);
  }

  async load() {
    // Keep only today's fields (v0.1 accounts also had a hand-typed hub URL and key).
    this.list = (await this.file.read()).map(({ id, name, isJob, roots }) => ({ id, name, isJob, roots: roots ?? [] }));
    // ADR 0003: rewrite every account's config folder on start.
    for (const a of this.list) await this.connect(a.id);
  }

  all(): readonly Account[] {
    return this.list;
  }

  get(id: string): Account | undefined {
    return this.list.find((a) => a.id === id);
  }

  require(id: string): Account {
    const a = this.get(id);
    if (!a) throw new UserError(`No account ${id}`);
    return a;
  }

  /** What a thread needs to run under this account; refuses until it is signed in. */
  async hubAccess(id: string): Promise<HubAccess> {
    const account = this.require(id);
    if (!this.hub.summary(id).signedIn) throw new UserError(`Sign ${account.name} in with Claude first (Accounts).`);
    return { baseUrl: this.hubUrl, accessKey: await this.hub.ensureAccount(id) };
  }

  onCheckInUse(check: AccountInUse) {
    this.inUseChecks.push(check);
  }

  register(router: Router) {
    router
      .on('accounts.list', () => this.views())
      .on('accounts.save', async (req) => {
        const { accounts, saved } = saveAccount(this.list, req);
        await this.commit(accounts);
        await this.connect(saved.id);
        return this.view(saved);
      })
      .on('accounts.delete', async ({ id }) => {
        const account = this.require(id);
        for (const check of this.inUseChecks) {
          const reason = check(id);
          if (reason) throw new UserError(`${account.name} is still used by ${reason}`);
        }
        await this.commit(this.list.filter((a) => a.id !== id));
        await this.hub.removeAccount(id);
        return null;
      })
      .on('accounts.beginSignIn', async ({ accountId }) => {
        this.require(accountId);
        await this.hub.ensureAccount(accountId);
        return this.hub.beginSignIn(accountId);
      })
      .on('accounts.completeSignIn', async ({ signInId, code }) => {
        const accountId = await asUserError(() =>
          this.hub.completeSignIn(signInId, code, (who, id) =>
            assertLoginKeptApart(this.list, (other) => this.hub.summary(other), id, who.claudeAccountId),
          ),
        );
        this.announce();
        return this.view(this.require(accountId));
      })
      .on('accounts.signOut', async ({ accountId }) => {
        const account = this.require(accountId);
        await this.hub.signOut(accountId);
        this.announce();
        return this.view(account);
      });
  }

  private view(a: Account): AccountView {
    return toView(a, this.hub.summary(a.id));
  }

  private views(): AccountView[] {
    return this.list.map((a) => this.view(a));
  }

  /** Makes sure the hub knows the account and its config folder points there. */
  private async connect(id: string) {
    const accessKey = await this.hub.ensureAccount(id);
    await writeConfigFolder(this.home, id, { baseUrl: this.hubUrl, accessKey });
  }

  private announce() {
    this.broadcast('accounts.changed', this.views());
  }

  private async commit(next: Account[]) {
    this.list = next;
    this.announce();
    await this.file.write(next);
  }
}

async function asUserError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SignInError) throw new UserError(err.message);
    throw err;
  }
}
