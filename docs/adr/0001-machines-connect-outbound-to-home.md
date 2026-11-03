# Machines and clients connect outbound to the home machine

Every machine runs its own accio server, and every machine and client connects outbound over HTTPS (port 443) to the home machine, a VPS reachable by domain, which passes traffic between them. Some networks block Tailscale, but almost none block outbound HTTPS, so nothing in accio requires Tailscale.

## Considered Options

- **Tailscale between all machines**: simplest to build, but fails on networks that block it.
- **Direct over Tailscale with the home machine as fallback**: lower latency, but two paths to build and debug. Can be added later.

## Consequences

The home machine is a single point of failure for anything between machines, and it is reachable from the internet while it can start agents with full permissions. It therefore requires HTTPS, a revocable token for every paired machine and client, no anonymous access, and pairing only through a one-time code shown on an already-trusted machine. The machine built into the desktop app keeps working locally while the home machine is down.
