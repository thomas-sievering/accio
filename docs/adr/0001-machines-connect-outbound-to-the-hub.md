# Machines and clients connect outbound to the hub

Every machine runs its own accio server, and every machine and client connects outbound over HTTPS (port 443) to the hub, which is reachable by domain and relays traffic between them. Which computer runs the hub is still open: the VPS (already public, isolated from the home network) or the media server (residential IP, but needs a way to be reachable from outside without Tailscale). Some networks block Tailscale, but almost none block outbound HTTPS, so nothing in accio requires Tailscale.

Unlike T3 Connect, which only brokers and then lets clients reach each environment through its own tunnel, the hub carries the relayed traffic itself, so no machine needs to be reachable.

## Considered Options

- **Tailscale between all machines**: simplest to build, but fails on networks that block it.
- **Direct over Tailscale with the hub as fallback**: lower latency, but two paths to build and debug. Can be added later.

## Consequences

The hub is a single point of failure for anything between machines, and it is reachable from the internet while it can start threads with full permissions. It therefore requires HTTPS, a revocable credential for every paired machine and client, no anonymous access, and pairing only through a one-time code shown on an already-trusted machine. The machine built into the desktop app keeps working locally while the hub is down, except that its threads cannot reach any account (ADR 0002).
