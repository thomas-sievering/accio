import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { enabled, type McpGateway, type Resources } from '@accio/hub';
import type { McpDefinition, ResourcesState, ToolDefinition } from '@accio/protocol';
import type { Router, Broadcast } from '../rpc/router.js';
import type { Profiles } from '../profiles/profiles.js';
import type { Projects } from '../projects/projects.js';
import { SkillFiles } from './skills.js';
import { ManagedTools } from './tools.js';
import type { CommandRunner } from './process.js';
import type { HarnessMcp, TurnResources } from '../threads/harness.js';

export class ResourceManager {
  readonly skills: SkillFiles;
  readonly tools: ManagedTools;
  private sourceJobs = new Map<string, Promise<unknown>>();
  private sourceOperations = new Set<Promise<unknown>>();
  private closing = false;
  constructor(private home: string, private machineId: string, private store: Resources, private gateway: McpGateway,
    private profiles: Profiles, private projects: Projects, private broadcast: Broadcast,
    repair: (tool: ToolDefinition, detail: string) => Promise<string>, run?: CommandRunner) {
    this.skills = new SkillFiles(home, run);
    this.tools = new ManagedTools(home, machineId, store, () => this.announce(), repair, run);
  }
  state(): ResourcesState { return this.store.state(); }
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
        this.checkScope(tool.scope); if (tool.repairProfileId) this.profiles.require(tool.repairProfileId);
        await this.store.saveTool(tool); this.announce();
        if (enabled(tool.scope) || tool.scope.profileIds.length || tool.scope.projectKeys.length) void this.tools.check(tool).catch(console.error);
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
      .on('skills.copy', async ({ id, checkoutId }) => { const skill = this.state().skills.find(s => s.id === id); if (!skill) throw new Error('No such skill'); const release = this.projects.useCheckout(checkoutId); try { return await this.skills.copy(skill, this.projects.checkout(checkoutId).path); } finally { release(); } })
      .on('mcp.save', async mcp => { this.checkScope(mcp.scope); this.validateMcp(mcp); const old = this.state().mcps.find(m => m.id === mcp.id); if (old && (old.url !== mcp.url || old.auth !== mcp.auth || old.oauthClientId !== mcp.oauthClientId)) await this.gateway.signOut(mcp.id); await this.store.saveMcp(mcp); this.announce(); return this.state().mcps.find(m => m.id === mcp.id)!; })
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
    if (mcp.transport === 'http') { if (!mcp.url || !['https:', 'http:'].includes(new URL(mcp.url).protocol)) throw new Error('Remote MCP servers need an HTTP or HTTPS URL'); }
    else { if (!mcp.command) throw new Error('Local MCP servers need a command'); if (mcp.auth !== 'none') throw new Error('Local MCP sign-in is managed by that server; use a remote MCP for hub-owned credentials'); }
  }
  async reconcile() {
    for (const tool of this.state().tools) if (enabled(tool.scope) || tool.scope.profileIds.length || tool.scope.projectKeys.length) await this.tools.check(tool);
  }
  async prepare(profileId: string, projectId: string, env: Record<string, string>, options: { repair?: boolean; cwd?: string } = {}): Promise<TurnResources> {
    const project = this.projects.state().projects.find(p => p.id === projectId);
    const key = project ? project.repoKey ?? `local:${project.id}` : undefined;
    const state = this.state();
    const tools = state.tools.filter(t => enabled(t.scope, profileId, key));
    if (options.repair) return { env: this.tools.env(state.tools, env), instructions: '', mcps: {}, snapshot: { tools: [], skills: [], mcps: [] }, release: () => {} };
    if (!options.repair) for (const tool of tools) {
      const status = await this.tools.check(tool);
      if (status.status !== 'ready') throw new Error(`${tool.name} is not ready. ${status.repairThreadId ? 'A repair thread was started.' : status.repairError ?? status.detail}`);
    }
    const skills = state.skills.filter(s => enabled(s.scope, profileId, key));
    const names = new Set<string>();
    for (const skill of skills) {
      if (names.has(skill.name)) throw new Error(`More than one enabled skill is named ${skill.name}; select one source`);
      names.add(skill.name); await this.skills.validate(skill);
      if (options.cwd && /^[a-zA-Z0-9_-]+$/.test(skill.name)) for (const folder of ['.agents', '.claude']) {
        if (await access(join(options.cwd, folder, 'skills', skill.name, 'SKILL.md')).then(() => true, () => false)) throw new Error(`This project already has a skill named ${skill.name}. Choose either the project copy or the synced skill in settings.`);
      }
    }
    const instructions = skills.length ? `Skills enabled for this turn:\n${skills.map(s => `- ${s.name}: ${s.description}\n  Read ${join(s.path, 'SKILL.md')} when relevant. Source revision: ${s.revision}`).join('\n')}\nRead a skill's SKILL.md before using it. Resolve its relative references against its own folder.` : '';
    const releases: (() => void)[] = [];
    const mcps: Record<string, HarnessMcp> = {};
    for (const mcp of state.mcps.filter(m => enabled(m.scope, profileId, key))) {
      if (mcp.transport === 'http') { const grant = this.gateway.grant(mcp.id, profileId, key); releases.push(grant.release); mcps[mcp.id] = { type: 'http', url: grant.url, headers: { Authorization: `Bearer ${grant.token}` } }; }
      else mcps[mcp.id] = { type: 'stdio', command: mcp.command!, args: mcp.args };
    }
    return { env: this.tools.env(tools, env), instructions, mcps, snapshot: { tools: tools.map(t => ({ id: t.id, version: t.version })), skills: skills.map(s => ({ id: s.id, revision: s.revision })), mcps: Object.keys(mcps) }, release: () => { releases.forEach(release => release()); } };
  }
  async close() { this.closing = true; await this.tools.close(); await Promise.allSettled([...this.sourceOperations]); }
}
