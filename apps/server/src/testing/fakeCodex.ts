import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodexClient, CodexFactory, CodexNotification } from '@accio/codex';

export const fakeModels = [
  { id: 'test-codex', model: 'test-codex', displayName: 'Test Codex', description: 'A test model', isDefault: true },
  { id: 'test-fast', model: 'test-fast', displayName: 'Test Fast', description: 'Another test model', isDefault: false },
];
export function testJWT(who: string, expired = false) {
  return `header.${Buffer.from(JSON.stringify({ sub: who, exp: Math.floor(Date.now() / 1000) + (expired ? -100 : 3600) })).toString('base64url')}.signature`;
}

/** Real RPC and disk storage around a scripted app-server, without using a developer's accounts. */
export class FakeCodex {
  clients: FakeCodexClient[] = [];
  rateLimitsResponse: unknown = { rateLimits: null };
  rateLimitsError?: Error;
  holdTurns = false;
  factory: CodexFactory = async (options) => {
    const client = new FakeCodexClient(options, this);
    this.clients.push(client);
    return client;
  };
  get latest() { return this.clients.at(-1)!; }
}

export class FakeCodexClient implements CodexClient {
  requests: { method: string; params: any }[] = [];
  notifications = new Set<(event: CodexNotification) => void>();
  exits = new Set<(error: Error) => void>();
  closed = false;
  constructor(readonly options: Parameters<CodexFactory>[0], private host: FakeCodex) {}
  emit(method: string, params: Record<string, any>) { for (const listener of this.notifications) listener({ method, params }); }
  async complete(who = 'me') {
    await mkdir(this.options.home, { recursive: true });
    await writeFile(join(this.options.home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: {
      access_token: testJWT(who), account_id: who, refresh_token: `refresh-${who}`, id_token: 'private-id-token',
    } }));
    this.emit('account/login/completed', { loginId: 'login-id', success: true, error: null });
  }
  async request<T = any>(method: string, params: any = {}): Promise<T> {
    this.requests.push({ method, params });
    let result: any = {};
    switch (method) {
      case 'account/login/start': result = { loginId: 'login-id', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'TEST-1234' }; break;
      case 'account/read': {
        const auth = JSON.parse(await readFile(join(this.options.home, 'auth.json'), 'utf8'));
        if (params.refreshToken) {
          auth.tokens.access_token = testJWT(`${auth.tokens.account_id}-refreshed`);
          await writeFile(join(this.options.home, 'auth.json'), JSON.stringify(auth));
        }
        result = { account: { type: 'chatgpt', email: `${auth.tokens.account_id}@example.com`, planType: 'pro' } }; break;
      }
      case 'model/list': result = { data: fakeModels, nextCursor: null }; break;
      case 'account/rateLimits/read':
        if (this.host.rateLimitsError) throw this.host.rateLimitsError;
        result = this.host.rateLimitsResponse; break;
      case 'thread/start': result = { thread: { id: 'codex-session' } }; break;
      case 'thread/resume': result = { thread: { id: params.threadId } }; break;
      case 'turn/start':
        result = { turn: { id: 'codex-turn' } };
        if (!this.host.holdTurns) queueMicrotask(() => this.reply());
        break;
      case 'turn/interrupt': this.emit('turn/completed', { threadId: 'codex-session', turn: { id: 'codex-turn', status: 'interrupted' } }); break;
    }
    return result;
  }
  reply() {
    this.emit('item/agentMessage/delta', { threadId: 'codex-session', turnId: 'codex-turn', itemId: 'message', delta: 'Hello ' });
    this.emit('item/agentMessage/delta', { threadId: 'codex-session', turnId: 'codex-turn', itemId: 'message', delta: 'world' });
    this.emit('item/completed', { threadId: 'codex-session', turnId: 'codex-turn', item: { id: 'message', type: 'agentMessage', text: 'Hello world.' } });
    this.emit('item/started', { threadId: 'codex-session', turnId: 'codex-turn', item: { id: 'shell', type: 'commandExecution', command: 'git status', status: 'inProgress' } });
    this.emit('item/completed', { threadId: 'codex-session', turnId: 'codex-turn', item: { id: 'shell', type: 'commandExecution', command: 'git status', status: 'completed', aggregatedOutput: 'clean', exitCode: 0 } });
    this.emit('turn/completed', { threadId: 'codex-session', turn: { id: 'codex-turn', status: 'completed' } });
  }
  onNotification(listener: (event: CodexNotification) => void) { this.notifications.add(listener); return () => { this.notifications.delete(listener); }; }
  onExit(listener: (error: Error) => void) { this.exits.add(listener); return () => { this.exits.delete(listener); }; }
  async close() { this.closed = true; }
}
