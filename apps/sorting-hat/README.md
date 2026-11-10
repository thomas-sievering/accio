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

On first start it creates the admin token, prints it and keeps it in
`<state folder>/admin-token`. It prints `SORTING_HAT_READY {"url":…,"port":…}`
once it listens.

The state folder holds:

- `sorting-hat.json`: accounts (with Claude credentials), houses and hat keys (hashes only).
- `admin-token`: the admin token.
- `codex/<id>/`: each ChatGPT account's Codex credential home.

Keep it private: it holds your subscriptions' refresh tokens. Pointing `--dir`
at an Accio hub's `hub` folder converts the hub's account file
(`profiles.json`) on first start and removes it; do that only with the hub
stopped and not using that folder any more, since refresh tokens rotate.

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

## Deploy

`Dockerfile.sorting-hat` builds its image; the home-server deployment at
`sortinghat.mediatom.cc`, behind Cloudflare Access, is described in
[deploy/sorting-hat](../../deploy/sorting-hat/README.md).

## Develop

`pnpm exec vitest run apps/sorting-hat` runs its tests with faked providers.
`src/cli.native.test.ts` also runs the real Codex this package pins and, if it
is installed, the real Claude Code against the standalone Sorting Hat. The
Sorting Hat imports nothing from Accio's packages; `src/boundary.test.ts`
enforces that.
