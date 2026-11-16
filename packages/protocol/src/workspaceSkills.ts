import { z } from 'zod';
import { method } from './rpc.js';

/**
 * GLOSSARY: Skill level. Narrowest first, the order in which levels win a skill name
 * (ADR 0020).
 */
export const SKILL_LEVELS = ['project', 'space', 'profile', 'global'] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

/** A draft names the harness it would start on; a thread has its own. */
export type SkillContext = { threadId?: string; checkoutId?: string; profileId?: string; harnessId?: string };
export type LoadedSkill = { id: string; name: string; path: string };
export type WorkspaceSkill = LoadedSkill & {
  description: string;
  /** GLOSSARY: Harness skill. `harness` ones ship with the thread's harness and can't be turned off. */
  origin: 'repository' | 'library' | 'harness';
  enabled: boolean;
  /** The narrowest level that turns it on; null when nothing does, and for harness skills. */
  enabledBy: SkillLevel | null;
  /** A narrower level has a skill of this name, which the thread gets instead. */
  overriddenBy?: SkillLevel;
  sourceName?: string;
  revision?: string;
  conflict?: string;
  loaded?: { itemId: string; turnId: string };
};
/** `harnessId` is whose harness skills are listed; `space` is the space the project is in, if any. */
export type WorkspaceSkills = { skills: WorkspaceSkill[]; projectId?: string; space?: { id: string; name: string }; harnessId?: string; unavailable?: string };

const Context = z.object({ threadId: z.string().min(1).optional(), checkoutId: z.string().min(1).optional(), profileId: z.string().min(1).optional(), harnessId: z.string().min(1).optional() });
const Skill = Context.extend({ skillId: z.string().min(1) });
const Save = Skill.extend({ content: z.string().max(1_000_000) });
/** Turns a library skill on or off for the context's project, or with `level: 'space'` for the space it is in. */
const Enable = Skill.extend({ enabled: z.boolean(), level: z.enum(['project', 'space']).default('project') });
export const workspaceSkillMethods = {
  'threads.skills': method<typeof Context, WorkspaceSkills>(Context),
  'threads.skillContent': method<typeof Skill, { content: string; path: string; editable: boolean }>(Skill),
  'threads.saveSkillContent': method<typeof Save, null>(Save),
  'threads.setSkillEnabled': method<typeof Enable, null>(Enable),
};
