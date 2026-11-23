import { startTransport } from './rpc/transport.js';
import { loadMachineId, machineInfo } from './machine/machine.js';
import { startHubService, type Fetch } from '@accio/hub';
import type { Harness } from './threads/harness.js';
import { claudeCode, claudeCodeInstall } from './threads/claudeCode.js';
import { codexHarness } from './threads/codex.js';
import { piHarness, piInstall, type PiFactory } from './threads/pi.js';
import { codexInstall, type CodexFactory } from '@accio/codex';
import { HubConnections } from './hub/connections.js';
import type { CommandRunner } from './resources/process.js';
import type { DeliveryHosting } from './threads/delivery.js';
import { sdkClaudeModels, type ClaudeModelSource } from './harnesses/catalog.js';
import { Updates, pnpmHere, type UpdateDeps } from './machine/update.js';
import { desktopHost } from './machine/desktop.js';
import { appCheckout, checkoutVersion } from './machine/checkout.js';
import { runCommand } from './resources/process.js';
import type { GhRunner } from './github/accounts.js';

export type AppOptions = { home: string; host: string; port: number; token: string; hubPort: number; webRoot?: string };
export type AppDeps = { resourceCommand: CommandRunner; mcpFetch: Fetch; harness: Harness; claudeModels: ClaudeModelSource; codexHarness: Harness; codexFactory: CodexFactory; piFactory: PiFactory; deliveryHosting: DeliveryHosting; github: GhRunner; updates: Partial<Omit<UpdateDeps, 'machineId'>> };

/** The local machine hosts clients and work; all hubs use the standalone service protocol. */
export async function startApp(opts: AppOptions, deps: Partial<AppDeps> = {}) {
  // GLOSSARY: Update. Tests pass their own checkout; nothing else looks for one.
  const root = deps.updates ? deps.updates.root : await appCheckout();
  // The version this Accio started on, here and for its local hub.
  const version = root ? await checkoutVersion(root) : undefined;
  const here = { ...machineInfo(await loadMachineId(opts.home)), ...(version ? { version } : {}) };
  const codex = await codexInstall();
  const pi = await piInstall();
  const harnesses = [await claudeCodeInstall(), ...(codex.version ? [codex] : []), ...(pi.version ? [pi] : [])];
  const host = desktopHost();
  const updates = new Updates({ machineId: here.id, run: runCommand, pnpm: pnpmHere(), host, ...(deps.updates ?? { root }) });
  // The transport listens first, so every workspace knows its origin; clients wait until the first workspace is open.
  let opened!: () => void, failed!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { opened = resolve; failed = reject; });
  ready.catch(() => {});
  const transport = await startTransport({ ...opts, ready, routerFor: (id) => connections.router(id), serveHttp: (req, res) => connections.serve(req, res) });
  const connections = new HubConnections({ home: opts.home, here, harnesses, runners: { claudeCode: deps.harness ?? claudeCode, codex: deps.codexHarness ?? codexHarness(deps.codexFactory), pi: piHarness(deps.piFactory) },
    send: transport.broadcast, origin: `http://${['0.0.0.0', '::', ''].includes(opts.host) ? '127.0.0.1' : opts.host.includes(':') ? `[${opts.host}]` : opts.host}:${transport.port}`,
    resourceCommand: deps.resourceCommand, claudeModelSource: deps.claudeModels ?? (deps.harness ? undefined : sdkClaudeModels), deliveryHosting: deps.deliveryHosting, updates, github: deps.github });
  host?.onSleep((asleep) => connections.setAsleep(asleep));
  let local: Awaited<ReturnType<typeof startHubService>> | undefined;
  try {
    const shouldStartLocal = !await connections.load() || connections.saved.some((s) => s.managed);
    if (shouldStartLocal) {
      local = await startHubService({ home: opts.home, host: '127.0.0.1', port: opts.hubPort, mcpFetch: deps.mcpFetch, ...(version ? { version } : {}) });
      const saved = connections.saved.find((s) => s.managed);
      if (saved) { if (saved.id !== local.trust.id) throw new Error('The managed local hub identity has changed. Restore its state before reconnecting.'); saved.url = local.url; }
      else {
        const code = await local.createPairingCode();
        const paired = await fetch(local.url + '/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.code, machineId: here.id }) }).then((r) => r.json()) as any;
        if (typeof paired.token !== 'string') throw new Error('Could not pair this machine with its local hub');
        await connections.add({ id: local.trust.id, name: 'Local dev', url: local.url, token: paired.token, local: true, managed: true, home: opts.home });
      }
    }
    for (const saved of connections.saved) { if (!connections.workspaces.has(saved.id)) await connections.open(saved); opened(); }
    opened();
    const first = connections.workspaces.get(connections.defaultId!)!;
    let closing: Promise<void> | undefined;
    return { ...transport, router: first?.router ?? connections.global, profiles: first?.profiles, projects: first?.projects, threads: first?.threads, machines: first?.machines, tools: first?.tools, resources: first?.resources,
      settings: local?.settings!, secrets: first?.secrets, hubUrl: first?.client.url ?? '', connections,
      close: () => { connections.stopAccepting(); return closing ??= (async () => { await transport.close(); await connections.close(); await local?.close(); })(); } };
  } catch (error) { failed(error); await transport.close().catch(() => {}); await connections.close().catch(() => {}); await local?.close().catch(() => {}); throw error; }
}
