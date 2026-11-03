import { join } from 'node:path';
import { JsonFile } from '@accio/persistence';
import type { McpDefinition, ResourceScope, ResourcesState, SkillEntry, SkillSource, ToolDefinition, ToolStatus } from '@accio/protocol';

export const optionalScope = (): ResourceScope => ({ global: false, profileIds: [], projectKeys: [] });
export function enabled(scope: ResourceScope, profileId?: string, projectKey?: string): boolean {
  return scope.global || !!profileId && scope.profileIds.includes(profileId) || !!projectKey && scope.projectKeys.includes(projectKey);
}
type Data = { tools: ToolDefinition[]; sources: SkillSource[]; skills: SkillEntry[]; mcps: McpDefinition[]; toolStatuses: ToolStatus[]; skillSelections?: Record<string, ResourceScope>; skillSnapshots?: { sourceId: string; revision: string; skills: SkillEntry[] }[] };
export type McpCredential = { accessToken: string; refreshToken?: string; expiresAt?: number; tokenEndpoint?: string; clientId?: string; clientSecret?: string };

/** Definitions and selections are shared; credentials are kept in a separate hub-only file. */
export class Resources {
  private file: JsonFile<Data>;
  private secretsFile: JsonFile<Record<string, McpCredential>>;
  private data: Data = { tools: [], sources: [], skills: [], mcps: [], toolStatuses: [] };
  private secrets: Record<string, McpCredential> = {};
  private queue: Promise<unknown> = Promise.resolve();
  constructor(home: string) {
    this.file = new JsonFile(join(home, 'hub', 'resources.json'), () => this.data);
    this.secretsFile = new JsonFile(join(home, 'hub', 'mcp-credentials.json'), () => ({}));
  }
  async load() { this.data = await this.file.read(); this.secrets = await this.secretsFile.read(); }
  state(): ResourcesState { const { skillSnapshots = [], skillSelections: _selections, ...data } = this.data; return structuredClone({ ...data, skillVersions: skillSnapshots.map(s => ({ sourceId: s.sourceId, revision: s.revision, active: this.data.skills.some(skill => skill.sourceId === s.sourceId && skill.revision === s.revision) })), mcps: this.data.mcps.map(m => ({ ...m, signedIn: !!this.secrets[m.id] })) }); }
  credential(id: string) { return this.secrets[id] ? { ...this.secrets[id] } : undefined; }
  private change(fn: () => Promise<void>) { const result = this.queue.then(fn); this.queue = result.catch(() => {}); return result; }
  private save(fn: (data: Data) => Data) { return this.change(async () => { const next = fn(this.data); await this.file.write(next); this.data = next; }); }
  async setCredential(id: string, value?: McpCredential) { await this.change(async () => { const next = { ...this.secrets }; if (value) next[id] = value; else delete next[id]; await this.secretsFile.write(next); this.secrets = next; }); }
  saveTool(tool: ToolDefinition) { return this.save(d => {
    const previous = d.tools.find(t => t.id === tool.id);
    const changed = previous && (previous.package !== tool.package || previous.version !== tool.version || previous.executable !== tool.executable || JSON.stringify(previous.checkArgs) !== JSON.stringify(tool.checkArgs));
    return { ...d, tools: [...d.tools.filter(t => t.id !== tool.id), tool], toolStatuses: changed ? d.toolStatuses.filter(s => s.toolId !== tool.id) : d.toolStatuses };
  }); }
  deleteTool(id: string) { return this.save(d => ({ ...d, tools: d.tools.filter(t => t.id !== id), toolStatuses: d.toolStatuses.filter(t => t.toolId !== id) })); }
  saveSource(source: SkillSource, skills: SkillEntry[]) { return this.save(d => ({ ...d, sources: [...d.sources.filter(s => s.id !== source.id), source], skillSelections: { ...Object.fromEntries(d.skills.map(s => [s.id, s.scope])), ...d.skillSelections }, skillSnapshots: [...(d.skillSnapshots ?? []).filter(s => s.sourceId !== source.id || s.revision !== skills[0]?.revision), { sourceId: source.id, revision: skills[0]!.revision, skills }], skills: [...d.skills.filter(s => s.sourceId !== source.id), ...skills.map(s => ({ ...s, scope: d.skillSelections?.[s.id] ?? d.skills.find(old => old.id === s.id)?.scope ?? optionalScope() }))] })); }
  stageSkills(sourceId: string, skills: SkillEntry[]) { return this.save(d => ({ ...d, skillSnapshots: [...(d.skillSnapshots ?? []).filter(s => s.sourceId !== sourceId || s.revision !== skills[0]?.revision), { sourceId, revision: skills[0]!.revision, skills }] })); }
  async applySkills(id: string, revision: string) { const source = this.data.sources.find(s => s.id === id); const snapshot = this.data.skillSnapshots?.find(s => s.sourceId === id && s.revision === revision); if (!source || !snapshot) throw new Error('Preview this source revision before applying it'); await this.saveSource(source, snapshot.skills); }
  deleteSource(id: string) { return this.save(d => ({ ...d, sources: d.sources.filter(s => s.id !== id), skills: d.skills.filter(s => s.sourceId !== id), skillSelections: Object.fromEntries(Object.entries(d.skillSelections ?? {}).filter(([key]) => !key.startsWith(`${id}:`))), skillSnapshots: (d.skillSnapshots ?? []).filter(s => s.sourceId !== id) })); }
  setSkillScope(id: string, scope: ResourceScope) { return this.save(d => { if (!d.skills.some(s => s.id === id)) throw new Error('No such skill'); return { ...d, skillSelections: { ...d.skillSelections, [id]: scope }, skills: d.skills.map(s => s.id === id ? { ...s, scope } : s) }; }); }
  /** Update just one project inside the store queue so concurrent selections keep each other. */
  setSkillProject(id: string, projectKey: string, on: boolean) {
    return this.save(d => {
      const skill = d.skills.find(skill => skill.id === id);
      if (!skill) throw new Error('No such skill');
      const projectKeys = skill.scope.projectKeys.filter(key => key !== projectKey);
      if (on) projectKeys.push(projectKey);
      const scope = { ...skill.scope, projectKeys };
      return { ...d, skillSelections: { ...d.skillSelections, [id]: scope }, skills: d.skills.map(skill => skill.id === id ? { ...skill, scope } : skill) };
    });
  }
  saveMcp(mcp: McpDefinition) { return this.save(d => ({ ...d, mcps: [...d.mcps.filter(m => m.id !== mcp.id), mcp] })); }
  async deleteMcp(id: string) { await this.setCredential(id); await this.save(d => ({ ...d, mcps: d.mcps.filter(m => m.id !== id) })); }
  setToolStatus(status: ToolStatus) { return this.save(d => ({ ...d, toolStatuses: [...d.toolStatuses.filter(s => s.toolId !== status.toolId || s.machineId !== status.machineId), status] })); }
  async close() { await this.queue; await this.file.idle(); await this.secretsFile.idle(); }
}
