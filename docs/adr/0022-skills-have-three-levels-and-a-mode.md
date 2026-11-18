---
status: proposed
---

# Skills have three levels and a mode: Auto, Slash or Off

Proposed on 2026-11-18.

Skills are set at three levels instead of four: Everywhere, Space and Project. Profile is no longer a skill level. A profile chooses accounts and providers (ADR 0016), not what a thread knows, and because spaces are independent of profiles (ADR 0019) a Profile level cut across the Space level: a skill could be on for a profile and overridden by a space the profile doesn't own. Everywhere, Space and Project nest, since a project is in at most one space, so "the narrowest wins" means what it says.

At each level a skill has a mode, not just on or off:

- **Auto**: the thread gets it and its description is listed to the model, which uses it when it fits.
- **Slash**: the thread gets it only when you name it with `/` in the composer. Its description costs no context.
- **Off**: the thread doesn't get it.

The narrowest level that sets a mode wins. A level that sets nothing inherits. Where no level sets anything, the skill's own default applies. A skill whose frontmatter has `disable-model-invocation: true`, or whose `agents/openai.yaml` sets `policy.allow_implicit_invocation: false`, defaults to Slash. Every other skill defaults to Auto. Accio ignored these flags until now: it listed every enabled skill to the model while Claude Code's native discovery hid them, so the same skill was both hidden and advertised. A setting, "Let the model invoke every skill", treats Slash defaults as Auto. It never overrides a mode you set yourself.

Which skills a level offers is unchanged, except that the home's skill files now count as Space defaults:

- A repository's own skill files default to their own mode at Project.
- A space's home repository's skill files default to their own mode for every project in the space.
- Library skills stay Off until a level sets them.

Harness skills now take part. Each one has a mode at every level, and its default is Auto. Turning off all of Claude Code's skills Everywhere is one setting.

Each turn passes the result to its harness. Claude Code gets the SDK's `skills` allowlist, and Codex gets `skills.config` entries, so a harness's own discovery hides Slash and Off skills. Accio's skill list in the turn instructions names only the Auto skills that the harness doesn't discover itself, such as library and home skills, so no description is listed twice. A `/name` for a Slash skill is sent to the harness with the skill's path, not left to native expansion, because the allowlist would refuse it.

Modes are changed only in Settings → Skills, by level. The thread's Skills panel shows the effective mode, the level that set it, and whether the thread loaded the skill. It has no controls except a link to the settings for this project.

This amends ADR 0020 (levels and overriding) and ADR 0021, whose CLIs share the skill levels and so lose Profile too.

## Considered Options

- **Two switches per skill, On and Model can invoke**: one more control per row, and "off but the model can invoke it" means nothing.
- **Keep the Profile level**: it serves work-only skills, but profiles choose accounts, and the overlap with spaces made overrides hard to follow.
- **Only Everywhere and Project, with home skill files offered automatically**: simpler, but library skills could no longer be turned on for one space.
- **Ignore skills' own invocation flags and let the model pick everything**: the view that skills should be discovered rather than invoked by hand. It is kept as the setting, off by default, because skill authors set those flags on purpose.
- **Change modes in the side panel**: quick while working, but the panel and Settings each showed half of the picture.

## Consequences

Selections stored at the Profile level today must move to Everywhere or a space before this ships. A harness skill whose instructions the harness doesn't share, such as most of Claude Code's, can be Auto or Off, but Slash works only if the harness still expands `/name` for a skill outside the allowlist. That needs checking before Slash is offered for those skills.
