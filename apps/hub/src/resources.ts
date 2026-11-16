import { join } from 'node:path';
import { JsonFile, JsonStore } from '@accio/persistence';
import { McpDefinition, ResourceScope as ResourceScopeInput, ToolDefinition, narrowestLevel } from '@accio/protocol';
import type { ResourceScope, ResourcesState, SkillEntry, SkillSource, ToolSave, ToolStatus } from '@accio/protocol';

export const optionalScope = (): ResourceScope => ({ global: false, profileIds: [], spaceIds: [], projectKeys: [] });
/** Every CLI saved before CLIs had levels was on for every thread. */
export const everywhere = (): ResourceScope => ({ ...optionalScope(), global: true });
export function enabled(scope: ResourceScope, profileId?: string, projectKey?: string, spaceId?: string): boolean {
  return !!narrowestLevel(scope, { profileId, projectKey, spaceId });
}
type Data = { tools: ToolDefinition[]; sources: SkillSource[]; skills: SkillEntry[]; mcps: McpDefinition[]; toolStatuses: ToolStatus[]; toolSelections?: Record<string, ResourceScope>; skillSelections?: Record<string, ResourceScope>; skillSnapshots?: { sourceId: string; revision: string; skills: SkillEntry[] }[] };
export type McpCredential = { accessToken: string; refreshToken?: string; expiresAt?: number; tokenEndpoint?: string; clientId?: string; clientSecret?: string };

/** Definitions and selections are shared; credentials are kept in a separate hub-only file. */
export class Resources {
  private store: JsonStore<Data>;
  /** Written inside the store's queue, so credential and definition changes stay ordered. */
  private secretsFile: JsonFile<Record<string, McpCredential>>;
  private secrets: Record<string, McpCredential> = {};
  constructor(home: string) {
    this.store = new JsonStore(join(home, 'hub', 'resources.json'), () => ({ tools: [], sources: [], skills: [], mcps: [], toolStatuses: [] }));
    this.secretsFile = new JsonFile(join(home, 'hub', 'mcp-credentials.json'), () => ({}));
  }
  private get data() { return this.store.data; }
  async load() {
    const data = await this.store.load();
    // Parsing strips scopes stored on legacy tool and MCP definitions; CLI levels live in toolSelections.
    data.tools = data.tools.map(tool => ToolDefinition.parse(tool));
    data.mcps = data.mcps.map(mcp => McpDefinition.parse(mcp));
    // Selections saved before spaces had skills have no `spaceIds`.
    data.skills = data.skills.map(skill => ({ ...skill, scope: ResourceScopeInput.parse(skill.scope) }));
    if (data.skillSelections) data.skillSelections = Object.fromEntries(Object.entries(data.skillSelections).map(([id, scope]) => [id, ResourceScopeInput.parse(scope)]));
    this.secrets = await this.secretsFile.read();
  }
  state(): ResourcesState { const { skillSnapshots = [], skillSelections: _selections, toolSelections = {}, ...data } = this.data; return structuredClone({ ...data, tools: data.tools.map(tool => ({ ...tool, scope: toolSelections[tool.id] ?? everywhere() })), skillVersions: skillSnapshots.map(s => ({ sourceId: s.sourceId, revision: s.revision, active: this.data.skills.some(skill => skill.sourceId === s.sourceId && skill.revision === s.revision) })), mcps: this.data.mcps.map(m => ({ ...m, signedIn: !!this.secrets[m.id] })) }); }
  credential(id: string) { return this.secrets[id] ? { ...this.secrets[id] } : undefined; }
  private save(fn: (data: Data) => Data) { return this.store.change(() => this.store.commit(fn(this.data))); }
  async setCredential(id: string, value?: McpCredential) { await this.store.change(async () => { const next = { ...this.secrets }; if (value) next[id] = value; else delete next[id]; await this.secretsFile.write(next); this.secrets = next; }); }
  saveTool(input: ToolSave) { return this.save(d => {
    const { scope, ...rest } = input; const tool = ToolDefinition.parse(rest);
    const previous = d.tools.find(t => t.id === tool.id);
    const changed = previous && (previous.package !== tool.package || previous.version !== tool.version || previous.executable !== tool.executable || JSON.stringify(previous.checkArgs) !== JSON.stringify(tool.checkArgs));
    return { ...d, tools: [...d.tools.filter(t => t.id !== tool.id), tool], toolSelections: scope ? { ...d.toolSelections, [tool.id]: scope } : d.toolSelections, toolStatuses: changed ? d.toolStatuses.filter(s => s.toolId !== tool.id) : d.toolStatuses };
  }); }
  deleteTool(id: string) { return this.save(d => ({ ...d, tools: d.tools.filter(t => t.id !== id), toolSelections: Object.fromEntries(Object.entries(d.toolSelections ?? {}).filter(([key]) => key !== id)), toolStatuses: d.toolStatuses.filter(t => t.toolId !== id) })); }
  setToolScope(id: string, scope: ResourceScope) { return this.save(d => { if (!d.tools.some(t => t.id === id)) throw new Error('No such CLI'); return { ...d, toolSelections: { ...d.toolSelections, [id]: scope } }; }); }
  saveSource(source: SkillSource, skills: SkillEntry[]) { return this.save(d => ({ ...d, sources: [...d.sources.filter(s => s.id !== source.id), source], skillSelections: { ...Object.fromEntries(d.skills.map(s => [s.id, s.scope])), ...d.skillSelections }, skillSnapshots: [...(d.skillSnapshots ?? []).filter(s => s.sourceId !== source.id || s.revision !== skills[0]?.revision), { sourceId: source.id, revision: skills[0]!.revision, skills }], skills: [...d.skills.filter(s => s.sourceId !== source.id), ...skills.map(s => ({ ...s, scope: d.skillSelections?.[s.id] ?? d.skills.find(old => old.id === s.id)?.scope ?? optionalScope() }))] })); }
  stageSkills(sourceId: string, skills: SkillEntry[]) { return this.save(d => ({ ...d, skillSnapshots: [...(d.skillSnapshots ?? []).filter(s => s.sourceId !== sourceId || s.revision !== skills[0]?.revision), { sourceId, revision: skills[0]!.revision, skills }] })); }
  async applySkills(id: string, revision: string) { const source = this.data.sources.find(s => s.id === id); const snapshot = this.data.skillSnapshots?.find(s => s.sourceId === id && s.revision === revision); if (!source || !snapshot) throw new Error('Preview this source revision before applying it'); await this.saveSource(source, snapshot.skills); }
  deleteSource(id: string) { return this.save(d => ({ ...d, sources: d.sources.filter(s => s.id !== id), skills: d.skills.filter(s => s.sourceId !== id), skillSelections: Object.fromEntries(Object.entries(d.skillSelections ?? {}).filter(([key]) => !key.startsWith(`${id}:`))), skillSnapshots: (d.skillSnapshots ?? []).filter(s => s.sourceId !== id) })); }
  setSkillScope(id: string, scope: ResourceScope) { return this.save(d => { if (!d.skills.some(s => s.id === id)) throw new Error('No such skill'); return { ...d, skillSelections: { ...d.skillSelections, [id]: scope }, skills: d.skills.map(s => s.id === id ? { ...s, scope } : s) }; }); }
  /** Update just one project inside the store queue so concurrent selections keep each other. */
  setSkillProject(id: string, selection: { projectKey: string; enabled: boolean }) { return this.setSkillMember(id, 'projectKeys', selection.projectKey, selection.enabled); }
  /** GLOSSARY: Space. The same for one space, by its id. */
  setSkillSpace(id: string, selection: { spaceId: string; enabled: boolean }) { return this.setSkillMember(id, 'spaceIds', selection.spaceId, selection.enabled); }
  private setSkillMember(id: string, list: 'projectKeys' | 'spaceIds', member: string, on: boolean) {
    return this.save(d => {
      const skill = d.skills.find(skill => skill.id === id);
      if (!skill) throw new Error('No such skill');
      const scope = { ...skill.scope, [list]: [...skill.scope[list].filter(key => key !== member), ...(on ? [member] : [])] };
      return { ...d, skillSelections: { ...d.skillSelections, [id]: scope }, skills: d.skills.map(skill => skill.id === id ? { ...skill, scope } : skill) };
    });
  }
  saveMcp(mcp: McpDefinition) { return this.save(d => ({ ...d, mcps: [...d.mcps.filter(m => m.id !== mcp.id), mcp] })); }
  async deleteMcp(id: string) { await this.setCredential(id); await this.save(d => ({ ...d, mcps: d.mcps.filter(m => m.id !== id) })); }
  setToolStatus(status: ToolStatus) { return this.save(d => ({ ...d, toolStatuses: [...d.toolStatuses.filter(s => s.toolId !== status.toolId || s.machineId !== status.machineId), status] })); }
  async close() { await this.store.idle(); await this.secretsFile.idle(); }
}

/** Machine operations exclude reading MCP credentials or owning the persistence files. */
export type ResourceAccess = Pick<Resources, Exclude<keyof Resources, 'credential' | 'load' | 'close'>>;
