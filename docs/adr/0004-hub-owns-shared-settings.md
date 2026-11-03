# The hub owns shared settings and replaces fleet

Profiles, which project belongs to which profile (ADR 0008), skill sources and MCP servers are defined once on the hub, stored in git there, and handed to each machine when it connects. Skill sources are git repositories the hub pulls, and each profile chooses which it gets. This replaces the marauders-map `fleet.toml` setup, where every machine pulled repos, linked skills and received pasted secrets by hand, because that proved too tedious to keep working across machines. Marauders-map retires once two machines run on accio.

In v0.1 each machine's server still stores profile names and profile folders itself, and the hub knows only profile ids.

## Consequences

A new machine needs only installing accio and pairing it. The work VM is never paired, so it never receives keys or skills.
