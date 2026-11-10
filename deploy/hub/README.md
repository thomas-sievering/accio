# Home-server hub

The production address is `https://accio.mediatom.cc`. It uses the existing remotely managed Cloudflare homeserver tunnel, forwarding to `http://accio-hub:47322` on `media_server_default`. No host port or Tailscale is required. The desktop and coding harnesses stay on their own machines.

## Provision

Build `Dockerfile.hub` for Linux amd64 or pull a verified image from `ghcr.io/thomas-sievering/accio-hub`. Put `compose.yaml` and `deploy.sh` in `/home/tom/accio`. Provision `/data/configs/accio` for UID/GID 1000 with mode 700, then set `ACCIO_HUB_IMAGE` in `.env` to the immutable image reference and run `docker compose up -d hub` from that directory. Inspect existing state and containers first; this is Compose project `accio`, separate from the media and CLI proxy projects.

For first-device pairing or recovery:

```sh
docker exec accio-hub node dist/main.js --pair
```

In Accio, open Settings / Hubs and enter a name, the public address, and that code within ten minutes. Later codes can also be generated from a paired device. Anyone holding a code can pair a trusted device, so keep it private. There is no public signup or username/password.

Before starting the service, provision `.secrets.env` beside `compose.yaml`, mode 600, containing `ACCIO_SECRET_KEY=<32 random bytes encoded as standard base64>`. Generate it once and preserve it across updates; replacing it makes saved secrets unreadable. Keep a protected backup separately from `/data/configs/accio`. The updater changes only `.env` with the image reference and preserves this key file. Encrypted saved-secret values and the Sorting Hat's admin token live in the mounted state; provider accounts live on the Sorting Hat; temporary secret deliveries stay on each machine.

## Move the accounts to the Sorting Hat

Linking the hub to its Sorting Hat ([deploy/sorting-hat](../sorting-hat/README.md)) moves the hub's accounts there once, with their credentials, and links every profile to a new house of its name with its accounts in order. The hub then deletes its copy. In order:

1. Back up `/data/configs/accio` (see below) and check that the Sorting Hat is healthy. Let running threads finish: the new hub serves no model requests itself.
2. Copy the new `deploy.sh` (it follows `stable-v2`) to `/home/tom/accio` and run it, then in Accio open Settings / Hubs and link the hub's Sorting Hat with the address `http://sorting-hat:47330`, the address for threads `https://sortinghat.mediatom.cc` and the admin token. The hub reaches the Sorting Hat on the Docker network; threads on other machines get the public address.
3. Check the profiles: each shows its house and accounts, signed in. The Sorting Hat's dashboard lists the accounts and houses. `/data/configs/accio/hub` keeps no `profiles.json`, no `codex/` folder and no `sorting-hat-move.json`.

The new hub never uses its old accounts; until it is linked, no thread can run. If the upload fails, linking says so and the hub tries again whenever the Sorting Hat answers, and on every start, until it is done. Each thread's next turn gets a hat key and the address for threads from the hub. Do not restore the backup onto a running hub afterwards: it would bring back a second live copy of the moved refresh tokens.

## Automatic updates

GitHub Actions in `.github/workflows/hub.yml` verifies changes before publishing a commit image. Successful `main` builds also advance `stable-v<HUB_PROTOCOL>` (now `stable-v2`, the first hub without accounts); the server follows the tag named in its `deploy.sh`. A branch build publishes only its commit tag. The private registry requires a token with `read:packages` on the server, supplied privately to `docker login ghcr.io --password-stdin`.

Install `accio-update.service` and `accio-update.timer` under `~/.config/systemd/user/`, then run:

```sh
systemctl --user daemon-reload
systemctl --user enable --now accio-update.timer
```

The user must have lingering enabled so updates survive logout/reboot. Inspect with `loginctl show-user tom -p Linger`. Check updates with `systemctl --user status accio-update.timer` and `journalctl --user -u accio-update.service`. To deploy a specific published commit manually, pass its full registry image reference to `./deploy.sh`.

The updater changes only this hub service. It leaves existing media routes and containers running. It checks health before retaining the new digest, and restores the previous image reference if health fails. This does not reverse a state-format migration. Keep protocol-incompatible releases off the current deployment tag.

## Check and recover

`/healthz` returns readiness, protocol and durable hub identity. Management endpoints require a paired device credential; the hub has no model routes. Verify public HTTPS and authenticated WSS after tunnel changes, and a real streamed turn through the Sorting Hat. The public root is setup information.

Back up the protected `/data/configs/accio` directory consistently while the service is stopped. Restore the entire identity and credential store together. Keep machine checkouts, threads, transcripts and harness sessions on their original machine. After restoring, restart only `accio-hub` and verify saved devices reconnect to the same identity.
