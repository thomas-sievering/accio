# Home-server hub

The production address is `https://accio.mediatom.cc`. It uses the existing remotely managed Cloudflare homeserver tunnel, forwarding to `http://accio-hub:47322` on `media_server_default`. No host port or Tailscale is required. The desktop and coding harnesses stay on their own machines.

Behind the tunnel every client reaches the hub from the same address, so `compose.yaml` sets `ACCIO_CLIENT_ADDRESS_HEADER=cf-connecting-ip`: the hub then limits pairing attempts (10 a minute) per real client address, which Cloudflare sets and clients can't forge. Leave it unset when the hub is reachable without a proxy that overwrites that header; it then limits per socket address.

## Provision

Build `Dockerfile.hub` for Linux amd64 or pull a verified image from `ghcr.io/thomas-sievering/accio-hub`. Put `compose.yaml` and `deploy.sh` in `/home/tom/accio`. Provision `/data/configs/accio` for UID/GID 1000 with mode 700, then set `ACCIO_HUB_IMAGE` in `.env` to the immutable image reference and run `docker compose up -d hub` from that directory. Inspect existing state and containers first; this is Compose project `accio`, separate from the media and CLI proxy projects.

For first-device pairing or recovery:

```sh
docker exec accio-hub node dist/main.js --pair
```

In Accio, open Settings / Hubs and enter a name, the public address, and that code within ten minutes. Later codes can also be generated from a paired device. Anyone holding a code can pair a trusted device, so keep it private. There is no public signup or username/password.

Before starting the service, provision `.secrets.env` beside `compose.yaml`, mode 600, containing `ACCIO_SECRET_KEY=<32 random bytes encoded as standard base64>`. Generate it once and preserve it across updates; replacing it makes saved secrets unreadable. Keep a protected backup separately from `/data/configs/accio`. The updater changes only `.env` with the image reference and preserves this key file. Encrypted saved-secret values and the Sorting Hat's admin token live in the mounted state; provider accounts live on the Sorting Hat; temporary secret deliveries stay on each machine.

## Link the Sorting Hat

The hub keeps no accounts; its Sorting Hat ([deploy/sorting-hat](../sorting-hat/README.md)) holds them. In Accio open Settings / Hubs and link it with the address `http://sorting-hat:47330`, the address for threads `https://sortinghat.mediatom.cc` and the admin token. The hub reaches the Sorting Hat on the Docker network; threads on other machines get the public address. Until it is linked, no thread can run. Then link each profile to a house. Each thread's next turn gets a hat key and the address for threads from the hub.

Hubs no longer move accounts they kept themselves before ADR 0018. If `/data/configs/accio/hub` still has a `profiles.json` with accounts, a `sorting-hat.json`, a `sorting-hat-move.json` or a `codex/` folder, the hub hasn't moved them yet. Back up `/data/configs/accio`, run the hub image `ghcr.io/thomas-sievering/accio-hub:0f8364b7522672086ea69b9bf37a0aba81275106` and link it: linking moves the accounts and removes those files. Update only then. Don't restore that backup onto a running hub afterwards, since it would bring back a second live copy of the moved refresh tokens.

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

`/healthz` returns readiness, protocol and durable hub identity. Management endpoints require a paired machine credential; the hub has no model routes. Verify public HTTPS and authenticated WSS after tunnel changes, and a real streamed turn through the Sorting Hat.

The public root shows **Pair this browser** until the browser is paired. In the desktop app, open **Settings → Machines → Pair a browser**, then scan the QR code or type the one-time code at the hub URL. The image serves its own version of the web app. Thread transcripts stream from their machines; the hub does not save them. A browser that has already seen a machine's threads keeps their last list on its Offline shelf when the machine is away.

Back up the protected `/data/configs/accio` directory consistently while the service is stopped. Restore the entire identity and credential store together. Keep machine checkouts, threads, transcripts and harness sessions on their original machine. After restoring, restart only `accio-hub` and verify saved devices reconnect to the same identity.
