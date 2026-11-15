# CLIs: listed to threads, at the skill levels

[ADR 0021](../adr/0021-clis-are-listed-to-threads-at-the-skill-levels.md) records the decisions. Today a tool in Settings → Tools is installed with npm on every machine and put on the PATH, but `ResourceManager.prepare` (`apps/worker/src/resources/resources.ts`) never mentions it in the turn's instructions, every tool is global, and one failed check blocks every turn on that machine (`requireToolsReady`, also called from `threads/threads.ts`).

## Steps

Each step ships and is verifiable on its own. The first fixes "I can't do that" without anything else.

1. **List CLIs in every turn.** Add `description` to `ToolDefinition` (`packages/protocol/src/resources.ts`), filled from the installed package's `package.json` when left empty and editable in Settings. `prepare` adds a "CLIs available in this turn" section next to the skills list: name, executable, description and "run `<executable> --help` before first use". It lands in the same `resourceInstructions` both harnesses already receive (`threads/claudeCode.ts`, `threads/codex.ts`) and shows under Settings → System prompt. Rename the UI label from Tools to CLIs and use the glossary term in copy.
2. **Don't block on a broken CLI.** Remove `requireToolsReady` from turn start. `prepare` puts only ready CLIs on the PATH and lists the others as "unavailable on this machine: <detail>; a repair thread is running" (or the repair precondition). Repair behaviour in `ManagedTools` stays as it is.
3. **Install with pnpm.** `ManagedTools.perform` (`resources/tools.ts`) runs `pnpm add --dir <folder>` with install scripts allowed for that install (pnpm 10+ skips them by default). Keep the per-machine folder under the Accio home so worktrees share one install. Existing npm installs fail the version check once and reinstall.
4. **Levels.** Add `spaceIds` to `ResourceScope`. Space membership comes from the spaces shared setting, so a project's thread is in a space's level when its project is in that space. Bring back selections for tools in the hub store (`apps/hub/src/resources.ts`: it discards them on load today, and the test "loads legacy tools and MCPs without profile or project scopes" asserts that). `prepare` filters CLIs by level. Same package at several levels: the narrowest wins (Project, Space, Profile, Everywhere), and the others are marked overridden. Settings reuses the skills picker (`apps/web/src/resources/ResourcePicker.tsx`, `ScopeEditor.tsx`) and its overridden display. Space skills need the same `spaceIds`, so coordinate this with ADR 0020's Space level rather than building it twice.
5. **Install right away everywhere.** On a `resources.changed` from the hub (`hub/connections.ts`, `client.onChanged`), each machine checks CLIs whose definition changed, not only the machine that saved it. Reconnecting already runs `reconcile`. Install every CLI regardless of level, so a thread moved or handed off to another machine finds it.
6. **`add_cli` accio tool** (`apps/worker/src/tools`). Inputs: package, exact version, executable, optional check arguments and description, and the level (`project`, `space`, `profile`, `everywhere`), defaulting to the thread's project. It saves through the hub, waits for the install and check on the thread's machine, and returns ready or the error so the agent can retry with other check arguments. `everywhere` first shows a confirmation card in the thread, the pattern of the private secret card. No removal or level change through the tool.
7. **Adopt the hand-installed CLIs.** Once the above has shipped, add agent-desktop, surf, playwright-cli, tldraw-cli, gmcli, lumos, imp, pi-puck and vercel at their levels with `add_cli` or Settings, then uninstall the global npm copies so threads only see Accio's.

## Verification

- Unit: the CLI section of `prepare` (listed, unavailable, filtered by level, narrowest wins); hub store keeps tool selections and `spaceIds`; `ManagedTools` builds the pnpm command with scripts allowed.
- UI through the `3-verify` skill: add a CLI at a space level, start threads in and outside the space, and check Settings → System prompt and the turn's transcript snapshot.
- Two machines: save on one, see the other report installing then ready without a turn.

## Out of scope

Levels and per-profile accounts for MCP servers (a separate decision), installers other than pnpm, and removing CLIs from a thread.
