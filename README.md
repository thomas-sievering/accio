# accio

Runs coding threads in Claude Code and Codex on your own machines, keeping each profile, such as work and personal, apart. Terms are in [GLOSSARY.md](GLOSSARY.md), decisions in [docs/adr](docs/adr).

## v0.1

One machine, with the Claude Agent SDK and a bundled Codex app-server.

- **Accounts** are named and signed in separately under Settings / Accounts. Claude uses a consent page and a code pasted back into accio. ChatGPT uses Codex's device-code flow: open the page, enter the displayed code, and accio detects completion. Device-code login must be enabled in your ChatGPT security settings or workspace permissions. Credentials stay on the **hub** (`apps/hub`, ADR 0007 and ADR 0010), which gives each profile its own key and forwards model requests to the selected provider.
- **Profiles** (personal, work, any you add) select one named Claude account and one named ChatGPT account independently. Multiple profiles can select the same account. Each profile has its own Claude config folder at `~/.accio/profiles/<id>/claude` and Codex home at `~/.accio/profiles/<id>/codex`; accio never configures your regular `~/.claude` or `~/.codex`. These are configuration and credential-routing boundaries, not OS sandboxes: harnesses have full permissions.
- **Projects** are folders on this machine, matched by git remote. Each belongs to one profile; the profile folders suggest it.
- **Threads** stream the harness's reply and keep their profile for life. **Stop** interrupts a turn; a turn cut off by Stop or by accio restarting waits for **Resume**.
- **Models** come from the selected profile's signed-in providers. Codex's available models are discovered at ChatGPT sign-in; its default follows that account's reported default. A profile with only ChatGPT signed in starts Codex threads automatically. An existing thread can change models within its harness; changing harnesses requires a new thread.

To use Codex: **Settings / Accounts / Add ChatGPT account**, name it, then **Sign in with ChatGPT**. Select that account under **Settings / Profiles**, then choose **OpenAI / Codex** in a new thread's model picker. Codex is bundled; no global CLI installation or API key is required.

## Run

accio uses pnpm (pinned in `package.json`; `corepack enable pnpm` provides it).

```sh
pnpm install
pnpm start         # build, then open the desktop app (starts this machine's server)
pnpm server        # server only; open the printed http://127.0.0.1:47321/#token=… link in a browser
pnpm test          # vitest
pnpm typecheck
```

State lives in `~/.accio` (`ACCIO_HOME` overrides it; `ACCIO_PORT` and `ACCIO_HUB_PORT` the ports, default 47321 and 47322). Named accounts, Claude credentials, ChatGPT account metadata and profile selections are in `~/.accio/hub/profiles.json`; Codex stores ChatGPT credentials under `~/.accio/hub/codex/<credential-id>/auth.json`. Shared profile names, machine folders and model favorites are in `~/.accio/hub/settings.json`. Both JSON stores use the shared atomic writer in `packages/persistence`. State from before the Account → Profile rename moves to the new names on first start.

## Layout

Code is grouped by domain, one vertical slice each: `machine`, `profiles`, `projects`, `threads`.

- `packages/protocol`: client–server messages (zod).
- `packages/codex`: pinned Codex executable, isolated environment and stdio app-server client, shared by hub authentication and machine execution.
- `apps/hub`: the hub: Claude and ChatGPT sign-in, token refresh, and the proxy threads call. Runs inside this machine's server in v0.1; later it runs alone, always on (ADR 0001).
- `apps/server`: Node server. Pure domain rules sit next to their infrastructure (`profile.ts` and `profiles.ts`, `project.ts` and `git.ts`, `thread.ts`/`transcript.ts` and `claudeCode.ts`).
- `apps/web`: React client, plain web.
- `apps/desktop`: Electron shell that starts the local server.
