import { Router, type Broadcast } from './rpc/router.js';
import { startTransport } from './rpc/transport.js';
import { Machines, loadMachineId, machineInfo } from './machine/machine.js';
import { Hub, SharedSettings, Resources, McpGateway, startHubProxy, type Fetch } from '@accio/hub';
import { ResourceManager } from './resources/resources.js';
import type { CommandRunner } from './resources/process.js';
import { moveProfilesToHub } from './store/moveProfilesToHub.js';
import { registerHarnesses } from './harnesses/harnesses.js';
import { Models } from './harnesses/models.js';
import { Profiles } from './profiles/profiles.js';
import { registerHub } from './hub/hub.js';
import { renameAccountsToProfiles } from './store/renameAccountsToProfiles.js';
import { Projects } from './projects/projects.js';
import { Threads } from './threads/threads.js';
import type { Harness } from './threads/harness.js';
import { claudeCode, claudeCodeInstall } from './threads/claudeCode.js';
import { codexHarness } from './threads/codex.js';
import { codexInstall, type CodexFactory } from '@accio/codex';
import { OpenAIAuth } from '@accio/hub';

export type AppOptions = {
  home: string;
  host: string;
  port: number;
  token: string;
  /** Port of the hub that threads call (ADR 0007). 0 picks a free one. */
  hubPort: number;
  webRoot?: string;
};

/** Infrastructure a test can swap out. Grows as slices need it. */
export type AppDeps = {
  resourceCommand: CommandRunner;
  mcpFetch: typeof fetch;
  harness: Harness;
  /** Reaches Anthropic for sign-in and token refresh. */
  claudeFetch: Fetch;
  /** Where the hub forwards threads' requests. */
  anthropicUrl: string;
  codexHarness: Harness;
  codexFactory: CodexFactory;
  openaiUrl: string;
  openaiFetch: Fetch;
};

/** Composition root: wires each domain slice into the router and transport. */
export async function startApp(opts: AppOptions, deps: Partial<AppDeps> = {}) {
  const router = new Router();
  // Domain modules get a broadcast that becomes live once the transport is up.
  let send: Broadcast = () => {};
  const broadcast: Broadcast = (event, data) => send(event, data);

  await renameAccountsToProfiles(opts.home);
  const here = machineInfo(await loadMachineId(opts.home));

  // In v0.1 this machine runs the hub in-process.
  const hub = new Hub(opts.home, deps.claudeFetch ?? fetch, new OpenAIAuth(opts.home, deps.codexFactory));
  await hub.load();
  const settings = new SharedSettings(opts.home);
  await moveProfilesToHub(opts.home, here, settings);
  const resourceStore = new Resources(opts.home);
  await resourceStore.load();
  const mcpGateway = new McpGateway(resourceStore, deps.mcpFetch);
  const hubProxy = await startHubProxy({
    hub,
    host: '127.0.0.1',
    port: opts.hubPort,
    upstream: deps.anthropicUrl,
    fetchImpl: deps.claudeFetch,
    openaiUpstream: deps.openaiUrl,
    openaiFetch: deps.openaiFetch,
    handleMcp: (req, res) => mcpGateway.handle(req, res),
  });
  mcpGateway.setUrl(hubProxy.url);

  const machines = new Machines(here, settings, broadcast);
  const codex = await codexInstall();
  await machines.connect([await claudeCodeInstall(), ...(codex.version ? [codex] : [])]);
  machines.register(router);
  registerHarnesses(router, settings);

  const profiles = new Profiles(opts.home, hub, settings, hubProxy.url, broadcast);
  await profiles.load();
  profiles.register(router);
  const models = new Models(profiles, settings, here.id);
  models.register(router, broadcast);
  registerHub(router, { hub, settings, url: hubProxy.url });

  const projects = new Projects(opts.home, profiles, machines, broadcast);
  await projects.load();
  projects.register(router);

  const threads = new Threads(opts.home, profiles, projects, { claudeCode: deps.harness ?? claudeCode, codex: deps.codexHarness ?? codexHarness(deps.codexFactory) }, broadcast, models, machines);
  await threads.load();
  threads.register(router);
  const resources = new ResourceManager(opts.home, here.id, resourceStore, mcpGateway, profiles, projects, broadcast, async (tool, detail) => {
    const candidates = tool.repairProfileId ? [profiles.require(tool.repairProfileId)] : profiles.all();
    const profile = candidates.find(p => models.list(p.id).models.length > 0);
    if (!profile) throw new Error('Sign in to a provider and select its account in a profile to start a repair thread.');
    const folder = resources.tools.folder(tool);
    const thread = await threads.start({ profileId: profile.id, machineId: here.id, text: `Repair ${tool.name} on this machine\n\nAccio could not install or verify this managed tool. Diagnose the failure, fix the installation, test it and verify the result. Work on this machine only.\n\nPackage: ${tool.package}@${tool.version}\nExecutable: ${tool.executable}\nManaged installation folder: ${folder}\nInstall with npm install --prefix <that folder> ${tool.package}@${tool.version}. Keep the installation inside that managed folder.\nHealth check arguments: ${JSON.stringify(tool.checkArgs)}\nFailure:\n${detail}\n\nAccio will rerun the health check after this thread completes. Report what you changed and the commands and results that prove it works.` }, { repairToolId: tool.id });
    return thread.id;
  }, deps.resourceCommand);
  resources.register(router);
  threads.resources = resources;
  threads.onRepairFinished = id => resources.tools.afterRepair(id);

  const transport = await startTransport({ ...opts, router, serveAsset: (req, res) => threads.assets.handle(req, res) });
  send = transport.broadcast;
  const reconciliation = resources.reconcile().catch(error => console.error('[resources] startup check failed', error));
  let closing: Promise<void> | undefined;
  return {
    ...transport,
    router,
    profiles,
    projects,
    threads,
    hub,
    settings,
    machines,
    resources,
    hubUrl: hubProxy.url,
    close: () => closing ??= (async () => {
      const turnsClosed = threads.close();
      const resourcesClosed = resources.close();
      const profilesClosed = profiles.close();
      await transport.close();
      await turnsClosed;
      await resourcesClosed;
      await reconciliation;
      await profilesClosed;
      await projects.close();
      await machines.disconnect();
      await hubProxy.close();
      await hub.close();
      await resourceStore.close();
      await settings.close();
    })(),
  };
}
