# The home machine owns shared settings and replaces fleet

Accounts, skill sources and MCP servers are defined once on the home machine, stored in git there, and handed to each machine when it connects; hub access keys go only to paired machines. Skill sources are git repositories the home machine pulls, and each account chooses which it gets. This replaces the marauders-map `fleet.toml` setup, where every machine pulled repos, linked skills and received pasted secrets by hand, because that proved too tedious to keep working across machines. Marauders-map retires once two machines run on accio.

## Consequences

A new machine needs only installing accio and pairing it. The work VM is never paired, so it never receives keys or skills.
