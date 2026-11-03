import { z } from 'zod';
import { method } from './rpc.js';

export const ResourceScope = z.object({ global: z.boolean().default(false), profileIds: z.array(z.string()).default([]), projectKeys: z.array(z.string()).default([]) });
export type ResourceScope = z.infer<typeof ResourceScope>;
const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const ToolDefinition = z.object({ id: Id, name: z.string().trim().min(1).max(120), package: z.string().regex(/^(@[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9_.-]+$/), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, 'Use an exact version, such as 1.2.3'), executable: Id, checkArgs: z.array(z.string()).default(['--version']), scope: ResourceScope, repairProfileId: z.string().optional() });
export type ToolDefinition = z.infer<typeof ToolDefinition>;
export const SkillSource = z.object({ id: Id, name: z.string().trim().min(1).max(120), url: z.string().trim().min(1), ref: z.string().min(1).default('HEAD') });
export type SkillSource = z.infer<typeof SkillSource>;
export type SkillEntry = { id: string; sourceId: string; name: string; description: string; path: string; revision: string; scope: ResourceScope };
export const McpDefinition = z.object({ id: Id, name: z.string().trim().min(1).max(120), transport: z.enum(['http', 'stdio']), url: z.url().optional(), command: z.string().trim().min(1).optional(), args: z.array(z.string()).default([]), scope: ResourceScope, auth: z.enum(['none', 'bearer', 'oauth']).default('none'), oauthClientId: z.string().optional() });
export type McpDefinition = z.infer<typeof McpDefinition>;
export type McpView = McpDefinition & { signedIn: boolean; status?: string };
export type ToolStatus = { toolId: string; machineId: string; status: 'pending' | 'installing' | 'ready' | 'error'; version?: string; detail?: string; checkedAt?: string; repairThreadId?: string; repairError?: string };
export type ResourcesState = { tools: ToolDefinition[]; sources: SkillSource[]; skills: SkillEntry[]; mcps: McpView[]; toolStatuses: ToolStatus[]; skillVersions: { sourceId: string; revision: string; active: boolean }[] };
const ResourceId = z.object({ id: z.string().min(1) });
const ScopeInput = z.object({ id: z.string(), scope: ResourceScope });
const ToolCheck = z.object({ id: z.string(), machineId: z.string().optional() });
const CopySkill = z.object({ id: z.string(), checkoutId: z.string() });
const Secret = z.object({ id: z.string(), token: z.string().min(1) });
const OAuthComplete = z.object({ id: z.string(), callbackUrl: z.url() });
const ApplySkills = z.object({ id: z.string(), revision: z.string() });
export const resourceMethods = {
  'resources.get': method<z.ZodObject<{}>, ResourcesState>(z.object({})),
  'tools.save': method<typeof ToolDefinition, ToolDefinition>(ToolDefinition),
  'tools.delete': method<typeof ResourceId, null>(ResourceId),
  'tools.check': method<typeof ToolCheck, ToolStatus>(ToolCheck),
  'tools.repair': method<typeof ToolCheck, ToolStatus>(ToolCheck),
  'skills.addSource': method<typeof SkillSource, SkillSource>(SkillSource),
  'skills.updateSource': method<typeof ResourceId, SkillEntry[]>(ResourceId),
  'skills.previewUpdate': method<typeof ResourceId, SkillEntry[]>(ResourceId),
  'skills.applyUpdate': method<typeof ApplySkills, SkillEntry[]>(ApplySkills),
  'skills.deleteSource': method<typeof ResourceId, null>(ResourceId),
  'skills.setScope': method<typeof ScopeInput, SkillEntry>(ScopeInput),
  'skills.copy': method<typeof CopySkill, { path: string }>(CopySkill),
  'mcp.save': method<typeof McpDefinition, McpView>(McpDefinition),
  'mcp.delete': method<typeof ResourceId, null>(ResourceId),
  'mcp.setToken': method<typeof Secret, null>(Secret),
  'mcp.signOut': method<typeof ResourceId, null>(ResourceId),
  'mcp.beginSignIn': method<typeof ResourceId, { url: string }>(ResourceId),
  'mcp.completeSignIn': method<typeof OAuthComplete, null>(OAuthComplete),
};
export type ResourceEvents = { 'resources.changed': ResourcesState };
