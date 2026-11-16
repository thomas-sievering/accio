# CLIs are listed to threads and turned on at the skill levels

Accepted design direction on 2026-11-15.

A CLI is a command-line program, such as agent-desktop, that Accio installs on every machine at a pinned version. Until now Accio put managed CLIs on the PATH but never told the model about them, so threads answered "I can't control the desktop" while the program was installed. Each turn now lists the CLIs it gets in its instructions, next to the skills: the name, a one-line description (taken from the package by default and editable), and an instruction to run `<cli> --help` before using it. The list is part of the instructions Accio rebuilds for every turn, not a message in the history, so it takes up context once.

Because the list costs context, CLIs get the four levels skills have (ADR 0020): Everywhere, Profile, Space and Project. This brings back the scoping that ADR 0012 removed, back when a CLI cost nothing beyond a PATH entry. Selections are stored on the hub, including Space selections. A repository never makes machines install anything. When levels pin different versions of one CLI, the narrowest wins and the other is shown as overridden.

Only Accio's own copy counts. A program you installed on a machine yourself is not listed until you add it, for the same reason ADR 0020 has no machine level: a thread must get the same CLIs on every machine. Each machine installs every CLI once under its Accio home with pnpm, shared by all its worktrees, and allows the package's install scripts, since you chose the package and threads already run with full permissions (ADR 0005). Every online machine starts installing a new or changed CLI immediately, and an offline one does so when it reconnects.

A thread can add a CLI through the `add_cli` accio tool, which saves it, installs and checks it on the thread's machine, and returns the result. It may choose the thread's own project, space or profile. Everywhere asks you first, because it reaches your other profiles. Only Settings removes a CLI or changes its levels.

A CLI that fails its check no longer blocks turns. The turn starts without it, and its list says that the CLI is unavailable on this machine, why, and that a repair thread is running.

This amends ADR 0012 for tools. MCP servers keep a single global level for now. Giving them levels and per-profile accounts is a separate decision.

## Considered Options

- **Keep CLIs global and unlisted, and rely on skills to mention them**: no new levels, but most CLIs have no skill, and a skill can be on where its CLI is not.
- **Tell the thread once, at its start**: less repetition, but a CLI turned on mid-thread, a resumed session or a handoff to another harness would miss it. The instructions are rebuilt per turn anyway.
- **Use the machine's own global installs**: nothing to add, but threads would behave differently per machine, and remote and handed-off threads would break.
- **A CLI manifest in the space's home repository**: history and review through Ship, but a commit could make every machine install a package.
- **npm**: what Accio used first, but pnpm's shared store keeps versions from duplicating files, and pnpm is already on every machine that runs Accio.
