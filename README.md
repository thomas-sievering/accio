# accio

Runs coding agents (Claude Code first) on your own machines, keeping work and personal agent use strictly apart. Terms are in [GLOSSARY.md](GLOSSARY.md), decisions in [docs/adr](docs/adr).

## v0.1

One machine, Claude only, through the Claude Agent SDK.

- **Accounts** sign in with Claude inside accio: approve on Claude's page, paste back the code. The login stays on the **hub** (`apps/hub`, ADR 0007), which gives each account its own key and forwards its agents' requests to Anthropic. accio writes each account's Claude config folder under `~/.accio/accounts/<id>/claude` and never touches `~/.claude`.
- **Projects** are folders on this machine, matched by git remote. Each belongs to one account; the account's folders suggest it.
- **Threads** stream the agent's reply and keep their account for life. **Stop** interrupts a turn; a turn cut off by Stop or by accio restarting waits for **Resume**.

## Run

```sh
npm install
npm start          # build, then open the desktop app (starts this machine's server)
npm run server     # server only; open the printed http://127.0.0.1:47321/#token=… link in a browser
npm test           # vitest
npm run typecheck
```

State lives in `~/.accio` (`ACCIO_HOME` overrides it; `ACCIO_PORT` and `ACCIO_HUB_PORT` the ports, default 47321 and 47322). Hub logins are in `~/.accio/hub/accounts.json`.

## Layout

Code is grouped by domain, one vertical slice each: `machine`, `accounts`, `projects`, `threads`.

- `packages/protocol`: client–server messages (zod).
- `apps/hub`: the hub: Claude sign-in, token refresh, and the proxy agents call. Runs inside the server on the home machine (this machine, in v0.1).
- `apps/server`: Node server. Pure domain rules sit next to their infrastructure (`account.ts` and `accounts.ts`, `project.ts` and `git.ts`, `thread.ts`/`transcript.ts` and `claudeAgent.ts`).
- `apps/web`: React client, plain web.
- `apps/desktop`: Electron shell that starts the local server.
