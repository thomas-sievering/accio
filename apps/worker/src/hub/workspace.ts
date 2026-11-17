import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HubClient, remoteSettings, remoteResources, remoteMcp, remoteSecrets, type SecretsAccess, type HubSnapshot, type HarnessInstall } from '@accio/hub';
import { projectKey, type Events, type MachineInfo } from '@accio/protocol';
import { Router, UserError, type Broadcast } from '../rpc/router.js';
import { Profiles } from '../profiles/profiles.js';
import { Machines } from '../machine/machine.js';
import { Models } from '../harnesses/models.js';
import { registerHarnesses } from '../harnesses/harnesses.js';
import { finishGoalTool } from '../goals/goal.js';
import { deliveryStepTool } from '../threads/deliveryStep.js';
import { shippedNoteTool } from '../threads/shippedNote.js';
import { readThreadTool } from '../threads/handoff.js';
import { readMentionedThread } from '../threads/threadMentions.js';
import { startThreadTool } from '../threads/startThread.js';
import { Projects } from '../projects/projects.js';
import { Spaces, refused } from '../spaces/spaces.js';
import { NewHomes } from '../spaces/newHome.js';
import { SpaceContext } from '../spaces/spaceContext.js';
import { SiblingThreads } from '../spaces/siblingThreads.js';
import { MissingCheckouts } from '../spaces/missingCheckouts.js';
import { registerProjectChangelog } from '../projects/projectChangelog.js';
import { Threads } from '../threads/threads.js';
import type { Harness } from '../threads/harness.js';
import { AccioTools } from '../tools/tools.js';
import { offerChoice } from '../threads/choice.js';
import { ResourceManager } from '../resources/resources.js';
import { addCliTool } from '../resources/addCli.js';
import type { CommandRunner } from '../resources/process.js';
import type { DeliveryHosting } from '../threads/delivery.js';
import { GitHubAccounts, type GhRunner } from '../github/accounts.js';
import { ClaudeModels } from '../harnesses/claudeModels.js';
import type { ClaudeModelSource } from '../harnesses/catalog.js';
import { harnessEnv } from '../threads/harnessEnv.js';
import { configFolderOf } from '../profiles/claudeConfigFolder.js';
import { Relay } from '../relay/relay.js';
import type { Updates } from '../machine/update.js';
import { findMachine, machineTools } from '../machine/machineTools.js';
import { imageTool } from '../images/imageTool.js';
import { requestSecretTool } from '../secrets/secrets.js';

/**
 * The snapshot saved with a hub connection, for use until the hub answers. One
 * this build can't read, such as from before profiles named their accounts by
 * id (#232), is dropped: the hub sends a current one on connect.
 */
export function cachedSnapshot(snapshot: HubSnapshot | undefined): HubSnapshot | undefined {
  const readable = Array.isArray(snapshot?.accounts) && Array.isArray(snapshot?.profiles)
    && snapshot.profiles.every((p) => Array.isArray(p?.providers) && p.providers.every((provider) => Array.isArray(provider?.accountIds)));
  return readable ? snapshot : undefined;
}

export type SavedHub = { id: string; name: string; url: string; token: string; home: string; local: boolean; managed?: boolean; snapshot?: HubSnapshot };
export type HubWorkspace = { client: HubClient; router: Router; relay: Relay; profiles: Profiles; machines: Machines; models: Models; projects: Projects; spaces: Spaces; threads: Threads; tools: AccioTools; resources: ResourceManager; secrets: SecretsAccess; home: string;
  /** Answers this hub's accio tools and thread media; resolves false for any other request. */
  serve(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  close(): Promise<void> };

/** What every hub workspace on this machine shares. */
export type WorkspaceDeps = {
  /** This machine's Accio home. */
  home: string;
  here: MachineInfo;
  harnesses: HarnessInstall[];
  runners: Record<string, Harness>;
  /** To this machine's clients of one hub, or of every hub without one. */
  send: (event: any, data: any, hubId?: string) => void;
  /** Where this machine's transport listens. */
  origin: string;
  resourceCommand?: CommandRunner;
  claudeModelSource?: ClaudeModelSource;
  deliveryHosting?: DeliveryHosting;
  updates?: Updates;
  github?: GhRunner;
};

/** What one workspace needs from the connections holding it. */
export type WorkspaceSlot = {
  /** Answers calls this hub's router doesn't, such as `hubs.list`. */
  global: Router;
  /** Where this hub's accio tools are served: the default hub's at the origin, others under `/hubs/<id>`. */
  toolsOrigin: string;
  asleep: () => boolean;
  closing: () => boolean;
  /** The hub's status, running count or snapshot may have changed. */
  changed: () => void;
};

/**
 * One hub's workspace on this machine, built in the order its parts depend on each other.
 * Cycles, such as threads and the accio tools that act on them or the relay that lists them,
 * are closures that only run once the workspace is open: nothing in here is set after construction.
 */
export async function openWorkspace(record: SavedHub, deps: WorkspaceDeps, slot: WorkspaceSlot): Promise<HubWorkspace> {
  const { here } = deps;
  const client = new HubClient(record.url, record.id, record.token, { ...here, harnesses: deps.harnesses });
  const cached = cachedSnapshot(record.snapshot);
  if (cached) client.snapshot = cached;
  client.setAsleep(slot.asleep());
  await client.start();
  const settings = remoteSettings(client);
  const secrets = remoteSecrets(client);
  const router = new Router(slot.global);
  const send = (event: string, data: unknown) => deps.send(event, data, record.id);
  // From here until the relay is built nothing awaits, so no event reaches `broadcast` before it exists.
  const broadcast: Broadcast = (event, data) => {
    if (event === 'threads.changed') { relay.localChanged(); threads.threadsChanged(); send(event, relay.merged(data as Events['threads.changed'])); }
    else {
      if (event === 'thread.item' || event === 'thread.delta') relay.transcriptEvent(event, data as Events['thread.item']);
      if (event === 'projects.changed') { relay.localChanged(); relay.announce(); }
      send(event, event === 'machines.changed' ? relay.machines(data as Events['machines.changed']) : data);
    }
    if (event === 'projects.changed' || event === 'threads.changed') { void profiles.syncReferences().catch(() => {}); slot.changed(); }
  };
  const profiles = new Profiles(record.home, client, broadcast, () => [...projects.state().projects.map((p) => p.profileId), ...threads.profileReferences()]);
  const machines = new Machines(here, settings, broadcast,
    deps.github && new GitHubAccounts((profileId) => settings.profiles().find((p) => p.id === profileId)?.githubLogin, deps.github));
  const claudeModels = new ClaudeModels(deps.claudeModelSource,
    async (profileId) => harnessEnv(process.env, await profiles.hubAccess(profileId, 'anthropic'), configFolderOf(record.home, profileId)),
    () => broadcast('models.changed', null));
  const models = new Models(profiles, settings, here.id, claudeModels);
  // GLOSSARY: Shared settings. The hub keeps each project with a remote and its profile, for every machine.
  const projects = new Projects(record.home, profiles, machines, broadcast, {
    list: () => settings.projects(),
    register: (list) => settings.registerProjects(list),
    setProfile: (project) => refused(() => settings.setProjectProfile(project)),
    forget: (repoKey) => settings.forgetProject(repoKey),
    onChanged: (listener) => { settings.onMachinesChanged(listener); },
    checkoutElsewhere: (repoKey) => relay.checkoutElsewhere(repoKey),
  });
  const spaces = new Spaces(settings, broadcast);

  const tools = new AccioTools([offerChoice, finishGoalTool((id, outcome, summary) => threads.finishGoal(id, outcome, summary), (id) => threads.goalActive(id)),
    deliveryStepTool((id, step, note) => threads.reportDeliveryStep(id, step, note), (id) => threads.deliveryRunning(id)),
    shippedNoteTool((id, note) => threads.recordShippedNote(id, note), (id) => threads.deliveryRunning(id)),
    readThreadTool((id, handle, offset, limit) => handle
      ? readMentionedThread({ threads: () => relay.merged(), transcript: (threadId) => router.call('threads.transcript', { threadId }) }, id, handle, offset, limit)
      : threads.readThread(id, offset, limit)),
    imageTool({
      thread: (id) => threads.toolContext(id),
      canMakeImages: (profileId) => {
        const profile = profiles.get(profileId) && profiles.profileView(profileId);
        return !!profile?.house && profiles.providerAccounts(profileId, 'openai').some((a) => a.signedIn);
      },
      access: (profileId) => profiles.hubAccess(profileId, 'openai'),
      folder: join(record.home, 'images'),
    }),
    requestSecretTool], slot.toolsOrigin);
  const { updates } = deps;
  if (updates) tools.add(...machineTools({ here: here.id, machines: () => settings.machines(), folder: join(deps.home, 'screenshots'), call: (method, params) => router.call(method, params) }));
  // GLOSSARY: Space. Checkouts of the space's projects, cloned here when missing, for the Space section and start_thread.
  const spaceCheckouts = new MissingCheckouts({ projects: () => projects.state(), clone: (repoKey, url, profileId) => projects.clone(repoKey, url, profileId), source: (repoKey) => relay.cloneSource(repoKey), profileOf: (repoKey) => projects.profileOf(repoKey) });
  const siblings = new SiblingThreads({ spaces: () => spaces.list(), projects: () => projects.state(), projectsOn: (machineId) => relay.projectsOn(machineId), checkoutHere: (key) => spaceCheckouts.checkout(key) });
  tools.add(startThreadTool({
    here: here.id,
    caller: (id) => threads.views().find((t) => t.id === id),
    models: (profileId) => models.list(profileId).models,
    machine: (name) => { if (!name) return undefined; const found = findMachine(settings.machines(), name); return found.id === here.id ? undefined : found; },
    sibling: (projectId, project, machine) => siblings.target(projectId, project, machine),
    start: (params) => router.call('threads.start', params),
  }));
  const resources = new ResourceManager(record.home, here.id, remoteResources(client), remoteMcp(client), profiles, projects, broadcast, async (tool, detail) => {
    const candidates = tool.repairProfileId ? [profiles.require(tool.repairProfileId)] : profiles.all();
    const profile = candidates.find(p => models.list(p.id).models.length > 0);
    if (!profile) throw new Error('Sign in to a provider and select its account in a profile to start a repair thread.');
    const folder = resources.tools.folder(tool);
    return (await threads.start({ profileId: profile.id, machineId: here.id, text: `Repair ${tool.name} on this machine\n\nDiagnose the failure, fix the installation, test it and verify the result. Work on this machine only.\nPackage: ${tool.package}@${tool.version}\nExecutable: ${tool.executable}\nManaged installation folder: ${folder}\nInstall with pnpm add --dir <that folder> --ignore-workspace --config.dangerously-allow-all-builds=true ${tool.package}@${tool.version}. Keep the installation inside that folder.\nHealth check arguments: ${JSON.stringify(tool.checkArgs)}\nFailure:\n${detail}\n\nAccio will rerun the health check after this thread completes. Report what you changed and the commands and results that prove it works.` }, { repairToolId: tool.id })).id;
  }, {
    spaces: () => spaces.list(),
    // GLOSSARY: Home. Its skill files are the Space level; a missing home is cloned like the Space section's.
    homeCheckout: async (key, wait) => { const found = wait ? await spaceCheckouts.checkout(key) : await spaceCheckouts.lookup(key); return 'checkout' in found ? found.checkout.path : undefined; },
  }, deps.resourceCommand);
  const threads = new Threads(record.home, profiles, projects, deps.runners, broadcast, models, machines, secrets, {
    knownThreads: () => relay.merged(), tools, deliveryHosting: deps.deliveryHosting, resources,
    spaceContext: new SpaceContext({ spaces: () => spaces.list(), projects: () => projects.state(), checkouts: spaceCheckouts }),
    toolOverrides: () => settings.harnessTools(), onRepairFinished: (id) => resources.tools.afterRepair(id),
    checkoutOf: async (repoKey) => {
      const found = await spaceCheckouts.checkout(repoKey, { retry: true });
      if ('unavailable' in found) throw new UserError(`${repoKey} can't be cloned on this machine: ${found.unavailable}.`);
      return found.checkout;
    },
  });
  // GLOSSARY: Project. Its threads on other machines also keep it in its profile.
  projects.onCheckProjectInUse((projectId) => {
    const n = relay.merged([]).filter((t) => t.projectId === projectId).length;
    return n ? `${n} thread${n > 1 ? 's' : ''} on other machines` : undefined;
  });
  tools.add(addCliTool({
    caller: (id) => threads.views().find((t) => t.id === id),
    levelContext: (profileId, projectId) => resources.levelContext(profileId, projectId),
    names: (at) => ({ profile: profiles.all().find((p) => p.id === at.profileId)?.name, space: spaces.list().find((s) => s.id === at.spaceId)?.name,
      project: projects.state().projects.find((p) => at.projectKey && projectKey(p) === at.projectKey)?.name }),
    tools: () => resources.state().tools,
    save: async (tool) => (await resources.saveTool(tool)).check,
    bin: (tool) => resources.tools.bin(tool),
    confirm: async (threadId, request, signal) => {
      const turnId = threads.runningTurn(threadId);
      if (!turnId) return 'cancelled';
      return threads.confirmations.ask(threadId, turnId, request, signal);
    },
  }));
  // GLOSSARY: Relay. The only answer for the thread and machine lists: other machines' threads join
  // this machine's, and calls about them go to their machine.
  const relay = new Relay(record.home, {
    here: here.id,
    threads: () => threads.views(),
    projects: () => projects.state(),
    machines: () => machines.views(),
    router,
    assets: threads.assets,
    machineName: (id) => settings.machine(id)?.name,
    offlineSnoozes: () => settings.offlineSnoozes(),
    setOfflineSnooze: (threadId, snooze) => settings.setOfflineSnooze(threadId, snooze),
    send: (event, data) => { if (event === 'threads.changed') threads.threadsChanged(); send(event, data); },
    profileOf: (repoKey) => projects.profileOf(repoKey),
  });
  // GLOSSARY: Home. "New home…" in Settings → Spaces; a user action, not an accio tool.
  const newHomes = new NewHomes({
    spaces: () => spaces.list(),
    saveSpace: (space) => refused(() => settings.saveSpace(space)),
    projects: () => projects.state(),
    addFolder: (path, profileId) => projects.addFolder(path, profileId),
    requireProfile: (profileId) => { profiles.require(profileId); },
    profileFolder: (profileId) => machines.profileFoldersHere().find((p) => p.id === profileId)?.folders[0],
    requireThreadsStart: async (profileId) => { await models.ready(profileId); models.require(profileId); },
    removeCheckout: async (id) => { await router.call('checkouts.remove', { id }); },
    githubLogin: (profileId) => machines.github.chosenLogin(profileId),
    gh: (profileId, cwd, args) => machines.github.run(profileId, cwd, args),
    start: (params) => threads.start(params),
  });

  profiles.register(router); machines.register(router); models.register(router, broadcast);
  projects.register(router); registerProjectChangelog(router, projects); spaces.register(router);
  registerHarnesses(router, settings, models, deps.runners, tools);
  if (updates) {
    router.on('update.status', () => updates.status())
      .on('update.start', () => updates.start())
      .on('app.screenshot', async ({ script }) => {
        const { png, note } = await updates.screenshot(script);
        return { png: png.toString('base64'), ...(note ? { note } : {}) };
      });
  }
  threads.register(router); newHomes.register(router); resources.register(router);
  router.on('threads.list', () => relay.merged());
  // A gh sign-in made since startup shows up in machine settings without a restart.
  router.on('machines.list', async () => { await machines.refresh(); await machines.reportGitHub().catch(() => {}); return relay.machines(); });
  router.forward = (method, params) => relay.forward(method, params);

  // A snooze set from another machine, or dropped by the hub, changes how these threads look.
  settings.onMachinesChanged(() => relay.announce());
  const stopUpdates = updates?.onChange((view) => { relay.emit('update.changed', view); send('update.changed', view); });
  let reconciliation: Promise<unknown> = Promise.resolve();
  const close = async () => { stopUpdates?.(); await relay.close(); await threads.close(); await secrets.close(); await resources.close(); await reconciliation; await profiles.close(); await projects.close(); await client.close(); };
  try {
    await projects.load();
    await threads.load();
    await relay.load();
    if (client.status === 'connected') { await profiles.load(); await profiles.syncReferences(); }
  } catch (error) { await close().catch(() => {}); throw error; }

  const continueAfterRestart = () => {
    if (!slot.closing()) void threads.continueAfterRestart().catch(error => console.error('[threads] startup recovery failed', error));
  };
  client.onChanged(() => { slot.changed(); broadcast('resources.changed', resources.state()); if (client.status === 'connected') resources.syncTools(); relay.announce(); continueAfterRestart(); });
  void machines.reportGitHub().catch(() => {});
  // The system may have slept or woken while the workspace opened.
  client.setAsleep(slot.asleep()); relay.setAsleep(slot.asleep());
  relay.start(record.url, record.token);
  if (client.status === 'connected') reconciliation = resources.reconcile().catch(error => console.error('[resources] startup check failed', error));
  continueAfterRestart();
  return { client, router, relay, profiles, machines, models, projects, spaces, threads, tools, resources, secrets, home: record.home,
    serve: async (req, res) => await tools.handle(req, res) || threads.assets.handle(req, res), close };
}
