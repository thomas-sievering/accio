import { accountInUse, noHouseMessage, providerAccounts, type AccountLimitsView, type AccountView, type LimitWindow, type ProfileView, type ProviderId } from '@accio/protocol';
import { HubClient } from '@accio/hub';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { writeConfigFolder, type HubAccess } from './claudeConfigFolder.js';
import { BrowserSignIns } from '../hub/browserSignIns.js';

export type ProfileInUse = (profileId: string) => string | undefined;

/** Hub-backed profiles; only configuration and usage reservations live on the machine. */
export class Profiles {
  private queue: Promise<unknown> = Promise.resolve();
  private inUseChecks: ProfileInUse[] = [];
  private users = new Map<string, number>();
  private removing = new Set<string>();
  private closing = false;
  private announcedProfiles = '';
  private announcedAccounts = '';
  private announcedModels = '';
  private announcedLimits = '';
  private announcedSortingHat = '';
  readonly signIns: BrowserSignIns;
  private referenceQueue: Promise<unknown> = Promise.resolve();
  /** `references` names the profiles this machine's projects and threads use, so the hub keeps them. */
  constructor(private home: string, readonly client: HubClient, private broadcast: Broadcast, private references: () => string[]) {
    this.signIns = new BrowserSignIns(client);
    client.onChanged(() => this.announce());
  }
  async load() {
    if (this.client.status !== 'connected') return;
    // A profile without a house on the hub's Sorting Hat gets no key; its threads say why when they start.
    for (const profile of this.client.snapshot?.profiles ?? []) if (profile.house !== null) await this.connect(profile.id).catch((error) => console.error(`[profiles] ${profile.name}:`, (error as Error).message));
  }
  all(): readonly ProfileView[] { return this.client.snapshot?.profiles ?? []; }
  get(id: string) { return this.all().find((p) => p.id === id); }
  require(id: string) { const profile = this.get(id); if (!profile) throw new UserError(`No profile ${id}`); return profile; }
  profileView(id: string): ProfileView { return this.require(id); }
  /** GLOSSARY: Account. Each account once, as the hub's snapshot lists them; profiles name theirs by id. */
  accounts(): readonly AccountView[] { return this.client.snapshot?.accounts ?? []; }
  /** The profile's accounts at a provider, in order. */
  providerAccounts(id: string, providerId: ProviderId) { return providerAccounts(this.provider(id, providerId), this.accounts()); }
  /** GLOSSARY: Account in use. The profile's account at the provider that the Sorting Hat chose for the next request. */
  accountInUse(id: string, providerId: ProviderId) { return accountInUse(this.provider(id, providerId), this.accounts()); }
  private provider(id: string, providerId: ProviderId) { return this.profileView(id).providers.find((p) => p.id === providerId); }
  codexModels(id: string) { this.require(id); return this.client.snapshot.models[id] ?? []; }
  limitWindows(accountId: string): LimitWindow[] {
    return this.limitViews().find((v) => v.accountId === accountId)?.snapshot?.windows ?? [];
  }
  refreshLimits(profileId: string, providerId: ProviderId) {
    const account = this.accountInUse(profileId, providerId);
    if (!account) return;
    void this.client.call('accounts.refreshLimits', { accountIds: [account.id] }).catch((error) => console.error('[limits] background refresh failed', (error as Error).message));
  }
  limitViews(): AccountLimitsView[] { return this.client.snapshot?.limits ?? []; }
  onLimitsChanged(listener: () => void) { this.client.onChanged(listener); }
  async hubAccess(id: string, providerId: ProviderId = 'anthropic'): Promise<HubAccess> {
    const profile = this.profileView(id);
    if (profile.house === null) throw new UserError(noHouseMessage(profile.name));
    if (!this.providerAccounts(id, providerId).some((a) => a.signedIn)) throw new UserError(`Select a signed-in ${providerId === 'openai' ? 'ChatGPT' : 'Claude'} account for ${profile.name} in Profiles.`);
    await this.syncReferences(); return this.connect(id);
  }
  syncReferences() {
    const refs = [...new Set([...this.references(), ...this.users.keys()])];
    const next = this.referenceQueue.then(() => this.client.call('machine.references', { profiles: refs }));
    this.referenceQueue = next.catch(() => {}); return next;
  }
  onCheckInUse(check: ProfileInUse) { this.inUseChecks.push(check); }
  useProfile(id: string) {
    this.require(id);
    if (this.closing) throw new UserError('This machine is shutting down');
    if (this.removing.has(id)) throw new UserError('This profile is being removed');
    this.users.set(id, (this.users.get(id) ?? 0) + 1);
    let released = false;
    return () => { if (released) return; released = true; const count = this.users.get(id)! - 1; if (count) this.users.set(id, count); else this.users.delete(id); };
  }
  async close() { this.closing = true; await this.queue; await this.signIns.close(); }
  stopAccepting() { this.closing = true; }
  register(router: Router) {
    router.on('accounts.list', () => this.client.snapshot?.accounts ?? [])
      .on('accounts.limits', () => this.client.snapshot?.limits ?? [])
      .on('accounts.refreshLimits', params => this.client.call('accounts.refreshLimits', params))
      .on('accounts.save', (p) => this.client.call('accounts.save', p))
      .on('accounts.delete', (p) => this.client.call('accounts.delete', p))
      .on('accounts.signOut', (p) => this.client.call('accounts.signOut', p))
      .on('accounts.beginSignIn', ({ id }) => this.signIns.begin(id))
      .on('accounts.signInStatus', async (p) => {
        try {
          const result = await this.client.call('accounts.signInStatus', p);
          if (result.status === 'complete') this.signIns.finish(p.signInId);
          return result;
        } catch (error) { this.signIns.finish(p.signInId); throw error; }
      })
      .on('accounts.cancelSignIn', async (p) => { this.signIns.finish(p.signInId); return this.client.call('accounts.cancelSignIn', p); })
      .on('profiles.list', () => this.client.snapshot?.profiles ?? [])
      .on('sortingHat.get', () => this.client.snapshot?.sortingHat ?? null)
      // The admin token passes through to the hub, which keeps it; nothing here stores or returns it.
      .on('sortingHat.configure', (p) => this.client.call('sortingHat.configure', p))
      .on('sortingHat.disconnect', () => this.client.call('sortingHat.disconnect', {}))
      .on('profiles.save', (p) => this.change(async () => {
        const saved = await this.client.call<ProfileView>('profiles.save', p);
        if (saved.house !== null) await this.connect(saved.id);
        return saved;
      }))
      .on('profiles.delete', ({ id }) => this.change(async () => {
        const profile = this.require(id);
        if (this.users.has(id)) throw new UserError(`${profile.name} is being used to start a thread or add a project. Wait for it to finish.`);
        this.removing.add(id);
        try {
          for (const check of this.inUseChecks) { const reason = check(id); if (reason) throw new UserError(`${profile.name} is still used by ${reason}`); }
          await this.syncReferences();
          await this.client.call('profiles.delete', { id }); return null;
        } finally { this.removing.delete(id); }
      }));
  }
  private async connect(id: string): Promise<HubAccess> {
    // GLOSSARY: Hat key. The hub answers with this machine's key for the profile's house and the address threads reach the Sorting Hat at.
    const { key, url } = await this.client.call<{ key: string; url: string }>('machine.modelKey', { profileId: id });
    const access = { baseUrl: url, accessKey: key };
    await writeConfigFolder(this.home, id, access); return access;
  }
  private announce() {
    const profiles = this.client.snapshot?.profiles ?? [];
    const accounts = this.client.snapshot?.accounts ?? [];
    const profileState = JSON.stringify(profiles), accountState = JSON.stringify(accounts);
    const modelState = JSON.stringify([profiles, accounts, this.client.snapshot?.models, this.client.snapshot?.favorites]);
    if (profileState !== this.announcedProfiles) { this.announcedProfiles = profileState; this.broadcast('profiles.changed', profiles); }
    if (accountState !== this.announcedAccounts) { this.announcedAccounts = accountState; this.broadcast('accounts.changed', accounts); }
    if (modelState !== this.announcedModels) { this.announcedModels = modelState; this.broadcast('models.changed', null); }
    const sortingHat = this.client.snapshot?.sortingHat ?? null, sortingHatState = JSON.stringify(sortingHat);
    if (sortingHatState !== this.announcedSortingHat) { this.announcedSortingHat = sortingHatState; this.broadcast('sortingHat.changed', sortingHat); }
    const limits = this.client.snapshot?.limits ?? [], limitState = JSON.stringify(limits);
    if (limitState !== this.announcedLimits) { this.announcedLimits = limitState; this.broadcast('accounts.limitsChanged', limits); }
  }
  private change<T>(fn: () => Promise<T>): Promise<T> { if (this.closing) return Promise.reject(new UserError('This machine is shutting down')); const p = this.queue.then(fn); this.queue = p.catch(() => {}); return p; }
}
