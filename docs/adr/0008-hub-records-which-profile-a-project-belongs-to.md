# The hub records which profile a project belongs to

The hub keeps the link from each project to its profile, keyed by the project's git remote URL, and hands it out with the other shared settings (ADR 0004). You choose the profile once, when the project is first added on any machine. Every other machine that later has a checkout of that remote picks the profile up from the hub and does not ask again. We rejected a `.accio` file in the repository. Committed, it would put a stray file in employers' repositories and let a repository's own contents decide which profile runs on it, which could cross the boundary between profiles. Gitignored, it would not travel between machines, so it would do no better than a per-machine record.

## Consequences

A project without a git remote has no key the hub can share, so its profile stays on the one machine that has it. Adding a checkout needs the hub to be reachable, or its settings at least last synced, before accio knows the project's profile. A project's profile can change only while it has no threads, since a thread keeps its profile for life.
