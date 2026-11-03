# Home-server hub and local development hubs

Status: implemented and manually deployed on 2026-11-03. Real state migration, browser authentication and provider streaming through Cloudflare are verified. Automatic deployment is configured; registry publication and timer activation follow the merge. Implemented decisions are in [ADR 0014](../adr/0014-independent-hubs-and-browser-sign-in.md) and operating instructions in [deploy/hub/README.md](../../deploy/hub/README.md).

## Outcome and scope

Run the everyday hub on `homeserver`, reached at `https://accio.mediatom.cc` through the existing Cloudflare Tunnel. Also support a local development hub running from this PC's source checkout, with an easy way to select either saved connection. The existing desktop continues to run threads on its own machine. Accounts, profile selections, shared settings, and model requests belong to the hub selected for that work. A second machine can pair with a hub without signing in to the providers again.

Use the same standalone hub service and connection protocol locally and remotely. Hubs are explicitly selected, independent connections. If one is unavailable, report that hub's status; do not silently move its work to another hub or use another provider login. Give both providers one automatic browser sign-in experience, with no separate manual-code fallback.

The first milestone is the existing desktop working against the home-server hub and switching to an independent local development hub without a deployment. Browser access to threads on arbitrary machines, the general thread relay, skill distribution, and MCP configuration are separate work. The public hostname initially serves the hub API; opening it is not yet a remote desktop client. This keeps moving the hub from depending on a complete multi-machine UI rewrite.

Automatic deployment follows a proven manual deployment using the same image and deployment script.

## Verified starting point

Server access is documented in `D:\workspaces\mediatom\README.md` and `AGENTS.md`. The existing `scripts/ssh.sh` helper connects as `tom` to `192.168.0.111`; the hostname is `homeserver`. Credentials remain in the gitignored file and were not printed or copied into this repository.

Read-only inspection established:

- The server is Linux x86-64 with four CPUs and sufficient current memory and disk space for the hub. Docker is installed; Node is not installed on the host, so package the runtime in an image.
- The media stack is Compose project `media_server`, with its configuration under `/home/media_server`. That directory is not directly readable by `tom`, and passwordless sudo is unavailable. A separate deployment under `/home/tom/accio` avoids editing that stack.
- Container `cloudflared` is running on Docker network `media_server_default`, has restart policy `unless-stopped`, uses a tunnel token, and has no mounted local configuration. Treat ingress as remotely managed in Cloudflare.
- Observed tunnel routes include `jellyfin.mediatom.cc` to `http://jellyfin:8096` and `request.mediatom.cc` to `http://jellyseerr:5055`.
- `accio.mediatom.cc` did not resolve at inspection time. A HEAD request to the existing Jellyfin hostname received a Cloudflare 403. This confirms reaching the edge, not the cause of that refusal or suitability of its rules for API clients.
- CLIProxyAPI also runs on the server in a separate `cliproxy-hub` project. Migrating Accio does not require changing its containers or credentials.
- Accio's GitHub repository is private, `thomas-sievering/accio`, with default branch `main`. No GitHub Actions workflows were listed.
- The Mediatom credential file has SSH credentials but no identified Cloudflare or GitHub credential. The running tunnel token is not a Cloudflare management API credential.

Accio's current implementation is local-only despite the intended architecture in ADRs 0001, 0002, 0004, and 0009:

- `apps/server/src/app.ts` creates `Hub`, `SharedSettings`, and a loopback model proxy inside each machine process.
- `apps/server/src/profiles/profiles.ts` directly calls hub objects and combines shared mutations with machine-local configuration writes.
- `apps/server/src/machine/machine.ts` records connections in the same process. Network pairing and a remote hub client do not exist.
- Model proxy keys are currently shared by all machines using a profile. They cannot revoke just one machine.
- Hub state is under `ACCIO_HOME/hub`. Projects, threads, transcripts, media, and harness session folders are on the machine.
- Anthropic uses hosted-code-page OAuth. OpenAI uses the pinned Codex app-server's device-code flow. Automatic browser callbacks have not been proved against the remote deployment.

## Target ownership

Each hub owns its named accounts and provider credentials, profiles and their account selections, shared settings, machine pairing and revocation, model catalogs, and model proxy. It has no checkouts and never starts a thread or turn. Its Codex dependency remains necessary for account sign-in and refresh, as in ADR 0010.

Each machine owns its checkouts, threads, transcripts, assets, harness sessions, and local server token. Its server stores a separate pairing credential for each saved hub and can maintain multiple authenticated hub connections. Its harnesses receive only the model key for the exact hub, machine, and profile assigned to their thread.

The desktop's existing renderer-to-local-server connection stays local in this milestone. The machine server forwards shared operations to the hub and forwards the resulting shared-state events to its clients. Provider tokens and the machine's management credential never reach a harness or renderer.

Each hub remains the authority for its shared writes. Machine-local cached views can support display and reconnect, but cannot create a second writer while disconnected. Hubs do not synchronize accounts or settings with each other.

## What machine credentials mean

Pairing authorizes an Accio machine to use a particular Accio hub. It does not log the machine into Anthropic, OpenAI, SSH, Docker, or Cloudflare. After entering a one-time code, the machine saves its hub-issued credential and normally reconnects without another prompt. Unpairing that PC revokes its access to that hub alone.

There are three distinct credentials:

- The machine's pairing credential authenticates its server to one hub for permitted account/settings operations and presence. It stays in the machine's server.
- A restricted model key lets a harness send model requests through that hub for one machine and profile. Revoking a machine also revokes its model keys.
- Provider access and refresh tokens authenticate the hub to Anthropic or OpenAI. They remain in that hub's credential store and are never handed to a paired machine or harness.

Generate and store these automatically after pairing; users do not manually manage keys. Pair once with Home server and once with Local dev, then retain those independent pairings across switches and restarts.

## Local development and hub switching

Maintain a machine-local list of named hub connections, initially `Home server` and `Local dev`. Each record has a display name, endpoint, durable hub identity learned during pairing, and its own pairing credential. A URL is an address, not the identity of the hub: changing an address must not silently attach existing work to a different hub's state.

Each client window selects its visible hub from a persistent selector. Show the selected name and connection status beside it, including a running-work indicator for other hubs. Remember the selection for that window and manage saved connections under Settings / Hubs. The machine server retains the connections needed by open clients and ongoing work; selecting another hub does not globally change another window or disconnect running work.

Bind every thread permanently to its `hubId` and profile at creation. All subsequent send, retry, resume, model access, and account lookup use that binding. Project/checkout associations are scoped to a hub as well. Existing thread records currently lack a hub ID; adding one is part of the migration, not an optional UI enhancement.

Scope profile IDs, model catalogs, events, subscriptions, account lists, drafts, remembered selections, caches, and local harness configuration by hub identity. An explicit hub context accompanies shared requests; never route a delayed request or response using whichever hub happens to be selected later. Derive thread operations from the stored thread binding and validate that it matches the client context. Use separate Claude and Codex session/configuration directories for each `(hubId, profileId)`, including when IDs happen to be identical across hubs.

Switching replaces the visible hub-scoped data and restores that hub's draft/selection without re-pairing. A turn already running through Home server continues through Home server while the window shows Local dev. Pending provider sign-ins are also bound to their initiating hub and machine. Refuse removal of a saved connection while it has running work or unfinished sign-in; simply selecting another connection remains allowed.

Provide a development command such as `pnpm dev:hub` that starts the same standalone service on loopback, watches the relevant workspace code, and uses a separate persistent state directory, for example `%LOCALAPPDATA%/accio-dev/hub`. Pair it once and retain the `Local dev` connection. Hub code changes become testable locally without a GitHub Actions run, image publication, or home-server update.

The local hub starts with its own durable hub ID and empty account/settings store. Use a separate provider sign-in there if live testing is needed; do not run a copied production token store with two concurrent refreshers. Ordinary automated tests continue to use temporary state and fake providers. Restarting the local development service should reconnect its clients without affecting Home server.

## Implementation sequence

### 1. Make the hub a standalone service

Add a runnable composition root to `apps/hub`, independent of `apps/server`. Separate the model proxy's HTTP handler from its listener so one public listener can serve health, management, and model endpoints. Persist a stable hub ID in that service's state and report it during pairing/connection setup. The loopback development command and deployed image run this same service with different endpoints and state directories.

Expose a minimal health endpoint and authenticated control methods for the existing account, profile, shared-setting, model-catalog, and machine operations. Preserve the current account view types and typed RPC contracts where practical; add an explicit internal hub protocol rather than serializing calls to arbitrary object methods.

Move shared profile validation and account-selection commits to the hub. The existing `configureProfile(...prepare)` callback cannot span two processes: commit shared state durably on the hub, then reconcile each machine's configuration from a versioned snapshot. A machine must apply the current profile configuration before starting a turn. Failure on one machine must not undo a successful shared change on the others.

Preserve existing profile/project deletion rules. Machine-held project and thread references must be registered with the hub; an offline machine's last known references still prevent deleting a profile it uses. Do not simply remove the local in-use checks when moving handlers. Moving all project storage and cross-machine project identity to the hub is outside this milestone.

Changes concentrate in `apps/hub`, `apps/server/src/app.ts`, `apps/server/src/profiles`, `apps/server/src/machine`, `apps/server/src/harnesses`, and `packages/protocol`. Add a local hub-connection registry and move the existing single-hub settings view toward named connections and per-hub status.

Done when an isolated hub can start, persist state, restart, and serve existing account/profile operations through its network boundary without loading a harness or creating machine state.

### 2. Pair the desktop with named hubs and support switching

Add a hub connection manager to the machine server. When adding a connection, the desktop asks for its name and address and uses a short-lived, single-use pairing code. Store the paired hub's identity and validate it on reconnect. A new service with empty state at a saved URL is a new hub requiring pairing, not permission to reinterpret old threads. Bootstrap the first trusted machine with a code issued through an authenticated server-side setup command; do not expose an anonymous administrator signup. Later codes are issued by an already trusted client.

Store pairing configuration separately for each hub on the machine. Issue independent, revocable model keys for each `(machine, profile)` within that hub and restrict those keys to model routes. They cannot invoke account management, mint pairing codes, or read provider credentials. Store credential hashes on the hub where a retrievable cleartext value is unnecessary.

Use outbound WSS for remote control requests, shared-state events, presence, and reconnect, and the same WebSocket protocol over loopback for Local dev. On reconnect, obtain a full current snapshot for that hub before applying incremental events; do not replay uncertain mutations automatically. Include a protocol version and report incompatibility on the affected connection without disrupting the others.

Give harnesses their thread's bound hub model-proxy address and scoped key: HTTPS for Home server and loopback HTTP for Local dev. Keep Anthropic and OpenAI model routes distinct from management routes, with the correct prefix handling for both SDKs. Preserve streaming, cancellation, refresh-on-401, and existing Codex HTTP behavior.

Replace the unconditional embedded hub startup with explicit saved connections and the separately runnable service. Local dev is a supported named connection; an unavailable hub does not cause automatic switching or implicit hub creation.

Add the client hub selector and hub-scoped contexts to `apps/web/src/app`, `apps/web/src/hub`, profiles, projects, and threads. Extend the persisted project/checkout and thread records, protocol views, and harness configuration paths with hub ownership. A mutable server-wide active-hub variable is insufficient because multiple windows and existing turns can use different hubs.

Done when two machine clients can pair with the same hub, Home server and Local dev remain independent, switching takes no new pairing or deployment, and running work stays bound to its original hub. Revoking one machine's access to one hub must leave its other hub pairing and other machines unaffected.

### 3. Prove and implement one browser sign-in flow

Target experience for Claude and ChatGPT: press Sign in, approve in the system browser, and return to a completed sign-in in Accio. No manual copying in either direction.

Use a loopback callback receiver on the machine where the system browser opens. Keep the PKCE verifier, token exchange, provider tokens, and refresh on the hub selected when the attempt started. Relay only the short-lived callback result through that machine's connection to that exact hub, even if the window has switched hubs in the meantime.

- For Claude, generate a loopback redirect in the same format Claude Code uses, retain the exact redirect URI with the pending attempt, and exchange the returned code on the hub.
- For OpenAI, prove `account/login/start` with `type: chatgpt` using the pinned Codex version. Its callback listener runs inside the hub container. The machine receives the browser callback locally and relays the result to a hub handler bound to that pending login. The hub delivers it only to that app-server's known loopback callback endpoint.
- When Local dev runs directly on the browser's PC, the app-server's own callback listener is already local: let it receive the callback directly and observe completion through the same sign-in status contract. Do not bind a competing receiver to that port. An isolated or remote hub uses the authenticated callback relay. These are transport details of the same automatic browser sign-in, with no user-selected alternative method.
- Validate state, provider, initiating hub and machine, expiration, and one-time completion. Do not offer an arbitrary URL forwarding endpoint. Do not forward token-bearing redirect responses or provider success pages back to the machine; return an Accio completion page.
- Resolve callback port conflicts and concurrent attempts across local and remote hubs explicitly, including serializing attempts if the pinned app-server requires a fixed callback port. Close receivers on completion, cancellation, timeout, and shutdown.

Implement the callback bridge in this step. Prove both providers on Local dev, then run a real sign-in for each on the isolated deployment from step 4, with the browser on the Windows machine and token exchange on the Linux home server, before the state cutover in step 5. Native CLI implementation and the [documented Codex browser flow](https://developers.openai.com/codex/app-server/) are evidence for feasibility, not proof of the complete relay with the pinned version.

Once proved, replace the two current sign-in components with one shared flow and provider adapters, and remove the device-code/manual-paste production paths. A failed attempt reports an error and offers retry through the same flow.

New provider sign-ins in this milestone require an Accio machine on the browser's computer. Signing in from a browser-only phone or an unrelated computer is not included. Existing signed-in accounts remain usable by paired machines.

If the live proof fails, resolve that constraint before committing the replacement; do not silently add another sign-in method. Hub extraction and this feasibility work can proceed before migrating real account state.

### 4. Package and deploy the hub manually

Create a Linux amd64 image with the built hub, production workspace dependencies, and the pinned Linux Codex binary. Build the hub dependency graph only; avoid installing or downloading Electron and the machine's Claude harness into the runtime. Test the final runtime image, not just a TypeScript build on Windows.

Create a separate Compose project under `/home/tom/accio` with:

- Service name/network alias `accio-hub`, an immutable image reference, healthcheck, graceful shutdown, and restart policy `unless-stopped`.
- Persistent state at `/data/configs/accio`, mounted as `ACCIO_HOME`. Provision its ownership for the container's non-root user during setup. No media directories or Docker socket are mounted into the hub.
- Membership in the existing external network `media_server_default`, so the current `cloudflared` can reach `http://accio-hub:47322`.
- No host-published public port. Keep the app-server's callback ports inside the container too.

Test the internal service before publishing it. Add `accio.mediatom.cc` to the existing tunnel's published application routes with origin `http://accio-hub:47322`; preserve all existing ingress rules. Use the Cloudflare dashboard or an appropriately scoped management credential, not the tunnel's connector token. No router or client VPN changes are needed.

Use Accio's authentication for control and model access. Configure this hostname so machine and model requests do not require an interactive Cloudflare Access login or browser challenge. Disable caching of authenticated API/model responses and validate real WSS and streamed model traffic through the edge; the existing Jellyfin route does not establish those properties.

Done when the new hostname serves the hub and accepts a paired machine through ordinary HTTPS/WSS, while existing media routes continue working.

### 5. Move state and validate the real desktop

Inventory the actual running Accio home at implementation time, including any `ACCIO_HOME` override. Do not assume the worktree is the state directory or copy all of `~/.accio` to the server.

After the new deployment and both sign-in proofs work:

1. Assign a durable hub ID to the legacy hub and bind existing projects, checkouts, threads, and saved selections to it. This ID follows the account/settings state being moved to Home server. Stop the old account writer during a controlled cutover and take a consistent protected snapshot.
2. Transfer the hub-owned state over SSH: hub identity, account/profile records, shared settings, and Codex credential directories. Preserve account, profile, credential, and machine IDs; restore restrictive file ownership and permissions. The imported account tokens must have exactly one active refresher.
3. Save and pair the Home server connection under the existing machine's original ID through the bootstrap flow. Issue its new machine/profile keys, then rewrite the hub address and keys in the configuration for that hub. Never reinterpret an unpaired claim of an existing ID as trust.
4. Keep checkout paths, projects, threads, media, and harness sessions on the original machine. Migrate existing session/configuration directories into their hub namespace without discarding their contents or saved session IDs. Add Local dev with fresh identity and separate state; no existing work is rebound merely because that connection is selected.
5. Verify existing accounts and token refresh, then perform one new sign-in per provider, a short real Claude turn, a short real Codex turn, and a resume of an existing thread.
6. After acceptance, retire the old live copy of the migrated credential store and keys securely. Any retained migration snapshot belongs to Home server's identity and remains offline recovery material. The independently created Local dev hub can keep running with its own state and sign-ins.

Tests before cutover use temporary state and fake providers. Real provider operations belong to the deliberate integration checks, not general CI.

### 6. Add automatic deployment after manual acceptance

Use the same deployment script for manual and automatic Home server updates. Local dev runs directly from the checkout and is independent of this pipeline. Selecting a hub does not trigger a deployment. Do not expose SSH publicly or run arbitrary GitHub jobs on the media server.

Add GitHub Actions on successful changes to `main`: run the relevant tests and typecheck/build checks, build the Linux hub image, then publish it to GHCR with an immutable commit tag and recorded digest. Advance the deployment tag only after those checks pass. Source changes that do not affect the hub image need not redeploy it.

Run a small scheduled pull on the home server. It reaches GHCR outbound, resolves the published deployment digest, and updates only the `accio-hub` service when that digest changes. Use one deployment lock, check health afterward, and retain the previous image reference for a failed release. Never rebuild source on the home server or restart the media Compose project.

Because the repository is private, verify package visibility and supply a read-only registry credential through protected storage if needed. Configure credentials during implementation without printing them or putting them in Git. Select the server's timer mechanism during initial provisioning; it must keep working after SSH logout and reboot.

Version the hub protocol and allow the currently installed desktop to keep working across compatible hub updates. An incompatible release must not deploy automatically ahead of the required desktop update. Handle state format changes deliberately; changing an image reference must not assume it can undo a data migration.

Done when a subsequent verified hub change deploys without an open SSH session, preserves accounts and pairings, and existing machines reconnect without repeating or duplicating turns.

## Validation required before calling the move complete

- The production image starts on Linux amd64, loads its mounted state, uses Codex account methods successfully, and never starts a thread or turn.
- Anonymous management and model requests fail. Pairing codes expire and cannot be reused; revocation closes existing control sessions and rejects old model keys.
- A model key cannot use management methods or reach another profile. A harness receives neither provider tokens nor the machine's pairing credential.
- Pair Home server and Local dev once, restart the app, and switch repeatedly without re-pairing or waiting for a deployment. Stop Local dev and verify only that saved connection reports unavailable.
- Create matching profile IDs in two independent hub stores. Verify account changes, keys, project assignments, model catalogs, UI selections, events, and harness session paths remain isolated by hub identity.
- Switch hubs while a turn, delayed RPC, or sign-in is pending. The turn and callback stay on the original hub, and late replies do not populate the newly selected hub's UI. Two windows can select different hubs without interfering.
- Resume a migrated legacy thread after switching away and back. It retains its original hub, profile, session ID, transcript, and media. A new hub at an old endpoint cannot inherit that binding by URL alone.
- Two paired machine processes share account/profile changes. A disconnection and reconnect applies the latest snapshot without losing or duplicating events or repeating a mutation.
- Shared profile updates survive a machine failing to write local configuration. That machine cannot start a turn with stale configuration. Profile deletion still respects known references on offline machines.
- Both providers complete the automatic browser flow across Windows-to-Linux and the real tunnel. State mismatch, wrong machine, replay, timeout, cancellation, callback port conflicts, and a hub restart during sign-in have clear outcomes.
- Existing Claude and Codex accounts, model selection, streaming, stop, and resume work with the remote proxy. Provider tokens refresh after restart without another sign-in.
- Loss of a hub reports that connection's unavailability and does not move its work to another hub or provider login. Loss of a control connection does not automatically replay a user message or restart a turn.
- A full hub-container restart preserves state, reconnects the desktop, and leaves Jellyfin and the existing proxy projects running.
- A machine outside the home network reaches the new hostname without Tailscale. Test the real control/model requests, not only DNS or a health GET.
- Run `pnpm test`, `pnpm typecheck`, the relevant package builds, and the existing desktop/chat checks when their integration changes. Add focused tests for the new network and credential boundaries rather than duplicating existing model behavior tests.

## Remaining inputs for implementation

These are bounded setup tasks, not reasons to add a second architecture:

- Obtain access to the existing Cloudflare tunnel's route editor, and inspect rules that would affect `accio.mediatom.cc`.
- Identify the currently active Accio state home and its exact cutover contents without exposing credentials.
- Verify the pinned Codex browser-flow callback behavior and complete both live provider proofs.
- Provision the new state directory and deployment scheduling permissions; `tom` currently has no passwordless sudo.
- Decide GHCR package access and provision the minimum deployment credential after the manual release works.

Document the implemented decision in a new ADR, update the affected glossary/README descriptions, and record the deployment procedure in the Mediatom workspace when implementation is complete. This plan does not change the original media-server operating rules.

## Rollout evidence

The production hub retains its durable identity through container restarts. The existing Windows machine kept both profiles, all four signed-in provider accounts and four threads, including continuation of an original Claude session. All four accounts returned live limits. Claude and ChatGPT completed automatic browser callbacks and streamed real turns through the public tunnel. The updated desktop runs against Home server; Local dev has a separate saved pairing and starts with `pnpm dev:hub`.

Tests cover shared resources and MCP credentials/grants, account limits, and scoped saved-secret delivery across the standalone service. Saved-secret metadata is cached per hub; encrypted values remain on the hub and authorized temporary files stay on the machine. A persistent headless encryption key is provisioned separately from the state volume. The deterministic secrets UI journey covers save, reuse, replacement, access, deletion, use once and decline with disposable values. Live provider proofs and migration use protected local evidence under `out`; credentials and pairing material are excluded from Git.
