#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec 9>.deploy.lock
flock -n 9 || exit 0
image="${1:-ghcr.io/thomas-sievering/accio-hub:stable-v2}"
docker pull "$image" >/dev/null
digest="$(docker image inspect --format '{{.Id}}' "$image")"
reference="$(docker image inspect --format '{{index .RepoDigests 0}}' "$image")"
[[ "$reference" == *@sha256:* ]] || { printf 'Registry image has no immutable digest.\n' >&2; exit 1; }
if [[ -f .deployed-image-id && "$(cat .deployed-image-id)" == "$digest" ]]; then exit 0; fi
previous="$(cat .env 2>/dev/null || true)"
restore() {
  trap - ERR
  if [[ -n "$previous" ]]; then
    printf '%s\n' "$previous" > .env
    docker compose up -d --no-deps hub || true
  fi
  printf 'Hub deployment failed; restored the previous image reference.\n' >&2
  exit 1
}
trap restore ERR
printf 'ACCIO_HUB_IMAGE=%s\n' "$reference" > .env.pending
mv .env.pending .env
docker compose up -d --no-deps hub
for attempt in {1..20}; do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' accio-hub)"
  if [[ "$status" == healthy ]]; then
    printf '%s\n' "$digest" > .deployed-image-id
    trap - ERR
    printf 'Deployed %s\n' "$image"
    exit 0
  fi
  sleep 2
done
restore
