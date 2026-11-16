import { SECRET_MCP_SERVER } from '../secrets/secrets.js';
import { join } from 'node:path';
import { projectKey, type McpDefinition, type ProjectView, type ResourcesState, type SkillSpace, type Space, type ToolDefinition, type WorkspaceSkill, type SkillEntry } from '@accio/protocol';
import type { McpAccess, ResourceAccess } from '@accio/hub';
import type { Router, Broadcast } from '../rpc/router.js';
import type { Profiles } from '../profiles/profiles.js';
import type { Projects } from '../projects/projects.js';
import { SkillFiles } from './skills.js';
import { inside } from '../paths.js';
import { ManagedTools } from './tools.js';
import type { CommandRunner } from './process.js';
import type { HarnessMcp, TurnResources } from '../threads/harness.js';
import { ACCIO_MCP_SERVER } from '../tools/tools.js';
import { readSkillFile, repositorySkills } from './workspaceSkills.js';
import { enabledLevel, resolveLevels } from './skillLevels.js';
import { checkoutHere } from '../projects/project.js';
import { nameOfKey } from '../spaces/spaceContext.js';

/** GLOSSARY: Skill level. Every skill a thread here could get, and the space its project is in. */
export type LevelSkills = { skills: WorkspaceSkill[]; space?: SkillSpace };

export class ResourceManager {
  readonly skills: SkillFiles;
  readonly tools: ManagedTools;
  private sourceJobs = new Map<string, Promise<unknown>>();
  private sourceOperations = new Set<Promise<unknown>>();
  private closing = false;
  private localSources = new Map<string, Promise<SkillEntry[]>>();
  constructor(private home: string, private machineId: string, private store: ResourceAccess, private gateway: McpAccess,
    private profiles: Profiles, private projects: Projects, private spaces: () => readonly Space[], private broadcast: Broadcast,
    repair: (tool: ToolDefinition, detail: string) => Promise<string>, run?: CommandRunner) {
    this.skills = new SkillFiles(home, run);
    this.tools = new ManagedTools(home, machineId, store, () => this.announce(), repair, run);
  }
  state(): ResourcesState { return this.store.state(); }
  /**
   * GLOSSARY: Skill level. Every skill a thread here could get: the repository's (Project), its space's
   * home's (Space), then each library skill at the narrowest level that turns it on, resolved by ADR 0020.
   */
  async workspaceSkills(profileId?: string, projectId?: string, cwd?: string): Promise<LevelSkills> {
    return this.levelSkills(this.state(), profileId, projectId, cwd);
  }
  /** One state for the whole resolution. Only skills a thread gets need their files here, so a wider source that is overridden can't block a turn. */
  private async levelSkills(state: ResourcesState, profileId?: string, projectId?: string, cwd?: string): Promise<LevelSkills> {
    const project = this.projects.state().projects.find(p => p.id === projectId);
    const { space, files } = await this.spaceSkills(project);
    const context = { profileId, projectKey: project ? projectKey(project) : undefined, spaceId: space?.id };
    const library: WorkspaceSkill[] = state.skills.map(skill => {
      const enabledBy = enabledLevel(skill.scope, context);
      return { id: skill.id, name: skill.name, description: skill.description, path: join(skill.path, 'SKILL.md'), origin: 'library' as const, enabled: enabledBy !== null, enabledBy, sourceName: state.sources.find(source => source.id === skill.sourceId)?.name, revision: skill.revision };
    });
    const skills = resolveLevels([...(cwd ? await repositorySkills(cwd) : []), ...files, ...library]);
    const entries = new Map(state.skills.map(entry => [entry.id, entry]));
    await Promise.all(skills.map(async skill => {
      const entry = skill.origin === 'library' && skill.enabled && !skill.overriddenBy ? entries.get(skill.id) : undefined;
      if (entry) skill.path = join((await this.localSkill(entry)).path, 'SKILL.md');
    }));
    return { skills, space };
  }
  /**
   * GLOSSARY: Space, Home. The space the project is in, and its home's skill files from the home's checkout
   * on this machine. A thread in the home already has them as its own Project skills, so they aren't repeated.
   */
  private async spaceSkills(project?: ProjectView): Promise<{ space?: SkillSpace; files: WorkspaceSkill[] }> {
    const key = project && projectKey(project);
    const space = key ? this.spaces().find(s => s.projectKeys.includes(key)) : undefined;
    if (!space) return { files: [] };
    const found = { id: space.id, name: space.name };
    const homeKey = space.homeProjectKey;
    if (!homeKey || homeKey === key) return { space: found, files: [] };
    const projects = this.projects.state();
    const home = projects.projects.find(p => projectKey(p) === homeKey);
    const checkout = await checkoutHere(projects, home);
    if (!checkout) return { space: { ...found, homeUnavailable: `${home?.name ?? nameOfKey(homeKey)}, the space’s home, isn’t on this machine, so its skill files are missing.` }, files: [] };
    const files = (await repositorySkills(checkout.path)).map(skill => ({ ...skill, id: skill.id.replace(/^repository:/, 'home:'), origin: 'home' as const, enabledBy: 'space' as const }));
    return { space: found, files };
  }
  async skillContent(id: string) {
    const skill = this.state().skills.find(skill => skill.id === id);
    if (!skill) throw new Error('No such library skill');
    const local = await this.localSkill(skill);
    return readSkillFile(join(local.path, 'SKILL.md'));
  }
  /** Turns a library skill on or off for a project, or for the space that project is in. */
  async setLevelSkill(id: string, projectId: string, level: 'project' | 'space', on: boolean) {
    const project = this.projects.state().projects.find(project => project.id === projectId);
    if (!project) throw new Error('No such project');
    const skill = this.state().skills.find(skill => skill.id === id);
    if (!skill) throw new Error('Only library skills can be enabled or disabled');
    const key = projectKey(project);
    if (level === 'space') {
      const space = this.spaces().find(s => s.projectKeys.includes(key));
      if (!space) throw new Error('This project is in no space');
      await this.store.setSkillSpace(id, { spaceId: space.id, enabled: on });
    } else await this.store.setSkillProject(id, { projectKey: key, enabled: on });
    this.announce();
  }
  skillsChanged() { this.announce(); }
  private announce() { this.broadcast('resources.changed', this.state()); }
  private tool(id: string) { const tool = this.state().tools.find(t => t.id === id); if (!tool) throw new Error('No such tool'); return tool; }
  private local(machineId?: string) { if (machineId && machineId !== this.machineId) throw new Error('This machine must be online locally; remote execution is not available yet'); }
  /** A space deleted since it was selected stays in the scope, unused; only newly selected spaces must exist. */
  private checkScope(scope: { profileIds: string[]; projectKeys: string[]; spaceIds: string[] }, before: string[] = []) {
    for (const id of scope.profileIds) this.profiles.require(id);
    const keys = new Set(this.projects.state().projects.map(projectKey));
    if (scope.projectKeys.some(key => !keys.has(key))) throw new Error('No such project');
    const spaces = new Set(this.spaces().map(space => space.id));
    if (scope.spaceIds.some(id => !spaces.has(id) && !before.includes(id))) throw new Error('No such space');
  }
  register(router: Router) {
    router.on('resources.get', () => this.state())
      .on('tools.save', async tool => {
        if (tool.repairProfileId) this.profiles.require(tool.repairProfileId);
        await this.store.saveTool(tool); this.announce();
        void this.tools.check(tool).catch(console.error);
        return tool;
      })
      .on('tools.delete', async ({ id }) => { await this.store.deleteTool(id); this.announce(); return null; })
      .on('tools.check', ({ id, machineId }) => { this.local(machineId); return this.tools.check(this.tool(id)); })
      .on('tools.repair', ({ id, machineId }) => { this.local(machineId); return this.tools.requestRepair(this.tool(id)); })
      .on('skills.addSource', source => this.sourceOperation(source.id, async () => {
        const skills = await this.skills.fetch(source); await this.store.saveSource(source, skills); this.announce(); return source;
      }))
      .on('skills.previewUpdate', ({ id }) => this.sourceOperation(id, async () => {
        const source = this.state().sources.find(s => s.id === id); if (!source) throw new Error('No such skill source');
        const skills = await this.skills.fetch(source); await this.store.stageSkills(id, skills); this.announce(); return skills;
      }))
      .on('skills.applyUpdate', ({ id, revision }) => this.sourceOperation(id, async () => {
        await this.store.applySkills(id, revision); this.announce(); return this.state().skills.filter(s => s.sourceId === id);
      }))
      .on('skills.deleteSource', ({ id }) => this.sourceOperation(id, async () => { await this.store.deleteSource(id); this.announce(); return null; }))
      .on('skills.setScope', async ({ id, scope }) => { this.checkScope(scope, this.state().skills.find(s => s.id === id)?.scope.spaceIds); await this.store.setSkillScope(id, scope); this.announce(); return this.state().skills.find(s => s.id === id)!; })
      .on('skills.copy', async ({ id, checkoutId }) => { const skill = this.state().skills.find(s => s.id === id); if (!skill) throw new Error('No such skill'); const release = this.projects.useCheckout(checkoutId); try { return await this.skills.copy(await this.localSkill(skill), this.projects.checkout(checkoutId).path); } finally { release(); } })
      .on('mcp.save', async mcp => { this.validateMcp(mcp); const old = this.state().mcps.find(m => m.id === mcp.id); if (old && (old.url !== mcp.url || old.auth !== mcp.auth || old.oauthClientId !== mcp.oauthClientId)) await this.gateway.signOut(mcp.id); await this.store.saveMcp(mcp); this.announce(); return this.state().mcps.find(m => m.id === mcp.id)!; })
      .on('mcp.delete', async ({ id }) => { await this.gateway.signOut(id); await this.store.deleteMcp(id); this.announce(); return null; })
      .on('mcp.setToken', async ({ id, token }) => { if (!this.state().mcps.some(m => m.id === id && m.auth === 'bearer')) throw new Error('Select a server with bearer authentication'); await this.store.setCredential(id, { accessToken: token }); this.announce(); return null; })
      .on('mcp.signOut', async ({ id }) => { await this.gateway.signOut(id); this.announce(); return null; })
      .on('mcp.beginSignIn', ({ id }) => this.gateway.beginSignIn(id))
      .on('mcp.completeSignIn', async ({ id, callbackUrl }) => { await this.gateway.completeSignIn(callbackUrl, id); this.announce(); return null; });
  }
  private sourceOperation<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('This machine is shutting down'));
    const pending = this.sourceJobs.get(id) ?? Promise.resolve();
    const job = pending.catch(() => {}).then(operation).finally(() => { if (this.sourceJobs.get(id) === job) this.sourceJobs.delete(id); });
    this.sourceJobs.set(id, job); this.sourceOperations.add(job); void job.finally(() => this.sourceOperations.delete(job)).catch(() => {}); return job;
  }
  private validateMcp(mcp: McpDefinition) {
    if ([ACCIO_MCP_SERVER, SECRET_MCP_SERVER].includes(mcp.id)) throw new Error('This MCP name is reserved for built-in tools; choose another name');
    if (mcp.transport === 'http') { if (!mcp.url || !['https:', 'http:'].includes(new URL(mcp.url).protocol)) throw new Error('Remote MCP servers need an HTTP or HTTPS URL'); }
    else { if (!mcp.command) throw new Error('Local MCP servers need a command'); if (mcp.auth !== 'none') throw new Error('Local MCP sign-in is managed by that server; use a remote MCP for hub-owned credentials'); }
  }
  async reconcile() {
    for (const tool of this.state().tools) await this.tools.check(tool);
  }
  private async localSkill(skill: SkillEntry): Promise<SkillEntry> {
    try { await this.skills.validate(skill); return skill; }
    catch (error) { if (inside(join(this.home, 'hub', 'skill-sources'), skill.path) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const source = this.state().sources.find(value => value.id === skill.sourceId);
    if (!source) throw new Error('No such skill source');
    const key = `${source.id}:${skill.revision}`;
    let pending = this.localSources.get(key);
    if (!pending) { pending = this.skills.fetch({ ...source, ref: skill.revision }); this.localSources.set(key, pending); void pending.catch(() => this.localSources.delete(key)); }
    const local = (await pending).find(value => value.id === skill.id && value.revision === skill.revision);
    if (!local) throw new Error('The pinned source revision does not contain this skill');
    await this.skills.validate(local); return { ...skill, path: local.path };
  }
  /** Check before allocating a new conversation so a blocked draft remains unsent. */
  async requireToolsReady() {
    for (const tool of this.state().tools) {
      const status = await this.tools.check(tool);
      if (status.status !== 'ready') throw new Error(`${tool.name} is not ready. ${status.repairThreadId ? 'A repair thread was started.' : status.repairError ?? status.detail}`);
    }
  }
  async prepare(profileId: string, projectId: string, env: Record<string, string>, options: { repair?: boolean; cwd?: string } = {}): Promise<TurnResources> {
    const project = this.projects.state().projects.find(p => p.id === projectId);
    const key = project ? projectKey(project) : undefined;
    const state = this.state();
    const tools = state.tools;
    if (options.repair) return { env: this.tools.env(state.tools, env), instructions: '', mcps: {}, snapshot: { tools: [], skills: [], mcps: [] }, release: () => {} };
    await this.requireToolsReady();
    // ADR 0020: the turn gets each name's winner; overridden skills stay out, a clash refuses the turn.
    const catalog = (await this.levelSkills(state, profileId, projectId, options.cwd)).skills.filter(skill => skill.enabled && !skill.overriddenBy);
    const clash = catalog.find(skill => skill.conflict);
    if (clash) throw new Error(clash.conflict);
    const skills = state.skills.filter(entry => catalog.some(skill => skill.origin === 'library' && skill.id === entry.id));
    for (const skill of skills) await this.skills.validate(await this.localSkill(skill));
    const instructions = catalog.length ? `Skills enabled for this turn:\n${catalog.map(s => `- ${s.name}: ${s.description}\n  Read ${s.path} when relevant.${'revision' in s ? ` Source revision: ${s.revision}` : ''}`).join('\n')}\nRead a skill's SKILL.md before using it. Resolve its relative references against its own folder.` : '';
    const releases: (() => void)[] = [];
    const mcps: Record<string, HarnessMcp> = {};
    for (const mcp of state.mcps) {
      if ([ACCIO_MCP_SERVER, SECRET_MCP_SERVER].includes(mcp.id)) throw new Error('Rename this managed MCP server: that name is reserved for built-in tools');
      if (mcp.transport === 'http') { const grant = await this.gateway.grant(mcp.id, profileId, key); releases.push(grant.release); mcps[mcp.id] = { type: 'http', url: grant.url, headers: { Authorization: `Bearer ${grant.token}` } }; }
      else mcps[mcp.id] = { type: 'stdio', command: mcp.command!, args: mcp.args };
    }
    return { env: this.tools.env(tools, env), instructions, mcps, skills: catalog, snapshot: { tools: tools.map(t => ({ id: t.id, version: t.version })), skills: skills.map(s => ({ id: s.id, revision: s.revision })), mcps: Object.keys(mcps) }, release: () => { releases.forEach(release => release()); } };
  }
  async close() { this.closing = true; await this.tools.close(); await Promise.allSettled([...this.sourceOperations]); }
}
