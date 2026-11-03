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
  const hub = new Hub(opts.home, deps.claudeFetch ?? fetch);
  await hub.load();
  const settings = new SharedSettings(opts.home);
  await moveProfilesToHub(opts.home, here, settings);
  const hubProxy = await startHubProxy({
    hub,
    host: '127.0.0.1',
    port: opts.hubPort,
    upstream: deps.anthropicUrl,
    fetchImpl: deps.claudeFetch,
  });

  const machines = new Machines(here, settings, broadcast);
  await machines.connect([await claudeCodeInstall()]);
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

  const threads = new Threads(opts.home, profiles, projects, deps.harness ?? claudeCode, broadcast, models, machines);
  await threads.load();
  threads.register(router);

  const transport = await startTransport({ ...opts, router });
  send = transport.broadcast;
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
    hubUrl: hubProxy.url,
    close: () => closing ??= (async () => {
      const turnsClosed = threads.close();
      await transport.close();
      await turnsClosed;
      await projects.close();
      await machines.disconnect();
      await hubProxy.close();
      await hub.close();
      await settings.close();
    })(),
  };
}
