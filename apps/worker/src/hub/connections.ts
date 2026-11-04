import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { JsonFile } from '@accio/persistence';
import { HubClient, hubAddress, remoteSettings, remoteResources, remoteMcp, remoteSecrets, type SecretsAccess, type HubSnapshot, type HarnessInstall } from '@accio/hub';
import type { HubConnectionView, MachineInfo, MethodName } from '@accio/protocol';
import { Router, UserError, type Broadcast } from '../rpc/router.js';
import { Profiles } from '../profiles/profiles.js';
import { Machines } from '../machine/machine.js';
import { Models } from '../harnesses/models.js';
import { registerHarnesses } from '../harnesses/harnesses.js';
import { finishGoalTool } from '../goals/goal.js';
import { deliveryStepTool } from '../threads/deliveryStep.js';
import { Projects } from '../projects/projects.js';
import { Threads } from '../threads/threads.js';
import type { Harness } from '../threads/harness.js';
import { AccioTools } from '../tools/tools.js';
import { offerChoice } from '../threads/choice.js';
import { ResourceManager } from '../resources/resources.js';
import type { CommandRunner } from '../resources/process.js';
import type { DeliveryHosting } from '../threads/delivery.js';
import { ClaudeModels } from '../harnesses/claudeModels.js';
import type { ClaudeModelSource } from '../harnesses/catalog.js';
import { harnessEnv } from '../threads/harnessEnv.js';
import { configFolderOf } from '../profiles/claudeConfigFolder.js';

export type SavedHub = { id: string; name: string; url: string; token: string; home: string; local: boolean; managed?: boolean; snapshot?: HubSnapshot };
export type HubWorkspace = { client: HubClient; router: Router; profiles: Profiles; machines: Machines; models: Models; projects: Projects; threads: Threads; tools: AccioTools; resources: ResourceManager; secrets: SecretsAccess; home: string; initialize(origin: string): void; close(): Promise<void> };

/** One local workspace per hub: identical profile IDs cannot alias local work or configuration. */
export class HubConnections {
  readonly workspaces = new Map<string, HubWorkspace>();
  readonly global = new Router();
  readonly file: JsonFile<SavedHub[]>;
  saved: SavedHub[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private cacheTimer?: ReturnType<typeof setTimeout>;
  private closing = false;
  private origin?: string;
  initialized = false;
  constructor(private home: string, private here: MachineInfo, private harnesses: HarnessInstall[], private runners: Record<string, Harness>, private send: (event: any, data: any, hubId?: string) => void, private resourceCommand?: CommandRunner, private claudeModelSource?: ClaudeModelSource, private deliveryHosting?: DeliveryHosting) {
    this.file = new JsonFile(join(home, 'hub-connections.json'), () => []);
    this.register();
  }
  async load() { this.initialized = await access(this.file.path).then(() => true, () => false); this.saved = await this.file.read(); }
  get defaultId() { return this.saved[0]?.id; }
  views(): HubConnectionView[] { return this.saved.map((record) => { const workspace = this.workspaces.get(record.id); return { id: record.id, name: record.name, url: record.url, local: record.local, status: workspace?.client.status ?? 'connecting', error: workspace?.client.error, running: workspace?.threads.runningCount ?? 0 }; }); }
  private async persist() { await this.file.write(this.saved.map((s) => ({ ...s, snapshot: this.workspaces.get(s.id)?.client.snapshot ?? s.snapshot }))); }
  private announce() { if (this.closing) return; this.send('hubs.changed', this.views()); clearTimeout(this.cacheTimer); this.cacheTimer = setTimeout(() => { void this.persist().catch(() => {}); }, 250); this.cacheTimer.unref(); }
  async add(record: SavedHub) {
    if (this.saved.some((s) => s.id === record.id)) throw new UserError('This hub is already saved. Select its existing connection.');
    this.saved.push(record);
    try { await this.open(record); await this.persist(); this.announce(); } catch (error) { this.saved = this.saved.filter((s) => s !== record); throw error; }
  }
  async open(record: SavedHub) {
    const client = new HubClient(record.url, record.id, record.token, { ...this.here, harnesses: this.harnesses });
    if (record.snapshot) client.snapshot = record.snapshot;
    await client.start();
    const settings = remoteSettings(client);
    const router = new Router(this.global);
    let workspace: HubWorkspace | undefined;
    const broadcast: Broadcast = (event, data) => {
      this.send(event, data, record.id);
      if ((event === 'projects.changed' || event === 'threads.changed') && workspace) {
        void workspace.profiles.syncReferences().catch(() => {}); this.announce();
      }
    };
    const profiles = new Profiles(record.home, client, broadcast);
    const machines = new Machines(this.here, settings, broadcast);
    const claudeModels = new ClaudeModels(this.claudeModelSource,
      async (profileId) => harnessEnv(process.env, await profiles.hubAccess(profileId, 'anthropic'), configFolderOf(record.home, profileId)),
      () => broadcast('models.changed', null));
    const models = new Models(profiles, settings, this.here.id, claudeModels);
    profiles.register(router); machines.register(router); models.register(router, broadcast); registerHarnesses(router, settings, models);
    const projects = new Projects(record.home, profiles, machines, broadcast); await projects.load(); projects.register(router);
    const tools = new AccioTools([offerChoice, finishGoalTool((id, outcome, summary) => threads.finishGoal(id, outcome, summary), (id) => threads.goalActive(id)),
      deliveryStepTool((id, step, note) => threads.reportDeliveryStep(id, step, note), (id) => threads.deliveryRunning(id))]);
    const secrets = remoteSecrets(client);
    const threads = new Threads(record.home, profiles, projects, this.runners, broadcast, models, machines, secrets, tools, this.deliveryHosting); await threads.load(); threads.register(router);
    const resources = new ResourceManager(record.home, this.here.id, remoteResources(client), remoteMcp(client), profiles, projects, broadcast, async (tool, detail) => {
      const candidates = tool.repairProfileId ? [profiles.require(tool.repairProfileId)] : profiles.all();
      const profile = candidates.find(p => models.list(p.id).models.length > 0);
      if (!profile) throw new Error('Sign in to a provider and select its account in a profile to start a repair thread.');
      const folder = resources.tools.folder(tool);
      return (await threads.start({ profileId: profile.id, machineId: this.here.id, text: `Repair ${tool.name} on this machine\n\nDiagnose the failure, fix the installation, test it and verify the result. Work on this machine only.\nPackage: ${tool.package}@${tool.version}\nExecutable: ${tool.executable}\nManaged installation folder: ${folder}\nInstall with npm install --prefix <that folder> ${tool.package}@${tool.version}. Keep the installation inside that folder.\nHealth check arguments: ${JSON.stringify(tool.checkArgs)}\nFailure:\n${detail}\n\nAccio will rerun the health check after this thread completes. Report what you changed and the commands and results that prove it works.` }, { repairToolId: tool.id })).id;
    }, this.resourceCommand);
    resources.register(router); threads.resources = resources; threads.toolOverrides = () => settings.harnessTools(); threads.onRepairFinished = id => resources.tools.afterRepair(id);
    profiles.setReferenceSource(() => [...projects.state().projects.map((p) => p.profileId), ...threads.profileReferences()]);
    let reconciliation: Promise<unknown> = Promise.resolve();
    let initialized = false;
    const continueAfterRestart = () => {
      if (initialized && !this.closing) void threads.continueAfterRestart().catch(error => console.error('[threads] startup recovery failed', error));
    };
    workspace = { client, router, profiles, machines, models, projects, threads, tools, resources, secrets, home: record.home,
      initialize: origin => { tools.listen(record.id === this.defaultId ? origin : `${origin}/hubs/${record.id}`); initialized = true; continueAfterRestart(); if (client.status === 'connected') reconciliation = resources.reconcile().catch(error => console.error('[resources] startup check failed', error)); },
      close: async () => { await threads.close(); await secrets.close(); await resources.close(); await reconciliation; await profiles.close(); await projects.close(); await client.close(); } };
    this.workspaces.set(record.id, workspace);
    client.onChanged(() => { this.announce(); broadcast('resources.changed', resources.state()); continueAfterRestart(); });
    if (client.status === 'connected') { await profiles.load(); await profiles.syncReferences(); }
    if (this.origin) workspace.initialize(this.origin);
    return workspace;
  }
  private register() {
    this.global.on('hubs.list', () => this.views())
      .on('hubs.pair', (params) => this.change(async () => {
        const url = hubAddress(params.url);
        const health = await fetch(url + '/healthz', { redirect: 'error', signal: AbortSignal.timeout(10_000) }).then((response) => response.json()) as any;
        if (this.saved.some((s) => s.id === health.hubId)) throw new UserError('This hub is already saved. Select its existing connection.');
        const response = await fetch(url + '/pair', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: params.code, machineId: this.here.id }) });
        const result = await response.json() as any;
        if (!response.ok) throw new UserError(result.error ?? 'Could not pair with this hub');
        if (typeof result.hubId !== 'string' || !/^[\da-f-]{36}$/i.test(result.hubId) || typeof result.token !== 'string') throw new UserError('The address did not return a valid hub pairing');
        await this.add({ id: result.hubId, name: params.name, url, token: result.token, local: ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), home: join(this.home, 'hubs', result.hubId) });
        return this.views().find((v) => v.id === result.hubId)!;
      }))
      .on('hubs.rename', ({ id, name }) => this.change(async () => { const record = this.require(id); record.name = name; await this.persist(); this.announce(); return this.views().find((v) => v.id === id)!; }))
      .on('hubs.createPairingCode', ({ id }) => this.workspace(id).client.call('hub.pairingCode'))
      .on('hubs.revokeMachine', ({ id, machineId }) => this.workspace(id).client.call('hub.revokeMachine', { machineId }))
      .on('hubs.remove', ({ id }) => this.change(async () => {
        const workspace = this.workspace(id);
        if (workspace.threads.runningCount || workspace.profiles.signIns.busy) throw new UserError('Finish or cancel this hub’s running work and sign-in before removing it.');
        await workspace.close(); this.workspaces.delete(id); this.saved = this.saved.filter((s) => s.id !== id); await this.persist(); this.announce(); return null;
      }));
  }
  private require(id: string) { const record = this.saved.find((s) => s.id === id); if (!record) throw new UserError('No such saved hub'); return record; }
  workspace(id: string) { const workspace = this.workspaces.get(id); if (!workspace) throw new UserError('This hub connection is unavailable'); return workspace; }
  router(id: string | null) { return this.workspaces.get(id ?? this.defaultId ?? '')?.router ?? this.global; }
  listen(origin: string) { this.origin = origin; for (const workspace of this.workspaces.values()) workspace.initialize(origin); }
  async asset(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
    const original = req.url;
    const tool = /^\/hubs\/([\da-f-]{36})(\/mcp)(\?.*)?$/.exec(original ?? '');
    if (tool) {
      const workspace = this.workspaces.get(tool[1]!); if (!workspace) { res.writeHead(404).end(); return true; }
      req.url = tool[2]! + (tool[3] ?? '');
      try { return await workspace.tools.handle(req, res); } finally { req.url = original; }
    }
    const match = /^\/hubs\/([\da-f-]{36})(\/thread-assets\/[^?]+)(\?.*)?$/.exec(original ?? '');
    if (match) {
      const workspace = this.workspaces.get(match[1]!); if (!workspace) { res.writeHead(404).end(); return true; }
      req.url = match[2]! + (match[3] ?? '');
      try { return await workspace.threads.assets.handle(req, res); } finally { req.url = original; }
    }
    if (!this.defaultId) return false;
    const workspace = this.workspace(this.defaultId);
    return await workspace.tools.handle(req, res) || workspace.threads.assets.handle(req, res);
  }
  private change<T>(fn: () => Promise<T>) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
  stopAccepting() { for (const workspace of this.workspaces.values()) workspace.profiles.stopAccepting(); }
  async close() { this.closing = true; this.stopAccepting(); clearTimeout(this.cacheTimer); await this.queue; await this.persist(); await Promise.all([...this.workspaces.values()].map((workspace) => workspace.close())); }
}
