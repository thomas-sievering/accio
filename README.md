# accio

Runs coding threads in harnesses (Claude Code first) on your own machines, keeping each profile, such as work and personal, strictly apart. Terms are in [GLOSSARY.md](GLOSSARY.md), decisions in [docs/adr](docs/adr).

## v0.1

One machine, Claude only, through the Claude Agent SDK.

- **Accounts** are named and signed in separately under Settings / Accounts: approve on Claude's page, paste back the code. The account stays on the **hub** (`apps/hub`, ADR 0007), which gives each profile its own key and forwards its threads' requests to Anthropic. **Profiles** (personal, work, any you add) select an account by its custom name. Multiple profiles can select the same account. For now a profile selects one Claude account. accio writes each profile's Claude config folder under `~/.accio/profiles/<id>/claude` and never touches `~/.claude`.
- **Projects** are folders on this machine, matched by git remote. Each belongs to one profile; the profile folders suggest it.
- **Threads** stream the harness's reply and keep their profile for life. **Stop** interrupts a turn; a turn cut off by Stop or by accio restarting waits for **Resume**.

Chat shows expandable tool inputs and results, images, video/audio players and current-file download links. Successful tool calls start collapsed; failures open automatically. Tool-result images stay inside the tool details unless the assistant embeds them in its reply.

Local media embedded by the assistant is copied into the thread's storage when its message arrives. Editing or deleting the source does not change that saved media. Ordinary file links download the current file; remote media remains hosted at its original URL. Missing or unsupported media shows an explanation. Inline snapshots support PNG, JPEG, GIF, WebP, AVIF and common video/audio formats; SVG is not accepted as an inline snapshot. Limits are 10 MiB per image, 100 MiB per video/audio/file download, 64 result parts per tool/message, 1,000,000 saved result text characters and 100,000 saved input characters per tool. Exceeded limits are shown explicitly. Older transcripts keep their saved text; discarded historical input and image bytes cannot be recovered.

## Run

accio uses pnpm (pinned in `package.json`; `corepack enable pnpm` provides it).

```sh
pnpm install
pnpm start         # build, then open the desktop app (starts this machine's server)
pnpm server        # server only; open the printed http://127.0.0.1:47321/#token=… link in a browser
pnpm test          # vitest
pnpm typecheck
pnpm test:chat     # build, then run isolated Chromium and hidden Electron chat checks
```

Install the Chromium test browser once with `pnpm exec playwright install chromium` before running `test:chat`. The fixtures use a fake harness and a temporary Accio home; they do not call a model or use your profiles. Interactive HTML/charts and composer uploads are separate milestones.

State lives in `~/.accio` (`ACCIO_HOME` overrides it; `ACCIO_PORT` and `ACCIO_HUB_PORT` the ports, default 47321 and 47322). Named accounts, credentials and profile selections are in `~/.accio/hub/profiles.json`; shared profile names, machine folders and model favorites are in `~/.accio/hub/settings.json`. Both use the shared atomic JSON writer in `packages/persistence`. State from before the Account → Profile rename moves to the new names on first start.

## Layout

Code is grouped by domain, one vertical slice each: `machine`, `profiles`, `projects`, `threads`.

- `packages/protocol`: client–server messages (zod).
- `apps/hub`: the hub: Claude sign-in, token refresh, and the proxy threads call. Runs inside this machine's server in v0.1; later it runs alone, always on (ADR 0001).
- `apps/server`: Node server. Pure domain rules sit next to their infrastructure (`profile.ts` and `profiles.ts`, `project.ts` and `git.ts`, `thread.ts`/`transcript.ts` and `claudeCode.ts`).
- `apps/web`: React client, plain web.
- `apps/desktop`: Electron shell that starts the local server.
