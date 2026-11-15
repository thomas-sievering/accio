import { SKILL_LEVELS, type ResourceScope, type SkillLevel, type WorkspaceSkill } from '@accio/protocol';

/** Where a thread stands: its profile, its project's key and the id of the space that project is in. */
export type LevelContext = { profileId?: string; projectKey?: string; spaceId?: string };

/**
 * GLOSSARY: Skill level. The narrowest level a library skill's selection turns it on
 * at for this context, or null. A skill on at several levels competes at the narrowest.
 */
export function enabledLevel(scope: ResourceScope, context: LevelContext): SkillLevel | null {
  const on: Record<SkillLevel, boolean> = {
    project: !!context.projectKey && scope.projectKeys.includes(context.projectKey),
    space: !!context.spaceId && scope.spaceIds.includes(context.spaceId),
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
      const files = level.find(other => other.origin === 'repository' || other.origin === 'home')?.origin;
      if (level.length > 1) skill.conflict = files && level.some(other => other.origin === 'library')
        ? `${files === 'home' ? 'This space’s home' : 'This project'} already has a skill named ${name}. Choose either its copy or the synced skill in settings.`
        : `More than one enabled skill is named ${name}. Choose one source before the next turn.`;
    }
  }
  return skills;
}
