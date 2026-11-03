import { Router, type Broadcast } from './rpc/router.js';
import { startTransport } from './rpc/transport.js';
import { registerMachine } from './machine/machine.js';
import { Hub, startHubProxy, type Fetch } from '@accio/hub';
import { Accounts } from './accounts/accounts.js';
import { Projects } from './projects/projects.js';
import { Threads } from './threads/threads.js';
import type { Agent } from './threads/agent.js';
import { claudeAgent } from './threads/claudeAgent.js';

export type AppOptions = {
  home: string;
  host: string;
  port: number;
  token: string;
  /** Port of the hub agents call (ADR 0007). 0 picks a free one. */
  hubPort: number;
  webRoot?: string;
};

/** Infrastructure a test can swap out. Grows as slices need it. */
export type AppDeps = {
  agent: Agent;
  /** Reaches Anthropic for sign-in and token refresh. */
  claudeFetch: Fetch;
  /** Where the hub forwards agent requests. */
  anthropicUrl: string;
};

/** Composition root: wires each domain slice into the router and transport. */
export async function startApp(opts: AppOptions, deps: Partial<AppDeps> = {}) {
  const router = new Router();
  // Domain modules get a broadcast that becomes live once the transport is up.
  let send: Broadcast = () => {};
  const broadcast: Broadcast = (event, data) => send(event, data);

  registerMachine(router);

  // This machine is the home machine in v0.1, so it runs the hub in-process.
  const hub = new Hub(opts.home, deps.claudeFetch ?? fetch);
  await hub.load();
  const hubProxy = await startHubProxy({
    hub,
    host: '127.0.0.1',
    port: opts.hubPort,
    upstream: deps.anthropicUrl,
    fetchImpl: deps.claudeFetch,
  });

  const accounts = new Accounts(opts.home, hub, hubProxy.url, broadcast);
  await accounts.load();
  accounts.register(router);

  const projects = new Projects(opts.home, accounts, broadcast);
  await projects.load();
  projects.register(router);

  const threads = new Threads(opts.home, accounts, projects, deps.agent ?? claudeAgent, broadcast);
  await threads.load();
  threads.register(router);

  const transport = await startTransport({ ...opts, router });
  send = transport.broadcast;
  return {
    ...transport,
    router,
    accounts,
    projects,
    threads,
    hub,
    hubUrl: hubProxy.url,
    close: async () => {
      await transport.close();
      await threads.close();
      await hubProxy.close();
      await hub.close();
    },
  };
}
