import type { CodexClient } from '@accio/codex';
import type { HarnessSkill } from './harness.js';
import { CodexSkillsList, parseCodex } from './codexMessages.js';

/**
 * ADR 0020: where Codex finds skills a user installed on this machine, such as
 * `~/.agents/skills`. They are no skill level, so every turn passes them as disabled.
 * Repository skills (`repo`) are the Project level; `system` ones ship with Codex.
 */
const MACHINE_SCOPES = new Set(['user', 'admin']);

/** The `-c` override that turns skills off by their SKILL.md path; TOML basic strings read JSON strings. */
export function disabledSkillsConfig(paths: readonly string[]): string[] {
  return paths.length ? [`skills.config=[${paths.map(path => `{path=${JSON.stringify(path)},enabled=false}`).join(',')}]`] : [];
}

/**
 * What Codex discovers per profile home: the machine skills to disable, remembered so
 * a turn normally launches once with them already off, and its harness skills.
 */
export class CodexSkills {
  private machine = new Map<string, string[]>();
  private bundled = new Map<string, HarnessSkill[]>();

  /** Machine skills last seen for this Codex home, to disable at launch. */
  known(home: string) { return this.machine.get(home) ?? []; }
  /** Harness skills last seen for this Codex home, if it was listed yet. */
  harness(home: string) { return this.bundled.get(home); }

  /**
   * Lists what the launched app-server would give a turn in `cwd`. True when it
   * still has an enabled machine skill, so the turn must relaunch with it disabled.
   */
  async discover(client: CodexClient, home: string, cwd: string): Promise<boolean> {
    const listed = parseCodex('skills/list', CodexSkillsList, await client.request('skills/list', { cwds: [cwd], forceReload: true }));
    const skills = listed.data.flatMap(entry => entry.skills);
    const machine = skills.filter(skill => MACHINE_SCOPES.has(skill.scope));
    this.machine.set(home, [...new Set(machine.map(skill => skill.path))]);
    this.bundled.set(home, skills.filter(skill => skill.scope === 'system').map(({ name, description, path }) => ({ name, description: description ?? '', path })));
    return machine.some(skill => skill.enabled);
  }
}
