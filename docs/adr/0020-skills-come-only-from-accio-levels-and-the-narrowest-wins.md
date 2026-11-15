# Skills come only from Accio's levels, and the narrowest level wins

A thread's skills come from four levels: Everywhere, Profile, Space and Project, plus the harness skills that ship with its harness. Skills installed on a machine are not a level. Claude threads already ignore `~/.claude/skills` because of the per-profile config folder (ADR 0003), but Codex threads still read user skill folders such as `~/.agents/skills`, because only `CODEX_HOME` is per profile. From now on, each turn finds the skills Codex would discover in those user folders and passes them to Codex as disabled (`skills.config` entries with `enabled = false`). Both harnesses then get the same skills on every machine, and the Skills panel shows exactly what a thread gets. A skill meant for every thread goes in a skill source and is turned on Everywhere.

When levels share a skill name, the narrowest wins: Project over Space over Profile over Everywhere. The overridden skill stays visible, marked as overridden, so a repository can fork a shared skill without turning the shared one off. A name clash within one level is still a conflict.

This amends ADR 0012, which reported every name clash among enabled skills as a conflict, and extends ADR 0003's isolation from the user's own configuration to Codex.

## Considered Options

- **A machine level**: keeps skills you've installed locally, but a thread's skills would depend on where it runs, and remote and handed-off threads would behave differently.
- **Giving Codex its own `HOME`**: hides the user folders, but also git, gh and ssh configuration, which threads need.
- **Codex's `skip_host_skill_discovery` feature**: still under development in Codex 0.166.0, and it left `~/.agents/skills` in the prompt.
- **Reporting clashes across levels as conflicts**: no surprise winner, but forking a shared skill would mean turning it off at the wider level, for every other project too.

## Consequences

Skills reachable only through `~/.agents/skills` disappear from Codex threads. Repositories they link to, such as marauders-map and hrc_ai_skills, are added as skill sources first and their skills turned on at the level that fits.
