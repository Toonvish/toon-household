#!/usr/bin/env bash
#
# Server-side deploy command for toon-household.
#
# THIS IS A FORCED COMMAND, AND THAT IS THE WHOLE POINT. It is installed on the
# server as /usr/local/bin/toon-household-deploy and pinned to the GitHub Actions
# key in ~/.ssh/authorized_keys:
#
#   restrict,command="/usr/local/bin/toon-household-deploy" ssh-ed25519 AAAA… household-deploy
#
# NOTE THE NAME. During the cutover from toon-recipe and toon-finance the old
# apps' deploy commands (/usr/local/bin/toon-deploy, toon-finance-deploy) still
# exist on the same machine, and this script must NOT be merged into one command
# taking an app argument. A forced command hangs off the KEY, so one key can only
# ever drive one app, and that is the property worth having: the key in this
# repository's secret store cannot touch another stack, and vice versa. One
# script per app, one key per script, one authorized_keys line each. A distinct
# name also lets the new key be installed before the old ones are removed.
#
# sshd then ignores whatever the client asked to run and executes this instead,
# putting the client's request in $SSH_ORIGINAL_COMMAND. So the private key that
# lives in GitHub's secret store does not buy a shell on the box: it buys exactly
# the three verbs below, on exactly one image repository, and `restrict` also
# takes away port forwarding, agent forwarding, X11 and a pty.
#
# Two consequences worth knowing:
#
#   * THE IMAGE REPOSITORY IS PINNED HERE, not sent by the client. The caller may
#     choose a digest or `latest`; it may not choose a registry or a path.
#     Otherwise a stolen key could point the server at any image on the internet,
#     which is a root shell in a trench coat.
#   * The workflow does not scp docker-compose.yml or docker/Caddyfile over.
#     `sync-config` below fetches both from the repository instead, and it is
#     deliberately a SEPARATE verb: a configuration change deserves a human, not
#     a silent side effect of every push to main.
#
# `sync-config` DOES FETCH THE CADDYFILE, because the stack has its own Caddy
# (SPEC D11) and, unlike a shared edge proxy, nothing else maintains it:
#
#   * A bad Caddyfile takes the whole site down, so both files are validated
#     BEFORE they are kept (`docker compose config -q` for the compose file, and
#     `caddy validate` inside the caddy image for the Caddyfile, with the stack's
#     .env interpolated by compose). On any failure the previous files are put
#     back and the command fails.
#   * The Caddyfile is a single-file bind mount, which pins the OLD inode. After
#     the file is replaced the running Caddy still serves the old config, and
#     `deploy` never recreates the caddy container, so sync-config restarts the
#     caddy container itself, and only when the Caddyfile actually changed.
#   * A compose change is still applied by the next `deploy`, not here.
#
# Run it by hand exactly as CI does; the arguments work either way:
#
#   toon-household-deploy deploy latest
#   toon-household-deploy deploy sha256:<64 hex>
#   toon-household-deploy sync-config
#   toon-household-deploy status
#
set -euo pipefail

# All overridable from the environment for a non-standard install, but note that
# `restrict` means the SSH client cannot set them: they are the server's call.
APP_DIR="${TOON_APP_DIR:-/opt/toon-household}"
IMAGE_REPO="${TOON_IMAGE_REPO:-ghcr.io/toonvish/toon-household}"
RAW_BASE="${TOON_RAW_BASE:-https://raw.githubusercontent.com/Toonvish/toon-household/main}"

# How long to wait for the container's own HEALTHCHECK (Dockerfile: it calls
# /api/health, so healthy means Hono answers AND the env validated). The image's
# start-period is 40s, so the defaults have to comfortably exceed it.
HEALTH_TRIES="${TOON_HEALTH_TRIES:-40}"
HEALTH_SLEEP="${TOON_HEALTH_SLEEP:-3}"

log() { printf '%s  %s\n' "$(date -Is)" "$*"; }
die() { printf '%s  ERROR: %s\n' "$(date -Is)" "$*" >&2; exit 1; }

# Under a forced command the request arrives in SSH_ORIGINAL_COMMAND; a human
# running this directly passes it as normal arguments.
request="${SSH_ORIGINAL_COMMAND:-$*}"
# shellcheck disable=SC2206  # deliberate word splitting: the request is validated below
set -f  # no globbing: a request like `deploy *` must not expand against the cwd
parts=($request)
set +f
verb="${parts[0]:-}"
ref="${parts[1]:-}"

[ "${#parts[@]}" -le 2 ] || die "Too many arguments: $request"

resolve_image() {
  # ALLOW-LIST, never a pattern match on what is forbidden. Anything that is not
  # `latest` or a well-formed digest is refused outright rather than being passed
  # to docker, which is what keeps a shell metacharacter from ever reaching one.
  case "$ref" in
    latest | "")
      echo "${IMAGE_REPO}:latest"
      ;;
    sha256:*)
      [[ "$ref" =~ ^sha256:[0-9a-f]{64}$ ]] || die "Not a valid digest: $ref"
      echo "${IMAGE_REPO}@${ref}"
      ;;
    *)
      die "Not a valid image reference: $ref (allowed: latest or sha256:<64 hex>)"
      ;;
  esac
}

pin_image_in_env() {
  # Pin the deployed image so a later manual `docker compose up -d` brings up the
  # SAME version instead of drifting back to whatever `latest` points at.
  # Idempotent, and every other line (SESSION_SECRET included) is untouched.
  local image="$1"
  if grep -q '^TOON_IMAGE=' .env; then
    sed -i "s|^TOON_IMAGE=.*|TOON_IMAGE=${image}|" .env
  else
    printf 'TOON_IMAGE=%s\n' "$image" >> .env
  fi
}

wait_for_healthy() {
  local cid status i
  log "Waiting for healthy ..."
  for i in $(seq 1 "$HEALTH_TRIES"); do
    cid="$(docker compose ps -q app 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      status="$(docker inspect --format \
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' \
        "$cid" 2>/dev/null || echo missing)"
    else
      status=missing
    fi
    case "$status" in
      healthy) log "app is healthy"; return 0 ;;
      unhealthy) return 1 ;;
    esac
    [ "$i" -lt "$HEALTH_TRIES" ] || { log "Timed out, status=$status"; return 1; }
    sleep "$HEALTH_SLEEP"
  done
}

cmd_deploy() {
  local image
  image="$(resolve_image)"
  cd "$APP_DIR" 2>/dev/null || die "$APP_DIR does not exist"
  [ -f .env ] || die "$APP_DIR/.env is missing. Template: docker/env.example (SESSION_SECRET + TOON_HOSTNAME)."

  log "Deploying $image"

  # TOON_IMAGE is passed in the ENVIRONMENT rather than written to .env first,
  # because compose reads the environment ahead of the .env file. That ordering is
  # what makes a failed deploy recoverable: .env still names the last version that
  # actually came up healthy, so the operator's fix is one `docker compose up -d`
  # with no editing. The pin below happens only after the health check passes.
  TOON_IMAGE="$image" docker compose pull
  TOON_IMAGE="$image" docker compose up -d --remove-orphans

  # No TOON_IMAGE prefix on this one: it inspects the running container and needs
  # no interpolation, and `VAR=x some_function` leaks VAR into the rest of the
  # script in bash, which would defeat the .env ordering explained above.
  if ! wait_for_healthy; then
    docker compose logs --tail=60 app >&2 || true
    printf '%s\n' \
      "" \
      "The .env still points at the last healthy version. Back to that one:" \
      "    cd $APP_DIR && docker compose up -d" >&2
    die "Container did not become healthy: $image was NOT adopted"
  fi

  pin_image_in_env "$image"

  # Old layers add up fast on a 30 GB VPS disk. Images only, never
  # `system prune --volumes`, which would delete the database.
  docker image prune -af --filter "until=168h" >/dev/null 2>&1 || true

  docker compose ps
}

restore_config() {
  # Put the previous files back (or remove the new ones when there were none).
  # Called only after the new files were moved into place.
  local f
  for f in docker-compose.yml docker/Caddyfile; do
    if [ -f "$f.bak" ]; then
      cp -p "$f.bak" "$f"
    else
      rm -f "$f"
    fi
  done
}

cmd_sync_config() {
  local caddyfile_changed=1 f
  cd "$APP_DIR" 2>/dev/null || die "$APP_DIR does not exist"
  # `docker compose config` below interpolates the .env, so a missing one would
  # fail the validation for a reason that has nothing to do with the download.
  [ -f .env ] || die "$APP_DIR/.env is missing. Template: docker/env.example (SESSION_SECRET + TOON_HOSTNAME)."
  mkdir -p docker
  log "Fetching docker-compose.yml and docker/Caddyfile from the repository"
  # To temp files first: a half-written compose file on a truncated download
  # would leave the next `up -d` with no way to describe the running stack.
  if ! curl -fsSL "$RAW_BASE/docker-compose.yml" -o docker-compose.yml.new \
    || ! curl -fsSL "$RAW_BASE/docker/Caddyfile" -o docker/Caddyfile.new; then
    rm -f docker-compose.yml.new docker/Caddyfile.new
    die "Download failed, nothing changed"
  fi

  # Keep the current files as *.bak (the restore point, and the operator's undo).
  for f in docker-compose.yml docker/Caddyfile; do
    if [ -f "$f" ]; then
      cp -p "$f" "$f.bak"
    else
      rm -f "$f.bak"
    fi
  done
  if [ -f docker/Caddyfile.bak ] && cmp -s docker/Caddyfile.bak docker/Caddyfile.new; then
    caddyfile_changed=0
  fi

  mv docker-compose.yml.new docker-compose.yml
  mv docker/Caddyfile.new docker/Caddyfile

  # Validate BEFORE anything runs on the new files. The caddy check goes through
  # compose so the stack's .env is interpolated the way the real container sees it.
  if ! docker compose config -q >/dev/null; then
    restore_config
    die "The new docker-compose.yml is invalid; the previous files were restored"
  fi
  if ! docker compose run --rm --no-deps --entrypoint caddy caddy validate \
    --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null; then
    restore_config
    die "The new docker/Caddyfile is invalid; the previous files were restored"
  fi

  if [ "$caddyfile_changed" -eq 1 ]; then
    log "docker/Caddyfile changed, restarting caddy"
    docker compose restart caddy \
      || die "The files are in place but caddy did not restart; run: cd $APP_DIR && docker compose restart caddy"
  else
    log "docker/Caddyfile unchanged, caddy not restarted"
  fi
  log "Done. A changed docker-compose.yml takes effect with the next deploy."
}

case "$verb" in
  deploy)
    cmd_deploy
    ;;
  sync-config | status)
    # Neither takes an argument. Refusing one rather than ignoring it keeps a
    # typo'd `sync-config latest` from looking like it did something.
    [ "${#parts[@]}" -eq 1 ] || die "$verb takes no arguments"
    if [ "$verb" = status ]; then
      cd "$APP_DIR" 2>/dev/null || die "$APP_DIR does not exist"
      docker compose ps
    else
      cmd_sync_config
    fi
    ;;
  *)
    die "Unknown command: ${verb:-<empty>} (allowed: deploy, sync-config, status)"
    ;;
esac
