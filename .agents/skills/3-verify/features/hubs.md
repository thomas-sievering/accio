# Hubs

Run `node .agents/skills/3-verify/scripts/verify.mjs .agents/skills/3-verify/scripts/hubs.mjs` after building. The journey owns an additional standalone hub and pairs it through Settings / Hubs using its initial code. Both services and all state are disposable.

Mapped entry points:

- `hubs/pair`: Settings / Hubs → Hub name, Hub address, Pairing code → Connect hub. Require the independent hub's onboarding and identity. Reusing a code or pairing the same saved hub must fail.
- `hubs/first-run`: Set up accio → radio `Remote hub` → `Continue` → Hub address and Pairing code (named after its host) → `Connect hub`. `Back` returns to the local/remote question. Joining a hub with a signed-in profile must skip to the project question.
- `hubs/switch`: sidebar Hub combobox and Settings / Hubs selector or Use hub. Switching restores that hub's own profiles, accounts, projects and threads without pairing again.
- `hubs/windows`: two windows select different hubs independently. Reload preserves each window's selection. Matching profile names and IDs must not mix accounts, local settings or events.
- `hubs/offline`: stop only the journey's additional hub. Require Offline for that saved connection and normal access to the other hub. Restart with the same state; require reconnection without repeating a mutation or turn.
- `hubs/running`: with a provider or explicit harness fixture, switch during a turn. Require a running indicator on its original hub, no thread on the other hub, and completion/resume on the original profile and session.
- `hubs/pair-device`: Generate pairing code on a connected hub, then pair a second isolated machine. Require shared account/profile metadata and independent machine keys. Keep the code private.
- `hubs/revoke`: revoke a paired machine through `hubs.revokeMachine`. Require its control socket to close and old model keys to fail while another machine and the revoked machine's other hub still work. Revocation currently has an RPC entry point; do not claim a UI button.
- `hubs/remove`: Remove an inactive saved connection and require its disappearance. Running work or a pending sign-in must prevent removal. Removing local connection metadata does not delete its local work.

The committed journey covers pairing, separate metadata, both-window selection and reload. The network and ownership tests cover additional trust and running-work boundaries; they are not real-provider proof. Browser sign-in and streamed turns through Cloudflare require the account preconditions in [Accounts](accounts.md). Record each unexercised entry as unverified rather than expanding the journey's coverage claim.
