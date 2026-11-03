import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { startCodex, type CodexClient, type CodexFactory } from '@accio/codex';
import { SignInError } from './claudeOAuth.js';
import { LimitsReadError } from './limits.js';

/** `efforts` is absent on models stored before accio kept them. */
export type CodexModel = { id: string; name: string; description: string; isDefault: boolean; efforts?: { id: string; description?: string }[]; defaultEffort?: string };
type ModelPage = { data: { model: string; displayName: string; description?: string; isDefault: boolean;
  supportedReasoningEfforts?: { reasoningEffort: string; description?: string }[]; defaultReasoningEffort?: string }[]; nextCursor?: string | null };

/** Every model the signed-in ChatGPT account offers Codex, with the effort levels each accepts. */
async function listModels(client: CodexClient): Promise<CodexModel[]> {
  const models: CodexModel[] = [];
  let cursor: string | null = null;
  do {
    const page: ModelPage = await client.request('model/list', { cursor, limit: 100, includeHidden: false });
    models.push(...page.data.map((m) => ({ id: m.model, name: m.displayName, description: m.description ?? '', isDefault: !!m.isDefault,
      efforts: (m.supportedReasoningEfforts ?? []).map((e) => ({ id: e.reasoningEffort, ...(e.description ? { description: e.description } : {}) })),
      ...(m.defaultReasoningEffort ? { defaultEffort: m.defaultReasoningEffort } : {}) })));
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return models;
}
/** Only metadata is stored in profiles.json. Codex owns auth.json inside this hub-only credential home. */
export type OpenAIAccount = { credentialId: string; email: string | null; planType: string | null; models: CodexModel[] };
export type OpenAICredentials = { accessToken: string; accountId: string };
type Pending = { client: CodexClient; credentialId: string; loginId?: string; success?: boolean; error?: string; timer: ReturnType<typeof setTimeout> };
const TTL = 15 * 60_000;

/** Hub-side authentication only. This class never starts a Codex thread or turn. */
export class OpenAIAuth {
  private pending = new Map<string, Pending>();
  private refreshing = new Map<string, Promise<OpenAICredentials>>();
  constructor(private home: string, private factory: CodexFactory = startCodex) {}

  async begin() {
    const credentialId = randomUUID();
    const dir = this.directory(credentialId);
    await mkdir(dir, { recursive: true });
    let client: CodexClient;
    try { client = await this.factory({ home: dir, cwd: dir }); }
    catch (error) { await this.remove(credentialId); throw new SignInError((error as Error).message); }
    const id = randomUUID();
    const timer = setTimeout(() => { void this.cancel(id); }, TTL);
    timer.unref();
    const pending: Pending = { client, credentialId, timer };
    this.pending.set(id, pending);
    client.onNotification(({ method, params }) => {
      if (method === 'account/login/completed' && (!pending.loginId || params.loginId === pending.loginId)) {
        pending.success = params.success; pending.error = params.error ?? undefined;
      }
    });
    client.onExit(() => { if (pending.success === undefined) { pending.success = false; pending.error = 'Codex closed before sign-in finished. Start again.'; } });
    try {
      const result = await client.request<{ loginId: string; verificationUrl: string; userCode: string }>('account/login/start', { type: 'chatgptDeviceCode' });
      pending.loginId = result.loginId;
      return { signInId: id, url: result.verificationUrl, userCode: result.userCode };
    } catch (error) { await this.cancel(id); throw new SignInError((error as Error).message); }
  }

  async status(id: string): Promise<{ status: 'pending' } | { status: 'complete'; account: OpenAIAccount }> {
    const p = this.pending.get(id);
    if (!p) throw new SignInError('This sign-in has expired or was cancelled. Start it again.');
    if (p.success === undefined) return { status: 'pending' };
    if (!p.success) {
      const error = p.error ?? 'ChatGPT sign-in failed. Start it again.';
      await this.cancel(id); throw new SignInError(error);
    }
    const result = await p.client.request('account/read', { refreshToken: false });
    if (result.account?.type !== 'chatgpt') throw new SignInError('Sign in with a ChatGPT account to use Codex.');
    const models = await listModels(p.client);
    // Check credentials before publishing a signed-in account.
    await this.readCredentials(p.credentialId);
    return { status: 'complete', account: { credentialId: p.credentialId, email: result.account.email ?? null, planType: result.account.planType ?? null, models } };
  }

  async finish(id: string) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id); clearTimeout(p.timer); await p.client.close();
  }
  async cancel(id: string) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id); clearTimeout(p.timer);
    await p.client.close(); await this.remove(p.credentialId);
  }
  async remove(credentialId: string) {
    await this.refreshing.get(credentialId)?.catch(() => {});
    await rm(this.directory(credentialId), { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }

  credentials(account: OpenAIAccount, force = false): Promise<OpenAICredentials> {
    const existing = this.refreshing.get(account.credentialId);
    if (existing) return existing;
    const pending = this.loadCredentials(account, force).finally(() => this.refreshing.delete(account.credentialId));
    this.refreshing.set(account.credentialId, pending);
    return pending;
  }

  /** The account's current models; account-only, never starts a thread or turn. */
  async models(account: OpenAIAccount): Promise<CodexModel[]> {
    await this.credentials(account);
    const dir = this.directory(account.credentialId);
    const client = await this.factory({ home: dir, cwd: dir });
    try { return await listModels(client); }
    finally { await client.close(); }
  }

  /** Account-only query in the hub credential home; never starts a thread or turn. */
  async rateLimits(account: OpenAIAccount, signal: AbortSignal): Promise<unknown> {
    // Reuse the proxy's refresh coordination rather than rotate tokens independently.
    await this.credentials(account);
    signal.throwIfAborted();
    const dir = this.directory(account.credentialId);
    const client = await this.factory({ home: dir, cwd: dir, signal });
    const abort = () => { void client.close(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      const result = await client.request('account/read', { refreshToken: false });
      if (result.account?.type !== 'chatgpt') throw new LimitsReadError('signInRequired', 'Sign in to this ChatGPT account again to read its limits.');
      signal.throwIfAborted();
      return await client.request('account/rateLimits/read', null);
    } finally {
      signal.removeEventListener('abort', abort);
      await client.close();
    }
  }

  private async loadCredentials(account: OpenAIAccount, force: boolean): Promise<OpenAICredentials> {
    const credentials = await this.readCredentials(account.credentialId);
    let expiresAt = 0;
    try { expiresAt = JSON.parse(Buffer.from(credentials.accessToken.split('.')[1]!, 'base64url').toString()).exp * 1000; } catch {}
    if (!force && expiresAt > Date.now() + 60_000) return credentials;
    const dir = this.directory(account.credentialId);
    const client = await this.factory({ home: dir, cwd: dir });
    try {
      await client.request('account/read', { refreshToken: true });
      return await this.readCredentials(account.credentialId);
    } finally { await client.close(); }
  }

  private async readCredentials(credentialId: string): Promise<OpenAICredentials> {
    const auth = JSON.parse(await readFile(join(this.directory(credentialId), 'auth.json'), 'utf8'));
    const { access_token, account_id } = auth.tokens ?? {};
    if (typeof access_token !== 'string' || !access_token || typeof account_id !== 'string' || !account_id) throw new SignInError('ChatGPT credentials are missing. Sign in again.');
    return { accessToken: access_token, accountId: account_id };
  }
  private directory(id: string) {
    if (!/^[\da-f-]{36}$/i.test(id)) throw new SignInError('Invalid ChatGPT credential id');
    return join(this.home, 'hub', 'codex', id);
  }
  async close() {
    await Promise.all([...this.pending.keys()].map((id) => this.cancel(id)));
    await Promise.allSettled(this.refreshing.values());
  }
}
