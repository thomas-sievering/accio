# Sorting Hat

Holds your Claude and ChatGPT subscriptions as accounts, groups them into
houses, and lets apps with a hat key send model requests through one house's
accounts. It picks the account in use per house and moves on when one runs out.
It knows nothing of Accio; Accio is one app that uses it (ADR 0018). The HTTP
API is described in [API.md](API.md).

## Run it

From the repository root:

```sh
pnpm install
pnpm --filter @accio/sorting-hat build
pnpm --filter @accio/sorting-hat start          # node apps/sorting-hat/dist/main.js
```

| Setting | Argument | Environment | Default |
| --- | --- | --- | --- |
| State folder | `--dir` | `SORTING_HAT_DIR` | `~/.sorting-hat` |
| Address | `--host` | `SORTING_HAT_HOST` | `127.0.0.1` |
| Port | `--port` | `SORTING_HAT_PORT` | `47330` |
| Admin token | | `SORTING_HAT_ADMIN_TOKEN` | created in the state folder |
| Cloudflare Access team | | `SORTING_HAT_ACCESS_TEAM_DOMAIN` | none: dashboard on loopback only |
| Cloudflare Access audience | | `SORTING_HAT_ACCESS_AUD` | none |

On first start it creates the admin token, prints it and keeps it in
`<state folder>/admin-token`. It prints `SORTING_HAT_READY {"url":…,"port":…}`
once it listens.

The state folder holds:

- `sorting-hat.json`: accounts (with Claude credentials), houses and hat keys (hashes only).
- `usage.json`: usage per hour, hat key, house, account and model ([API.md](API.md#usage)).
- `admin-token`: the admin token.
- `codex/<id>/`: each ChatGPT account's Codex credential home.

Keep it private: it holds your subscriptions' refresh tokens.

## Dashboard

Open the Sorting Hat's address (`http://127.0.0.1:47330/` by default) in a
browser. The dashboard signs accounts in and out, renames and deletes them,
creates houses and orders their accounts per provider, shows each account's
limits and each house's account in use, and creates, renames, revokes and
deletes hat keys. A new hat key is shown once, with settings for Claude Code,
pi-claude-bridge and Codex that point at the address the dashboard was opened at.

Its **Usage** section charts the tokens used over the last 24 hours (per hour),
7 or 30 days (per day) or a chosen range of dates (per hour for up to two days),
stacked by house, hat key, account or model, for all tokens or one type (input,
output, cache read, cache write). A table beside it lists each group's requests
and tokens of every type with their totals; by account, it lists every account
with its limits next to its usage. Usage of a deleted house, hat key or account
shows as deleted, and usage from before hat keys as "No hat key". It refreshes every
30 seconds.

Days and hours are in the browser's time zone. The API's day buckets are UTC
days, so the dashboard asks for hours and adds them up into local days. The
Sorting Hat keeps hours only for the last 90 days; for a range reaching further
back, those days are UTC days, and the dashboard says so.

It has no login of its own:

- **On this machine** (no Cloudflare Access settings): the dashboard and its API
  calls are answered only for requests from a loopback address to a loopback
  name (`127.0.0.1`, `localhost`, `[::1]`). Anyone who can open a connection to
  that port on this machine counts as its owner, as with the admin-token file,
  which they could usually read too; on a shared machine, run it behind Access
  instead. A page at another name that resolves to 127.0.0.1 (DNS rebinding)
  is refused by the Host check. The dashboard's API calls carry an
  `x-sorting-hat-dashboard: 1` header, which another site cannot send without a
  CORS preflight the Sorting Hat never grants, and every change must come with
  an `Origin` equal to the Host, so other sites open in the same browser cannot
  drive the API. Bound to another address (`--host 0.0.0.0`, a container),
  requests from elsewhere get no dashboard.
- **Behind Cloudflare Access**: set `SORTING_HAT_ACCESS_TEAM_DOMAIN`
  (`<team>.cloudflareaccess.com`) and `SORTING_HAT_ACCESS_AUD` (the Access
  application's Application Audience tag). Then the dashboard and the
  management API refuse any request without a valid Access token in
  `Cf-Access-Jwt-Assertion`, or else in the `CF_Authorization` cookie Access sets
  in the browser (RS256, verified against
  `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, checking `aud`,
  `iss`, `exp` and `nbf`), or the admin token for the API. Loopback earns
  nothing here, since a Cloudflare Tunnel reaches the server over loopback too.
  Model routes must not be behind Access, since Claude Code and Codex cannot
  sign in to it, and the hub calls `/api/` with only the admin token. So in
  Cloudflare, guard the hostname with an Access application and bypass `/v1/*`,
  `/openai/*` and `/api/*` there (more specific Bypass applications), or give
  the hub an Access service token instead of bypassing `/api/*`. Where `/api/*`
  is bypassed, the dashboard's API calls are checked with the `CF_Authorization`
  cookie the browser got when it passed Access for the dashboard.

The admin token keeps working for the management API in both cases; that is how
the hub and scripts call it.

## Set up a house

```sh
HAT=http://127.0.0.1:47330
ADMIN="Authorization: Bearer $(cat ~/.sorting-hat/admin-token)"

# A Claude account: open the url, approve, paste the code shown.
curl -s -H "$ADMIN" -d '{"name":"Personal Claude","providerId":"anthropic"}' $HAT/api/accounts
curl -s -H "$ADMIN" -X POST $HAT/api/accounts/<account id>/sign-in
curl -s -H "$ADMIN" -d '{"code":"<code#state>"}' $HAT/api/sign-ins/<sign-in id>/complete

# A ChatGPT account, with the device flow: open the url, enter the code, then poll.
curl -s -H "$ADMIN" -d '{"name":"Personal ChatGPT","providerId":"openai"}' $HAT/api/accounts
curl -s -H "$ADMIN" -d '{"flow":"device"}' $HAT/api/accounts/<account id>/sign-in
curl -s -H "$ADMIN" $HAT/api/sign-ins/<sign-in id>

# A house with those accounts, and a hat key for one app.
curl -s -H "$ADMIN" -d '{"name":"Personal","accounts":{"anthropic":["<claude id>"],"openai":["<chatgpt id>"]}}' $HAT/api/houses
curl -s -H "$ADMIN" -d '{"houseId":"personal","name":"pi on laptop"}' $HAT/api/hat-keys
```

The last answer's `secret` is the hat key. It is shown only then.

## Use it

### Claude Code

```sh
ANTHROPIC_BASE_URL=http://127.0.0.1:47330 ANTHROPIC_AUTH_TOKEN=<hat key> claude
```

Leave `ANTHROPIC_API_KEY` unset. Claude Code then runs on the house's Claude
account in use.

### Codex

In `~/.codex/config.toml` (or with `-c` overrides):

```toml
model_provider = "sorting-hat"

[model_providers.sorting-hat]
name = "Sorting Hat"
base_url = "http://127.0.0.1:47330/openai"
env_key = "SORTING_HAT_KEY"
wire_api = "responses"
supports_websockets = false
```

and run it with `SORTING_HAT_KEY=<hat key> codex`.

### Model lists

With a hat key, `GET /v1/models` lists the house's Claude models in Anthropic's
shape and `GET /openai/models` (or `/openai/v1/models`) its ChatGPT models in
OpenAI's, so other apps can discover them:

```sh
curl -s -H "x-api-key: <hat key>" $HAT/v1/models
curl -s -H "Authorization: Bearer <hat key>" $HAT/openai/models
```

See [API.md](API.md#models) for where each list comes from.

### pi with pi-claude-bridge

[pi-claude-bridge](https://www.npmjs.com/package/pi-claude-bridge) runs the
real Claude Code for pi's `claude-bridge/...` models, so it uses the Sorting Hat
the way Claude Code does. Install it with `pi install npm:pi-claude-bridge`, then
give only the bridge's Claude Code the Sorting Hat's address and a hat key, in a
`claude-bridge` credential in `~/.pi/agent/auth.json`:

```json
{
  "claude-bridge": {
    "type": "api_key",
    "key": "not-used",
    "env": {
      "ANTHROPIC_BASE_URL": "http://127.0.0.1:47330",
      "ANTHROPIC_AUTH_TOKEN": "<hat key>",
      "ANTHROPIC_API_KEY": ""
    }
  }
}
```

and pick a `claude-bridge/...` model with `/model`. Exporting
`ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` before starting pi works too,
but then every Anthropic request pi makes gets them. This setup follows the
bridge's documentation and has not yet been tried end to end with pi.
pi takes its model list from its own catalog and `models.json`; it reads the
Sorting Hat's [model lists](#model-lists) only through a provider extension that
discovers models (`refreshModels`), which has not been tried either.

## Deploy

`Dockerfile.sorting-hat` builds its image; the home-server deployment at
`sortinghat.mediatom.cc`, behind Cloudflare Access, is described in
[deploy/sorting-hat](../../deploy/sorting-hat/README.md).

## Develop

`pnpm exec vitest run apps/sorting-hat` runs its tests with faked providers.
`pnpm test:sortinghat` drives the dashboard in Chromium against a standalone
Sorting Hat with faked providers (`scripts/sortinghat-test-server.ts`); set
`SORTING_HAT_SCREENSHOTS=<folder>` to keep screenshots. The dashboard is plain
HTML, CSS and JavaScript in `dashboard/`, served by `src/dashboard.ts`; a
deployment image needs that folder beside `dist/`.
`src/cli.native.test.ts` also runs the real Codex this package pins and, if it
is installed, the real Claude Code against the standalone Sorting Hat. The
Sorting Hat imports nothing from Accio's packages; `src/boundary.test.ts`
enforces that.
