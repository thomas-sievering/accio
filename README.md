# accio

Runs coding threads in Claude Code and Codex on your own machines, keeping each profile, such as work and personal, apart. Terms are in [GLOSSARY.md](GLOSSARY.md), decisions in [docs/adr](docs/adr), open work in [docs/plans](docs/plans).

For development checks and autonomous shipping, follow [Verification and shipping](docs/verification.md).

## How it fits together

- **Hub.** accio runs its own hub (`apps/hub`): a standalone service, at home or locally, that holds profiles, shared settings and saved secrets, and links to a Sorting Hat (`apps/sorting-hat`), which holds accounts and forwards model requests: one of its own, entered with an admin token under Settings / Hubs, or else one it runs in-process. It never runs threads (ADR 0009). Machines save named hub connections under Settings / Hubs and pair with a one-time code; the hub's startup or `--pair` command issues the first one. Each window selects its own hub; running work stays on its hub (ADR 0014).
- **Accounts.** Named Claude and ChatGPT accounts under Settings / Accounts. Press **Sign in with Claude** or **Sign in with ChatGPT**, approve in the system browser, and sign-in finishes automatically: a loopback receiver on this PC relays the callback to the hub, which keeps the tokens (ADR 0014, superseding the paste-code flow of ADR 0007). New sign-ins need accio running on the browser's PC.
- **Profiles** each select Claude and ChatGPT accounts in order (the hub picks one per request by remaining allowance and reset time, ADR 0016) and get their own config folders under `~/.accio/profiles/<id>/`; your regular `~/.claude` and `~/.codex` are untouched. These are credential-routing boundaries, not sandboxes: harnesses run with full permissions (ADR 0005).
- **Clients** let you read threads, send prompts and change settings. **Workers** on connected machines execute turns with the Claude Agent SDK and a bundled Codex app-server, in owned Git worktrees, and serve accio tools to harnesses over MCP (ADR 0011). A machine can run either role or both; currently the desktop app starts both, and the web client is served by a worker. Standalone web and iOS clients are planned. Ship / Prepare for review deliver through Git and optional PRs ([ADR 0015](docs/adr/0015-threads-own-delivery-with-optional-pull-requests.md), [delivery notes](docs/plans/thread-delivery.md)).
- **Secrets** requested by a thread are entered privately, saved encrypted on the hub per profile and project, and delivered as short-lived files (ADR 0013). Off Windows, provision `ACCIO_SECRET_KEY` (32-byte base64) in the hub's environment and back it up separately.
- **Tools, MCP servers and skills** are managed by the hub under Settings (ADR 0012).

## Run

accio uses pnpm (pinned in `package.json`; `corepack enable pnpm` provides it).

```sh
pnpm install
pnpm start          # build, then open the desktop app (starts this machine's worker)
pnpm try            # build, then open this checkout's app beside the running one (see below)
pnpm worker         # worker only; open the printed http://127.0.0.1:…/#token=… link
pnpm dev:hub        # local dev hub from source, restarted on changes (port 47323)
pnpm hub            # standalone hub (port 47322; ACCIO_HOME, ACCIO_HUB_PORT override)
pnpm hub:pair       # issue a fresh first-device or recovery pairing code
pnpm test           # vitest
pnpm typecheck
pnpm test:e2e       # build, then every Playwright suite (chat, limits, secrets, relay)
pnpm test:chat      # ...or one suite: test:chat, test:limits, test:secrets
pnpm verify         # build, drive the real UI in isolation, retain proof in out/verify
```

From a worktree, use `pnpm try` to open that version for hands-on testing. `pnpm start` uses the real `~/.accio` and port 47321, so it stops while your everyday accio is open. `pnpm try` instead gets a fresh home and free ports, joins the hub as the verify device (link one first, see the [3-verify skill](.agents/skills/3-verify/SKILL.md#real-model-turns)) so signed-in accounts and real turns work, titles its window after the checkout, and deletes the home when the window closes. Only one `pnpm try` or real-turn verify holds the device at a time. A `pnpm try` window closes by itself when the next `pnpm try` or real-turn verify asks for the device, so the newest one wins; a running verify is waited for.

Install the test browser once with `pnpm exec playwright install chromium`. The Playwright suites (`playwright.config.ts`, one project per suite) start fixture servers from `scripts/<suite>-test-server.ts` with a fake harness, fixture provider I/O and a temporary home on their own ports; they never call a model or touch your profiles. Agents can drive further journeys with the [3-verify skill](.agents/skills/3-verify/SKILL.md).

## Terminal client

The CLI is an agent-facing developer tool for quick testing, debugging and
verification without opening the UI. Use it to exercise worker behavior and
inspect state during development. The desktop and web apps remain the user-facing
clients.

After `pnpm install` and `pnpm build`, run `pnpm cli --help`. The CLI connects to
an already running worker using the same authenticated RPC interface as the app.
It reads the existing `server.json` under `ACCIO_HOME` (default `~/.accio`), without
starting a worker or creating configuration. Point `--home` at an isolated test
worker's home to test that instance.

```sh
pnpm cli methods                         # discover every operation, offline
pnpm cli methods threads.                # filter by prefix
pnpm cli schema threads.start            # JSON input schema, offline
pnpm cli profiles.list
pnpm cli projects.get
pnpm cli call threads.start @start.json  # params from a file
pnpm cli threads.transcript @thread.json
pnpm cli wait THREAD_ID --timeout 120000
pnpm cli events thread.item              # filtered JSON Lines; Ctrl+C to stop
```

For example, `start.json` can contain
`{"checkoutId":"CHECKOUT_ID","text":"Explain this project"}`; get checkout IDs
from `projects.get`. The returned thread contains its `id`. Use
`{"threadId":"THREAD_ID"}` in `thread.json` to read its transcript. Any protocol
method can be called directly or through `call`; `schema METHOD` shows its inputs.
Use `-` in place of JSON or `@file` to read params from stdin, including secrets.
Pass JSON as one shell argument when using inline params.

Use `--hub HUB_ID` to select a window's hub context (`hubs.list` lists connections).
For a different worker, set `ACCIO_URL` and `ACCIO_TOKEN`, or pass its printed
`--url 'http://127.0.0.1:PORT/#token=TOKEN'` link. Explicit URLs never borrow a token
from the local home. Prefer environment variables for credentials to avoid shell
history. `ACCIO_HUB` also selects a hub. Run `pnpm --silent cli ...` to suppress
pnpm's command banner when consuming JSON.

Results are JSON on stdout; errors are JSON on stderr. Exit codes are **0** for
success, **1** for errors, and **2** for timeouts. `wait` reads fresh thread state
until it leaves `running`: `idle` succeeds, `failed` or `interrupted` exits 1, and
a missing thread is an error. It reports the current state, so call it after the
start/send request succeeds. `events` streams until interrupted (exit 130) or
disconnected (exit 1); it does not replay history. Read a transcript snapshot when
you need existing items. Requests default to a 30-second timeout and are never
retried automatically, since a timed-out write may have completed.

This tests worker behavior and saved state; visual interactions still use the UI
verification suites.

## State

- Machine: `~/.accio` (`ACCIO_HOME` overrides). Remote hubs' projects, threads and media live under `hubs/<hub-id>`; hub credentials are server-only in `hub-connections.json`.
- Standalone hub: `~/.accio-hub`. Its `hub` directory holds account credentials, Codex homes, shared settings, secrets and device trust; keep it private and back it up as one unit. See [deploy/hub/README.md](deploy/hub/README.md) for Docker, Cloudflare Tunnel and automatic updates.
- Dev hub: `%LOCALAPPDATA%/accio-dev` on Windows (`ACCIO_DEV_HUB_HOME`, `ACCIO_DEV_HUB_PORT` override). Pair it once as Local dev and switch in the sidebar.

## Layout

Code is grouped by domain, one vertical slice each.

- `packages/protocol`: client–server messages (zod).
- `packages/codex`: pinned Codex executable and stdio app-server client.
- `packages/persistence`: atomic JSON files and owner-only private files.
- `apps/hub`: hub service: pairing, relay, shared settings, profiles and resources; hands threads hat keys for a Sorting Hat of its own, or runs one in-process for accounts.
- `apps/sorting-hat`: the Sorting Hat (ADR 0018): accounts, sign-in, token refresh, limits, houses, hat keys, the account in use and model request forwarding. Imports nothing from Accio's packages. It also runs on its own with a management API; see [its README](apps/sorting-hat/README.md) and [API](apps/sorting-hat/API.md).
- `apps/worker`: worker implementation: threads, harnesses, delivery and accio tools; also serves the web client and manages local hub connections.
- `apps/web`: React client.
- `apps/desktop`: Electron shell that opens the client and starts the local worker.
- `tests/`, `scripts/*-test-server.ts`: Playwright suites and their fixture servers.
