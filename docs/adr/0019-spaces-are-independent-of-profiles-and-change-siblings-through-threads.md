# Spaces are independent of profiles, and change sibling projects through threads

Accepted design direction on 2026-11-14.

A space groups projects that share context, such as "hrc" or "Copilot Studio agents", and can have a home: one of its projects, holding what applies to the whole space. A space is not tied to a profile. A profile decides which accounts, GitHub login, secrets and models a thread uses, while a space decides which context it gets. One subject can span both sides of your life, for example a private experiment and an hrc agent in one "agents" space. Each project keeps its own profile, so a thread in a mixed space still pushes with the right GitHub account and sees only its own profile's secrets.

A thread stays attached to one project. It reads sibling projects from their checkouts on its machine. To change a sibling, including the home, it starts a thread in that sibling. The new thread runs under the sibling's profile and ships its change on its own. Accio passes the home's AGENTS.md and the sibling list to every thread in the space through its own instructions, the same way for every harness.

## Considered options

- **Spaces inside a profile.** This is simpler, but one subject can span profiles, and a profile is also not a fixed property of the work: limits are handled by fallback accounts in a house, not by moving work between profiles.
- **One thread owning worktrees in several projects.** Coordinating a cross-repo change would be easier. But it breaks the rule that a thread belongs to one project, which Ship, profiles, secrets and Archive all rely on. A thread spanning profiles would also need several GitHub logins and secret scopes at once.
- **Joint delivery of a change across repos.** Postponed until separate shipping is actually missed.
- **The home as an MCP or hub storage instead of a repo.** That would lose history, review through Ship, and the ability to open the home in other tools. A repo is always on disk, so no read tool is needed.
- **Each harness's own instruction loading.** Claude can load CLAUDE.md from extra folders, but Codex has no equivalent for a folder outside its project. Accio's own instructions work the same for both.
