import { join } from 'node:path';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { JsonFile } from '../store/jsonFile.js';
import { saveAccount, toView, type Account } from './account.js';
import { writeConfigFolder } from './claudeConfigFolder.js';

/** Other slices that hold on to an account (projects) veto its deletion here. */
export type AccountInUse = (accountId: string) => string | undefined;

/** The accounts on this machine: persistence plus the rules in account.ts. */
export class Accounts {
  private file: JsonFile<Account[]>;
  private list: Account[] = [];
  private inUseChecks: AccountInUse[] = [];

  constructor(
    private home: string,
    private broadcast: Broadcast,
  ) {
    this.file = new JsonFile(join(home, 'accounts.json'), () => []);
  }

  async load() {
    // Accounts saved before a field existed get its default.
    this.list = (await this.file.read()).map((a) => ({ ...a, roots: a.roots ?? [] }));
    // ADR 0003: rewrite every account's config folder on start.
    await Promise.all(this.list.map((a) => writeConfigFolder(this.home, a)));
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

  onCheckInUse(check: AccountInUse) {
    this.inUseChecks.push(check);
  }

  register(router: Router) {
    router
      .on('accounts.list', () => this.list.map(toView))
      .on('accounts.save', async (req) => {
        const { accounts, saved } = saveAccount(this.list, req);
        await writeConfigFolder(this.home, saved);
        await this.commit(accounts);
        return toView(saved);
      })
      .on('accounts.delete', async ({ id }) => {
        const account = this.require(id);
        for (const check of this.inUseChecks) {
          const reason = check(id);
          if (reason) throw new UserError(`${account.name} is still used by ${reason}`);
        }
        await this.commit(this.list.filter((a) => a.id !== id));
        return null;
      });
  }

  private async commit(next: Account[]) {
    this.list = next;
    this.broadcast('accounts.changed', next.map(toView));
    await this.file.write(next);
  }
}
