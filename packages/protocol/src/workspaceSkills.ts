import { z } from 'zod';
import { method } from './rpc.js';

export type SkillContext = { threadId?: string; checkoutId?: string; profileId?: string };
export type LoadedSkill = { id: string; name: string; path: string };
export type WorkspaceSkill = LoadedSkill & {
  description: string;
  origin: 'repository' | 'library';
  enabled: boolean;
  enabledBy: 'project' | 'profile' | 'global' | null;
  sourceName?: string;
  revision?: string;
  conflict?: string;
  loaded?: { itemId: string; turnId: string };
};
export type WorkspaceSkills = { skills: WorkspaceSkill[]; projectId?: string; unavailable?: string };

const Context = z.object({ threadId: z.string().min(1).optional(), checkoutId: z.string().min(1).optional(), profileId: z.string().min(1).optional() });
const Skill = Context.extend({ skillId: z.string().min(1) });
const Save = Skill.extend({ content: z.string().max(1_000_000) });
const Enable = Skill.extend({ enabled: z.boolean() });
export const workspaceSkillMethods = {
  'threads.skills': method<typeof Context, WorkspaceSkills>(Context),
  'threads.skillContent': method<typeof Skill, { content: string; path: string; editable: boolean }>(Skill),
  'threads.saveSkillContent': method<typeof Save, null>(Save),
  'threads.setSkillEnabled': method<typeof Enable, null>(Enable),
};
