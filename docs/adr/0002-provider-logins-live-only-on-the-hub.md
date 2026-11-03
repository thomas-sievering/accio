# Provider logins live only on the hub, on the home machine

Agents never use a provider login stored on the machine they run on. Each account reaches its provider through its own hub proxy, and the hub (CLIProxyAPI, see `S:\cliproxy-hub`) moves from the media server to the home machine, so one internet-reachable machine is both hub and connector. Machines hold only each account's hub address and access key, which lets every machine run every account without logging in again, and keeps each job account's login in a proxy of its own.

## Consequences

There is no fallback: when the hub is down, no thread can run. If the home machine is the VPS, subscription traffic leaves from a datacenter IP rather than a home connection.
