# Home-server Sorting Hat

The production address is `https://sortinghat.mediatom.cc`, beside the hub at
`https://accio.mediatom.cc` ([deploy/hub](../hub/README.md)). It uses the same
remotely managed Cloudflare homeserver tunnel, forwarding to
`http://sorting-hat:47330` on `media_server_default`. No host port is published.
It is its own Compose project, `sorting-hat`, in `/home/tom/sorting-hat`,
separate from the `accio` project and the media projects.

[wizard.sh](wizard.sh) walks through every step below that only the owner can
do (server folders, Cloudflare Access, the tunnel route, the admin token). Run it
from a checkout on your own computer, with SSH access to the server:

```sh
deploy/sorting-hat/wizard.sh
```

It remembers its answers in `~/.config/accio/sorting-hat-wizard.env`, so it can be
stopped and run again.

## Provision

Build `Dockerfile.sorting-hat` for Linux amd64 or pull a verified image from
`ghcr.io/thomas-sievering/accio-sorting-hat`. Put `compose.yaml` and `deploy.sh` in
`/home/tom/sorting-hat`. Provision `/data/configs/sorting-hat` for UID/GID 1000
(the image's `node` user) with mode 700. Inspect existing state and containers
first.

Beside `compose.yaml`, provision `.secrets.env`, mode 600:

```sh
SORTING_HAT_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com
SORTING_HAT_ACCESS_AUD=<Application Audience (AUD) tag of the dashboard's Access application>
```

With both set, the dashboard and the management API accept a request only with a
valid Cloudflare Access token or, for the API, the admin token. With neither, a
container gets no dashboard at all. The image sets `SORTING_HAT_DIR=/data`,
`SORTING_HAT_HOST=0.0.0.0` and `SORTING_HAT_PORT=47330`. Leave
`SORTING_HAT_ADMIN_TOKEN` unset: on first start the Sorting Hat creates the admin
token in `/data/admin-token`. Read it with

```sh
docker exec sorting-hat cat /data/admin-token
```

and keep it in a password manager. Anyone holding it can manage every account.
The updater changes only `.env` (the image reference) and leaves `.secrets.env`
alone.

## How requests reach it

| Caller | Address | Guarded by |
| --- | --- | --- |
| You in a browser: the dashboard and its `/api/` calls | `https://sortinghat.mediatom.cc/` | Cloudflare Access (your email), then the Access token is checked again by the Sorting Hat |
| Claude Code, pi (pi-claude-bridge), Codex, Accio's threads | `https://sortinghat.mediatom.cc/v1/…`, `/openai/…` | Access bypassed; a hat key |
| The hub, managing accounts, houses and hat keys | `http://sorting-hat:47330/api/…` on `media_server_default` | the admin token; never leaves the server |

The hub reaches the Sorting Hat over the Docker network, by its alias
`sorting-hat`, rather than through Cloudflare: the admin token never crosses the
internet, the management API stays behind Access for everyone else, and no Access
service token is needed. Both projects join `media_server_default`, so the name
resolves from `accio-hub`. Hat keys the hub hands to threads on other machines
come with the public address, since those machines are not on that network.

### Cloudflare Access

Access matches the most specific application for a path, and a more specific
application replaces the general one's policies rather than adding to them. A path
`v1/*` covers `/v1/messages` but not `/v1` itself. So:

1. **Sorting Hat** (self-hosted): `sortinghat.mediatom.cc`, path empty (the whole
   host). Policy: Allow, Include Emails = the owner's email. Its Application
   Audience (AUD) tag goes into `SORTING_HAT_ACCESS_AUD`. This covers the
   dashboard (`/`, `/dashboard/…`), `/api/…` and `/healthz`.
2. **Sorting Hat model routes** (self-hosted): `sortinghat.mediatom.cc/v1/*` and
   `sortinghat.mediatom.cc/openai/*`. Policy: Bypass, Include Everyone.
   - `/v1/*` holds the Anthropic routes Claude Code calls: `POST /v1/messages`,
     `POST /v1/messages/count_tokens`, `GET /v1/models`.
   - `/openai/*` holds the ChatGPT routes Codex calls: `POST /openai/responses`,
     `POST /openai/responses/compact`, and whatever else Codex sends below `/openai/`.

Every other path stays behind Access. If a client turns out to call an Anthropic
path outside `/v1/`, it sees Access' login redirect instead of a 401; add that path
to the second application. Do not turn on **Protect with Access** in the tunnel
route's origin settings: `cloudflared` would then demand an Access token on the
bypassed routes too. Bypassed requests are not in Access' logs; the Sorting Hat
records their usage per hat key.

Create both applications before the tunnel route, so the hostname is never
published unguarded. Bot Fight Mode or WAF rules on `mediatom.cc` that challenge
non-browser clients would break the model routes; the hub's model traffic
already works through this tunnel with the zone's current settings.

## Use it

Make a hat key on the dashboard (or `POST /api/hat-keys`, see
[API.md](../../apps/sorting-hat/API.md)), then point the tool at the public
address as in the Sorting Hat's [README](../../apps/sorting-hat/README.md#use-it):

```sh
# Claude Code
ANTHROPIC_BASE_URL=https://sortinghat.mediatom.cc ANTHROPIC_AUTH_TOKEN=<hat key> claude
```

- **pi with pi-claude-bridge**: in the `claude-bridge` credential's `env`,
  `ANTHROPIC_BASE_URL=https://sortinghat.mediatom.cc`, `ANTHROPIC_AUTH_TOKEN=<hat key>`,
  `ANTHROPIC_API_KEY=""`.
- **Codex**: `base_url = "https://sortinghat.mediatom.cc/openai"` in its
  `sorting-hat` model provider.

### Signing in ChatGPT accounts

ChatGPT's browser sign-in returns to `http://localhost:1455/auth/callback`, Codex's
login server inside the container. Port 1455 is not published and needs not be:
use the device flow, or copy that address from the browser after approving and
paste it into the dashboard (`POST /api/sign-ins/{id}/complete` with `{ "url" }`).
Claude accounts use the paste-code flow and need nothing on the server.

## Automatic updates

`.github/workflows/sorting-hat.yml` runs on changes under `apps/sorting-hat/` (and
the shared build files), tests the Sorting Hat, and publishes
`ghcr.io/thomas-sievering/accio-sorting-hat:<commit>`. The newest successful `main`
build also advances `stable-v1`, where `1` is the `sorting-hat.json` format
version in `apps/sorting-hat/src/state.ts`. A release that converts the state
file moves to the next tag, so the server does not pick it up until `deploy.sh`'s
default is moved with it: rolling back the image does not undo a conversion. The
private registry needs a token with `read:packages`; the server's existing
`docker login ghcr.io` for the hub covers it when that token is a classic token
with `read:packages`.

Install `sorting-hat-update.service` and `sorting-hat-update.timer` under
`~/.config/systemd/user/`, then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now sorting-hat-update.timer
```

Lingering must stay enabled (`loginctl show-user tom -p Linger`), as for the hub.
Check with `systemctl --user status sorting-hat-update.timer` and
`journalctl --user -u sorting-hat-update.service`. To deploy a specific published
commit, pass its full image reference to `./deploy.sh`.

`deploy.sh` is the hub's updater for this service: it pulls the tag, does nothing
if the image is already deployed, points `.env` at the new digest, restarts only
`sorting-hat`, and waits up to 40 seconds for the image's health check. If it does
not turn healthy, it restores the previous image reference and restarts that.

## Check and recover

`/healthz` answers `{"ok":true}` while the server runs. The container's health
check and `deploy.sh` use it from inside the container; from outside, it is
behind Access like the dashboard. From the server:

```sh
docker inspect --format '{{.State.Health.Status}}' sorting-hat
docker exec accio-hub node -e "fetch('http://sorting-hat:47330/healthz').then(r=>r.text()).then(console.log)"
```

After tunnel or Access changes, check from outside that
`https://sortinghat.mediatom.cc/api/houses` redirects to the Access login, that
`https://sortinghat.mediatom.cc/v1/models` answers the Sorting Hat's own 401
(`authentication_error`) without a hat key, and that a real Claude Code request
with a hat key streams. The wizard's last stage runs the first two.

When the Sorting Hat is down, no Accio thread and no other app can reach a model;
other hub features keep working.

### Backup

`/data/configs/sorting-hat` holds every account's credentials and refresh tokens
(`sorting-hat.json` and each ChatGPT account's `codex/<id>/`), the hat keys'
hashes and the admin token. Treat a copy as the accounts themselves:

- Back it up while the service is stopped, so the files agree, and only
  encrypted, for example
  `docker compose stop sorting-hat && sudo tar -C /data/configs -c sorting-hat | age -r <your key> > sorting-hat-$(date +%F).tar.age && docker compose start sorting-hat`.
  Keep it apart from the hub's backup and its `.secrets.env`.
- Restore the whole folder together, owned by UID/GID 1000 with mode 700, and
  restart only `sorting-hat`.
- **Never run two live copies.** Providers rotate refresh tokens on every
  refresh: a second Sorting Hat started from the same folder or from a restored
  backup (a test machine, a second server, a laptop) refreshes the same accounts,
  and each copy signs the other out. Start a restored copy only where the old one
  is stopped for good. A backup older than an account's last refresh may hold a
  refresh token that was already used; sign that account in again.
