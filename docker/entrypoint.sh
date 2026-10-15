#!/bin/sh
# =============================================================================
# Container entrypoint: make the data volume usable, then hand over to the API.
#
# Everything here is idempotent — it runs on every start, including a restart
# after a crash and a `docker compose up` on an existing volume.
# =============================================================================
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"

log() { printf '[entrypoint] %s\n' "$*"; }

mkdir -p "$DATA_DIR/uploads"

# NO OCR LANGUAGE-DATA SEEDING HERE ANY MORE, and nothing needs to replace it.
# tesseract.js downloaded ~15 MB of `.traineddata` on first use and cached it under
# $DATA_DIR/tessdata — which is a VOLUME, so the image's build-time copy was hidden
# behind the mount and had to be re-seeded from /app/seed on every fresh volume.
# The native engine reads its language data from /usr/share/tesseract-ocr, i.e. from
# the image itself, where a volume cannot hide it.

# --- schema ------------------------------------------------------------------
# Migrations are applied on every boot. They are the only writer of the schema, so
# a fresh volume gets a working DB with no manual step, and an upgraded image
# applies its new migrations before it starts answering requests.
#
# A FAILED MIGRATION MUST STOP THE CONTAINER. Starting the API against a
# half-migrated database would answer requests with confusing 500s instead, and the
# healthcheck would report the container as fine.
if [ "${SKIP_MIGRATIONS:-}" = "1" ]; then
  log "SKIP_MIGRATIONS=1 — skipping migrations"
else
  log "applying database migrations"
  bun apps/api/scripts/migrate.ts
fi

log "starting: $*"
exec "$@"
