# Thread relay

Status: slices 1 and 2 implemented, 2026-11-04 (`apps/worker/src/relay`, `apps/hub/src/relayClient.ts`, the hub's `/relay` socket). Implements **Relay** from the [glossary](../../GLOSSARY.md) within [ADR 0001](../adr/0001-machines-connect-outbound-to-the-hub.md) and [ADR 0009](../adr/0009-the-hub-never-runs-threads.md).

## Problem

Each client shows only the threads of the worker that serves it. With the Windows PC and the MacBook paired to the same hub, each sees its own projects and threads and nothing of the other. A thread started on the MacBook can't be read, steered or shipped from the PC, and the PC can't start a thread in the MacBook's checkout. `threads.start` already takes a `machineId` and `MachinePicker` exists, but the worker refuses other machines ("Running threads on another machine is not available yet").

## Decision

Relay, not sync. A thread stays on the worker that runs it, and nothing is copied. Other machines read and drive it through the hub, which only forwards messages and stores nothing.

```
PC client ──ws──► PC worker ──relay ws──► hub ──relay ws──► MacBook worker (owns the thread)
                     ▲                                          │
                     └──────── events (threads.changed, thread.item, thread.delta) ◄─┘
```

- **Path.** The client keeps talking only to its own worker, as now. The worker merges other machines' threads into what it returns and forwards calls for them. The envelope addresses machines, not workers, so a future hub-direct client (iOS, standalone web) can use the same messages.
- **Hub.** Adds a `/relay` WebSocket per paired machine, next to `/events`. It authenticates the sender, stamps `from` with the authenticated machine id, forwards to the target machine's socket and drops the message if that machine is offline. It never parses thread content or persists it. Revoking a machine closes its relay socket as well.
- **Envelope.** `{ to, from, id, method, params }` for requests, `{ to, from, id, ok, result | error }` for responses, `{ from, event, data }` for events. One size limit per frame. Large results (transcripts, assets) are paged or chunked, never sent in one frame.
- **Owner.** `ThreadView` and `CheckoutView` get `machineId`. Thread ids are already UUIDs, so they stay unique across machines. The viewing worker keeps a `threadId → machineId` map from the merged lists and routes each thread-scoped call by it.
- **Allowlist.** A remote machine may call only the methods the receiving worker exposes for relay: thread reads and actions, `projects.get`, and project and app reads. Never `hubs.*`, `secrets.*`, pairing or machine settings. Shared settings already go through the hub.
- **Subscriptions.** Lists (`threads.changed`, `projects.changed`) are pushed to every connected machine. Transcript streams (`thread.item`, `thread.delta`) are pushed only to machines that sent `threads.observe` for that thread, until they unobserve or disconnect, so that deltas don't go to every machine.
- **Projects.** A project is already recognised across machines by its remote URL (ADR 0008). The merged `projects.get` shows each project once, with checkouts from every connected machine. Starting a thread on a project picks a machine that has a checkout, defaulting to this one.

## Trust

A paired machine can now run full-permission turns on every other paired machine (ADR 0005). ADR 0001 already planned this, and pairing remains the boundary: an unpaired machine, such as the work VM, gets nothing. Profiles stay credential boundaries. The owning worker gets model keys for its own threads, and a relayed call never carries keys or secrets.

## Implemented

- A machine publishes a `relay.snapshot` (its threads and projects, ordered by `{ boot, seq }`) to every machine on the relay on each change, and answers one for every machine that joins. The viewing worker caches the last snapshot per machine in `relay-cache.json`.
- A forwarded `threads.observe` registers the caller as an observer before the snapshot is read, as a local client does. The owner streams `thread.item` and `thread.delta` to at most 16 observed threads per machine. When the owner reconnects, the viewer emits `thread.resync` so the open transcript observes again.
- Frames over 256 KB are split into chunks; the hub caps one WebSocket message at 1 MiB.
- This design takes from T3 Code: the remote thread is paired with its owning machine, the forwarded methods are a typed allowlist, a cursor dedupes events against the snapshot, and reconnects back off with jitter. Unlike T3 Code, where clients connect to each environment directly, accio's hub carries the traffic (ADR 0001).
- `node --import tsx scripts/relay-test-server.ts` starts a hub, a "MacBook" with a scripted harness and a "PC" serving the web client, and prints the PC's URL.

## Slices

Each slice is usable on the PC and the MacBook on their own, and each is verified with two workers on one hub (`pnpm try` plus a second home).

1. **See them.** Hub `/relay` socket, worker relay client, merged `threads.list` with machine labels and a machine filter in the sidebar, and the cached greyed list for offline machines. Opening a remote thread shows its transcript live (`threads.observe` and streamed events). Read-only.
2. **Drive them.** Forward the thread actions: send, steering, queued messages, stop, resume, retry, snooze, settle, rename, model and goal. Ship and Prepare for review are worker-side work, so they forward too.
3. **Start them.** Merged projects with each machine's checkouts. `MachinePicker` offers connected machines with a checkout of the chosen project, and No project threads offer any connected machine.
4. **Media.** Images, attachments and `threads.assetUrl`/`fileUrl` across the relay, through a hub-forwarded HTTP stream rather than WebSocket frames.
5. **The rest.** Secret requests, choices, project apps and dashboards, the Changelog across machines, and **Open app** for owned previews on another machine, which needs port forwarding.

## Decided

- **Cross prompt** means driving a thread on another machine and starting new threads there. One thread working across several machines is out of scope.
- **Offline machines.** The viewing worker caches each machine's last thread list and shows those threads greyed and read-only, marked as offline. Transcripts open only while the owning machine is connected; they are never cached elsewhere.
- **Sidebar.** One list, with Inbox and Working as now. Remote threads carry a small machine label, and the sidebar can filter by machine.
- **Rollout.** Additive. Machines report a `relay` capability in `machine.hello`, and the hub protocol stays at 1. A machine without it simply doesn't appear as a relay target.
