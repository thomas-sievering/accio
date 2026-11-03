# Home-server hub

The production address is `https://accio.mediatom.cc`. It uses the existing remotely managed Cloudflare homeserver tunnel, forwarding to `http://accio-hub:47322` on `media_server_default`. No host port or Tailscale is required. The desktop and coding harnesses stay on their own machines.

## Provision

Build `Dockerfile.hub` for Linux amd64 or pull a verified image from `ghcr.io/thomas-sievering/accio-hub`. Put `compose.yaml` and `deploy.sh` in `/home/tom/accio`. Provision `/data/configs/accio` for UID/GID 1000 with mode 700, then set `ACCIO_HUB_IMAGE` in `.env` to the immutable image reference and run `docker compose up -d hub` from that directory. Inspect existing state and containers first; this is Compose project `accio`, separate from the media and CLI proxy projects.

For first-device pairing or recovery:

```sh
docker exec accio-hub node dist/main.js --pair
```

In Accio, open Settings / Hubs and enter a name, the public address, and that code within ten minutes. Later codes can also be generated from a paired device. Anyone holding a code can pair a trusted device, so keep it private. There is no public signup or username/password.

Before starting the service, provision `.secrets.env` beside `compose.yaml`, mode 600, containing `ACCIO_SECRET_KEY=<32 random bytes encoded as standard base64>`. Generate it once and preserve it across updates; replacing it makes saved secrets unreadable. Keep a protected backup separately from `/data/configs/accio`. The updater changes only `.env` with the image reference and preserves this key file. Provider credentials and encrypted saved-secret values live in the mounted state; temporary secret deliveries stay on each machine.

## Automatic updates

GitHub Actions in `.github/workflows/hub.yml` verifies changes before publishing a commit image. Successful `main` builds also advance `stable-v1`. A branch build publishes only its commit tag. The private registry requires a token with `read:packages` on the server, supplied privately to `docker login ghcr.io --password-stdin`.

Install `accio-update.service` and `accio-update.timer` under `~/.config/systemd/user/`, then run:

```sh
systemctl --user daemon-reload
systemctl --user enable --now accio-update.timer
```

The user must have lingering enabled so updates survive logout/reboot. Inspect with `loginctl show-user tom -p Linger`. Check updates with `systemctl --user status accio-update.timer` and `journalctl --user -u accio-update.service`. To deploy a specific published commit manually, pass its full registry image reference to `./deploy.sh`.

The updater changes only this hub service. It leaves existing media routes and containers running. It checks health before retaining the new digest, and restores the previous image reference if health fails. This does not reverse a state-format migration. Keep protocol-incompatible releases off the current deployment tag.

## Check and recover

`/healthz` returns readiness, protocol and durable hub identity. Management endpoints require a paired device credential; model routes require a restricted model key. Verify public HTTPS, authenticated WSS and real streamed model traffic after tunnel changes. The public root is setup information.

Back up the protected `/data/configs/accio` directory consistently while the service is stopped. Restore the entire identity and credential store together. Never run two live copies of imported refresh tokens. Keep machine checkouts, threads, transcripts and harness sessions on their original machine. After restoring, restart only `accio-hub` and verify saved devices reconnect to the same identity.
