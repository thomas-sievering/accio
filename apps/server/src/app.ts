import { Router, type Broadcast } from './rpc/router.js';
import { startTransport } from './rpc/transport.js';
import { registerMachine } from './machine/machine.js';
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
  webRoot?: string;
};

/** Infrastructure a test can swap out. Grows as slices need it. */
export type AppDeps = { agent: Agent };

/** Composition root: wires each domain slice into the router and transport. */
export async function startApp(opts: AppOptions, deps: Partial<AppDeps> = {}) {
  const router = new Router();
  // Domain modules get a broadcast that becomes live once the transport is up.
  let send: Broadcast = () => {};
  const broadcast: Broadcast = (event, data) => send(event, data);

  registerMachine(router);

  const accounts = new Accounts(opts.home, broadcast);
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
    close: async () => {
      await transport.close();
      await threads.close();
    },
  };
}
