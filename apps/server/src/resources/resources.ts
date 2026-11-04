import { SECRET_MCP_SERVER } from '../secrets/secrets.js';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import type { McpDefinition, ResourcesState, ToolDefinition, WorkspaceSkill, SkillEntry } from '@accio/protocol';
import { enabled, type McpAccess, type ResourceAccess } from '@accio/hub';
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

export class ResourceManager {
  readonly skills: SkillFiles;
  readonly tools: ManagedTools;
  private sourceJobs = new Map<string, Promise<unknown>>();
  private sourceOperations = new Set<Promise<unknown>>();
  private closing = false;
  private localSources = new Map<string, Promise<SkillEntry[]>>();
  constructor(private home: string, private machineId: string, private store: ResourceAccess, private gateway: McpAccess,
    private profiles: Profiles, private projects: Projects, private broadcast: Broadcast,
    repair: (tool: ToolDefinition, detail: string) => Promise<string>, run?: CommandRunner) {
    this.skills = new SkillFiles(home, run);
    this.tools = new ManagedTools(home, machineId, store, () => this.announce(), repair, run);
  }
  state(): ResourcesState { return this.store.state(); }
  async workspaceSkills(profileId?: string, projectId?: string, cwd?: string): Promise<WorkspaceSkill[]> {
    const state = this.state();
    const project = this.projects.state().projects.find(p => p.id === projectId);
    const key = project ? project.repoKey ?? `local:${project.id}` : undefined;
    const library: WorkspaceSkill[] = await Promise.all(state.skills.map(async skill => {
      const enabledBy = skill.scope.global ? 'global' : profileId && skill.scope.profileIds.includes(profileId) ? 'profile' : key && skill.scope.projectKeys.includes(key) ? 'project' : null;
      const local = enabledBy ? await this.localSkill(skill) : skill;
      return { id: skill.id, name: skill.name, description: skill.description, path: join(local.path, 'SKILL.md'), origin: 'library' as const, enabled: enabledBy !== null, enabledBy, sourceName: state.sources.find(source => source.id === skill.sourceId)?.name, revision: skill.revision };
    }));
    const skills = [...(cwd ? await repositorySkills(cwd) : []), ...library];
    for (const skill of skills) {
      if (skill.enabled && skills.some(other => other.id !== skill.id && other.enabled && other.name === skill.name)) skill.conflict = `More than one enabled skill is named ${skill.name}. Choose one source before the next turn.`;
    }
    return skills;
  }
  async skillContent(id: string) {
    const skill = this.state().skills.find(skill => skill.id === id);
    if (!skill) throw new Error('No such library skill');
    const local = await this.localSkill(skill);
    return readSkillFile(join(local.path, 'SKILL.md'));
  }
  async setProjectSkill(id: string, projectId: string, on: boolean) {
    const project = this.projects.state().projects.find(project => project.id === projectId);
    if (!project) throw new Error('No such project');
    const skill = this.state().skills.find(skill => skill.id === id);
    if (!skill) throw new Error('Only library skills can be enabled or disabled');
    const key = project.repoKey ?? `local:${project.id}`;
    await this.store.setSkillProject(id, { projectKey: key, enabled: on });
    this.announce();
  }
  skillsChanged() { this.announce(); }
  private announce() { this.broadcast('resources.changed', this.state()); }
  private tool(id: string) { const tool = this.state().tools.find(t => t.id === id); if (!tool) throw new Error('No such tool'); return tool; }
  private local(machineId?: string) { if (machineId && machineId !== this.machineId) throw new Error('This machine must be online locally; remote execution is not available yet'); }
  private checkScope(scope: { profileIds: string[]; projectKeys: string[] }) {
    for (const id of scope.profileIds) this.profiles.require(id);
    const keys = new Set(this.projects.state().projects.map(p => p.repoKey ?? `local:${p.id}`));
    if (scope.projectKeys.some(key => !keys.has(key))) throw new Error('No such project');
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
      .on('skills.updateSource', ({ id }) => this.sourceOperation(id, async () => {
        const source = this.state().sources.find(s => s.id === id); if (!source) throw new Error('No such skill source');
        const skills = await this.skills.fetch(source); await this.store.saveSource(source, skills); this.announce(); return this.state().skills.filter(s => s.sourceId === id);
      }))
      .on('skills.previewUpdate', ({ id }) => this.sourceOperation(id, async () => {
        const source = this.state().sources.find(s => s.id === id); if (!source) throw new Error('No such skill source');
        const skills = await this.skills.fetch(source); await this.store.stageSkills(id, skills); this.announce(); return skills;
      }))
      .on('skills.applyUpdate', ({ id, revision }) => this.sourceOperation(id, async () => {
        await this.store.applySkills(id, revision); this.announce(); return this.state().skills.filter(s => s.sourceId === id);
      }))
      .on('skills.deleteSource', ({ id }) => this.sourceOperation(id, async () => { await this.store.deleteSource(id); this.announce(); return null; }))
      .on('skills.setScope', async ({ id, scope }) => { this.checkScope(scope); await this.store.setSkillScope(id, scope); this.announce(); return this.state().skills.find(s => s.id === id)!; })
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
  async prepare(profileId: string, projectId: string, env: Record<string, string>, options: { repair?: boolean; cwd?: string } = {}): Promise<TurnResources> {
    const project = this.projects.state().projects.find(p => p.id === projectId);
    const key = project ? project.repoKey ?? `local:${project.id}` : undefined;
    const state = this.state();
    const tools = state.tools;
    if (options.repair) return { env: this.tools.env(state.tools, env), instructions: '', mcps: {}, snapshot: { tools: [], skills: [], mcps: [] }, release: () => {} };
    if (!options.repair) for (const tool of tools) {
      const status = await this.tools.check(tool);
      if (status.status !== 'ready') throw new Error(`${tool.name} is not ready. ${status.repairThreadId ? 'A repair thread was started.' : status.repairError ?? status.detail}`);
    }
    const skills = await Promise.all(state.skills.filter(s => enabled(s.scope, profileId, key)).map(skill => this.localSkill(skill)));
    const names = new Set<string>();
    for (const skill of skills) {
      if (names.has(skill.name)) throw new Error(`More than one enabled skill is named ${skill.name}; select one source`);
      names.add(skill.name); await this.skills.validate(skill);
      if (options.cwd && /^[a-zA-Z0-9_-]+$/.test(skill.name)) for (const folder of ['.agents', '.claude']) {
        if (await access(join(options.cwd, folder, 'skills', skill.name, 'SKILL.md')).then(() => true, () => false)) throw new Error(`This project already has a skill named ${skill.name}. Choose either the project copy or the synced skill in settings.`);
      }
    }
    const repository = options.cwd ? await repositorySkills(options.cwd) : [];
    const catalog: WorkspaceSkill[] = [...repository, ...skills.map(s => ({ id: s.id, name: s.name, description: s.description, path: join(s.path, 'SKILL.md'), revision: s.revision, origin: 'library' as const, enabled: true, enabledBy: 'project' as const }))];
    const catalogNames = new Set<string>();
    for (const skill of catalog) {
      if (catalogNames.has(skill.name)) throw new Error(`More than one enabled skill is named ${skill.name}; choose one source`);
      catalogNames.add(skill.name);
    }
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
