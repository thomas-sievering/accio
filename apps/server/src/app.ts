import { Router, type Broadcast } from './rpc/router.js';
import { startTransport } from './rpc/transport.js';
import { Machines, loadMachineId, machineInfo } from './machine/machine.js';
import { Hub, SharedSettings, startHubProxy, type Fetch } from '@accio/hub';
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
import { AccioTools } from './tools/tools.js';
import { offerChoice } from './threads/choice.js';

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
  const hubProxy = await startHubProxy({
    hub,
    host: '127.0.0.1',
    port: opts.hubPort,
    upstream: deps.anthropicUrl,
    fetchImpl: deps.claudeFetch,
    openaiUpstream: deps.openaiUrl,
    openaiFetch: deps.openaiFetch,
  });

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

  // Served by this machine to its own harnesses (ADR 0011).
  const tools = new AccioTools([offerChoice]);
  const threads = new Threads(opts.home, profiles, projects, { claudeCode: deps.harness ?? claudeCode, codex: deps.codexHarness ?? codexHarness(deps.codexFactory) }, broadcast, models, machines, tools);
  await threads.load();
  threads.register(router);

  const transport = await startTransport({ ...opts, router, serveHttp: async (req, res) => await tools.handle(req, res) || threads.assets.handle(req, res) });
  send = transport.broadcast;
  // Harnesses run on this computer, so they reach the server on loopback even when it listens on every interface.
  tools.listen(`http://${['0.0.0.0', '::', ''].includes(opts.host) ? '127.0.0.1' : opts.host.includes(':') ? `[${opts.host}]` : opts.host}:${transport.port}`);
  let closing: Promise<void> | undefined;
  return {
    ...transport,
    router,
    profiles,
    projects,
    threads,
    tools,
    hub,
    settings,
    machines,
    hubUrl: hubProxy.url,
    close: () => closing ??= (async () => {
      const turnsClosed = threads.close();
      const profilesClosed = profiles.close();
      await transport.close();
      await turnsClosed;
      await profilesClosed;
      await projects.close();
      await machines.disconnect();
      await hubProxy.close();
      await hub.close();
      await settings.close();
    })(),
  };
}
