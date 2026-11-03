import type { ProfileView } from '@accio/protocol';
import { SignInError, type Hub, type SharedSettings } from '@accio/hub';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { assertAccountInOneProfile, saveProfile, toView, type Profile } from './profile.js';
import { writeConfigFolder, type HubAccess } from './claudeConfigFolder.js';

/** Other slices that hold on to a profile (projects, threads) veto its deletion here. */
export type ProfileInUse = (profileId: string) => string | undefined;

/** The profiles, stored on the hub (ADR 0004): the rules in profile.ts, and their sign-in there. */
export class Profiles {
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
    if (!this.hub.summary(id).signedIn) throw new UserError(`Sign ${profile.name} in with Claude first (Profiles).`);
    return { baseUrl: this.hubUrl, accessKey: await this.hub.ensureProfile(id) };
  }

  onCheckInUse(check: ProfileInUse) {
    this.inUseChecks.push(check);
  }

  register(router: Router) {
    router
      .on('profiles.list', () => this.views())
      .on('profiles.save', async (req) => {
        const { profiles, saved } = saveProfile(this.list, req);
        await this.commit(profiles);
        await this.connect(saved.id);
        return this.view(saved);
      })
      .on('profiles.delete', async ({ id }) => {
        const profile = this.require(id);
        for (const check of this.inUseChecks) {
          const reason = check(id);
          if (reason) throw new UserError(`${profile.name} is still used by ${reason}`);
        }
        await this.commit(this.list.filter((a) => a.id !== id));
        await this.hub.removeProfile(id);
        return null;
      })
      .on('profiles.beginSignIn', async ({ profileId }) => {
        this.require(profileId);
        await this.hub.ensureProfile(profileId);
        return this.hub.beginSignIn(profileId);
      })
      .on('profiles.completeSignIn', async ({ signInId, code }) => {
        const profileId = await asUserError(() =>
          this.hub.completeSignIn(signInId, code, (who, id) =>
            assertAccountInOneProfile(this.list, (other) => this.hub.summary(other), id, who.claudeAccountId),
          ),
        );
        this.announce();
        return this.view(this.require(profileId));
      })
      .on('profiles.signOut', async ({ profileId }) => {
        const profile = this.require(profileId);
        await this.hub.signOut(profileId);
        this.announce();
        return this.view(profile);
      });
  }

  private view(a: Profile): ProfileView {
    return toView(a, this.hub.summary(a.id));
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
  }

  private async commit(next: Profile[]) {
    await this.settings.setProfiles(next);
    this.announce();
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
