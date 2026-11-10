---
status: superseded by ADR 0018
---

> Superseded: accounts now live in the Sorting Hat, a separate service; threads get hat keys bound to a house and a machine (ADR 0018).

# Accounts live only on the hub

Threads never use a provider login stored on the machine they run on. Each profile reaches its accounts only through the hub (see ADR 0001 for which computer runs it). Machines hold only the hub's address and their pairing credential, which lets every machine run every profile without signing in again.

The pairing credential stays inside the machine's accio worker. A thread instead gets a key bound to one machine and one profile that allows model requests and nothing else, because threads run with full permissions (ADR 0005) and anything in their environment can leak. The key tells the hub which profile's accounts to use; unpairing a machine revokes its keys. v0.1 still issues one key per profile, shared by all machines.

## Considered Options

- **One credential per machine, profile named in each request**: simplest, but every thread would hold a credential that can also drive other machines through the relay.
- **One key per profile, shared by all machines** (v0.1): the key alone names the profile, but a single machine cannot be revoked.

## Consequences

There is no fallback: when the hub is down, no thread can run. If the hub runs on the VPS, subscription traffic leaves from a datacenter IP rather than a home connection. A key does not keep one profile's threads from reading another profile's key on the same machine; the boundary between profiles is that each key reaches only its own profile's accounts.
