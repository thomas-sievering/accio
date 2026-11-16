# CLIs: listed to threads, at the skill levels

[ADR 0021](../adr/0021-clis-are-listed-to-threads-at-the-skill-levels.md) records the decisions. Before this, a tool in Settings → Tools was installed with npm on every machine and put on the PATH, but no turn was told about it, every tool was global, and one failed check blocked every turn on that machine.

## Shipped

- **Listed in every turn.** `ToolDefinition` has an optional `description`; a machine records the installed package's own description in its `ToolStatus`. `ResourceManager.prepare` (`apps/worker/src/resources/resources.ts`) adds the CLI section built by `cliInstructions` (`resources/clis.ts`) to the turn's `resourceInstructions`, next to the skills.
- **Broken CLIs don't block.** `requireToolsReady` is gone. A turn waits up to 15 s for a running check of its CLIs (`ManagedTools.settled`), puts only ready ones on the PATH and lists the rest as unavailable with the reason and repair state.
- **pnpm.** `ManagedTools` installs with `pnpm add --dir <folder> --ignore-workspace --config.dangerously-allow-all-builds=true`, located by `pnpmCli` (`resources/process.ts`) without a shell. Folders already installed with npm keep working; they pass the version check and are not reinstalled.
- **Levels.** `ResourceScope` has `spaceIds`. The hub keeps CLI levels in `toolSelections` (`apps/hub/src/resources.ts`); a CLI without one, including every CLI saved before levels, is on Everywhere. `threadClis` picks one CLI per executable, the narrowest level first (`narrowestLevel` in `packages/protocol/src/resources.ts`). `tools.setScope` changes levels; `tools.save` takes optional levels.
- **Every machine installs right away.** On every hub change, `ManagedTools.sync` checks the CLIs whose installation identity (`installIdentity`: package, version, executable, check arguments) changed since this machine last checked them. Levels, names and descriptions don't trigger a reinstall.
- **`add_cli`** (`resources/addCli.ts`). Saves at the thread's project (default), space or profile, merging levels into an existing CLI of the same package, version and executable; another version becomes its own CLI. It waits for this machine's install and check and returns the result, with the executable's full path for use within the same turn. Everywhere first waits on a **Confirmation** card (`threads/confirmations.ts`, `confirmations.answer`, web `threads/ConfirmationCard.tsx`), which ends with its turn or after ten minutes.
- **Settings → CLIs** (`apps/web/src/tools/ToolsSettings.tsx`): description, levels through `ScopeEditor` with its Space list (`withSpaces`), level summary in the list, and a note when another CLI provides the same executable.

## Open

- **Adopt the hand-installed CLIs.** Add agent-desktop, surf, playwright-cli, tldraw-cli, gmcli, lumos, imp, pi-puck and vercel at their levels with `add_cli` or Settings, then uninstall the global npm copies so threads only see Accio's.
- **Space level for skills** (#199). `ResourceScope.spaceIds` and `ResourceManager.levelContext` exist for CLIs; skill levels (`resources/skillLevels.ts`) still match only project, profile and Everywhere, and the skills `ScopeEditor` doesn't offer spaces.
- **Sidebar attention.** A pending Confirmation shows "Waiting for your answer" in the thread but doesn't flag the thread in the sidebar the way a pending secret does.
- **Project and profile pages.** CLI levels are edited on the CLI's own page only, not in the project and profile settings pickers.

## Verification

- Unit: `resources/clis.test.ts`, `resources/managedTools.test.ts`, `resources/addCli.test.ts` (with `Confirmations`), `resources/resources.test.ts` (listing, levels, narrowest wins, not blocking), `apps/hub/src/resources.test.ts` (levels persisted, legacy CLIs on Everywhere).
- UI: `node .agents/skills/3-verify/scripts/verify.mjs .agents/skills/3-verify/scripts/resources.mjs` installs a real CLI with pnpm and saves one at a profile level.

## Out of scope

Levels and per-profile accounts for MCP servers (a separate decision), installers other than pnpm, and removing CLIs from a thread.
