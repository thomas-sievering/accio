import type { ProfileView } from '@accio/protocol';
import { SignInError, type Hub, type SharedSettings } from '@accio/hub';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { saveProfile, toView, type Profile } from './profile.js';
import { writeConfigFolder, type HubAccess } from './claudeConfigFolder.js';

/** Other slices that hold on to a profile (projects, threads) veto its deletion here. */
export type ProfileInUse = (profileId: string) => string | undefined;

/** The profiles, stored on the hub (ADR 0004): the rules in profile.ts, coordinated with named accounts and machine config folders here. */
export class Profiles {
  private queue: Promise<unknown> = Promise.resolve();
  private inUseChecks: ProfileInUse[] = [];

  constructor(
    private home: string,
    private hub: Hub,
    private settings: SharedSettings,
    private hubUrl: string,
    private broadcast: Broadcast,
  ) {}

  async load() {
    // ADR 0003: rewrite every profile's config folder on start.
    for (const a of this.list) await this.connect(a.id);
  }

  private get list(): readonly Profile[] {
    return this.settings.profiles();
  }

  all(): readonly Profile[] {
    return this.list;
  }

  get(id: string): Profile | undefined {
    return this.list.find((a) => a.id === id);
  }

  require(id: string): Profile {
    const a = this.get(id);
    if (!a) throw new UserError(`No profile ${id}`);
    return a;
  }

  profileView(id: string): ProfileView {
    return this.view(this.require(id));
  }

  /** What a thread needs to run under this profile; refuses until it is signed in. */
  async hubAccess(id: string): Promise<HubAccess> {
    const profile = this.require(id);
    if (!this.hub.summary(id).signedIn) throw new UserError(`Select a signed-in Claude account for ${profile.name} in Profiles.`);
    return { baseUrl: this.hubUrl, accessKey: await this.hub.ensureProfile(id) };
  }

  onCheckInUse(check: ProfileInUse) {
    this.inUseChecks.push(check);
  }

  register(router: Router) {
    router
      .on('accounts.list', () => this.hub.accountViews())
      .on('accounts.save', async ({ id, name }) => {
        const account = await asUserError(() => this.hub.saveAccount(name, id));
        this.announce();
        return account;
      })
      .on('accounts.delete', async ({ id }) => {
        await asUserError(() => this.hub.deleteAccount(id));
        this.announce();
        return null;
      })
      .on('accounts.beginSignIn', ({ id }) => asUserError(async () => this.hub.beginAccountSignIn(id)))
      .on('accounts.completeSignIn', async ({ signInId, code }) => {
        const account = await asUserError(() => this.hub.completeAccountSignIn(signInId, code));
        this.announce();
        return account;
      })
      .on('accounts.signOut', async ({ id }) => {
        const account = await asUserError(() => this.hub.signOutAccount(id));
        this.announce();
        return account;
      })
      .on('profiles.list', () => this.views())
      .on('profiles.save', (req) => this.change(async () => {
        const { profiles, saved } = saveProfile(this.list, req);
        await asUserError(() => this.hub.configureProfile(saved.id, req.accountId, async (accessKey) => {
          await writeConfigFolder(this.home, saved.id, { baseUrl: this.hubUrl, accessKey });
          await this.settings.setProfiles(profiles);
        }));
        this.announce();
        return this.view(saved);
      }))
      .on('profiles.delete', ({ id }) => this.change(async () => {
        const profile = this.require(id);
        for (const check of this.inUseChecks) {
          const reason = check(id);
          if (reason) throw new UserError(`${profile.name} is still used by ${reason}`);
        }
        await this.hub.removeProfile(id, () => this.settings.setProfiles(this.list.filter((a) => a.id !== id)));
        this.announce();
        return null;
      }));
  }

  private view(a: Profile): ProfileView {
    return toView(a, this.hub.selectedAccount(a.id));
  }

  private views(): ProfileView[] {
    return this.list.map((a) => this.view(a));
  }

  /** Makes sure the hub knows the profile and its config folder points there. */
  private async connect(id: string) {
    const accessKey = await this.hub.ensureProfile(id);
    await writeConfigFolder(this.home, id, { baseUrl: this.hubUrl, accessKey });
  }

  private announce() {
    this.broadcast('profiles.changed', this.views());
    this.broadcast('accounts.changed', this.hub.accountViews());
  }

  private change<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
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
