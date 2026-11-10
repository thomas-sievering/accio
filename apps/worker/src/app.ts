import { startTransport } from './rpc/transport.js';
import { loadMachineId, machineInfo } from './machine/machine.js';
import { SharedSettings, startHubService, type Fetch } from '@accio/hub';
import { moveProfilesToHub } from './store/moveProfilesToHub.js';
import { renameAccountsToProfiles } from './store/renameAccountsToProfiles.js';
import type { Harness } from './threads/harness.js';
import { claudeCode, claudeCodeInstall } from './threads/claudeCode.js';
import { codexHarness } from './threads/codex.js';
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
export type AppDeps = { resourceCommand: CommandRunner; mcpFetch: Fetch; harness: Harness; claudeModels: ClaudeModelSource; codexHarness: Harness; codexFactory: CodexFactory; deliveryHosting: DeliveryHosting; github: GhRunner; updates: Partial<Omit<UpdateDeps, 'machineId'>> };

/** The local machine hosts clients and work; all hubs use the standalone service protocol. */
export async function startApp(opts: AppOptions, deps: Partial<AppDeps> = {}) {
  let send: (event: any, data: any, hubId?: string) => void = () => {};
  await renameAccountsToProfiles(opts.home);
  // GLOSSARY: Update. Tests pass their own checkout; nothing else looks for one.
  const root = deps.updates ? deps.updates.root : await appCheckout();
  // The version this Accio started on, here and for its local hub.
  const version = root ? await checkoutVersion(root) : undefined;
  const here = { ...machineInfo(await loadMachineId(opts.home)), ...(version ? { version } : {}) };
  const codex = await codexInstall();
  const harnesses = [await claudeCodeInstall(), ...(codex.version ? [codex] : [])];
  const updates = new Updates({ machineId: here.id, run: runCommand, pnpm: pnpmHere(), host: desktopHost(), ...(deps.updates ?? { root }) });
  const connections = new HubConnections(opts.home, here, harnesses, { claudeCode: deps.harness ?? claudeCode, codex: deps.codexHarness ?? codexHarness(deps.codexFactory) }, (...args) => send(...args), deps.resourceCommand, deps.claudeModels ?? (deps.harness ? undefined : sdkClaudeModels), deps.deliveryHosting, updates, deps.github);
  await connections.load();
  const shouldStartLocal = !connections.initialized || connections.saved.some((s) => s.managed);
  let local: Awaited<ReturnType<typeof startHubService>> | undefined;
  try {
    if (shouldStartLocal) {
      const settings = new SharedSettings(opts.home);
      await moveProfilesToHub(opts.home, here, settings); await settings.close();
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
    for (const saved of connections.saved) if (!connections.workspaces.has(saved.id)) await connections.open(saved);
    connections.global.on('machine.get', () => here);
    const transport = await startTransport({ ...opts, router: connections.router(null), routerFor: (id) => connections.router(id), serveHttp: (req, res) => connections.asset(req, res) });
    send = transport.broadcast;
    connections.listen(`http://${['0.0.0.0', '::', ''].includes(opts.host) ? '127.0.0.1' : opts.host.includes(':') ? `[${opts.host}]` : opts.host}:${transport.port}`);
    const first = connections.workspaces.get(connections.defaultId!)!;
    let closing: Promise<void> | undefined;
    return { ...transport, router: first?.router ?? connections.global, profiles: first?.profiles, projects: first?.projects, threads: first?.threads, machines: first?.machines, tools: first?.tools, resources: first?.resources,
      settings: local?.settings!, secrets: first?.secrets, hubUrl: first?.client.url ?? '', connections,
      close: () => { connections.stopAccepting(); return closing ??= (async () => { await transport.close(); await connections.close(); await local?.close(); })(); } };
  } catch (error) { await connections.close().catch(() => {}); await local?.close().catch(() => {}); throw error; }
}
