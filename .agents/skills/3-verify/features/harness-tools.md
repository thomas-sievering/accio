# Built-in tools

Settings → Harnesses lists each harness with a `Built-in tools` row ("4 of 26 on" for Claude Code, "5 of 10 on" for Codex by default). It opens one switch per group of the harness's own tools. Switches are hub-wide shared settings stored in `hub/settings.json` under `harnessTools`, holding only overrides of accio's defaults. Research and defaults: [docs/plans/harness-tools.md](../../../../docs/plans/harness-tools.md).

## Entry points

- `harness-tools-list`: the row on each harness section shows its count.
- `harness-tools-switch`: `page.getByRole('switch', { name: 'Web' })` toggles a group; the heading `Claude Code · 6 of 26 on` updates, `Reset to defaults` appears, and the override persists across reload.
- `harness-tools-reset`: `Reset to defaults` clears the harness's overrides.
- `harness-tools-turn`: a turn passes switched-off tools as Claude `disallowedTools` or Codex `-c` config. Covered by `claudeCode.test.ts` and `codex.test.ts`; a live provider turn needs a signed-in account and stays unverified otherwise.

Required groups (Shell, Files; Codex Shell, Files, Questions) show `Required` and have no switch.
