# Independent hubs and automatic browser sign-in

The same standalone service runs locally and on the home server. Machines authenticate over HTTPS and receive snapshots plus WebSocket change notifications. Hub identity and protocol are checked before applying state. Mutations are serialized by the hub; reconnection refreshes state without replaying mutations or turns.

Each machine saves named hub connections, with independent server-only credentials and local workspaces. Each window selects a hub independently. Threads retain their hub, profile and harness session. Existing local work keeps its original paths; new hub workspaces use `hubs/<hub-id>`. An unavailable hub stays offline.

Pairing uses expiring, single-use codes. Startup or the server's `--pair` command bootstraps the first device. Trusted devices can issue subsequent codes or revoke devices. Model keys are scoped to a machine and profile and cannot invoke management methods. Revocation rejects those keys and closes control sockets. Provider credentials never leave the hub.

Claude and ChatGPT share one browser sign-in UI. A machine-local loopback receiver validates state and relays the short-lived callback to the hub that initiated it. The hub performs the token exchange. Claude retains the exact redirect URI with its PKCE verifier. ChatGPT uses the pinned app-server's `chatgpt` flow; the remote hub forwards only the validated code and state to its known loopback callback. A hub running directly on the browser's PC lets app-server receive that callback itself. Concurrent ChatGPT sign-ins are serialized because app-server uses a fixed port. Listeners close on completion, cancellation, timeout and shutdown.

This supersedes the production manual-code flow in ADR 0007 and device-code flow in ADR 0010. The account and proxy ownership decisions remain in effect. New sign-ins require Accio on the browser's computer; the public hub URL is an API endpoint with setup information, not a remote desktop UI.

The home server runs a separate non-root Docker service on the existing tunnel network. GitHub Actions verifies and publishes immutable hub images; a user systemd timer pulls the compatible `stable-v<protocol>` deployment tag. The updater holds a lock, resolves the digest, checks container health and restores the previous image on a failed start. Incompatible protocols use a different deployment tag and require a coordinated client update. Data migrations still need an explicit migration strategy.

Sources: [app-server authentication](https://developers.openai.com/codex/app-server/), plus live checks against the pinned Codex executable and each provider's browser consent flow.
