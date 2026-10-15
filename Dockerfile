# syntax=docker/dockerfile:1.7
# =============================================================================
# toon-household — one image, one origin, one port.
#
# The API serves the built PWA from its own port (see
# apps/api/src/middleware/staticWeb.ts), so a deployment needs no second web
# server, no CORS entry and no API URL baked into the bundle. That is the whole
# reason this is a single container and not three.
#
# BUILT FOR A SMALL 64-BIT LINUX SERVER, WHICH SHAPES THREE DECISIONS:
#
#  1. TARGETS ARE linux/amd64 AND linux/arm64, 64-bit only. There is no Bun build
#     for 32-bit anything, so `uname -m` on the host has to say `x86_64` or
#     `aarch64`; a 32-bit userland cannot run this image at all.
#  2. DEBIAN, NOT ALPINE. `sharp` ships prebuilt glibc binaries for both targets;
#     on musl it would be rebuilt from source on the target, which takes the
#     better part of an hour when it works. Debian also has `tesseract-ocr` and
#     `poppler-utils` as ordinary packages, which is what the OCR and PDF
#     pipelines shell out to — installed only for `--build-arg WITH_OCR=1` /
#     `WITH_PDF=1`.
#
# PHOTO AND PDF IMPORT ARE OPT-IN, AND SEPARATELY SO. The default build omits
# tesseract and poppler entirely, so the image stays small enough for a low-spec
# VPS and both are switched off end to end (501 + hidden in the UI). `--build-arg
# WITH_OCR=1` adds German photo import; `WITH_PDF=1` (which WITH_OCR implies unless
# you say otherwise) adds PDFs on top. See docs/deployment.md.
#  3. THE WEB BUNDLE IS BUILT ON THE BUILD PLATFORM ($BUILDPLATFORM), not the
#     target. Its output is architecture-independent JavaScript, so building it
#     natively on the amd64 CI runner instead of under QEMU emulation is the
#     difference between a ~4 minute and a ~40 minute cross-build. Only the native
#     node_modules are installed for the target architecture.
# =============================================================================

ARG BUN_VERSION=1.4.2

# -----------------------------------------------------------------------------
# base — the workspace manifests and the lockfile, shared by every stage below.
# Copying only the manifests first means a source-only change does not invalidate
# the (slow) dependency install.
# -----------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-debian AS manifests
WORKDIR /app
COPY package.json bun.lock ./
# The ROOT tsconfig.json is not optional for the web build: vite/rolldown resolves
# it for the `@toon/shared` path mapping, and its absence fails the build with
# "Tsconfig not found" rather than anything about paths.
COPY tsconfig.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# -----------------------------------------------------------------------------
# web-build — vite build, ALWAYS on the build platform (output is portable JS).
#
# PUBLIC_API_URL is deliberately EMPTY: it makes lib/api.ts emit relative URLs
# ("/api/…"), which is what lets one image work behind any hostname. Baking an
# absolute URL in here would hard-code one deployment's address into the bundle and
# break the moment it is reached by a different name.
# -----------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-debian AS web-build
WORKDIR /app
COPY --from=manifests /app/ ./
RUN bun install --frozen-lockfile
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
ENV PUBLIC_API_URL=""
ENV NODE_ENV=production
# The bundle must not carry the dev fallback API URL: the API's CSP says connect-src 'self',
# so an absolute http://localhost:3001 would block every API call and every upload image on the
# real hostname (toon-finance gotcha 50, m3b plan §7.2). Fail the build instead.
RUN bun --filter @toon/web build && test -f apps/web/dist/index.html && test -f apps/web/dist/sw.js \
    && ! grep -rqF 'localhost:3001' apps/web/dist

# -----------------------------------------------------------------------------
# deps — production node_modules FOR THE TARGET ARCHITECTURE.
#
# The only stage that must run under emulation when cross-building, because this
# is where sharp's arm64 binary is fetched. No compilation happens (it is
# prebuilt), so QEMU is tolerable here.
#
# There is no `tessdata` stage any more: OCR language data used to be downloaded at
# build time because tesseract.js fetches its ~15 MB `.traineddata` over HTTPS on
# first use. The native engine reads it from an OS package instead (installed in
# the runtime stage), so the download, the seed copy and the entrypoint's volume
# seeding are all gone.
# -----------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-debian AS deps
WORKDIR /app
COPY --from=manifests /app/ ./
RUN bun install --frozen-lockfile --production

# -----------------------------------------------------------------------------
# runtime
# -----------------------------------------------------------------------------
FROM oven/bun:${BUN_VERSION}-debian AS runtime
WORKDIR /app

# --- optional: native OCR + PDF rasterization -------------------------------
# PHOTO AND PDF IMPORT ARE OPT-IN AT BUILD TIME, AND THEY ARE TWO SEPARATE ARGS.
# The default build leaves both out, which is what lets the image run on a small
# VPS. URL and text import need none of this.
#
#   WITH_OCR=1   tesseract-ocr + tesseract-ocr-deu  (~105 MB) — PHOTO import.
#                Debian's tesseract-ocr HARD-DEPENDS on tesseract-ocr-eng and
#                pulls -osd, so English data is present whether or not it is
#                asked for; TESSERACT_LANGS is therefore a runtime lever (speed
#                and memory), not a build-time one. Any OTHER language still
#                needs its own tesseract-ocr-<lang> package added here — a
#                missing one fails at recognise time, not at boot.
#   WITH_PDF=1   poppler-utils, i.e. pdftoppm (~28 MB) — the PDF rasterizer,
#                services/ocr/pdf.ts.
#
# WHY THEY SPLIT. A photo is one tesseract run; a scanned PDF is up to
# MAX_PDF_PAGES of them, and on a one-core VPS that cannot finish inside
# OCR_TIMEOUT_MS however much RAM the box has. So `--build-arg WITH_OCR=1
# --build-arg WITH_PDF=0` is a real, supported image: German photo import on a
# 1 GB box, PDFs honestly switched off rather than offered and timing out.
#
# WITH_PDF DEFAULTS TO WITH_OCR, so the pre-split invocation (`--build-arg
# WITH_OCR=1` alone) still produces exactly the image it always did.
#
# The runtime flags DEFAULT TO THE BUILD ARGS, so the image is self-consistent: it
# advertises `features.{ocrImport,pdfImport}` to match what is installed, its
# upload endpoints answer 501 for what is missing, and the web UI stops offering
# it. Overriding a flag on an image without the binary is not a crash — the
# pipeline answers the documented 422 naming it — but there is no reason to do it.
#
# tini reaps zombies and forwards signals. Keep it even without OCR: it is PID 1 for
# the whole container, and with OCR every recognition is a CHILD PROCESS that would
# otherwise be left a zombie on an aborted or timed-out import.
ARG WITH_OCR=0
ARG WITH_PDF=${WITH_OCR}
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
      tini \
      ca-certificates \
 && if [ "$WITH_OCR" = "1" ]; then \
      apt-get install --no-install-recommends -y \
        tesseract-ocr \
        tesseract-ocr-deu \
      && tesseract --version \
      && tesseract --list-langs; \
    else \
      echo "[build] OCR left out (WITH_OCR=$WITH_OCR): photo import is disabled."; \
    fi \
 && if [ "$WITH_PDF" = "1" ]; then \
      apt-get install --no-install-recommends -y poppler-utils \
      && pdftoppm -v; \
    else \
      echo "[build] poppler left out (WITH_PDF=$WITH_PDF): PDF import is disabled."; \
    fi \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    API_PORT=3001 \
    # The API serves the PWA itself — this is what makes it one origin.
    WEB_DIST_DIR=/app/apps/web/dist \
    DATABASE_URL="file:/app/data/local.db" \
    UPLOAD_DIR=/app/data/uploads \
    # Matches what was actually installed above; override only to turn a feature
    # OFF on an image built with it.
    IMPORT_OCR_ENABLED=${WITH_OCR} \
    IMPORT_PDF_ENABLED=${WITH_PDF} \
    TESSERACT_LANGS="deu+eng"

COPY --from=manifests /app/package.json ./package.json
COPY --from=manifests /app/apps/api/package.json ./apps/api/package.json
COPY --from=manifests /app/apps/web/package.json ./apps/web/package.json
COPY --from=manifests /app/packages/shared/package.json ./packages/shared/package.json
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY --from=web-build /app/apps/web/dist ./apps/web/dist

# --- node_modules: THREE directories, not one -------------------------------
# Bun 1.4 uses the ISOLATED linker for workspaces. The real packages live in the
# store at `node_modules/.bun/<pkg>@<version>/`, and each workspace gets its OWN
# `node_modules` full of symlinks into it — `/app/node_modules` itself contains
# nothing but `.bun`.
#
# Copying only the root therefore produces an image that builds, starts, and dies
# on the first import with "Cannot find module '@libsql/client'". All three paths
# have to come across for the symlinks to resolve. apps/web is absent on purpose:
# its bundle is already built.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# `bun` is the unprivileged user the oven/bun images ship with (uid 1000, which is
# also the default `pi` uid — so a bind-mounted ./data is writable without chown).
# docs/migration.md step 6 chowns a pre-filled volume to this uid.
RUN mkdir -p /app/data/uploads && chown -R bun:bun /app/data
USER bun

VOLUME ["/app/data"]
EXPOSE 3001

# Uses the API's own health endpoint, so "healthy" means Hono is answering and the
# env validated — not merely that the process exists.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:'+(process.env.API_PORT??3001)+'/api/health'); process.exit(r.ok ? 0 : 1)"

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["bun", "apps/api/src/index.ts"]
