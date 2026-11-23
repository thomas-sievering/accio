# Pi runs isolated and reaches Claude through Claude Code

Pi becomes a third harness. Threads on it run Claude models only, through `pi-claude-bridge`, which runs the real Claude Code as Pi's model provider. Claude Code gets the same Sorting Hat address and hat key as a Claude Code thread, through its environment, so the Sorting Hat sees an ordinary Claude Code client and needs no change, and neither does the hub beyond listing the harness. Pi's models are the profile's Claude account's own, under the ids the bridge knows (`claude-opus-5-5`).

Accio pins Pi and the bridge as worker dependencies rather than using a Pi the user installed. Turns start with `--no-extensions`, loading only the bundled bridge and Pi's built-in MCP support. Each profile has a Pi folder of its own (`profiles/<id>/pi`) for its sessions and the bridge's state. The user's `~/.pi` (its packages, logins, models and MCP servers) never reaches a thread, as ADR 0003 keeps `~/.claude` out.

Pi's Claude Code gets a Claude config folder of its own in that Pi folder, with empty settings, rather than the profile's (ADR 0003). The bridge loads Claude Code's user settings, whose env would outrank the turn's own key, so a thread borrowing another profile's accounts would spend its own.

Each turn starts Pi in RPC mode as a child process and resumes the thread's Pi session, as Codex runs app-server. Pi reads MCP servers only from its agent folder, so each turn gets an agent folder of its own holding its `mcp.json`, linked to the profile's bridge state, and removed when the turn ends.

## Considered Options

- **Pi's own Anthropic provider pointed at the Sorting Hat**: no Claude Code process, but it sends non-Claude-Code requests on a subscription login, the terms risk of ADR 0007. The Sorting Hat swaps the key and changes nothing else (ADR 0018).
- **The official `pi-claude-code` plugin**: it refuses `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` and always calls `api.anthropic.com`, so it cannot use the Sorting Hat, and it rewrites requests in a local relay.
- **The user's own Pi and extensions**: threads would get the user's tools, but each machine's behaviour would depend on what is installed there, and extensions could bring other logins or providers into a thread.
- **Pi's SDK inside the worker**: no process per turn, but a crash or a leaking extension would take the worker down, and per-turn environments would be shared.

## Consequences

Pi threads spend the profile's Anthropic account, so the rule that a harness spends one provider still holds. Pi and Claude Code offer the same models under the same names; a mention of the model Claude Code lists first keeps its short handle, and Pi's takes its harness's name, such as `@pi-opus`. ChatGPT models in Pi, which would break that rule, are left for a later decision. A Pi turn starts both Pi and Claude Code, so it starts more slowly than a Claude Code turn; its prompt is Claude Code's followed by Pi's, with Pi's tools. Updating Pi or the bridge is a worker release. Anthropic can change what it accepts from Claude Code under a subscription; that affects Pi threads as it does every Claude Code thread.
