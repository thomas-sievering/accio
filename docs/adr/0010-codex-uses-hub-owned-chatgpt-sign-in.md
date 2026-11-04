# Codex uses hub-owned ChatGPT sign-in and a profile-scoped model proxy

Codex is bundled at a pinned version in `packages/codex`. Both the hub and the machine use its documented stdio app-server protocol. The hub uses only account and model methods; it never starts a thread or turn (ADR 0009). The machine uses thread/start, thread/resume, turn/start and turn/interrupt, and maps Codex item notifications into accio's transcript.

Each named ChatGPT account originally signed in through app-server's `chatgptDeviceCode` flow; since ADR 0014 sign-in finishes automatically through the browser callback, and the rest of this section describes the device-code variant. accio shows the verification page and user code, then checks completion. This works without a localhost callback on the computer hosting the hub. Users may need to enable device-code login in ChatGPT security settings or workspace permissions. Cancellation, expiration, sign-out and deletion close the pending app-server and remove its credential folder.

The hub gives each sign-in attempt a fresh Codex home under `hub/codex/<credential-id>`. Codex manages OAuth and refreshes the file credentials there. Only a completed sign-in publishes the credential id, email, plan and model catalog into the existing hub account store. Reauthentication preserves the previous account until the new one succeeds. Old Claude accounts without a provider id still mean Anthropic, and their profile selections remain intact.

Profiles can select one account per provider. The existing `accountId` continues to select Claude; `openaiAccountId` selects ChatGPT. A profile key can reach only those selected accounts, and changing one provider's selection leaves the other alone.

## Execution and credentials

Each profile's Codex threads run with `CODEX_HOME` under `profiles/<id>/codex`. Inherited provider credentials and Codex settings variables are removed. CLI configuration overrides select an accio model provider whose Responses API endpoint is the hub's `/openai` route. Codex gets only the profile key, never ChatGPT access or refresh tokens. The hub replaces authorization and account headers, forwards HTTP Responses and compaction requests, and refreshes once on a 401. WebSockets are disabled for this provider so traffic always passes through the hub's HTTP proxy.

This preserves ADR 0002 without copying provider tokens to each machine or using the experimental external-token login mode. Configuration and profile keys do not sandbox filesystem access (ADR 0005).

Codex's model catalog is captured at account sign-in, including its reported default. Signing in again refreshes the catalog. Existing threads retain their harness and session id; model changes within Codex resume that session. Harness handoffs remain future work.

## Sources

- [Codex app-server protocol, authentication and events](https://developers.openai.com/codex/app-server/)
- [Codex authentication and credential storage](https://developers.openai.com/codex/auth/)
