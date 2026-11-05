import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { methods, ResourceScope, SecretSlot, type AccountView, type AccountLimitsView, type ProfileView, type ResourcesState, type SecretSummary } from '@accio/protocol';
import { Hub } from './hub.js';
import { SharedSettings, type MachineHello, type SharedSeed } from './sharedSettings.js';
import { OpenAIAuth, type CodexModel } from './openaiAuth.js';
import type { CodexFactory } from '@accio/codex';
import { SIGN_IN_TTL_MS, SignInError, type Fetch } from './claudeOAuth.js';
import { HubTrust } from './trust.js';
import { startHubProxy } from './proxy.js';
import { accountSelection, profileViews, saveSharedProfile } from './profile.js';
import { Resources } from './resources.js';
import { McpGateway } from './mcp.js';
import { RESOURCE_WRITES } from './resourceClient.js';
import { SecretsVault, SecretStoreError } from './secrets.js';

export const HUB_PROTOCOL = 1;
/** Largest relay WebSocket message; machines split bigger frames into chunks. */
export const RELAY_FRAME_BYTES = 1024 * 1024;
export type HubSnapshot = {
  hubId: string; protocol: number; revision: number; epoch: string;
  /** The Accio version this hub runs, when its build recorded one. */
  version?: string;
  profiles: ProfileView[]; accounts: AccountView[];
  machines: ReturnType<SharedSettings['machines']>;
  favorites: Record<string, { harnessId: string; modelId: string }[]>;
  /** Absent in snapshots cached before built-in tool switches existed. */
  harnessTools?: Record<string, Record<string, boolean>>;
  threadNaming?: ReturnType<SharedSettings['threadNaming']>;
  models: Record<string, CodexModel[]>;
  resources: ResourcesState;
  limits: AccountLimitsView[];
  secrets: SecretSummary[];
};
export type HubServiceOptions = {
  home: string; host?: string; port?: number; seed?: () => Promise<SharedSeed>;
  claudeFetch?: Fetch; codexFactory?: CodexFactory; anthropicUrl?: string;
  openaiUrl?: string; openaiFetch?: Fetch; mcpFetch?: Fetch; publicUrl?: string; secretKey?: string;
  /** GLOSSARY: Accio version. What this hub runs, shown to clients. */
  version?: string;
};
const SecretId = z.string().min(1).max(160);
const SecretScope = z.object({ profileId: SecretId, projectId: SecretId.nullable(), slot: SecretSlot });
const settingCalls = {
  'harnesses.setTools': z.object({ harnessId: z.string().min(1).max(64), tools: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), z.boolean()) }),
};
const secretCalls = {
  'secrets.resolve': SecretScope,
  'secrets.bind': z.object({ id: SecretId, scope: SecretScope }),
  'secrets.used': z.object({ id: SecretId, version: z.number().int().positive(), scope: SecretScope }),
};
type Login = { machineId: string; accountId: string; startedAt: number; complete?: AccountView };

/** The same service runs on loopback for development and behind HTTPS at home. */
export async function startHubService(opts: HubServiceOptions) {
  const hub = new Hub(opts.home, opts.claudeFetch, new OpenAIAuth(opts.home, opts.codexFactory));
  const settings = new SharedSettings(opts.home);
  const trust = new HubTrust(opts.home);
  const resources = new Resources(opts.home);
  const secrets = new SecretsVault(opts.home, opts.secretKey);
  const mcp = new McpGateway(resources, opts.mcpFetch);
  const grants = new Map<string, { machineId: string; release(): void }>();
  await hub.load(); await settings.load(opts.seed); await trust.load(); await resources.load(); await secrets.load();
  const proxy = await startHubProxy({ hub, host: '127.0.0.1', port: 0, upstream: opts.anthropicUrl, fetchImpl: opts.claudeFetch, openaiUpstream: opts.openaiUrl, openaiFetch: opts.openaiFetch });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16_384 });
  const owners = new Map<WebSocket, string>();
  const relay = new WebSocketServer({ noServer: true, maxPayload: RELAY_FRAME_BYTES });
  /** GLOSSARY: Relay. One socket per machine; a newer one replaces the older. */
  const relays = new Map<string, WebSocket>();
  function relayPeers() {
    const frame = JSON.stringify({ kind: 'peers', from: 'hub', machines: [...relays.keys()] });
    for (const ws of relays.values()) if (ws.readyState === WebSocket.OPEN) ws.send(frame);
  }
  function closeRelay(machineId: string, reason: string) { relays.get(machineId)?.close(4001, reason); }
  /** Forwards a frame by its `to`, stamped with the authenticated sender. The rest stays opaque. */
  function forward(from: string, text: string) {
    let frame: any;
    try { frame = JSON.parse(text); } catch { return; }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) || typeof frame.to !== 'string' || frame.to.length > 128 || !['request', 'response', 'event', 'chunk'].includes(frame.kind)) return;
    frame.from = from;
    const out = JSON.stringify(frame);
    const targets = frame.to === '*' ? [...relays].filter(([id]) => id !== from).map(([, ws]) => ws) : [relays.get(frame.to)].filter((ws) => !!ws && frame.to !== from);
    let sent = false;
    for (const ws of targets) if (ws!.readyState === WebSocket.OPEN) { ws!.send(out); sent = true; }
    if (!sent && frame.to !== '*' && typeof frame.id === 'string' && (frame.kind === 'request' || frame.kind === 'chunk')) {
      relays.get(from)?.send(JSON.stringify({ kind: 'undeliverable', from: 'hub', id: frame.id }));
    }
  }
  const logins = new Map<string, Login>();
  const pairingAttempts = new Map<string, { count: number; until: number }>();
  let revision = 0;
  const epoch = randomUUID();
  let queue: Promise<unknown> = Promise.resolve();
  let closing = false;
  function snapshot(): HubSnapshot {
    const profiles = settings.profiles();
    return { hubId: trust.id, protocol: HUB_PROTOCOL, revision, epoch, ...(opts.version ? { version: opts.version } : {}), profiles: profileViews(profiles, hub), accounts: hub.accountViews(), machines: settings.machines(),
      favorites: Object.fromEntries(profiles.map((p) => [p.id, settings.modelFavorites(p.id)])), harnessTools: settings.harnessTools(),
      threadNaming: settings.threadNaming(),
      models: Object.fromEntries(profiles.map((p) => [p.id, hub.codexModels(p.id)])), resources: resources.state(), limits: hub.limits.views(), secrets: profiles.flatMap(p => secrets.list(p.id)) };
  }
  function announce() { revision++; for (const ws of sockets.clients) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ revision })); }
  settings.onMachinesChanged(announce);
  hub.limits.subscribe(announce);
  secrets.onChanged(announce);
  const modelsRefreshed = hub.refreshCodexModels().then((changed) => { if (changed) announce(); });
  function auth(req: IncomingMessage) { const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]; return token ? trust.authenticate(token) : undefined; }
  function login(id: string, machineId: string) {
    const pending = logins.get(id);
    if (!pending || pending.machineId !== machineId || Date.now() - pending.startedAt > SIGN_IN_TTL_MS) throw new SignInError('This sign-in has expired or was cancelled. Start it again.');
    return pending;
  }
  async function execute(machineId: string, method: string, raw: any): Promise<unknown> {
    const schema = (methods as Record<string, any>)[method]?.params ?? (secretCalls as Record<string, z.ZodType>)[method] ?? (settingCalls as Record<string, z.ZodType>)[method];
    const parsed = schema?.safeParse(raw);
    if (parsed && !parsed.success) throw new SignInError('Invalid hub request parameters');
    const p = parsed ? parsed.data : raw;
    switch (method) {
      case 'machine.hello': {
        const hello = p as MachineHello;
        if (hello.id !== machineId || !hello.name || !hello.platform || !hello.version || !Array.isArray(hello.harnesses) || JSON.stringify(hello).length > 16_384) throw new SignInError('Invalid machine identity');
        await settings.machineConnected(hello); return null;
      }
      case 'machine.references': {
        if (!Array.isArray(p.profiles) || p.profiles.length > 10_000 || p.profiles.some((id: unknown) => typeof id !== 'string')) throw new SignInError('Invalid profile references');
        await trust.references(machineId, p.profiles); return null;
      }
      case 'machine.modelKey': {
        if (typeof p.profileId !== 'string' || !settings.profiles().some((profile) => profile.id === p.profileId)) throw new SignInError('No such profile');
        return { key: await trust.key(machineId, p.profileId) };
      }
      case 'hub.pairingCode': return HubTrust.createCode(opts.home);
      case 'hub.revokeMachine': {
        if (typeof p.machineId !== 'string') throw new SignInError('Invalid machine');
        await trust.revoke(p.machineId);
        for (const [token, grant] of grants) if (grant.machineId === p.machineId) { grant.release(); grants.delete(token); }
        for (const [ws, owner] of owners) if (owner === p.machineId) ws.close(4001, 'Pairing revoked');
        closeRelay(p.machineId, 'Pairing revoked');
        await settings.machineDisconnected(p.machineId); return null;
      }
      case 'accounts.list': return hub.accountViews();
      case 'accounts.limits': return hub.limits.views();
      case 'accounts.refreshLimits': return hub.refreshLimits(p.accountIds, p.force);
      case 'secrets.status': return secrets.status();
      case 'secrets.list': return secrets.list(p.profileId);
      case 'secrets.save': {
        if (!settings.profiles().some(profile => profile.id === p.profileId)) throw new SecretStoreError('No such profile.');
        return secrets.save(p);
      }
      case 'secrets.delete': await secrets.remove(p.id); return null;
      case 'secrets.resolve': return secrets.resolve(p);
      case 'secrets.bind': await secrets.bind(p.id, p.scope); return null;
      case 'secrets.used': await secrets.used(p.id, p.version, p.scope); return null;
      case 'resources.write': {
        if (!RESOURCE_WRITES.includes(p.method) || !Array.isArray(p.args) || p.args.length > 2) throw new SignInError('Invalid resource mutation');
        const args = [...p.args];
        const definitionSchema = { saveTool: methods['tools.save'].params, saveMcp: methods['mcp.save'].params, saveSource: methods['skills.addSource'].params }[p.method as 'saveTool' | 'saveMcp' | 'saveSource'];
        if (definitionSchema) args[0] = definitionSchema.parse(args[0]);
        else if (p.method !== 'setToolStatus' && (typeof args[0] !== 'string' || !args[0] || args[0].length > 512)) throw new SignInError('Invalid resource identity');
        if (p.method === 'saveSource' || p.method === 'stageSkills') {
          if (!Array.isArray(args[1]) || !args[1].length || args[1].length > 10_000) throw new SignInError('Invalid skills');
          for (const skill of args[1]) {
            if (!skill || ['id', 'sourceId', 'name', 'description', 'path', 'revision'].some(key => typeof skill[key] !== 'string')) throw new SignInError('Invalid skill');
            skill.scope = ResourceScope.parse(skill.scope);
          }
        }
        if (p.method === 'setSkillScope') args[1] = ResourceScope.parse(args[1]);
        if (p.method === 'setSkillProject' && (!args[1] || typeof args[1].projectKey !== 'string' || !args[1].projectKey || args[1].projectKey.length > 512 || typeof args[1].enabled !== 'boolean')) throw new SignInError('Invalid project skill selection');
        if (p.method === 'setToolStatus' && (!args[0] || args[0].machineId !== machineId || typeof args[0].toolId !== 'string' || !['pending', 'installing', 'ready', 'error'].includes(args[0].status))) throw new SignInError('Invalid machine tool status');
        if (p.method === 'setCredential' && (!resources.state().mcps.some(value => value.id === args[0] && value.auth === 'bearer') || typeof args[1]?.accessToken !== 'string')) throw new SignInError('Select a bearer-authenticated MCP server');
        if (p.method === 'deleteMcp') await mcp.signOut(args[0]);
        await (resources[p.method as typeof RESOURCE_WRITES[number]] as (...values: any[]) => Promise<void>).apply(resources, args);
        return null;
      }
      case 'mcp.beginSignIn': return mcp.beginSignIn(p.id).catch(error => { throw new SignInError(error.message); });
      case 'mcp.completeSignIn': await mcp.completeSignIn(p.callbackUrl, p.id).catch(error => { throw new SignInError(error.message); }); return null;
      case 'mcp.signOut': await mcp.signOut(p.id); return null;
      case 'mcp.grant': {
        if (typeof p.id !== 'string' || typeof p.profileId !== 'string' || !settings.profiles().some(profile => profile.id === p.profileId)) throw new SignInError('Invalid MCP grant');
        const grant = mcp.grant(p.id, p.profileId, p.projectKey); grants.set(grant.token, { machineId, release: grant.release }); return { token: grant.token };
      }
      case 'mcp.release': {
        const grant = grants.get(p.token); if (grant?.machineId === machineId) { grant.release(); grants.delete(p.token); } return null;
      }
      case 'accounts.save': return hub.saveAccount(p.name, p.id, p.providerId);
      case 'accounts.delete': await hub.deleteAccount(p.id); return null;
      case 'accounts.signOut': return hub.signOutAccount(p.id);
      case 'accounts.beginSignIn': {
        const account = hub.accountView(p.id);
        let result;
        if (account.providerId === 'openai') result = await hub.beginOpenAISignIn(p.id, true);
        else {
          const redirectUri = raw.redirectUri;
          if (redirectUri !== undefined) {
            const u = new URL(redirectUri);
            if (u.protocol !== 'http:' || u.hostname !== 'localhost' || u.pathname !== '/callback' || !u.port || u.search || u.hash || u.username || u.password) throw new SignInError('Invalid browser callback');
          }
          result = hub.beginAccountSignIn(p.id, redirectUri);
        }
        logins.set(result.signInId, { machineId, accountId: p.id, startedAt: Date.now() }); return result;
      }
      case 'accounts.completeSignIn': {
        const pending = login(p.signInId, machineId);
        pending.complete = await hub.completeAccountSignIn(p.signInId, p.code); return pending.complete;
      }
      case 'accounts.signInStatus': {
        const pending = login(p.signInId, machineId);
        if (pending.complete) return { status: 'complete', account: pending.complete };
        if (hub.accountView(pending.accountId).providerId !== 'openai') return { status: 'pending' };
        const result = await hub.openaiSignInStatus(p.signInId);
        if (result.status === 'complete') pending.complete = result.account;
        return result;
      }
      case 'accounts.callback': {
        const pending = login(p.signInId, machineId);
        if (pending.complete) throw new SignInError('This sign-in is already complete.');
        if (hub.accountView(pending.accountId).providerId === 'anthropic') pending.complete = await hub.completeAccountSignIn(p.signInId, p.code);
        else await hub.completeOpenAICallback(p.signInId, p.code, p.state);
        return null;
      }
      case 'accounts.cancelSignIn': login(p.signInId, machineId); await hub.cancelAccountSignIn(p.signInId); logins.delete(p.signInId); return null;
      case 'profiles.list': return profileViews(settings.profiles(), hub);
      case 'profiles.save': {
        const { saved, profiles } = saveSharedProfile(settings.profiles(), p);
        await hub.configureProfile(saved.id, accountSelection(p), async () => { await settings.setProfiles(profiles); });
        return profileViews([saved], hub)[0];
      }
      case 'profiles.delete': {
        if (!settings.profiles().some((profile) => profile.id === p.id)) throw new SignInError(`No profile ${p.id}`);
        if (secrets.inUse(p.id)) throw new SignInError('This profile still has saved secrets. Delete them first.');
        if (trust.referenced(p.id)) throw new SignInError('This profile is still used by projects or threads on a paired machine. Remove those references first.');
        await hub.removeProfile(p.id, () => settings.setProfiles(settings.profiles().filter((profile) => profile.id !== p.id))); return null;
      }
      case 'machines.rename': await settings.renameMachine(p.machineId, p.name); return null;
      case 'machines.setProfileFolders': await settings.setProfileFolders(p.machineId, p.profileId, p.folders); return null;
      case 'models.favorite': await settings.setModelFavorite(p.profileId, p.model, p.favorite); return null;
      case 'harnesses.setTools': await settings.setHarnessTools(p.harnessId, p.tools); return null;
      case 'threadNaming.save': await settings.setThreadNaming(p); return settings.threadNaming();
      default: throw new SignInError(`Unknown hub method ${method}`);
    }
  }
  const server = createServer((req, res) => { void handle(req, res).catch((error) => {
    if (res.headersSent) { res.destroy(); return; }
    const safe = error instanceof SignInError || error instanceof SecretStoreError;
    json(res, safe ? 400 : 500, { error: safe ? error.message : 'Hub request failed. Check the hub service.' });
  }); });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const target = new URL(req.url ?? '/', 'http://localhost');
    if (!req.url?.startsWith('/') || target.origin !== 'http://localhost') return json(res, 404, { error: 'Unknown hub endpoint' });
    const path = target.pathname;
    if (path.startsWith('/mcp/') && await mcp.handle(req, res)) { if (path === '/mcp/oauth/callback') announce(); return; }
    if (path === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
      res.end('<!doctype html><meta name="viewport" content="width=device-width"><title>Accio hub</title><main style="font-family:system-ui;max-width:38rem;margin:15vh auto;padding:2rem"><h1>Accio hub</h1><p>In Accio, open Settings → Hubs and add this address.</p><p>Use a pairing code from an already connected device, or generate your first code with the hub’s setup command.</p></main>'); return;
    }
    if (path === '/healthz' && req.method === 'GET') return json(res, closing ? 503 : 200, { hubId: trust.id, protocol: HUB_PROTOCOL, ready: !closing });
    if (path === '/pair' && req.method === 'POST') {
      const address = req.socket.remoteAddress ?? 'unknown';
      if (pairingAttempts.size > 1000) for (const [key, v] of pairingAttempts) if (v.until < Date.now()) pairingAttempts.delete(key);
      const counter = pairingAttempts.get(address);
      if (counter && counter.until > Date.now() && counter.count >= 10) return json(res, 429, { error: 'Too many pairing attempts. Try again in a minute.' });
      pairingAttempts.set(address, counter && counter.until > Date.now() ? { ...counter, count: counter.count + 1 } : { count: 1, until: Date.now() + 60_000 });
      const p = await readJson(req);
      if (typeof p.code !== 'string' || typeof p.machineId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(p.machineId)) throw new SignInError('Invalid pairing request');
      const paired = await trust.pair(p.code, p.machineId);
      for (const [ws, owner] of owners) if (owner === p.machineId) ws.close(4001, 'Pairing renewed');
      closeRelay(p.machineId, 'Pairing renewed');
      return json(res, 200, { ...paired, protocol: HUB_PROTOCOL });
    }
    if (path === '/state' || path === '/rpc') {
      const machineId = auth(req);
      if (!machineId) return json(res, 401, { error: 'This machine is not paired with the hub.' });
      if (path === '/state' && req.method === 'GET') return json(res, 200, snapshot());
      if (path !== '/rpc' || req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
      const p = await readJson(req);
      if (typeof p.method !== 'string' || !p.params || typeof p.params !== 'object' || Array.isArray(p.params)) throw new SignInError('Invalid hub request');
      const invoke = async () => {
        // Authenticate again after waiting for earlier revocation requests.
        if (auth(req) !== machineId) throw new SignInError('Pairing has been revoked.');
        const result = await execute(machineId, p.method, p.params); announce(); return { result, snapshot: snapshot() };
      };
      // MCP token exchanges must allow sign-out to invalidate an in-flight exchange.
      const independent = p.method === 'mcp.completeSignIn' || p.method === 'mcp.beginSignIn' || p.method === 'accounts.refreshLimits';
      const operation = independent ? Promise.resolve().then(invoke) : queue.then(invoke);
      if (!independent) queue = operation.catch(() => {});
      return json(res, 200, await operation);
    }
    if (req.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens', '/openai/responses', '/openai/responses/compact'].includes(path)) return json(res, 404, { error: 'Unknown hub endpoint' });
    const key = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? (typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : '');
    const profileId = trust.modelProfile(key);
    if (!profileId) return json(res, 401, { error: 'Unknown or revoked model key' });
    const headers: import('node:http').IncomingHttpHeaders = { ...req.headers, host: new URL(proxy.url).host, authorization: `Bearer ${await hub.ensureProfile(profileId)}` };
    delete headers['x-api-key'];
    const upstream = httpRequest(new URL(path + target.search, proxy.url), { method: req.method, headers }, (response) => {
      res.writeHead(response.statusCode ?? 502, { ...response.headers, 'cache-control': 'no-store' }); response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'Could not reach the provider proxy' }); else res.destroy(); });
    res.once('close', () => upstream.destroy());
    let bytes = 0;
    req.on('data', (chunk) => { bytes += chunk.length; if (bytes > 64 * 1024 * 1024) { upstream.destroy(); req.destroy(); } });
    req.pipe(upstream);
  }
  server.on('upgrade', (req, socket, head) => {
    const machineId = auth(req);
    if (machineId && req.url === '/relay') {
      relay.handleUpgrade(req, socket, head, (ws) => {
        const previous = relays.get(machineId);
        relays.set(machineId, ws);
        previous?.close(4000, 'Replaced by a newer connection');
        (ws as any).alive = true;
        ws.on('pong', () => { (ws as any).alive = true; });
        ws.on('error', () => {});
        ws.on('message', (data, binary) => { if (!binary && relays.get(machineId) === ws) forward(machineId, String(data)); });
        ws.once('close', () => { if (relays.get(machineId) === ws) { relays.delete(machineId); relayPeers(); } });
        relayPeers();
      });
      return;
    }
    if (!machineId || req.url !== '/events') { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      owners.set(ws, machineId);
      (ws as any).alive = true;
      ws.on('pong', () => { (ws as any).alive = true; });
      ws.on('error', () => {});
      ws.once('close', () => { owners.delete(ws); if (![...owners.values()].includes(machineId)) void settings.machineDisconnected(machineId).catch(() => {}); });
      ws.send(JSON.stringify({ revision }));
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of relay.clients) {
      if (!(ws as any).alive) { ws.terminate(); continue; }
      (ws as any).alive = false; ws.ping();
    }
    for (const ws of sockets.clients) {
      const owner = owners.get(ws);
      if (!(ws as any).alive || !owner) { ws.terminate(); continue; }
      (ws as any).alive = false; ws.ping();
    }
    for (const [id, pending] of logins) if (Date.now() - pending.startedAt > SIGN_IN_TTL_MS) { logins.delete(id); void hub.cancelAccountSignIn(id).catch(() => {}); }
  }, 25_000);
  heartbeat.unref();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(opts.port ?? 47322, opts.host ?? '127.0.0.1', resolve); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port!;
  const url = `http://${opts.host ?? '127.0.0.1'}:${port}`;
  mcp.setUrl(opts.publicUrl ?? url);
  return { hub, settings, resources, secrets, trust, port, url, snapshot, createPairingCode: () => HubTrust.createCode(opts.home),
    async close() { closing = true; clearInterval(heartbeat); for (const ws of sockets.clients) ws.terminate(); for (const ws of relay.clients) ws.terminate();
      // server.close() drops only the connections idle right now; a request finishing later would keep its socket open until the client's keep-alive timeout (~3s).
      const sweep = setInterval(() => server.closeIdleConnections(), 25);
      await new Promise<void>((resolve) => server.close(() => resolve())).finally(() => clearInterval(sweep)); sockets.close(); relay.close(); await queue; for (const grant of grants.values()) grant.release(); await proxy.close(); await modelsRefreshed; await hub.close(); await secrets.close(); await resources.close(); await settings.close(); await trust.close(); } };
}

function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
async function readJson(req: IncomingMessage): Promise<any> {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) throw new SignInError('Hub request is too large'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new SignInError('Invalid JSON request'); }
}
