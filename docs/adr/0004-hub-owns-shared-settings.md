# The hub owns shared settings and replaces fleet

Profiles, which project belongs to which profile (ADR 0008), skill sources and MCP servers are defined once on the hub, stored in git there, and handed to each machine when it connects. Skill sources are git repositories the hub pulls, and each profile chooses which it gets. This replaces the marauders-map `fleet.toml` setup, where every machine pulled repos, linked skills and received pasted secrets by hand, because that proved too tedious to keep working across machines. Marauders-map retires once two machines run on accio.

Almost every setting is shared. The few that apply to one machine, such as its profile folders and which harnesses it has installed, are stored on the hub too, under that machine, so every client sees and edits them in the same place. The hub also keeps the list of paired machines and whether each is connected.

In v0.1 the hub runs inside the machine's server, stores shared settings in `hub/settings.json` (not yet in git), and the server still applies the profile rules, such as unique names, before writing them there.

## Consequences

A new machine needs only installing accio and pairing it. The work VM is never paired, so it never receives keys or skills.
