# accio

Runs coding threads in Claude Code and Codex on your own machines, keeping each profile, such as work and personal, apart. Terms are in [GLOSSARY.md](GLOSSARY.md), decisions in [docs/adr](docs/adr).

For the delivery model, workspace ownership and optional pull requests, see [ADR 0013](docs/adr/0011-threads-own-delivery-with-optional-pull-requests.md) and the [delivery feature notes](docs/plans/thread-delivery.md).

## v0.1

One machine, with the Claude Agent SDK and a bundled Codex app-server.

- **Accounts** are named and signed in separately under Settings / Accounts. Claude uses a consent page and a code pasted back into accio. ChatGPT uses Codex's device-code flow: open the page, enter the displayed code, and accio detects completion. Device-code login must be enabled in your ChatGPT security settings or workspace permissions. Credentials stay on the **hub** (`apps/hub`, ADR 0007 and ADR 0010), which gives each profile its own key and forwards model requests to the selected provider.
- **Profiles** (personal, work, any you add) select one named Claude account and one named ChatGPT account independently. Multiple profiles can select the same account. Each profile has its own Claude config folder at `~/.accio/profiles/<id>/claude` and Codex home at `~/.accio/profiles/<id>/codex`; accio never configures your regular `~/.claude` or `~/.codex`. These are configuration and credential-routing boundaries, not OS sandboxes: harnesses have full permissions.
- **Projects** are folders on this machine, matched by git remote. Each belongs to one profile; the profile folders suggest it.
- **Threads** stream the harness's reply and keep their profile for life. **Stop** interrupts a turn; a turn cut off by Stop or by accio restarting waits for **Resume**.
- **Models** come from the selected profile's signed-in providers. Codex's available models are discovered at ChatGPT sign-in; its default follows that account's reported default. A profile with only ChatGPT signed in starts Codex threads automatically. An existing thread can change models within its harness; changing harnesses requires a new thread.

To use Codex: **Settings / Accounts / Add ChatGPT account**, name it, then **Sign in with ChatGPT**. Select that account under **Settings / Profiles**, then choose **OpenAI / Codex** in a new thread's model picker. Codex is bundled; no global CLI installation or API key is required.

Chat shows expandable tool inputs and results, images, video/audio players and current-file download links. Successful tool calls start collapsed; failures open automatically. Tool-result images stay inside the tool details unless the assistant embeds them in its reply.

Threads can request tokens through Accio's private `request_secret` tool. **Save & use** keeps a named secret on the Hub for the current profile, project and purpose; later requests for that purpose use it automatically, including after a restart, without another input or confirmation. **Use once** supplies it only to the current turn. An unassigned saved secret can be selected and assigned to another project in the same profile once. A thread with No project can use a one-time value or a secret explicitly allowed throughout its profile.

**Settings / Secrets**, under Hub settings, manages names, purposes, project access, replacements and deletion. Values are write-only. Provider Accounts remains Claude and ChatGPT sign-ins. Each tool delivery is a temporary file on the thread's machine, removed when the turn ends or after 15 minutes. Its contents bypass chat, but the thread's commands can read them: this is not an OS sandbox. Accio's download and media routes reject its private Hub and delivery paths.

Saved values are encrypted with AES-256-GCM in `hub/secrets/values.json`, separate from shared settings. On Windows the key is protected by DPAPI for the user running the Hub, and private directories use a verified owner-only ACL. On other platforms provision `ACCIO_SECRET_KEY` as a 32-byte standard-base64 key through the Hub's service environment; it is stripped from harness environments. Keep that key outside the data store and back it up separately. A Windows DPAPI key requires the original Windows identity/system; a portable backup needs an explicitly provisioned key. Changing or losing the key prevents decrypting existing values. Without a usable backend, Use once remains available and saving reports why it is unavailable. External token revocation is still done at its service. See [ADR 0013](docs/adr/0013-private-secrets-and-project-memory.md).

When you ask Claude Code or Codex to prototype, try or mock up UI for a feature, it shows its variants as a **choice**: cropped screenshots side by side. Click one to see it full size (arrow keys browse), tick one to put it in the composer, add feedback and send. The harness receives `I pick B ("Label") for "Question".` followed by your text. The choice comes from **accio tools**: each machine serves them to its own harnesses over MCP at `/mcp` on its port, with a token per turn (ADR 0013).

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
pnpm test:secrets  # build, then drive secret entry/reuse and Settings with disposable markers
pnpm exec playwright install chromium # one-time browser setup for verification
pnpm verify        # build, drive the real UI in isolation, retain proof in out/verify
```

Install the Chromium test browser once with `pnpm exec playwright install chromium` before running `test:chat`. The fixtures use a fake harness and a temporary Accio home; they do not call a model or use your profiles. Interactive HTML/charts and composer uploads are separate milestones.

The secrets browser fixture uses the production UI/server and a scripted harness, retains no typed-value traces, and checks thread-data exposure and file cleanup before deleting its temporary home. Native Claude CLI/SDK and Codex tool tests use local scripted model responses; no real provider account or inference is needed. Remote relay and external vault/opaque-reference consumers remain separate work.

Agents can use the project-local [3-verify skill](.agents/skills/3-verify/SKILL.md) and its [feature map](.agents/skills/3-verify/features/README.md) to drive additional user journeys. Verification owns a disposable home and ports; the default smoke covers profiles, signed-out account selection, machine settings and local projects. Provider sign-in, coding turns and Electron's native controls require the additional prerequisites listed in the map.

State lives in `~/.accio` (`ACCIO_HOME` overrides it; `ACCIO_PORT` and `ACCIO_HUB_PORT` the ports, default 47321 and 47322). Named accounts, Claude credentials, ChatGPT account metadata and profile selections are in `~/.accio/hub/profiles.json`; Codex stores ChatGPT credentials under `~/.accio/hub/codex/<credential-id>/auth.json`. Shared profile names, machine folders and model favorites are in `~/.accio/hub/settings.json`. Both JSON stores use the shared atomic writer in `packages/persistence`. State from before the Account → Profile rename moves to the new names on first start.

Settings also manages **Tools**, **MCP servers** and **Skills**. Enable an item globally, for profiles or for projects, or keep it optional in the library. Tools use exact npm versions in Accio-owned folders; failed checks start a local repair thread when a signed-in profile is available, and a completed repair is checked again. Remote MCP sign-in and tokens stay on the hub. Git skill sources support update previews and returning to previous revisions; copying a skill into a project makes independent files for that project's Git history. See [ADR 0012](docs/adr/0012-the-hub-manages-tools-mcp-servers-and-skills.md) for execution, credentials and the current single-machine boundary.

## Layout

Code is grouped by domain, one vertical slice each: `machine`, `profiles`, `projects`, `threads`, `tools`.

- `packages/protocol`: client–server messages (zod).
- `packages/codex`: pinned Codex executable, isolated environment and stdio app-server client, shared by hub authentication and machine execution.
- `apps/hub`: the hub: Claude and ChatGPT sign-in, token refresh, and the proxy threads call. Runs inside this machine's server in v0.1; later it runs alone, always on (ADR 0001).
- `apps/server`: Node server. `src/tools` serves accio tools to harnesses over MCP. Pure domain rules sit next to their infrastructure (`profile.ts` and `profiles.ts`, `project.ts` and `git.ts`, `thread.ts`/`transcript.ts` and `claudeCode.ts`).
- `apps/web`: React client, plain web.
- `apps/desktop`: Electron shell that starts the local server.
