import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { GitHubLogin, methods, noHouseMessage, noSortingHatMessage, ResourceScope, SecretSlot, type AccountView, type AccountLimitsView, type ProfileView, type ProviderId, type ResourcesState, type SaveProfileParams, type SecretSummary, type SortingHatView } from '@accio/protocol';
import { SharedSettings, type MachineHello } from './sharedSettings.js';
import { HubError } from './errors.js';
import { HubTrust } from './trust.js';
import { HUB_INTERVAL_MS, keepAlive } from './keepAlive.js';
import { accountSelection, profileViews, saveSharedProfile } from './profile.js';
import { SortingHatLink } from './sortingHatLink.js';
import type { CodexModel, Fetch } from './sortingHatClient.js';
import { Resources } from './resources.js';
import { McpGateway } from './mcp.js';
import { RESOURCE_WRITES } from './resourceClient.js';
import { SecretsVault, SecretStoreError } from './secrets.js';

export const HUB_PROTOCOL = 2;
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
  /** GLOSSARY: Space. Absent from hubs before spaces. */
  spaces?: ReturnType<SharedSettings['spaces']>;
  /** GLOSSARY: Project. Absent from hubs before they kept projects. */
  projects?: ReturnType<SharedSettings['projects']>;
  /** GLOSSARY: Snooze. Absent from hubs before snoozes until a machine is back. */
  offlineSnoozes?: ReturnType<SharedSettings['offlineSnoozes']>;
  models: Record<string, CodexModel[]>;
  resources: ResourcesState;
  limits: AccountLimitsView[];
  secrets: SecretSummary[];
  /** GLOSSARY: Sorting Hat. The hub's link to one, when it has one; never its admin token. Accounts, models and limits are read from it. */
  sortingHat?: SortingHatView;
};
export type HubServiceOptions = {
  home: string; host?: string; port?: number;
  mcpFetch?: Fetch; publicUrl?: string; secretKey?: string;
  /** GLOSSARY: Accio version. What this hub runs, shown to clients. */
  version?: string;
  /**
   * Header a trusted forwarding proxy sets to the real client address, such as `cf-connecting-ip`
   * behind a Cloudflare Tunnel. Pairing is limited per that address; unset, per socket address,
   * because a client could send any header itself. A list takes its last entry, the one the proxy added.
   */
  clientAddressHeader?: string;
};
const SecretId = z.string().min(1).max(160);
const SecretScope = z.object({ profileId: SecretId, projectId: SecretId.nullable(), slot: SecretSlot });
const settingCalls = {
  'threads.snoozeUntilOnline': z.object({
    threadId: z.string().min(1).max(128),
    snooze: z.object({ machineId: z.string().min(1).max(128), until: z.iso.datetime({ offset: true }) }).nullable(),
  }),
  'harnesses.setTools': z.object({ harnessId: z.string().min(1).max(64), tools: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), z.boolean()) }),
};
const secretCalls = {
  'secrets.resolve': SecretScope,
  'secrets.bind': z.object({ id: SecretId, scope: SecretScope }),
  'secrets.used': z.object({ id: SecretId, version: z.number().int().positive(), scope: SecretScope }),
};
const ShortId = z.string().min(1).max(512);
const SkillEntry = z.object({ id: z.string(), sourceId: z.string(), name: z.string(), description: z.string(), path: z.string(), revision: z.string(), scope: ResourceScope });
const Skills = z.array(SkillEntry).min(1).max(10_000);
const write = <M extends typeof RESOURCE_WRITES[number], A extends [z.ZodType, ...z.ZodType[]]>(method: M, ...args: A) => z.object({ method: z.literal(method), args: z.tuple(args) });
/** One entry per mutation in RESOURCE_WRITES, with its arguments in order. */
const ResourceWrite = z.discriminatedUnion('method', [
  write('saveTool', methods['tools.save'].params),
  write('deleteTool', ShortId),
  write('setToolScope', ShortId, ResourceScope),
  write('saveSource', methods['skills.addSource'].params, Skills),
  write('stageSkills', ShortId, Skills),
  write('applySkills', ShortId, ShortId),
  write('deleteSource', ShortId),
  write('setSkillScope', ShortId, ResourceScope),
  write('setSkillProject', ShortId, z.object({ projectKey: ShortId, enabled: z.boolean() })),
  write('setSkillSpace', ShortId, z.object({ spaceId: ShortId, enabled: z.boolean() })),
  write('saveMcp', methods['mcp.save'].params),
  write('deleteMcp', ShortId),
  write('setCredential', ShortId, z.object({ accessToken: z.string(), refreshToken: z.string().optional(), expiresAt: z.number().optional(), tokenEndpoint: z.string().optional(), clientId: z.string().optional(), clientSecret: z.string().optional() })),
  write('setToolStatus', z.object({ toolId: ShortId, machineId: z.string(), status: z.enum(['pending', 'installing', 'ready', 'error']), version: z.string().optional(), detail: z.string().optional(),
    checkedAt: z.string().optional(), description: z.string().max(1000).optional(), repairThreadId: z.string().optional(), repairError: z.string().optional() })),
]);
/** A machine's local browser callback, the only redirect address a sign-in may name. */
function isBrowserCallback(value: string) {
  if (!URL.canParse(value)) return false;
  const u = new URL(value);
  return u.protocol === 'http:' && u.hostname === 'localhost' && u.pathname === '/callback' && !!u.port && !u.search && !u.hash && !u.username && !u.password;
}
/** GLOSSARY: Project. A repository with a remote, by its key, as a machine registers it. */
const HubProjectInput = z.object({ repoKey: z.string().min(1).max(300), name: z.string().min(1).max(200), profileId: z.string().min(1).max(160) });
/** Methods only paired machines call, or call with more than the client protocol lists. */
const machineCalls = {
  'machine.hello': z.object({
    id: z.string().min(1).max(128), name: z.string().min(1).max(256), platform: z.string().min(1).max(64), version: z.string().min(1).max(128),
    harnesses: z.array(z.object({ harnessId: z.string().min(1).max(64), version: z.string().max(128).nullable() })).max(100),
    githubAccounts: z.array(GitHubLogin).max(100).optional(),
  }),
  'machine.references': z.object({ profiles: z.array(z.string()).max(10_000) }),
  'machine.modelKey': z.object({ profileId: z.string().min(1).max(160) }),
  'hubProjects.register': z.object({ projects: z.array(HubProjectInput).max(10_000) }),
  'hubProjects.setProfile': HubProjectInput,
  'hubProjects.forget': z.object({ repoKey: HubProjectInput.shape.repoKey }),
  'hub.pairingCode': z.object({}),
  'hub.revokeMachine': z.object({ machineId: z.string().min(1).max(128) }),
  'resources.write': ResourceWrite,
  'mcp.grant': z.object({ id: ShortId, profileId: z.string().min(1).max(160), projectKey: ShortId.optional() }),
  'mcp.release': z.object({ token: ShortId }),
  'accounts.beginSignIn': z.object({ id: z.string(), redirectUri: z.string().max(512).refine(isBrowserCallback, 'Invalid browser callback').optional() }),
  'accounts.callback': z.object({ signInId: ShortId, code: z.string().min(1).max(16_384), state: z.string().max(1024).optional() }),
};
/** Names the first problem, such as `profiles.0: Invalid input: expected string, received number`. */
function invalid(error: z.ZodError) {
  const issue = error.issues[0];
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  return new HubError(`Invalid hub request parameters${issue ? ` (${where}${issue.message})` : ''}`);
}
/** How long the hub remembers who started a sign-in; the Sorting Hat expires the sign-in itself. */
const SIGN_IN_TTL_MS = 15 * 60_000;

/** The same service runs on loopback for development and behind HTTPS at home. */
export async function startHubService(opts: HubServiceOptions) {
  const settings = new SharedSettings(opts.home);
  const trust = new HubTrust(opts.home);
  const resources = new Resources(opts.home);
  const secrets = new SecretsVault(opts.home, opts.secretKey);
  const mcp = new McpGateway(resources, opts.mcpFetch);
  const grants = new Map<string, { machineId: string; release(): void }>();
  await settings.load(); await trust.load(); await resources.load(); await secrets.load();
  // GLOSSARY: Sorting Hat (ADR 0018). It holds the accounts; each profile links to one of its houses, and threads get hat keys per profile and machine.
  const link = new SortingHatLink(opts.home, secrets, () => settings.profiles().flatMap((p) => p.houseId ? [p.houseId] : []));
  await link.load();
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
  /** GLOSSARY: Sign-in. Only which machine started each one, so another can't poll, finish or cancel it; the Sorting Hat holds the rest. */
  const signInOwners = new Map<string, { machineId: string; at: number }>();
  const pairingAttempts = new Map<string, { count: number; until: number }>();
  let revision = 0;
  const epoch = randomUUID();
  let queue: Promise<unknown> = Promise.resolve();
  let closing = false;
  function snapshot(): HubSnapshot {
    const profiles = settings.profiles();
    const remote = link.view();
    return { hubId: trust.id, protocol: HUB_PROTOCOL, revision, epoch, ...(opts.version ? { version: opts.version } : {}), profiles: profileViews(profiles, link), accounts: link.accountViews(), machines: settings.machines(),
      favorites: Object.fromEntries(profiles.map((p) => [p.id, settings.modelFavorites(p.id)])), harnessTools: settings.harnessTools(),
      threadNaming: settings.threadNaming(), spaces: settings.spaces(), projects: settings.projects(), offlineSnoozes: settings.offlineSnoozes(),
      models: Object.fromEntries(profiles.map((p) => [p.id, p.houseId ? link.codexModels(p.houseId) : []])), resources: resources.state(), limits: link.limitViews(), secrets: profiles.flatMap(p => secrets.list(p.id)),
      ...(remote ? { sortingHat: remote } : {}) };
  }
  function announce() { revision++; for (const ws of sockets.clients) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ revision })); }
  settings.onMachinesChanged(announce);
  link.onChanged(announce);
  secrets.onChanged(announce);
  function auth(req: IncomingMessage) { const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]; return token ? trust.authenticate(token) : undefined; }
  function ownSignIn(id: string, machineId: string) {
    if (signInOwners.get(id)?.machineId !== machineId) throw new HubError('This sign-in has expired or was cancelled. Start it again.');
  }
  async function execute(machineId: string, method: string, raw: any): Promise<unknown> {
    const schema: z.ZodType | undefined = (machineCalls as Record<string, z.ZodType>)[method] ?? (methods as Record<string, any>)[method]?.params ?? (secretCalls as Record<string, z.ZodType>)[method] ?? (settingCalls as Record<string, z.ZodType>)[method];
    if (!schema) throw new HubError(`Unknown hub method ${method}`);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw invalid(parsed.error);
    const p = parsed.data as any;
    switch (method) {
      case 'machine.hello': {
        const hello = p as MachineHello;
        if (hello.id !== machineId || JSON.stringify(hello).length > 16_384) throw new HubError('Invalid machine identity');
        await settings.machineConnected(hello); return null;
      }
      case 'machine.references': await trust.references(machineId, p.profiles); return null;
      case 'hubProjects.register': return settings.registerProjects(p.projects);
      case 'hubProjects.setProfile': await settings.setProjectProfile(p); return null;
      case 'hubProjects.forget': await settings.forgetProject(p.repoKey); return null;
      case 'machine.modelKey': {
        const profile = settings.profiles().find((profile) => profile.id === p.profileId);
        if (!profile) throw new HubError('No such profile');
        if (!link.configured) throw new HubError(noSortingHatMessage);
        // GLOSSARY: Hat key. One per profile and machine, with the address threads reach the Sorting Hat at.
        if (!profile.houseId) throw new HubError(noHouseMessage(profile.name));
        const key = await link.hatKey({ id: machineId, name: settings.machine(machineId)?.name ?? machineId }, profile, profile.houseId);
        return { key, url: link.threadUrl };
      }
      case 'hub.pairingCode': return HubTrust.createCode(opts.home);
      case 'hub.revokeMachine': {
        await trust.revoke(p.machineId);
        await link.forgetMachine(p.machineId);
        for (const [token, grant] of grants) if (grant.machineId === p.machineId) { grant.release(); grants.delete(token); }
        for (const [ws, owner] of owners) if (owner === p.machineId) ws.close(4001, 'Pairing revoked');
        closeRelay(p.machineId, 'Pairing revoked');
        await settings.machineDisconnected(p.machineId); return null;
      }
      case 'accounts.list': return link.accountViews();
      case 'accounts.limits': return link.limitViews();
      case 'accounts.refreshLimits': return link.refreshLimits(p.accountIds, p.force);
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
        const { method: write, args } = p as z.output<typeof ResourceWrite>;
        if (write === 'setToolStatus' && args[0].machineId !== machineId) throw new HubError('Invalid machine tool status');
        if (write === 'setCredential' && !resources.state().mcps.some(value => value.id === args[0] && value.auth === 'bearer')) throw new HubError('Select a bearer-authenticated MCP server');
        if (write === 'deleteMcp') await mcp.signOut(args[0]);
        await (resources[write] as (...values: any[]) => Promise<void>).apply(resources, args);
        return null;
      }
      case 'mcp.beginSignIn': return mcp.beginSignIn(p.id).catch(error => { throw new HubError(error.message); });
      case 'mcp.completeSignIn': await mcp.completeSignIn(p.callbackUrl, p.id).catch(error => { throw new HubError(error.message); }); return null;
      case 'mcp.signOut': await mcp.signOut(p.id); return null;
      case 'mcp.grant': {
        if (!settings.profiles().some(profile => profile.id === p.profileId)) throw new HubError('Invalid MCP grant');
        const grant = mcp.grant(p.id, p.profileId, p.projectKey); grants.set(grant.token, { machineId, release: grant.release }); return { token: grant.token };
      }
      case 'mcp.release': {
        const grant = grants.get(p.token); if (grant?.machineId === machineId) { grant.release(); grants.delete(p.token); } return null;
      }
      // GLOSSARY: Account. The hub passes account changes and sign-ins to the Sorting Hat's management API, then reads it back.
      case 'accounts.save': return link.write((c) => p.id ? c.renameAccount(p.id, p.name) : c.createAccount(p.name, p.providerId ?? 'anthropic'));
      case 'accounts.delete': await link.deleteAccount(p.id); return null;
      case 'accounts.signOut': return link.write((c) => c.signOut(p.id));
      case 'accounts.beginSignIn': {
        const result = await link.write((c) => c.beginSignIn(p.id, p.redirectUri));
        signInOwners.set(result.signInId, { machineId, at: Date.now() });
        return result;
      }
      case 'accounts.signInStatus': {
        ownSignIn(p.signInId, machineId);
        const result = await link.require().signInStatus(p.signInId);
        // Read back at once, so the snapshot answering this call has the signed-in account.
        if (result.status === 'complete') await link.poll();
        return result;
      }
      case 'accounts.callback':
        ownSignIn(p.signInId, machineId);
        await link.write((c) => c.completeSignIn(p.signInId, { code: p.code, ...(p.state ? { state: p.state } : {}) }));
        return null;
      case 'accounts.cancelSignIn':
        ownSignIn(p.signInId, machineId);
        await link.require().cancelSignIn(p.signInId);
        signInOwners.delete(p.signInId); return null;
      case 'profiles.list': return profileViews(settings.profiles(), link);
      case 'profiles.save': return saveProfile(p);
      case 'profiles.delete': {
        if (!settings.profiles().some((profile) => profile.id === p.id)) throw new HubError(`No profile ${p.id}`);
        if (secrets.inUse(p.id)) throw new HubError('This profile still has saved secrets. Delete them first.');
        if (trust.referenced(p.id)) throw new HubError('This profile is still used by projects or threads on a paired machine. Remove those references first.');
        // Its house stays on the Sorting Hat, which other apps may use; only this hub's keys for it go.
        await settings.setProfiles(settings.profiles().filter((profile) => profile.id !== p.id)); await link.forgetProfile(p.id); return null;
      }
      case 'machines.rename': await settings.renameMachine(p.machineId, p.name); return null;
      case 'machines.setProfileFolders': await settings.setProfileFolders(p.machineId, p.profileId, p.folders); return null;
      case 'machines.setProfileGitHub': await settings.setProfileGitHub(p.machineId, p.profileId, p.login); return null;
      case 'models.favorite': await settings.setModelFavorite(p.profileId, p.model, p.favorite); return null;
      case 'harnesses.setTools': await settings.setHarnessTools(p.harnessId, p.tools); return null;
      case 'threads.snoozeUntilOnline':
        try { await settings.setOfflineSnooze(p.threadId, p.snooze); } catch (error) { throw new HubError((error as Error).message); }
        return null;
      case 'threadNaming.save': await settings.setThreadNaming(p); return settings.threadNaming();
      case 'spaces.list': return settings.spaces();
      case 'spaces.save': return settings.saveSpace(p);
      case 'spaces.delete': await settings.deleteSpace(p.id); return null;
      case 'sortingHat.get': return link.view() ?? null;
      case 'sortingHat.configure': await link.configure(p); return link.view();
      case 'sortingHat.disconnect': await link.disconnect(); return null;
      default: throw new HubError(`Unknown hub method ${method}`);
    }
  }
  /**
   * GLOSSARY: Profile. Its link to a house is checked against the Sorting Hat's houses, and an account selection sets
   * that house's accounts there, for every app using it. A save that links
   * another house leaves both houses' accounts as they are. `createHouse` makes
   * a house of the profile's name there and links it.
   */
  async function saveProfile(p: SaveProfileParams) {
    if (p.createHouse) {
      saveSharedProfile(settings.profiles(), p); // An invalid profile makes no house.
      p = { ...p, houseId: (await link.write((c) => c.createHouse(p.name))).id };
    }
    if (p.houseId && !link.house(p.houseId)) throw new HubError('The Sorting Hat has no such house. Pick one from its list.');
    const before = p.id ? settings.profiles().find((profile) => profile.id === p.id) : undefined;
    const { saved, profiles } = saveSharedProfile(settings.profiles(), p);
    const moved = p.houseId !== undefined && (p.houseId ?? undefined) !== before?.houseId;
    // A new profile's accounts are its new house's.
    const relinked = moved && !!before;
    const selection = accountSelection(p);
    const house = saved.houseId ? link.house(saved.houseId) : undefined;
    if (!relinked && house) {
      const changes = Object.fromEntries(Object.entries(selection).filter(([provider, ids]) => JSON.stringify(ids) !== JSON.stringify(house.accounts[provider as ProviderId])));
      if (Object.keys(changes).length) await link.write((c) => c.setHouseAccounts(house.id, changes));
    } else if (!relinked && Object.values(selection).some((ids) => ids?.length)) throw new HubError('Link this profile to a house on the Sorting Hat before choosing its accounts.');
    await settings.setProfiles(profiles);
    // Read again for the house's models, now that a profile links it.
    if (moved) { await link.forgetStale((id) => settings.profiles().find((profile) => profile.id === id)?.houseId); await link.poll(); }
    return profileViews([saved], link)[0];
  }
  const server = createServer((req, res) => { void handle(req, res).catch((error) => {
    if (res.headersSent) { res.destroy(); return; }
    const safe = error instanceof HubError || error instanceof SecretStoreError;
    json(res, safe ? 400 : 500, { error: safe ? error.message : 'Hub request failed. Check the hub service.' });
  }); });
  const forwardedHeader = opts.clientAddressHeader?.trim().toLowerCase() || undefined;
  function clientAddress(req: IncomingMessage) {
    const forwarded = forwardedHeader && req.headers[forwardedHeader];
    const value = (Array.isArray(forwarded) ? forwarded.at(-1) : forwarded)?.split(',').at(-1)?.trim();
    return value || (req.socket.remoteAddress ?? 'unknown');
  }
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
      const address = clientAddress(req);
      if (pairingAttempts.size > 1000) for (const [key, v] of pairingAttempts) if (v.until < Date.now()) pairingAttempts.delete(key);
      const counter = pairingAttempts.get(address);
      if (counter && counter.until > Date.now() && counter.count >= 10) return json(res, 429, { error: 'Too many pairing attempts. Try again in a minute.' });
      pairingAttempts.set(address, counter && counter.until > Date.now() ? { ...counter, count: counter.count + 1 } : { count: 1, until: Date.now() + 60_000 });
      const p = await readJson(req);
      if (typeof p.code !== 'string' || typeof p.machineId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(p.machineId)) throw new HubError('Invalid pairing request');
      const paired = await trust.pair(p.code, p.machineId);
      // Pairing again starts over with new hat keys.
      await link.forgetMachine(p.machineId);
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
      if (typeof p.method !== 'string' || !p.params || typeof p.params !== 'object' || Array.isArray(p.params)) throw new HubError('Invalid hub request');
      const invoke = async () => {
        // Authenticate again after waiting for earlier revocation requests.
        if (auth(req) !== machineId) throw new HubError('Pairing has been revoked.');
        const result = await execute(machineId, p.method, p.params); announce(); return { result, snapshot: snapshot() };
      };
      // MCP token exchanges must allow sign-out to invalidate an in-flight exchange.
      const independent = p.method === 'mcp.completeSignIn' || p.method === 'mcp.beginSignIn' || p.method === 'accounts.refreshLimits';
      const operation = independent ? Promise.resolve().then(invoke) : queue.then(invoke);
      if (!independent) queue = operation.catch(() => {});
      return json(res, 200, await operation);
    }
    return json(res, 404, { error: 'Unknown hub endpoint' });
  }
  server.on('upgrade', (req, socket, head) => {
    const machineId = auth(req);
    if (machineId && req.url === '/relay') {
      relay.handleUpgrade(req, socket, head, (ws) => {
        const previous = relays.get(machineId);
        relays.set(machineId, ws);
        previous?.close(4000, 'Replaced by a newer connection');
        keepAlive(ws, HUB_INTERVAL_MS, { endOnWake: false });
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
      keepAlive(ws, HUB_INTERVAL_MS, { endOnWake: false });
      ws.on('error', () => {});
      ws.once('close', () => { owners.delete(ws); if (![...owners.values()].includes(machineId)) void settings.machineDisconnected(machineId).catch(() => {}); });
      ws.send(JSON.stringify({ revision }));
    });
  });
  // The Sorting Hat expires its own sign-ins, and keeps a finished one about as long.
  const signInSweep = setInterval(() => {
    for (const [id, owner] of signInOwners) if (Date.now() - owner.at > 2 * SIGN_IN_TTL_MS) signInOwners.delete(id);
  }, 25_000);
  signInSweep.unref();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(opts.port ?? 47322, opts.host ?? '127.0.0.1', resolve); });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port!;
  const url = `http://${opts.host ?? '127.0.0.1'}:${port}`;
  mcp.setUrl(opts.publicUrl ?? url);
  return { sortingHatLink: link, settings, resources, secrets, trust, port, url, snapshot, createPairingCode: () => HubTrust.createCode(opts.home),
    async close() { closing = true; clearInterval(signInSweep); for (const ws of sockets.clients) ws.terminate(); for (const ws of relay.clients) ws.terminate();
      // server.close() drops only the connections idle right now; a request finishing later would keep its socket open until the client's keep-alive timeout (~3s).
      const sweep = setInterval(() => server.closeIdleConnections(), 25);
      await new Promise<void>((resolve) => server.close(() => resolve())).finally(() => clearInterval(sweep)); sockets.close(); relay.close(); await queue; for (const grant of grants.values()) grant.release(); await link.close(); await secrets.close(); await resources.close(); await settings.close(); await trust.close(); } };
}

function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
async function readJson(req: IncomingMessage): Promise<any> {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) throw new HubError('Hub request is too large'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HubError('Invalid JSON request'); }
}
