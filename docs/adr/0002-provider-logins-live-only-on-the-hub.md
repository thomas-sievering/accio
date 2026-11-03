# Provider logins live only on the hub, on the home machine

Agents never use a provider login stored on the machine they run on. Each profile reaches its accounts only through the hub, which runs on the home machine (see ADR 0001 for which computer that is), so one internet-reachable machine is both hub and connector. Machines hold only each profile's hub address and access key, which lets every machine run every profile without signing in again, and keeps each profile's accounts apart from every other profile's (ADR 0007: an access key unlocks only its own profile's accounts).

## Consequences

There is no fallback: when the hub is down, no thread can run. If the home machine is the VPS, subscription traffic leaves from a datacenter IP rather than a home connection.
