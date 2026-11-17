import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { AccountView, EventName, Events, MethodName, ParamsOf, ProfileView, ResultOf, ServerEnvelope } from '@accio/protocol';
import type { CodexFactory } from '@accio/codex';
import { startStandalone } from '../../../sorting-hat/src/standalone.js';
import { startApp, type AppDeps } from '../app.js';
import type { HarnessTurn } from '../threads/harness.js';
import type { FakeCodex } from './fakeCodex.js';

// The local hub seals the Sorting Hat's admin token with this key, as a headless hub would.
process.env.ACCIO_SECRET_KEY ??= Buffer.alloc(32, 9).toString('base64');

/**
 * Anthropic's token and usage endpoints, faked. The pasted code names the Claude login it
 * stands for (code 'claude-job' signs in as Claude account 'claude-job').
 * Usage reports no limits: the real endpoint refuses the dummy token, which would end
 * the account's sign-in partway through a test (#243). Tests of limits fake it themselves.
 */
export const fakeClaudeFetch: typeof fetch = async (url, init) => {
  if (String(url).endsWith('/api/oauth/usage')) return Response.json({ rate_limits_available: false });
  if (!String(url).includes('/oauth/token')) return fetch(url, init);
  const body = JSON.parse(String(init?.body));
  const who = body.code ?? 'refreshed';
  return Response.json({
    access_token: `oauth-${who}`,
    refresh_token: `refresh-${who}`,
    expires_in: 3600,
    account: { uuid: who, email_address: `${who}@example.com` },
  });
};

const TEST_TOKEN = 'test-token';

/** What a test's Sorting Hat sends to the providers; Claude sign-in is faked unless given. */
export type TestHatDeps = { claudeFetch?: typeof fetch; anthropicUrl?: string; openaiUrl?: string; openaiFetch?: typeof fetch; codexFactory?: CodexFactory };

/**
 * GLOSSARY: Sorting Hat. A standalone one with its state in `home`, so a restart
 * on the same home finds the same accounts and houses at the same address.
 */
export async function startTestSortingHat(home: string, deps: TestHatDeps = {}) {
  const dir = join(home, 'test-sorting-hat'), portFile = join(dir, 'port');
  const start = (port: number) => startStandalone({ dir, port, claudeFetch: deps.claudeFetch ?? fakeClaudeFetch, codexFactory: deps.codexFactory, anthropicUrl: deps.anthropicUrl, openaiUrl: deps.openaiUrl, openaiFetch: deps.openaiFetch });
  const previous = Number(await readFile(portFile, 'utf8').catch(() => '0'));
  const hat = await start(previous).catch(() => start(0));
  await writeFile(portFile, String(hat.port));
  return hat;
}

/** Links the app's own hub to the Sorting Hat, as Settings / Hubs does. */
export async function linkSortingHat(app: { profiles: { client: { call(method: string, params: unknown): Promise<unknown> } } }, hat: { url: string; adminToken: string }) {
  await app.profiles.client.call('sortingHat.configure', { url: hat.url, adminToken: hat.adminToken, hubName: 'Local dev' });
}

/** Calls accio's tools (its MCP server) as the turn's harness would, and returns the JSON-RPC result. */
export async function callAccioTools(run: HarnessTurn, method: string, params?: unknown) {
  const response = await fetch(run.tools!.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: run.tools!.authorization },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await response.json() as { result: any }).result;
}

/** Where Claude's page sends the browser after approval of the sign-in at `authorizeUrl`, with `code` and the given state. */
export function claudeCallback(authorizeUrl: string, code: string, state = new URL(authorizeUrl).searchParams.get('state')!) {
  const callback = new URL(new URL(authorizeUrl).searchParams.get('redirect_uri')!);
  callback.hostname = '127.0.0.1';
  callback.searchParams.set('code', code); callback.searchParams.set('state', state);
  return callback;
}

/** The id of the profile's Claude account, or null. */
export function claudeAccountId(profile: ProfileView): string | null {
  return profile.providers.find((p) => p.id === 'anthropic')?.accountIds[0] ?? null;
}

/** The profile's Claude account, as the account list describes it, or null. */
export function claudeAccount(profile: ProfileView, accounts: readonly AccountView[]): AccountView | null {
  return accounts.find((a) => a.id === claudeAccountId(profile)) ?? null;
}

/**
 * A real server on a random port with a throwaway ACCIO_HOME, its hub linked to
 * a Sorting Hat of its own, plus a client. Pass an existing `home` to simulate a
 * restart on the same machine.
 */
export async function startTestApp(deps: Partial<AppDeps> & TestHatDeps = {}, existingHome?: string) {
  const home = existingHome ?? (await mkdtemp(join(tmpdir(), 'accio-test-')));
  const { claudeFetch, anthropicUrl, openaiUrl, openaiFetch, ...appDeps } = deps;
  const hat = await startTestSortingHat(home, { claudeFetch, anthropicUrl, openaiUrl, openaiFetch, codexFactory: deps.codexFactory });
  let app: Awaited<ReturnType<typeof startApp>>;
  try {
    app = await startApp(
      { home, host: '127.0.0.1', port: 0, hubPort: 0, token: TEST_TOKEN },
      // No test reads the real gh accounts of the machine running it.
      { github: async () => { throw new Error('gh is not available in tests'); }, ...appDeps },
    );
    await linkSortingHat(app, hat);
  } catch (error) { await hat.close(); throw error; }
  const clients: TestClient[] = [];
  let requestId = 0;
  return {
    home,
    app,
    hat,
    url: `ws://127.0.0.1:${app.port}/ws`,
    async connect(token = TEST_TOKEN) {
      const c = await TestClient.open(`ws://127.0.0.1:${app.port}/ws?token=${token}`);
      clients.push(c);
      return c;
    },
    /** A connected client whose profile `name` is signed in to Claude. */
    async signedIn(name: string) {
      const c = await this.connect();
      await c.signedIn(name);
      return c;
    },
    /** Calls the app's RPC router directly, without a client. */
    rpc(method: string, params: unknown) {
      return app.router.handle({ id: ++requestId, method, params });
    },
    async stop({ keepHome = false } = {}) {
      for (const c of clients) c.close();
      await app.close();
      await hat.close();
      if (keepHome) return;
      // Windows may still hold a just-written file for a moment.
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

export class TestClient {
  private nextId = 1;
  private pending = new Map<number, (m: ServerEnvelope) => void>();
  readonly events: { event: string; data: unknown }[] = [];
  private waiters: (() => void)[] = [];

  private constructor(private ws: WebSocket) {
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerEnvelope;
      if (msg.type === 'response') this.pending.get(msg.id)?.(msg);
      else {
        this.events.push(msg);
        for (const w of this.waiters.splice(0)) w();
      }
    });
  }

  static open(url: string): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once('open', () => resolve(new TestClient(ws)));
      ws.once('error', reject);
    });
  }

  async call<M extends MethodName>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const id = this.nextId++;
    const msg = await new Promise<ServerEnvelope>((resolve) => {
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
    if (msg.type !== 'response') throw new Error('unexpected');
    if (!msg.ok) throw new Error(msg.error);
    return msg.result as ResultOf<M>;
  }

  /** Creates a profile (if new) with a house of its name and signs it in as the given Claude login. */
  async signedIn(name: string, opts: { claudeAccount?: string } = {}) {
    const profile = await this.profile(name);
    const account = { id: claudeAccountId(profile) ?? (await this.call('accounts.save', { name: `${name} Claude` })).id };
    await this.claudeSignIn(account.id, opts.claudeAccount ?? `claude-${profile.id}`);
    return this.call('profiles.save', { id: profile.id, name, accountIds: { anthropic: [account.id] } });
  }

  /** Adds a ChatGPT account, signed in through the fake Codex, beside the profile's Claude account. */
  async withChatGpt(profile: ProfileView, codex: FakeCodex) {
    const account = await this.call('accounts.save', { name: `${profile.name} ChatGPT`, providerId: 'openai' });
    const login = await this.call('accounts.beginSignIn', { id: account.id });
    await codex.latest.complete(profile.name);
    await this.call('accounts.signInStatus', { signInId: login.signInId });
    return this.call('profiles.save', { id: profile.id, name: profile.name, accountIds: { anthropic: [claudeAccountId(profile)!], openai: [account.id] } });
  }

  /** Signs a Claude account in as the browser does: Claude's page sends `code` to this machine's callback, then the sign-in reads complete. */
  async claudeSignIn(accountId: string, code: string) {
    const { signInId, url } = await this.call('accounts.beginSignIn', { id: accountId });
    const response = await fetch(claudeCallback(url, code));
    if (!response.ok) throw new Error(await response.text());
    const status = await this.call('accounts.signInStatus', { signInId });
    if (status.status !== 'complete') throw new Error('The Claude sign-in did not complete');
    return status.account;
  }

  /** This machine, as the hub records it. */
  async thisMachine() {
    return (await this.call('machines.list', {})).find((m) => m.thisMachine)!;
  }

  /** The profile of this name, made with a house of its name on the Sorting Hat if new. */
  async profile(name: string) {
    return (await this.call('profiles.list', {})).find((a) => a.name === name) ?? this.call('profiles.save', { name, createHouse: true });
  }

  /** Waits until an event matching `pred` has arrived (including earlier ones). */
  async waitFor<E extends EventName>(event: E, pred: (data: Events[E]) => boolean = () => true, timeoutMs = 5000): Promise<Events[E]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.events.find((e) => e.event === event && pred(e.data as Events[E]));
      if (hit) return hit.data as Events[E];
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${event}`);
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }

  close() {
    this.ws.close();
  }
}
