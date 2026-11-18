# MCP servers are turned on at levels, and threads can add them

Accepted on 2026-11-18.

MCP servers get the levels CLIs have (ADR 0021): Everywhere, Profile, Space and Project. A turn gets only the servers turned on at one of its levels. Every server adds all of its tool definitions to every turn that gets it, so a design-reference server such as Mobbin should cost context only in projects that do UI work. Servers saved before this change stay on Everywhere. The levels are stored on the hub next to the definitions, as for CLIs. When ADR 0022 changes the skill levels, MCP servers follow.

A thread can add a server with the `add_mcp` accio tool, as it adds CLIs with `add_cli`. It may choose the thread's own project, space or profile without asking. Everywhere asks you first, because it reaches your other profiles. Adding a server that is already saved, matched by URL or by command and arguments, adds the level to it and keeps its other levels. The tool never removes a server or narrows its levels; only Settings does. A new server works from the next turn, because a turn's MCP servers are fixed when it starts.

Sign-in stays on the hub, and credentials never pass through the conversation:

- **OAuth**: the tool starts the hub's sign-in and returns the page for you to open. The hub finishes the sign-in at its own callback, so nothing else in the thread is needed.
- **Bearer token**: the thread gets the token with `request_secret` and passes the file, which the tool reads. The tool never accepts a token as text.

Credentials stay per server, not per profile. One sign-in serves every thread that gets the server, whatever its profile. Signing in per profile is a separate decision.

This amends ADR 0021, which left MCP servers on a single global level.

## Considered Options

- **Keep MCP servers global and only add the tool**: simpler, but every thread would pay for every server's tools.
- **A sign-in card in the thread instead of a link**: smoother, but it needs a new transcript item, while the link works now. A card can come later.
- **Accept a bearer token as a tool argument**: easier for the model, but the token would land in the transcript and the provider's logs.
- **Credentials per profile**: matches profiles choosing accounts (ADR 0016), but the hub would keep credentials by server and profile, and you would sign in once per profile.
