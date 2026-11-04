# Each machine serves accio's tools over MCP

Accio gives harnesses its own tools, such as `offer_choice`, through one MCP server named `accio`. Each machine serves it at `/mcp` on the accio worker's own port, and only its own harnesses use it. Every turn gets a bearer token that names its thread; the token stops working when the turn ends. Claude Code receives the server in the Agent SDK's `mcpServers`. Codex receives it as `mcp_servers.accio` in the `config` of both `thread/start` and `thread/resume`. T3 Code wires its own tools into both harnesses the same way.

## Considered Options

- **Serve the tools from the hub**: one endpoint for every machine. But turns, transcripts and thread files live on machines (ADR 0009), so every call would travel to the hub and back to the machine it came from, and the hub would need to reach into checkouts. A tool that needs shared data asks the hub through the machine's own connection (ADR 0001) instead.
- **Codex dynamic tools**: no endpoint, and Codex asks accio directly over app-server. But Codex accepts them only on `thread/start`, so a resumed thread, including any thread after accio restarts, would lose them.
- **An in-process server for Claude Code** (`createSdkMcpServer`): no HTTP. It works for Claude only, so every tool would need a second implementation for Codex.

## Consequences

- A tool is written once with `accioTool` (`apps/worker/src/tools`) and works for every harness.
- Tokens live only in memory on the machine. A turn cut off by a restart gets a new token when it is resumed.
- The URL is loopback. A harness that runs somewhere loopback can't reach, such as a container, would need another address.
- Claude Code names the tools `mcp__accio__<tool>` and Codex `accio/<tool>`; the transcript recognises both.
