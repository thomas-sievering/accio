---
status: superseded by ADR 0014
---

> Superseded: sign-in now finishes automatically through a browser callback (ADR 0014); the paste-code step is gone. Accio still runs its own hub.

# accio runs its own hub, and you sign in with Claude inside accio

The hub is part of accio (`apps/hub`), not CLIProxyAPI. You add a profile and press **Sign in with Claude**, which adds an account to it. accio opens Claude's consent page, and you paste the code Anthropic's page shows back into accio. This is the OAuth PKCE flow with Claude Code's public client ID, as pi and CLIProxyAPI use it. The redirect goes to Anthropic's hosted code page, not a local port, so sign-in works wherever the hub runs. The hub stores and refreshes each account's tokens. accio writes the hub's address and the thread's key (ADR 0002) into the profile's config folder, so nobody types a hub URL or key. Typing hub addresses and keys by hand, and running CLIProxyAPI's login over an SSH tunnel, was the UX this replaces.

## Considered Options

- **Log in per machine with `claude auth login`, as T3 does**: uses only the official CLI, but every machine would hold every profile's accounts, including work ones. That breaks ADR 0002 and "install, pair, done".
- **Wrap `claude auth login` or `claude setup-token` in the background and show its URL and a paste box**: avoids our own OAuth code, but depends on scraping the CLI's terminal output.
- **Keep CLIProxyAPI**: works today, but its login needs an SSH tunnel and a separate proxy process for each profile that must stay apart, and accio can't drive it.

## Consequences

- One hub process serves every profile, but each key is bound to exactly one profile's accounts. A profile's traffic therefore never reaches another profile's account, and no profile needs a separate proxy. Picking among a profile's accounts at one provider, which `S:\cliproxy-hub`'s `reset-priority` sidecar does today, moves into the hub too.
- Threads still run the real Claude Code, through the Agent SDK. The hub only swaps the key for one of the profile's OAuth tokens, so nothing has to imitate Claude Code. Using Claude Code's client ID outside Claude Code is still unofficial, and Anthropic could change or restrict it; the account and terms-of-service risk noted in `S:\cliproxy-hub` still applies.
- Codex got its own sign-in flow in the hub (ADR 0010).
