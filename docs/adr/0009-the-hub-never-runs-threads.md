# The hub never runs threads

The hub stores, forwards and relays: profiles, accounts, shared settings, the proxy that threads' requests go through, and messages between machines and clients. It never runs a harness, a thread or a turn, and it has no checkouts. Threads run only on machines, that is, wherever an accio server runs: inside the desktop app, or headless with `pnpm server` on a computer nobody sits at. A computer that should run threads and also host the hub, such as the VPS, runs both: the hub and a headless accio server, which pairs with the hub like any other machine.

## Considered Options

- **Let the hub run threads itself**: one process less on an always-on computer. But the hub is reachable from the internet (ADR 0001) and holds every profile's accounts (ADR 0002). A harness running there with full permissions (ADR 0005) would sit next to all of those tokens, outside any one profile's boundary.

## Consequences

- The hub's code (`apps/hub`) does not depend on harnesses, threads or checkouts. Anything that runs a turn belongs in `apps/server`.
- Running threads on an always-on computer means pairing a headless accio server there as a machine. It is not a feature of the hub.
- In v0.1 the hub runs inside this machine's server process (ADR 0007). That is only where it is hosted for now: the hub's part still runs no threads, and splitting it out later changes nothing for threads.
