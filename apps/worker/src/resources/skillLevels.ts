import { SKILL_LEVELS, type ResourceScope, type SkillLevel, type WorkspaceSkill } from '@accio/protocol';

/** Where a thread stands: its profile and its project's key. A space joins here with #199. */
export type LevelContext = { profileId?: string; projectKey?: string };

/**
 * GLOSSARY: Skill level. The narrowest level a library skill's selection turns it on
 * at for this context, or null. A skill on at several levels competes at the narrowest.
 */
export function enabledLevel(scope: ResourceScope, context: LevelContext): SkillLevel | null {
  const on: Record<SkillLevel, boolean> = {
    project: !!context.projectKey && scope.projectKeys.includes(context.projectKey),
    profile: !!context.profileId && scope.profileIds.includes(context.profileId),
    global: scope.global,
  };
  return SKILL_LEVELS.find(level => on[level]) ?? null;
}

/**
 * ADR 0020: among enabled skills of one name, the narrowest level wins and wider ones are
 * marked overridden by it; two at one level are a conflict, whether or not they win.
 * Harness skills don't compete. Marks the given skills in place and returns them.
 */
export function resolveLevels(skills: WorkspaceSkill[]): WorkspaceSkill[] {
  const rank = (skill: WorkspaceSkill) => SKILL_LEVELS.indexOf(skill.enabledBy!);
  const competing = skills.filter(skill => skill.enabled && skill.enabledBy && skill.origin !== 'harness');
  for (const name of new Set(competing.map(skill => skill.name))) {
    const named = competing.filter(skill => skill.name === name);
    const best = Math.min(...named.map(rank));
    for (const skill of named) {
      if (rank(skill) > best) skill.overriddenBy = SKILL_LEVELS[best];
      const level = named.filter(other => rank(other) === rank(skill));
      if (level.length > 1) skill.conflict = level.some(other => other.origin === 'repository') && level.some(other => other.origin === 'library')
        ? `This project already has a skill named ${name}. Choose either the project copy or the synced skill in settings.`
        : `More than one enabled skill is named ${name}. Choose one source before the next turn.`;
    }
  }
  return skills;
}
