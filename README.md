# accio

Runs coding threads in Claude Code and Codex on your own machines, keeping each profile, such as work and personal, apart. Terms are in [GLOSSARY.md](GLOSSARY.md), decisions in [docs/adr](docs/adr), open work in [docs/plans](docs/plans).

## How it fits together

- **Hub.** accio runs its own hub (`apps/hub`): a standalone service, at home or locally, that holds accounts, profiles, shared settings, saved secrets and the model proxy. It never runs threads (ADR 0009). Machines save named hub connections under Settings / Hubs and pair with a one-time code; the hub's startup or `--pair` command issues the first one. Each window selects its own hub; running work stays on its hub (ADR 0014).
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
pnpm test:e2e       # build, then every Playwright suite (chat, limits, secrets)
pnpm test:chat      # ...or one suite: test:chat, test:limits, test:secrets
pnpm verify         # build, drive the real UI in isolation, retain proof in out/verify
```

From a worktree, use `pnpm try` to open that version for hands-on testing. `pnpm start` uses the real `~/.accio` and port 47321, so it stops while your everyday accio is open. `pnpm try` instead gets a fresh home and free ports, joins the hub as the verify device (link one first, see the [3-verify skill](.agents/skills/3-verify/SKILL.md#real-model-turns)) so signed-in accounts and real turns work, titles its window after the checkout, and deletes the home when the window closes. Only one `pnpm try` or real-turn verify holds the device at a time; another one names the checkout that holds it.

Install the test browser once with `pnpm exec playwright install chromium`. The Playwright suites (`playwright.config.ts`, one project per suite) start fixture servers from `scripts/<suite>-test-server.ts` with a fake harness, fixture provider I/O and a temporary home on their own ports; they never call a model or touch your profiles. Agents can drive further journeys with the [3-verify skill](.agents/skills/3-verify/SKILL.md).

## State

- Machine: `~/.accio` (`ACCIO_HOME` overrides). Remote hubs' projects, threads and media live under `hubs/<hub-id>`; hub credentials are server-only in `hub-connections.json`.
- Standalone hub: `~/.accio-hub`. Its `hub` directory holds account credentials, Codex homes, shared settings, secrets and device trust; keep it private and back it up as one unit. See [deploy/hub/README.md](deploy/hub/README.md) for Docker, Cloudflare Tunnel and automatic updates.
- Dev hub: `%LOCALAPPDATA%/accio-dev` on Windows (`ACCIO_DEV_HUB_HOME`, `ACCIO_DEV_HUB_PORT` override). Pair it once as Local dev and switch in the sidebar.

## Layout

Code is grouped by domain, one vertical slice each.

- `packages/protocol`: client–server messages (zod).
- `packages/codex`: pinned Codex executable and stdio app-server client.
- `packages/persistence`: atomic JSON files and owner-only private files.
- `apps/hub`: hub service: accounts, sign-in, token refresh, shared resources and model proxy.
- `apps/worker`: worker implementation: threads, harnesses, delivery and accio tools; also serves the web client and manages local hub connections.
- `apps/web`: React client.
- `apps/desktop`: Electron shell that opens the client and starts the local worker.
- `tests/`, `scripts/*-test-server.ts`: Playwright suites and their fixture servers.
