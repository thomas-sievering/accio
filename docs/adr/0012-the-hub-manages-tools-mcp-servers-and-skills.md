# The hub manages tools, MCP servers and skills

The hub owns the library and the selections for tools, MCP servers and individual skills. Each item can be enabled globally, for named profiles, or for projects identified by their canonical Git remote. A project without a remote uses its local project identity. An item with no selections is optional. Selections are additive; project and profile settings show inherited selections rather than silently overriding them.

Definitions, skill selections, source revisions and machine tool reports live in `hub/resources.json`. This follows the current JSON implementation of ADR 0004; the settings store itself is not yet versioned in Git. Source content remains in Git repositories. MCP credentials live separately in `hub/mcp-credentials.json` and never appear in settings responses.

## Tools execute on machines

The first installer supports npm packages at exact versions. Each machine installs them under its Accio home, checks the declared executable and arguments, and adds only selected tools to the PATH passed to a turn. Saving an enabled tool, machine startup and turn preparation reconcile the installation. Tool health describes the configured check; a version check alone does not establish browser or other external dependency readiness.

A failed installation or check automatically starts one repair thread on the affected machine. Its profile is chosen explicitly when configured, otherwise from a profile with an available signed-in model. Its prompt includes the managed installation directory and the failure. Repair threads bypass resource readiness so a broken tool cannot prevent its own repair. A completed repair triggers the original health check again; the model's report alone does not mark the tool ready. Repeated failures reuse the existing repair thread. When sign-in is missing, the check remains failed with the repair precondition displayed.

## MCP credentials stay on the hub

Remote HTTP MCP definitions support no authentication, bearer tokens and OAuth authorization code with PKCE. OAuth discovers protected-resource and authorization-server metadata, can register a public client or use a configured client ID, and refreshes credentials on the hub. Services requiring another authentication method need their own integration. Sign-in opens the service's authorization page; this requires a callback reachable from the browser. In v0.1 both browser and hub normally run on the same machine.

The hub proxies remote MCP traffic. A turn receives a temporary credential limited to that MCP and its profile/project selection. Removing a selection revokes access on the next request, and ending a turn discards its credentials. Named MCP definitions can use separate accounts and profile selections. Local stdio MCPs execute on the machine; server-specific local sign-in is not presented as hub-owned sign-in.

## Skills have immutable source snapshots

Adding a Git source imports its SKILL.md files as optional skills. A source snapshot records an exact commit. Previewing an update fetches another snapshot without changing enabled content. Applying an update or returning to an earlier revision changes subsequent turns and preserves each existing skill's selections. Snapshots are retained so running turns keep their files and previous revisions remain available.

Enabling a synced skill makes its name, description, SKILL.md path and revision available in harness instructions. Relative references resolve against the snapshot's folder. Copying a skill into a project's `.agents/skills` creates independent project-owned files and refuses to overwrite an existing skill. Those files are subsequently edited and synced through the project's Git repository. Source skills containing symbolic links cannot be enabled or copied. Conflicting names among enabled source skills are reported explicitly.

Each turn records the resolved tool versions, skill revisions and MCP names in its transcript. Changes take effect when a turn starts, with per-turn configuration passed to both harnesses, rather than rewriting shared profile configuration while another thread is running.

## Current machine boundary

Accio v0.1 still runs the hub inside one machine's server. Pairing, remote execution, transport of skill snapshots to another machine, and fleet reconciliation are not implemented by this change. The settings use shared scopes and per-machine reports, while unsupported remote actions remain explicit. These features must be connected to the future pairing/relay transport before claiming a newly paired remote machine provisions itself.

The concurrent remote-hub work introduces a standalone service, named hub connections and per-hub machine workspaces. Integration must put `Resources` and `McpGateway` in that service, route resource definitions and credential operations through its authenticated client, and keep `ManagedTools` and repair threads on the executing machine. Git snapshots need an authenticated transfer to each machine rather than passing the hub's absolute paths to a remote harness. Resource events and caches must be bound to the selected hub, and OAuth callbacks must use the remote hub's supported browser relay. Until that integration lands, a deployed remote hub does not receive this feature just by merging its settings UI.
