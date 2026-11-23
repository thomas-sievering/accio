# Pi as a harness

[Pi](https://pi.dev) (`@earendil-works/pi-coding-agent`) is a third harness beside Claude Code and Codex, running Claude models only through `pi-claude-bridge`. [ADR 0026](../adr/0026-pi-runs-isolated-and-reaches-claude-through-claude-code.md) records the decisions. This page records how it was built and what is left.

## How it works

- **Install.** Pi 1.6.0, pi-ai 1.6.0 (the bridge's peer) and pi-claude-bridge 0.13.0 are pinned in `apps/worker/package.json`. `piInstall()` reports Pi's version, so every machine that runs this worker has the harness. `pnpm-workspace.yaml` refuses the build scripts of two packages Pi's model catalogue pulls in (`@google/genai`, `protobufjs`), which Claude needs neither of.
- **Start** (`threads/pi.ts`, `startPi`). Pi runs as `process.execPath` with its bundled `dist/bundle/cli.js`, with exactly the turn's environment. Under Electron, a one-line `-e` launcher starts it as Node and drops `ELECTRON_RUN_AS_NODE` before Pi starts anything, so commands Pi runs don't inherit it. Pi's `RpcClient` is not used: it merges the worker's whole environment and runs `node` from `PATH`.
- **Arguments.** `--mode rpc --no-extensions -e <bridge> -e builtin:mcp --no-skills --no-prompt-templates --no-themes --session-dir <profile>/pi/sessions [--session <id>] --model claude-bridge/<id> --thinking <effort> --tools <on> --append-system-prompt <accio's sections, resources, secrets>`. Pi still reads the checkout's `AGENTS.md` and `CLAUDE.md`.
- **Environment** (`harnessEnv.ts`). The Sorting Hat address and hat key as for Claude Code; `CLAUDE_CONFIG_DIR` is `profiles/<id>/pi/claude`, whose `settings.json` is `{}` (ADR 0026 says why); `PI_OFFLINE`, `PI_SKIP_VERSION_CHECK`, `PI_TELEMETRY=0`. Another Pi's `PI_CODING_AGENT*` and session variables are dropped.
- **Per-turn agent folder.** `profiles/<id>/pi/turns/turn-*` holds the turn's `mcp.json` (accio's tools and the turn's servers, all `exposure: "direct"`, codemode off) and a link `claude-bridge` to `profiles/<id>/pi/claude-bridge`, the bridge's per-session state. It is removed when the turn ends.
- **Events** (`PiEvents`). `message_update` text deltas stream into an item per assistant message and content block, replaced by `message_end`'s text; `tool_execution_start`/`_end` become tool rows named as Claude Code's (`bash` → Bash, `read` → Read with `file_path`, `find` → Glob); each reply's usage becomes the context window against the model's `contextWindow`; `agent_settled` ends the turn, with the last reply's `errorMessage` when its stop reason is `error`.
- **Steer and stop.** Steers go to RPC `steer`, which Pi delivers between tool calls. Stopping sends `abort` and waits for `agent_settled`, then ends Pi's input; Pi is signalled only if it doesn't exit.
- **Models** (`catalog.ts`, `piModels`). The Claude account's own list, as Claude Code reports it, under the bridge's ids: "Claude Opus 5.5" is `claude-opus-5-5`. Aliases without a version, shown before Claude Code has answered, are left out. Efforts and limits are the Claude models'.
- **Naming** uses Claude Code's `generateText` under the same account.
- **Built-in tools.** Shell (`bash`) and Files (`read`, `edit`, `write`) are required; Search (`grep`, `find`, `ls`) is off by default.
- **Names.** `HARNESSES` moved to `@accio/protocol` (the hub re-exports it), with `harnessName()` and `harnessProvider()`, so the web app and worker stop spelling "Codex or Claude Code".
- **Mentions.** Claude Code and Pi offer models with the same names. Handles are counted per harness; the harness listed first keeps `@opus`, Pi's is `@pi-opus`.

## Verification

- `apps/worker/src/threads/pi.test.ts`: arguments, environment, MCP config, the per-turn folder and its removal, event mapping, errors, steering, stopping, an unexpected exit, tool switches, isolation from another Pi, model ids, and a thread through the test app on a fake Pi.
- Live against the Sorting Hat, from the built worker: two turns on Claude Haiku 5.5 with a bash tool call, the second resuming the first's session; naming; the prompt-size baseline (0.7 s).
- Browser (`pnpm verify` journey): Settings → Harnesses lists Pi with Anthropic and "4 of 7 on"; Search switches on, persists in `hub/settings.json` across reload and resets; Settings → Machines shows Pi 1.6.0.
- Not yet verified in the browser: a real Pi turn from a signed-in profile (needs the verify device linked to a hub), and the model picker's `Anthropic · Pi` tab.

## Left for later

- **The hub.** Pi's tool switches need a hub that knows Pi (`sharedSettings.ts` checks the id); turns themselves work against an older hub, which stores harness ids as strings.
- **ChatGPT models in Pi.** Needs a harness that spans providers: `providerOf` per model, the web's account checks by the model's `providerId`, `changeAccounts` dropping Pi's session for ChatGPT models, and Pi's `openai-codex-responses` provider pointed at `<hat>/openai`. Its own ADR.
- **The user's Pi extensions** in threads.
- **Compaction point.** Pi compacts on its own; the context ring doesn't yet show where.
- **Upgrades.** Pi's built-in tool list (`BUILTIN_TOOLS.pi`) and event shapes were read from Pi 1.6.0; check them when bumping Pi or the bridge.
