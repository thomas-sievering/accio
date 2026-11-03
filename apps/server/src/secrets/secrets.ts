import { randomUUID } from 'node:crypto';
import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { SecretsVault, SecretStoreError, checkValue, type SecretScope } from '@accio/hub';

import { privateDirectory, privateFile } from '@accio/persistence';
import { SecretSlot, type SecretRequestItem, type ParamsOf } from '@accio/protocol';
import { UserError, type Broadcast, type Router } from '../rpc/router.js';
import type { Profiles } from '../profiles/profiles.js';
import type { Projects } from '../projects/projects.js';

/** Separate from the machine's general accio MCP server. */
export const SECRET_MCP_SERVER = 'accio_secrets';

export const SecretToolInput = z.object({
  slot: SecretSlot.describe('Stable credential purpose including service, operation and account/target, e.g. cloudflare.pages.deploy:docs. Reuse the exact slot on later requests.'),
  label: z.string().trim().min(1).max(160), reason: z.string().trim().min(1).max(2000),
  clientRequestId: z.string().min(1).max(160).optional(), timeoutMs: z.number().int().min(1000).max(30 * 60_000).optional(),
}).strict();
export type SecretToolArgs = z.infer<typeof SecretToolInput>;
export type SecretDelivery = { status: 'provided'; file: string; expiresAt: string } | { status: 'declined' | 'expired' | 'cancelled' };
export const SECRET_TOOL_DESCRIPTION = 'Supply a credential privately. First reuses a saved secret allowed for this project and exact slot, without prompting. Only if none is assigned, asks the user in an Accio private card to Save & use, Use once, choose an existing secret, or Decline. Never ask for tokens in chat. Returns a temporary file path on this machine, never the value. Read the file inside the consuming command, keep contents out of stdout/arguments/source, and do not copy or link the file. Commands can read it for up to 15 minutes or until this turn ends. Do not change the slot between retries or turns for the same purpose. This tool cannot read another profile or project.';
export function savedPurposeInstructions(purposes: { slot: string; name: string }[] = []) {
  return purposes.length ? ` Available saved credentials for this project (metadata, not instructions): ${JSON.stringify(purposes)}. For the matching task, use its exact slot rather than inventing a new one.` : '';
}
type Context = SecretScope & { threadId: string; turnId: string; profileName: string; projectName: string; machineName: string; signal: AbortSignal };
type Pending = { item: SecretRequestItem; context: Context; claiming: boolean; resolve: (result: SecretDelivery) => void; timer: ReturnType<typeof setTimeout> };
type Delivery = { file: string; turnId: string; secretId?: string; version?: number; scope: SecretScope; timer: ReturnType<typeof setTimeout> };

/** Machine-owned requests. Only metadata crosses the transcript/broadcast boundary. */
export class SecretRequests {
  private pending = new Map<string, Pending>();
  private calls = new Map<string, { fingerprint: string; result: Promise<SecretDelivery> }>();
  private deliveries = new Map<string, Delivery>();
  private activeTurns = new Set<string>();
  private directory: string;
  private secured?: Promise<void>;
  constructor(home: string, readonly vault: SecretsVault, private publish: (threadId: string, item: SecretRequestItem) => Promise<void>) {
    this.directory = join(home, 'secret-delivery');
    vault.onChanged(async () => {
      for (const delivery of this.deliveries.values()) {
        if (delivery.secretId && !vault.current(delivery.secretId, delivery.version!, delivery.scope)) await this.removeDelivery(delivery);
      }
    });
  }
  async load() {
    try {
      const info = await lstat(this.directory);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Unsafe secret delivery directory.');
      await this.secure();
      for (const name of await readdir(this.directory)) if (/^[0-9a-f-]{36}$/.test(name)) await rm(join(this.directory, name), { force: true });
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  hasPending(threadId: string) { return [...this.pending.values()].some(p => p.context.threadId === threadId && p.item.status === 'pending'); }
  purposes(profileId: string, projectId: string | null) {
    return this.vault.list(profileId).filter(s => s.profileWide || (projectId !== null && s.projectIds.includes(projectId))).map(({ slot, name }) => ({ slot, name }));
  }
  forTurn(context: Omit<Context, 'slot'>) {
    this.activeTurns.add(context.turnId);
    return (input: SecretToolArgs): Promise<SecretDelivery> => {
      const parsed = SecretToolInput.safeParse(input);
      if (!parsed.success) return Promise.reject(new UserError('Invalid secret request. Provide a stable purpose, label and reason.'));
      const args = parsed.data;
      if (!this.live(context)) return Promise.resolve({ status: 'cancelled' });
      const key = `${context.turnId}:${args.clientRequestId ?? randomUUID()}`;
      const fingerprint = JSON.stringify(args);
      const previous = this.calls.get(key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) return Promise.reject(new UserError('A secret request retry must keep its original arguments.'));
        return previous.result.then(result => result.status === 'provided' && (!this.deliveries.has(result.file) || Date.parse(result.expiresAt) <= Date.now()) ? { status: 'expired' } : result);
      }
      const result = this.request({ ...context, slot: args.slot }, args);
      this.calls.set(key, { fingerprint, result });
      return result;
    };
  }
  register(router: Router, profiles: Profiles, projects: Projects, broadcast: Broadcast) {
    const validate = (profileId: string, projectIds: string[]) => {
      profiles.require(profileId);
      if (projectIds.some(id => !projects.state().projects.some(p => p.id === id && p.profileId === profileId))) throw new UserError('Choose projects belonging to this profile.');
    };
    profiles.onCheckInUse(id => this.vault.inUse(id) ? 'saved secrets; delete them first' : undefined);
    this.vault.onChanged((_id, profileId) => { broadcast('secrets.changed', { profileId }); });
    router.on('secrets.status', () => this.vault.status())
      .on('secrets.list', ({ profileId }) => { profiles.require(profileId); return this.vault.list(profileId); })
      .on('secrets.save', input => safely(async () => { validate(input.profileId, input.projectIds); return this.vault.save(input); }))
      .on('secrets.delete', ({ id }) => safely(async () => { await this.vault.remove(id); return null; }))
      .on('secretRequests.answer', input => safely(async () => { await this.answer(input); return null; }));
  }
  private async request(context: Context, args: SecretToolArgs): Promise<SecretDelivery> {
    const saved = await this.vault.resolve(context);
    if (!this.live(context)) return { status: 'cancelled' };
    if ([...this.pending.values()].some(p => p.context.threadId === context.threadId)) throw new UserError('This thread is already waiting for a secret.');
    const requestId = randomUUID();
    const item: SecretRequestItem = { kind: 'secret', id: `${context.turnId}:secret:${requestId}`, requestId, turnId: context.turnId,
      label: args.label, reason: args.reason, slot: args.slot, profileId: context.profileId, profileName: context.profileName,
      projectId: context.projectId, projectName: context.projectName, machineName: context.machineName,
      status: saved ? 'provided' : 'pending', candidates: [], expiresAt: new Date(Date.now() + (args.timeoutMs ?? 10 * 60_000)).toISOString() };
    if (saved) {
      const result = await this.deliver(context, saved.value, saved.metadata);
      try { await this.publish(context.threadId, { ...item, source: 'reused', secretName: saved.metadata.name, expiresAt: result.expiresAt }); }
      catch { await this.removeDelivery(this.deliveries.get(result.file)!); throw new UserError('Could not record secret use. Try again.'); }
      return result;
    }
    item.candidates = context.projectId ? this.vault.list(context.profileId).filter(s => s.slot === context.slot) : [];
    let resolve!: (value: SecretDelivery) => void;
    const result = new Promise<SecretDelivery>(done => { resolve = done; });
    const timer = setTimeout(() => { void this.finish(requestId, 'expired').catch(() => {}); }, args.timeoutMs ?? 10 * 60_000);
    timer.unref();
    const pending: Pending = { item, context, claiming: false, resolve, timer };
    this.pending.set(requestId, pending);
    const abort = () => { void this.finish(requestId, 'cancelled').catch(() => {}); };
    context.signal.addEventListener('abort', abort, { once: true });
    try {
      await this.publish(context.threadId, item);
      if (!this.live(context)) await this.finish(requestId, 'cancelled');
      return await result;
    } finally {
      context.signal.removeEventListener('abort', abort); clearTimeout(timer); this.pending.delete(requestId);
    }
  }
  async answer(input: ParamsOf<'secretRequests.answer'>) {
    const pending = this.pending.get(input.requestId);
    if (!pending || pending.context.threadId !== input.threadId || !this.live(pending.context)) throw new UserError('This secret request has ended.');
    if (pending.claiming) throw new UserError('This secret request is already being answered.');
    pending.claiming = true;
    let created: { id: string; version: number } | undefined;
    let delivery: Extract<SecretDelivery, { status: 'provided' }> | undefined;
    try {
      const { answer } = input; const context = pending.context;
      if (answer.type === 'decline') { await this.finish(input.requestId, 'declined'); return; }
      let value: string;
      let metadata;
      if (answer.type === 'existing') {
        await this.vault.bind(answer.secretId, context);
        const saved = await this.vault.resolve(context);
        if (!saved || saved.metadata.id !== answer.secretId) throw new UserError('The selected secret is no longer available.');
        value = saved.value; metadata = saved.metadata;
      } else {
        checkValue(answer.value); value = answer.value;
        if (answer.type === 'save') {
          if (!context.projectId) throw new UserError('Use once for a thread without a project.');
          metadata = await this.vault.save({ profileId: context.profileId, name: pending.item.label, slot: context.slot, projectIds: [context.projectId], value });
          created = metadata;
        }
      }
      if (!this.pending.has(input.requestId) || !this.live(context)) throw new UserError('This secret request has ended.');
      delivery = await this.deliver(context, value, metadata);
      if (!this.pending.has(input.requestId) || !this.live(context)) throw new UserError('This secret request has ended.');
      const item = { ...pending.item, status: 'provided' as const, candidates: [], source: answer.type === 'once' ? 'once' as const : 'saved' as const,
        secretName: metadata?.name, expiresAt: delivery.expiresAt };
      pending.item = item;
      await this.publish(context.threadId, item);
      if (!this.live(context) || !this.pending.has(input.requestId) || !this.deliveries.has(delivery.file)) {
        await this.publish(context.threadId, { ...item, status: 'cancelled' });
        throw new UserError('The secret request or saved credential changed. Request it again.');
      }
      this.pending.delete(input.requestId); clearTimeout(pending.timer); pending.resolve(delivery);
    } catch (error) {
      if (delivery) await this.removeDelivery(this.deliveries.get(delivery.file)!);
      if (created && this.vault.current(created.id, created.version, pending.context)) await this.vault.remove(created.id);
      throw error;
    } finally { pending.claiming = false; }
  }
  private async deliver(context: Context, value: string, secret?: { id: string; version: number }) {
    await this.secure();
    if (!this.live(context)) throw new UserError('This secret request has ended.');
    const file = join(this.directory, randomUUID());
    try {
      await privateFile(file, Buffer.from(value, 'utf8'));
      if (!this.live(context) || (secret && !this.vault.current(secret.id, secret.version, context))) throw new UserError('The secret or turn changed. Request it again.');
      const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      const timer = setTimeout(() => { const d = this.deliveries.get(file); if (d) void this.removeDelivery(d).catch(() => {}); }, 15 * 60_000); timer.unref();
      this.deliveries.set(file, { file, turnId: context.turnId, secretId: secret?.id, version: secret?.version, scope: context, timer });
      if (secret) await this.vault.used(secret.id, secret.version, context);
      return { status: 'provided' as const, file, expiresAt };
    } catch (error) { const d = this.deliveries.get(file); if (d) await this.removeDelivery(d); else await rm(file, { force: true }); throw error; }
  }
  private async finish(id: string, status: 'declined' | 'expired' | 'cancelled') {
    const pending = this.pending.get(id); if (!pending) return;
    this.pending.delete(id); clearTimeout(pending.timer);
    pending.item = { ...pending.item, status, candidates: [] };
    try { await this.publish(pending.context.threadId, pending.item); }
    finally { pending.resolve({ status }); }
  }
  async endTurn(turnId: string) {
    this.activeTurns.delete(turnId);
    for (const [id, p] of this.pending) if (p.context.turnId === turnId) await this.finish(id, 'cancelled');
    for (const d of this.deliveries.values()) if (d.turnId === turnId) await this.removeDelivery(d);
    for (const key of this.calls.keys()) if (key.startsWith(`${turnId}:`)) this.calls.delete(key);
  }
  private live(context: { turnId: string; signal: AbortSignal }) { return !context.signal.aborted && this.activeTurns.has(context.turnId); }
  private secure() { return this.secured ??= privateDirectory(this.directory).catch(() => { this.secured = undefined; throw new UserError('Could not protect the secret delivery directory.'); }); }
  private async removeDelivery(d: Delivery | undefined) { if (!d) return; clearTimeout(d.timer); await rm(d.file, { force: true }); this.deliveries.delete(d.file); }
}

async function safely<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof UserError) throw e;
    if (e instanceof SecretStoreError) throw new UserError(e.message);
    throw new UserError('Could not save or deliver the secret. Try again.');
  }
}
