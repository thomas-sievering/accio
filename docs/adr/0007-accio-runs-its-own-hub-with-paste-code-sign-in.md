---
status: accepted
---

# accio runs its own hub, and you sign in with Claude inside accio

The hub is part of accio (`apps/hub`), not CLIProxyAPI. You add an account and press **Sign in with Claude**. accio opens Claude's consent page, and you paste the code Anthropic's page shows back into accio. This is the OAuth PKCE flow with Claude Code's public client ID, as pi and CLIProxyAPI use it. The redirect goes to Anthropic's hosted code page, not a local port, so sign-in works wherever the hub runs. The hub stores and refreshes each account's tokens. It gives each account its own address and access key, and accio writes those into the account's config folder, so nobody types a hub URL or key. Typing hub addresses and keys by hand, and running CLIProxyAPI's login over an SSH tunnel, was the UX this replaces.

## Considered Options

- **Log in per machine with `claude auth login`, as T3 does**: uses only the official CLI, but every machine would hold every account's login, including job logins. That breaks ADR 0002 and "install, pair, done".
- **Wrap `claude auth login` or `claude setup-token` in the background and show its URL and a paste box**: avoids our own OAuth code, but depends on scraping the CLI's terminal output.
- **Keep CLIProxyAPI**: works today, but its login needs an SSH tunnel and a separate proxy process per job account, and accio can't drive it.

## Consequences

- One hub process serves every account, but each access key is bound to exactly one stored login. A job account's traffic therefore never shares a login or key with another account; ADR 0002's separate proxy per job account is no longer needed.
- Agents are still the real Claude Code, through the Agent SDK. The hub only swaps the access key for the account's OAuth token, so nothing has to imitate Claude Code. Using Claude Code's client ID outside Claude Code is still unofficial, and Anthropic could change or restrict it; the account and terms-of-service risk noted in `S:\cliproxy-hub` still applies.
- Codex and other providers will get their own sign-in flows in the hub later. Until then, the CLIProxyAPI hub keeps serving them.
