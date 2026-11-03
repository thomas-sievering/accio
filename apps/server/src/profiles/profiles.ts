import { mkdir } from 'node:fs/promises';
import type { ProfileView, ProviderId } from '@accio/protocol';
import { HubClient } from '@accio/hub';
import type { Broadcast, Router } from '../rpc/router.js';
import { UserError } from '../rpc/router.js';
import { saveProfile, type Profile } from './profile.js';
import { configFolderOf, writeConfigFolder, type HubAccess } from './claudeConfigFolder.js';
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
  readonly signIns: BrowserSignIns;
  private referenceSource = (): string[] => [];
  private referenceQueue: Promise<unknown> = Promise.resolve();
  constructor(private home: string, readonly client: HubClient, private broadcast: Broadcast) {
    this.signIns = new BrowserSignIns(client);
    client.onChanged(() => this.announce());
  }
  async load() {
    if (this.client.status !== 'connected') return;
    for (const profile of this.all()) await this.connect(profile.id);
  }
  all(): readonly Profile[] { return this.client.snapshot?.profiles ?? []; }
  get(id: string) { return this.all().find((p) => p.id === id); }
  require(id: string) { const profile = this.get(id); if (!profile) throw new UserError(`No profile ${id}`); return profile; }
  profileView(id: string): ProfileView { this.require(id); return this.client.snapshot.profiles.find((p) => p.id === id)!; }
  codexModels(id: string) { this.require(id); return this.client.snapshot.models[id] ?? []; }
  async hubAccess(id: string, providerId: ProviderId = 'anthropic'): Promise<HubAccess> {
    const profile = this.profileView(id);
    if (!profile.providers.find((p) => p.id === providerId)?.accounts.some((a) => a.signedIn)) throw new UserError(`Select a signed-in ${providerId === 'openai' ? 'ChatGPT' : 'Claude'} account for ${profile.name} in Profiles.`);
    await this.syncReferences(); return this.connect(id);
  }
  setReferenceSource(source: () => string[]) { this.referenceSource = source; }
  syncReferences() {
    const refs = [...new Set([...this.referenceSource(), ...this.users.keys()])];
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
      .on('accounts.save', (p) => this.client.call('accounts.save', p))
      .on('accounts.delete', (p) => this.client.call('accounts.delete', p))
      .on('accounts.signOut', (p) => this.client.call('accounts.signOut', p))
      .on('accounts.beginSignIn', ({ id }) => this.signIns.begin(id))
      .on('accounts.completeSignIn', async (p) => { const result = await this.client.call('accounts.completeSignIn', p); this.signIns.finish(p.signInId); return result; })
      .on('accounts.signInStatus', async (p) => {
        try {
          const result = await this.client.call('accounts.signInStatus', p);
          if (result.status === 'complete') this.signIns.finish(p.signInId);
          return result;
        } catch (error) { this.signIns.finish(p.signInId); throw error; }
      })
      .on('accounts.cancelSignIn', async (p) => { this.signIns.finish(p.signInId); return this.client.call('accounts.cancelSignIn', p); })
      .on('profiles.list', () => this.client.snapshot?.profiles ?? [])
      .on('profiles.save', (p) => this.change(async () => {
        const preview = saveProfile(this.all(), p).saved;
        await mkdir(configFolderOf(this.home, preview.id), { recursive: true });
        const saved = await this.client.call<ProfileView>('profiles.save', p);
        await this.connect(saved.id); return saved;
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
    const { key } = await this.client.call<{ key: string }>('machine.modelKey', { profileId: id });
    const access = { baseUrl: this.client.url, accessKey: key };
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
  }
  private change<T>(fn: () => Promise<T>): Promise<T> { if (this.closing) return Promise.reject(new UserError('This machine is shutting down')); const p = this.queue.then(fn); this.queue = p.catch(() => {}); return p; }
}
