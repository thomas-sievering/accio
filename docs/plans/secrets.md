# Secrets: remaining work

Private entry, project memory, automatic reuse, Settings / Secrets, encrypted Hub storage and the Claude/Codex bridges have shipped. [ADR 0013](../adr/0013-private-secrets-and-project-memory.md) records the decisions; `tests/secret-ui.spec.ts` (`pnpm test:secrets`) drives the shipped UI with disposable markers.

## Open items

- **Remote relay.** Answering a request from another paired client, and delivery to a machine other than the one hosting the UI, depend on the general relay. File delivery must go to the requesting machine over its authenticated connection; the Hub never supplies a path on its own computer.
- **Opaque references (`secretRef`).** Offer only once a registered consumer resolves the reference inside trusted service code. Bind each grant to that consumer and operation, consume it atomically once, validate scope and expiry before reading the value, and keep values out of responses and errors. Consuming once does not mean the external side effect ran exactly once; use the operation's own idempotency where available.
- **Hub-side HTTP/MCP consumers.** The Hub authenticates the allowed request so the value never reaches the machine. The integration definition binds destination, operations and redirect behavior; never build a generic arbitrary-URL proxy. Never widen the model-only profile key into a secret-read key.
- **External vaults** (for example 1Password) can back saved entries later, resolved on the authorized service. An interactive laptop unlock is not a headless Hub strategy. Add no vault configuration page before a supported backend exists.
- **Value shapes.** Values are UTF-8, at most 16 KiB, preserved exactly. Multiline private keys, binary files and credential bundles are later work.
- **Verification gaps.** Browser coverage uses a scripted harness, and native Claude/Codex tool tests use scripted model responses; a live provider round trip is unproven. Private directory/file protection still needs checking on a supported Unix target. Use harmless markers only.

## Out of scope

Automatic credential discovery, injecting all profile secrets into harness environments, a general `get_secret` tool, browser password autofill, clipboard watching and a general password manager.

## Sources

- [T3 request tool](https://github.com/pingdotgg/t3code/blob/499727ddad87468cc22e23e5d8c92b9013f546c0/apps/server/src/mcp/toolkits/orchestrator/tools.ts), [request lifecycle and delivery](https://github.com/pingdotgg/t3code/blob/499727ddad87468cc22e23e5d8c92b9013f546c0/apps/server/src/secrets/SecretRequests.ts), [private-card copy and states](https://github.com/pingdotgg/t3code/blob/499727ddad87468cc22e23e5d8c92b9013f546c0/packages/client-runtime/src/secretRequest.ts), [filesystem secret store](https://github.com/pingdotgg/t3code/blob/499727ddad87468cc22e23e5d8c92b9013f546c0/apps/server/src/auth/ServerSecretStore.ts)
