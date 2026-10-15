# M6 — deploy: plan

**Status: DONE (2026-10-15)** (planned and revised the same day after the plan review, integrated by T08) (T03's empty-hostname
proof and its route-coverage check, T05's SHA rule and German strings, the local stack's own compose
project, `docs/migration.md` step 8; listed in section 7). Section 9 (integration record) and section 10
("what changed vs plan") were written by the integration task T08.

Milestone M6 of `docs/SPEC.md` §8, written by the planner of the `build-household` workflow. Paths:
`H` = `/home/erics/software/toon-household` (this repo), `R` = `/home/erics/software/toon-recipe`,
`F` = `/home/erics/software/toon-finance`, `E` = `/home/erics/software/toon-edge`. R, F and E are
READ-ONLY: `cat`, `grep`, `diff`, `git show`, `git log`, copying text out of them; never run
`bun install`, `bun test`, `docker` or any script inside them.

Goal (SPEC D11, §3, §7, §8 M6): the app ships as one image (`ghcr.io/toonvish/toon-household`) in one
compose stack with its own Caddy, in the shape toon-recipe had before toon-edge (`R` commit
`a369217^`): `app` + `caddy`, bridge network `toon`, volumes `toon-data`, `caddy-data`,
`caddy-config`, Caddy `2.11.4-alpine` pinned, `443/udp`, memory limits, json-file logging. The
Caddyfile takes toon-edge's `(hardening)` and `(fwd)` snippets verbatim, serves `TOON_HOSTNAME` with
the recipe import timeouts, optionally redirects `RECIPE_HOSTNAME` and `FINANCE_HOSTNAME` to it, and
keeps the plain-http block with the local CA download. `docker/env.example`, `docker/entrypoint.sh`,
`docker/toon-deploy.sh`, `.github/workflows/{release,deploy}.yml` (publishing `WITH_OCR=1 WITH_PDF=0`)
and `docs/deployment.md` (fresh install, cutover from toon-edge, local stack test) complete it.

Exit (as the workflow states it):

1. `docker build -t toon-household:local . > build.log 2>&1` exits 0, checked by `$?` (never through
   a pipe);
2. `docker compose --env-file .env.local-stack up -d` serves the PWA with `TOON_TLS_ISSUER=internal`
   and `/api/health` is healthy (the env file's `COMPOSE_PROJECT_NAME=toon-household-local` keeps the
   test off the production project `toon-household` and its volumes, decision 5);
3. `caddy validate` passes with the old hostnames set and unset;
4. `docs/deployment.md` has the cutover section.

## 1. Context

### 1.1 State of H at plan time

`main` at `ca7da99` (M3b closed, after M5). Re-run by the planner on 2026-10-15: `bun run typecheck`
`[typecheck] OK`; `bun test` **2202 pass, 0 fail, 129 files** (23.3 s). Milestones M0 to M5 and M3b are
done (CLAUDE.md "Status"). `API_MODULES` / `WEB_MODULES` are `[recipe, finance]`.

What exists and M6 builds on (NOT rebuilt):

- `apps/api/src/middleware/staticWeb.ts` serves `WEB_DIST_DIR` from the API port (sw.js, index.html,
  the manifest `no-cache`; hashed assets immutable; `.webmanifest` as `application/manifest+json`).
- `apps/api/src/middleware/securityHeaders.ts` (CSP hashed over the BUILT `index.html` at boot, no
  HSTS: "the Caddy owns it") and `middleware/originGuard.ts` (trusts `WEB_ORIGIN`), both M3b.
  `connect-src 'self'` presumes a build with `PUBLIC_API_URL=""` (F gotcha 50). Since `af71df1`
  `apps/web/src/lib/api.ts` falls back to `import.meta.env.PROD ? "" : "http://localhost:3001"`, so
  `! grep -rlF 'localhost:3001' apps/web/dist` holds for a production build.
- `apps/api/src/core/services/auth/rateLimit.ts` reads the LAST `X-Forwarded-For` hop when
  `TRUST_PROXY=1` (F gotcha 74).
- `apps/api/scripts/migrate.ts` (applies migrations and every module's `afterMigrate`; supplies a
  placeholder `SESSION_SECRET` only when none is set), `scripts/seed.ts` (refuses `NODE_ENV=production`
  without `ALLOW_SEED=1` plus a `SEED_PASSWORD` of 10+ characters), `scripts/reset-password.ts`,
  `scripts/uploads-gc.ts`, `scripts/plan-run.ts`, `scripts/migrate-legacy.ts` + `scripts/legacy/`.
  `apps/api/drizzle/` holds `0000_core` .. `0003_placeholder_members`.
- `apps/api/src/env.ts`: `REPO_ROOT` is three levels above `src/` (in the image: `/app`), relative
  `DATABASE_URL` / `UPLOAD_DIR` / `WEB_DIST_DIR` resolve against it; variables `NODE_ENV`,
  `DATABASE_URL`, `API_PORT`, `DEFAULT_LOCALE`, `WEB_ORIGIN`, `SESSION_SECRET` (production refuses the
  `change-me…` placeholder), `PUBLIC_API_URL`, OAuth, `OAUTH_REDIRECT_BASE`, `UPLOAD_DIR`,
  `IMPORT_OCR_ENABLED`, `IMPORT_PDF_ENABLED`, `IMPORT_OCR_CONCURRENCY`, `TESSERACT_LANGS`,
  `TESSERACT_BIN`, `PDFTOPPM_BIN`, `WEB_DIST_DIR`, `MAIL_*`, `DEBUG_SQL`, `IMPORT_ALLOW_PRIVATE_HOSTS`,
  `TRUST_PROXY`.
- `.github/workflows/ci.yml` (one `verify` job, SHA-pinned actions, poppler step, `PUBLIC_API_URL: ""`
  build, PWA output asserted; its header says "docker-build is added by M6 together with the
  Dockerfile").
- `.gitignore` already ignores `.env.*` with the exceptions `!.env.example` and **`!.env.local-stack`**
  (M0 prepared it), and `*.log` (so the exit's `build.log` in the repo root is never committed).
- `docs/migration.md` "Cutover order" (steps 1 to 9) uses `<new-volume>` and `/app/data/local.db` as
  placeholders "to check against `docs/deployment.md`"; `apps/api/test/legacy-migration-doc.test.ts`
  guards its step 6 (the copy-in command ending with `chown -R 1000:1000 /data`).
- Four source comments still describe toon-edge as the TLS terminator: `apps/api/src/index.ts:67`,
  `apps/api/src/middleware/originGuard.ts:7`, `apps/api/src/core/services/auth/rateLimit.ts:145`,
  `apps/api/src/middleware/securityHeaders.ts:8`.
- Not present: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker/`, `.env.local-stack`,
  `.github/workflows/{release,deploy}.yml`, `docs/deployment.md`.
- Stray, untracked, empty directories at the repo root (`collections/`, `plan/`, `recipes/`,
  `shopping/`, `tags/`, each holding only an empty `lib/`): leftovers of an earlier session, invisible to
  git. The Dockerfile copies named paths only, so they never reach an image; nobody touches them in M6.

### 1.2 The sources, by file

| Target in H | Source | Shape |
| --- | --- | --- |
| `Dockerfile` | `R/Dockerfile` (HEAD; identical to `a369217^` except `BUN_VERSION=1.4.2`) | port with the rewrites of T01 |
| `.dockerignore` | `R/.dockerignore` | port plus H's paths |
| `docker/entrypoint.sh` | `R/docker/entrypoint.sh` (log line from `F/docker/entrypoint.sh`) | port |
| `docker-compose.yml` | `git -C R show 'a369217^:docker-compose.yml'` plus F's `cap_drop` / `security_opt` block (`F/docker-compose.yml`, service `app`) | build |
| `docker/env.example` | `git -C R show 'a369217^:docker/env.example'` (German) | build: English (D15), H's variables |
| `docker/Caddyfile` | `git -C R show 'a369217^:docker/Caddyfile'` for the site/http blocks, `E/Caddyfile` for `(hardening)` and `(fwd)` verbatim | core |
| `docker/toon-deploy.sh` | `F/docker/toon-deploy.sh` (`set -f`, F's argument checks) plus `git -C R show 'a369217^:docker/toon-deploy.sh'` `cmd_sync_config` (fetches the Caddyfile too) | build |
| `.github/workflows/release.yml` | `F/.github/workflows/release.yml` (SHA pins, tags, `latest`, deploy gate) plus `R/.github/workflows/release.yml` (poppler step, `build-args: WITH_OCR=1 WITH_PDF=0`) | port |
| `.github/workflows/deploy.yml` | `F/.github/workflows/deploy.yml` | port |
| `.github/workflows/ci.yml` `docker-build` job | `F/.github/workflows/ci.yml` job `docker-build` | port |
| `docs/deployment.md` | `git -C R show 'a369217^:docs/deployment.md'` (German, 1045 lines), `E/README.md`, `docs/migration.md` | build: English (D15) |
| `.env.local-stack` | `git -C R show 'a369217^:docs/deployment.md'` "Lokal testen, ohne Server" | build |

### 1.3 What M6 must close (CLAUDE.md "Obligations", m3b plan §7.2, m2/m3/m5 plans)

1. D11 as written (compose shape, Caddy pin, snippets verbatim, import timeouts, optional redirect
   blocks, local CA download, `release.yml` + `deploy.yml` + `toon-deploy.sh`, cutover doc).
2. From F `97ab955`, `590697f`, `1715207` (m3b plan §7.2): `cap_drop: [ALL]` and
   `security_opt: [no-new-privileges:true]` on `app`; any mailpit on `127.0.0.1` and on no shared network
   (H ships none, and keeps R's comment that says so); `release.yml` publishes on push to `main` and on
   `v*` tags, `:latest` from `type=raw,value=latest,enable={{is_default_branch}}`, typecheck and test
   BEFORE the push, `provenance: false`, a digest output, actions pinned to commit SHAs; `deploy.yml`
   gated by the repository VARIABLE `DEPLOY_ENABLED`; the GHCR-visibility note; `toon-deploy.sh` with
   `set -f` and argument checks; `env.example` with `TOON_IMAGE`, `TRUST_PROXY=1` in the app's
   environment and no TLS variable in the APP's environment (decision 6); the Caddy keeps
   `header_up X-Forwarded-For {remote_host}` and sends the only HSTS; the seed in the container refuses
   production without `ALLOW_SEED=1` + `SEED_PASSWORD` (exists; documented); **the Dockerfile's web build
   sets `PUBLIC_API_URL=""` explicitly and the image check greps the built assets for
   `localhost:3001`**; a service name is never reused on a shared network (F gotcha 19; H has no shared
   network).
3. Old-path redirects (m2 plan §8, m3 plan §8, CLAUDE.md): R's `/recipes/…`, `/plan`, `/shopping`,
   `/import` and F's `/transactions`, `/new`, `/plan`, `/categories`, `/household` for bookmarks that
   arrive through the old-hostname redirect, "with the Caddyfile; note `/plan` exists in both sources".
4. `WITH_OCR=1 WITH_PDF=0` for the published image (m2 plan, R CLAUDE.md "The Dockerfile installs the OCR
   binaries only for …").
5. From M5: `docs/deployment.md` "Cutover from toon-edge" links `docs/migration.md` and names the new
   stack's volume and image for the copy-in step; `migration.md` step 6's `<new-volume>`,
   `/app/data/local.db` and `chown -R 1000:1000 /data` are checked against the real image (`bun` uid).
6. The `docker-build` CI job (M0 plan §4: "M6 adds it with the Dockerfile").

### 1.4 Environment facts (planner, 2026-10-15)

Docker Engine 29.9.0, Compose 2.40.3, buildx 0.38.0 on the dev machine; 16 cores, 60 GB RAM, 460 GB
free. Nothing listens on host ports 80 or 443 (`ss -ltnu`); 8080 is taken on loopback by something
else. Other compose projects run on this machine (a `default-ma-59179` stack with its own caddy that
publishes no ports): T08 must check 80/443 again before `up` and must not touch foreign containers.
No `caddy`, `shellcheck`, `hadolint` or `actionlint` binary on the host: Caddy is only ever run from the
pinned image (`docker run --rm caddy:2.11.4-alpine …`); shell scripts are checked with `bash -n` /
`sh -n` plus the stub-driven test of T04; workflows are checked by the YAML test of T05. `Bun.YAML.parse`
exists in Bun 1.4.2 (checked). The machine cannot run GitHub Actions; `release.yml` / `deploy.yml` are
verified statically only, and nothing is pushed (the workflow never pushes).

## 2. Decisions

1. **Names.** Compose project `name: toon-household`, so the volumes are `toon-household_toon-data`,
   `toon-household_caddy-data`, `toon-household_caddy-config` and the network `toon-household_toon`.
   Server directory `/opt/toon-household`. Forced command `/usr/local/bin/toon-household-deploy` (R
   owns `toon-deploy`, F `toon-finance-deploy` on the same server until the cutover's last step; a
   distinct name lets the new key be installed before the old ones are removed). Image repository
   `ghcr.io/toonvish/toon-household`, raw base
   `https://raw.githubusercontent.com/Toonvish/toon-household/main`. Deploy concurrency group
   `deploy-toon-household`. Local stack hostnames `haushalt.test`, `rezepte.test`, `finanzen.test`;
   example production hostname `haushalt.example.org` (old ones `rezepte.example.org`,
   `finanzen.example.org`, E's examples).
2. **Language.** Every comment, log line and message in the new deploy files is English (D15:
   docs in English). R's Dockerfile is already English except two `echo` lines; R's `env.example`,
   R's `docs/deployment.md` and both `toon-deploy.sh` messages are German and are translated with
   their substance kept. German UI copy is untouched (no UI change in M6).
3. **The Dockerfile is R's, plus one guard.** The web-build stage keeps R's `ENV PUBLIC_API_URL=""`
   (set and empty) and its `RUN` line gains `&& ! grep -rqF 'localhost:3001' apps/web/dist`, so an
   image whose bundle carries the dev fallback cannot be built at all (m3b §7.2 "the image check greps
   the built assets"; the same grep runs on the built image in T08). Everything else is R's, including
   the three `node_modules` copies (R CLAUDE.md "Bun 1.4 uses the ISOLATED linker"), tini, `USER bun`
   (uid 1000), `VOLUME ["/app/data"]`, the HEALTHCHECK on `/api/health`, the `WITH_OCR` / `WITH_PDF`
   args and the runtime flags defaulting to them.
4. **Compose is R's pre-toon-edge file plus F's hardening.** `app` gets F's `security_opt` /
   `cap_drop` block verbatim (comment included); `caddy` does NOT (as root it needs
   `CAP_NET_BIND_SERVICE` for 80/443). No mailpit service; R's comment explaining why (and how to bind
   one to `127.0.0.1` if ever added) stays. `app` environment additionally passes `DEFAULT_LOCALE`
   (`${DEFAULT_LOCALE:-de}`, F's compose had it fixed to `de`). `MAIL_FROM` defaults to
   `Haushalt <haushalt@localhost>`. `mem_limit: ${TOON_MEM_LIMIT:-768m}` (R's value; R's env.example
   explains the measured OCR peak). The `caddy` service passes `TOON_HOSTNAME` (`:?` required),
   `TOON_TLS_ISSUER`, `TOON_HSTS_MAX_AGE` (as R) and `RECIPE_HOSTNAME` / `FINANCE_HOSTNAME` with
   compose defaults `http://old-recipe-hostname.unset.invalid` /
   `http://old-finance-hostname.unset.invalid` (compose's `:-` also covers set-but-empty, which Caddy's
   own `{$VAR:default}` does not: decision 7), so the Caddy container always gets a non-empty address.
5. **`.env.local-stack` is committed** (the `.gitignore` exception exists since M0) and runs as its OWN
   compose project. Eight keys: `COMPOSE_PROJECT_NAME=toon-household-local`,
   `TOON_IMAGE=toon-household:local`, `TOON_HOSTNAME=haushalt.test`, a 48-hex dummy `SESSION_SECRET` that
   does not start with `change-me`, `TOON_TLS_ISSUER=internal`, `TOON_HSTS_MAX_AGE=0`,
   `RECIPE_HOSTNAME=rezepte.test`, `FINANCE_HOSTNAME=finanzen.test`, with a header comment "local stack
   test only; never use these values on a server". R's "Lokal testen" ran under `-p toonstack` for the
   same reason: without a project name of its own, compose's `name: toon-household` would put the test on
   the production names (`toon-household_toon-data`), and a `down -v` run from a checkout on the server
   (the cutover offers one, decision 13) would delete the production data volume. Compose takes
   `COMPOSE_PROJECT_NAME` from `--env-file` over the top-level `name:`, and `-p` over both (checked by the
   planner with Compose 2.40.3: a file with `name: toon-household` and an env file with
   `COMPOSE_PROJECT_NAME=toon-household-local` gives `config` → `name: toon-household-local`; adding
   `-p other` gives `name: other`). Belt and braces: every local-stack command in `docs/deployment.md`
   also spells `-p toon-household-local` (R's shape), and the doc test pins that every `down -v` in the
   doc sits on such a line. The production `.env` (from `docker/env.example`) never sets
   `COMPOSE_PROJECT_NAME`. `.dockerignore`'s `.env.*` keeps the file out of every build context.
6. **TLS variables live with the Caddy, not the app.** m3b §7.2 says "no TLS variables" in
   `env.example` because in F's toon-edge world the proxy had its own `.env`. In D11's single stack the
   one `.env` feeds both services (R's pre-toon-edge shape), so `docker/env.example` documents
   `TOON_TLS_ISSUER` / `TOON_HSTS_MAX_AGE` as OPTIONAL Caddy settings, and the `app` service's
   `environment:` carries neither (T02's test pins that). Same for `RECIPE_HOSTNAME` /
   `FINANCE_HOSTNAME`.
7. **One certificate issuer for every site, set globally.** The Caddyfile's global options gain
   `cert_issuer {$TOON_TLS_ISSUER:acme}` next to `admin off`, so the optional redirect sites use the
   same issuer as the main site without a per-site `tls` block (a `tls` block in a site whose only
   address is the `http://…invalid` default would be a config error). The `TOON_HOSTNAME` site keeps
   R's explicit `tls { issuer {$TOON_TLS_ISSUER:acme} }`.
   **Caddy treats an empty variable as set.** `{$VAR:default}` falls back to the default only when the
   variable is UNSET: a set-but-empty `RECIPE_HOSTNAME` leaves a site block without an address, and
   `caddy adapt` fails with `Error: server block without any key is global configuration, and if used,
   it must be first` (checked by the review and again by the planner on `caddy:2.11.4-alpine`,
   2026-10-15). So the Caddyfile's `{$…:http://…unset.invalid}` default covers only the unset case, and
   set-but-empty is covered by compose's `:-` defaults (decision 4), which always hand the Caddy container
   a non-empty value. The empty case is therefore proven only THROUGH COMPOSE (`docker compose --env-file
   <file with RECIPE_HOSTNAME= and FINANCE_HOSTNAME=> config` shows the two defaults; `docker compose …
   run --rm --no-deps --entrypoint caddy caddy validate …` passes), never with a raw `docker run -e
   RECIPE_HOSTNAME=`, whose failure is expected. Every documented way to run or validate the Caddy goes
   through compose. Fallbacks: only if the global `cert_issuer` is rejected or misread (the set, unset or
   acme `caddy adapt` runs fail, or a site in the internal runs is not on the `internal` issuer), T03
   falls back to per-site `tls { issuer … }` blocks plus a different unset mechanism proven with `caddy
   adapt`, inside `docker/Caddyfile` only. The failing raw-docker empty run is never a reason for a
   fallback. A fallback that needs `docker-compose.yml` (e.g. an `sh` wrapper as the caddy service's
   `command` writing `/etc/caddy/old-hosts/*.caddy` for an `import` glob) is not T03's: T02 owns that
   file in the same wave, so T03 records the need in its commit body and T08 applies it after the merge
   in its own commit. Any fallback taken is recorded in section 10.
8. **The old hostnames redirect PATH BY PATH and retire the old service workers (ADR 0008).** D11's
   literal text is one `redir https://{$TOON_HOSTNAME}{uri} permanent` per old hostname. That rule
   alone sends a bookmark of `https://rezepte…/plan` to `/plan` (NotFound in H) and leaves every
   INSTALLED old PWA running its precached shell forever: the browser's service-worker update check
   gets a redirect for `/sw.js`, which is a failed update, so the old worker keeps serving the old
   `index.html` whose `/api` calls are redirected cross-origin and fail. Hence each old-host block
   (Table R, section 3): (a) maps the source's own paths to H's (`/plan` → `/recipe/plan` on the recipe
   host, `/finance/plan` on the finance host: the collision disappears because each host has its own
   block), (b) answers `/sw.js` with a 200 self-retiring worker (decision 9), (c) falls back to
   D11's `{uri}` redirect for everything else (auth paths, `/uploads`, `/api`, unknown paths). This
   departs from D11's literal wording, so T03 writes **ADR 0008** and edits the D11 sentence in the
   same commit. No other SPEC §1 change is expected.
9. **The retiring worker** (served by Caddy on each old hostname at `/sw.js`,
   `Content-Type: text/javascript; charset=utf-8`, `Cache-Control: no-cache`), exactly:

   ```js
   // Retires the service worker of the app that used to live on this hostname (toon-household ADR 0008).
   self.addEventListener("install", () => self.skipWaiting());
   self.addEventListener("activate", (event) => {
     event.waitUntil((async () => {
       for (const key of await caches.keys()) await caches.delete(key);
       await self.clients.claim();
       await self.registration.unregister();
       for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
     })());
   });
   ```

   The reload then reaches the network, gets the 301 and lands on H. IndexedDB (the persisted TanStack
   cache with any unsent offline write) is NOT touched and is lost to the user anyway once the old API
   is gone: `docs/deployment.md`'s cutover tells everybody to open both old apps online once before the
   cutover so their outboxes drain (R's shopping list, F's capture).
10. **Status code.** `permanent` (301), as D11 and R's http block. Browsers cache 301s, so the map must be
    right before go-live; T08 checks every row of Table R with curl.
11. **`toon-deploy.sh` is F's script plus R's pre-toon-edge `sync-config`, made safe.** F's argument
    checks and `set -f`; verbs `deploy [latest|sha256:<64 hex>]`, `sync-config`, `status`; `APP_DIR`,
    `IMAGE_REPO`, `RAW_BASE` per decision 1; messages in English. `sync-config` downloads BOTH
    `docker-compose.yml` and `docker/Caddyfile` to `*.new`, keeps the current files as `*.bak`, moves the
    new ones into place, runs `docker compose config -q` and
    `docker compose run --rm --no-deps --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile
    --adapter caddyfile` (the stack's `.env` interpolated by compose), and on any failure restores the
    `*.bak` files and dies. When the Caddyfile changed (`cmp`), it restarts the caddy container
    (`docker compose restart caddy`): a single-file bind mount pins the old inode, so without a restart
    the running Caddy keeps the old config, and `deploy` never recreates caddy. A compose change is
    still applied by the next `deploy` (R's behaviour). E's lesson stands: a bad Caddyfile takes the
    site down, so it is validated before it is used.
12. **Workflows are F's (SHA-pinned) with R's two additions.** `release.yml` = F's file with the
    names rewritten, R's "Install poppler" step before `bun test` (H's `pdf-rasterize.test.ts` fails
    without `pdftoppm`; F's release has no such test), and R's `build-args` block (`WITH_OCR=1`,
    `WITH_PDF=0`) with its comment. `deploy.yml` = F's file with the names rewritten. `ci.yml` gains F's
    `docker-build` job (pull requests only, amd64, no push) with the same `build-args` as the release, so a
    pull request builds the image that would be published.
13. **The migration can run from the new image.** `docs/deployment.md`'s cutover offers two ways to run
    `migrate:legacy`: from a checkout with Bun (as `docs/migration.md` shows) or from the new image
    without Bun on the server: `docker run --rm --user 1000:1000 -e DATABASE_URL=file:/work/migration-out/
    toon.db -e UPLOAD_DIR=/work/migration-out/uploads -e WEB_ORIGIN=https://<new-hostname> -v "$PWD:/work"
    --entrypoint bun ghcr.io/toonvish/toon-household:latest apps/api/scripts/migrate-legacy.ts …` (the
    image carries `apps/api/scripts/`; T08 rehearses it on the fixtures and fixes the command if the
    rehearsal disagrees).
14. **Doc and config guards are tests.** Following `legacy-migration-doc.test.ts` and
    `design-system.test.ts`, each deploy artefact gets a bun test that pins its load-bearing lines (T01
    to T07). They run in CI without Docker; Docker itself is exercised only in T08.
15. **Comments that say toon-edge are corrected, nothing else in app code changes.** The four comments
    of section 1.1 are reworded to "the stack's own Caddy (SPEC D11)" (T06). If T08 finds a real defect
    it is fixed in its own commit with the failing check named, as in every milestone.

## 3. Table R — old-hostname redirects (decision 8)

Targets are `https://{$TOON_HOSTNAME}` plus the path below. `{uri}` is path plus query; `{?query}` is the
query with a leading `?` when non-empty (if the pinned Caddy lacks the shorthand, use
`{http.request.uri.query}` with an explicit `?` and record it). Source routes: `R/apps/web/src/router.tsx`
(`/`, `/search`, `/recipes/new`, `/recipes/$recipeId`, `/recipes/$recipeId/edit`, `/import`,
`/import/$draftId`, `/collections`, `/collections/$collectionId`, `/shopping`, `/shopping/cards`,
`/shopping/history`, `/shopping/$listId`, `/tags`, `/plan`, `/groups`, `/groups/$groupId`, `/settings`,
auth routes) and `F/apps/web/src/` routes (`/`, `/transactions`, `/transactions/$transactionId`,
`/transactions/$transactionId/edit`, `/new`, `/plan`, `/categories`, `/household`, `/settings`,
`/login`, `/register`, `/invite/$token`, `/password/forgot`, `/password/reset`).

**Recipe host (`RECIPE_HOSTNAME`)**

| Old path (matcher) | Target | Why |
| --- | --- | --- |
| `/sw.js` | 200, the retiring worker (decision 9) | installed old PWAs |
| `/` | `/recipe{?query}` | R's `/` is the recipe list (H `/recipe`, same search keys) |
| `/search` | `/recipe{?query}` | R redirected `/search` to `/` with the same params |
| `/recipes/*` | `/recipe{uri}` | `/recipe/recipes/new`, `/recipe/recipes/$id`, `…/edit` |
| `/import`, `/import/*` | `/recipe{uri}` | |
| `/collections`, `/collections/*` | `/recipe{uri}` | |
| `/tags` | `/recipe{uri}` | |
| `/shopping`, `/shopping/*` | `/recipe{uri}` | incl. `/shopping/cards`, `/shopping/history` |
| `/plan` | `/recipe{uri}` | the collision: recipe host means the meal plan |
| `/groups` | `/households{?query}` | D1 rename |
| `/groups/*` | `/households/<rest>{?query}` | group id = household id (SPEC §6 step 3) |
| everything else | `{uri}` (D11's rule) | `/settings`, `/login`, `/register`, `/forgot-password`, `/reset-password/*` (R's tokens are migrated, §6 step 5), `/verify-email/*`, `/invite/*`, `/oauth/callback`, `/uploads/*`, `/api/*` |

**Finance host (`FINANCE_HOSTNAME`)**

| Old path (matcher) | Target | Why |
| --- | --- | --- |
| `/sw.js` | 200, the retiring worker | installed old PWAs |
| `/` | `/finance` | F's `/` is the overview |
| `/transactions`, `/transactions/*` | `/finance{uri}` | list, detail, edit (F's filter query kept) |
| `/new` | `/finance/new` | |
| `/plan` | `/finance/plan` | the collision: finance host means the Fixkostenplan |
| `/categories` | `/finance/categories` | |
| `/household` | `/households` | F's household screen = H's Gruppen (the participants section is on `/settings`) |
| `/password/forgot` | `/forgot-password` | H's path |
| `/password/reset`, `/password/reset/*` | `/forgot-password` (query dropped) | F's reset tokens are not migrated (SPEC §6 step 5, §9): the old link is dead, the user asks for a new one |
| everything else | `{uri}` (D11's rule) | `/settings`, `/login`, `/register`, `/invite/*` (F invites are not migrated; H shows its invalid-invite state), `/api/*` |

## 4. Tasks and waves

| Wave | Id | Title | Tier | Deps |
| --- | --- | --- | --- | --- |
| 1 | T01 | Dockerfile, .dockerignore, entrypoint | port | — |
| 1 | T02 | docker-compose.yml, docker/env.example, .env.local-stack | build | — |
| 1 | T03 | docker/Caddyfile with Table R, ADR 0008 | core | — |
| 1 | T04 | docker/toon-deploy.sh with a stub-driven test | build | — |
| 1 | T05 | release.yml, deploy.yml, ci.yml docker-build | port | — |
| 2 | T06 | docs/deployment.md: install, operations, variants, local stack; README; comments | build | T01–T05 |
| 3 | T07 | docs/deployment.md "Cutover from toon-edge"; migration.md names | build | T06 |
| 4 | T08 | Integration: image, stack, Caddy, redirects, cutover rehearsal, record | build | T01–T07 |

File ownership (wave 1 is disjoint; `docker/` is shared as a directory only; T03 never edits
`docker-compose.yml`, decision 7):

| Task | Owns |
| --- | --- |
| T01 | `Dockerfile`, `.dockerignore`, `docker/entrypoint.sh`, `apps/api/test/deploy-dockerfile.test.ts` |
| T02 | `docker-compose.yml`, `docker/env.example`, `.env.local-stack`, `apps/api/test/deploy-compose.test.ts` |
| T03 | `docker/Caddyfile`, `apps/api/test/deploy-caddyfile.test.ts`, `apps/web/src/legacy-redirects.test.ts`, `docs/adr/0008-old-hostnames-map-paths-and-retire-workers.md`, `docs/SPEC.md` (D11 sentence only) |
| T04 | `docker/toon-deploy.sh`, `apps/api/test/deploy-script.test.ts` |
| T05 | `.github/workflows/release.yml`, `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`, `apps/api/test/deploy-workflows.test.ts` |
| T06 | `docs/deployment.md` (all but the cutover section), `README.md`, `apps/api/test/deployment-doc.test.ts` (created), comment-only edits in `apps/api/src/index.ts`, `apps/api/src/middleware/originGuard.ts`, `apps/api/src/core/services/auth/rateLimit.ts`, `apps/api/src/middleware/securityHeaders.ts` |
| T07 | `docs/deployment.md` (the cutover section), `docs/migration.md` ("Cutover order" names only), `apps/api/test/deployment-doc.test.ts` (extended) |
| T08 | `CLAUDE.md`, `docs/plans/m6-deploy.md` (sections 9, 10, status line), any defect fix (own commit, file named in section 9) |

Every task commits on its own branch with a message whose body names the SPEC decision or source file
it serves (CLAUDE.md "Conventions"), and leaves `bun run typecheck` and `bun test` green.

## 5. Task briefs

### T01 — Dockerfile, .dockerignore, entrypoint (port)

**Read:** SPEC D11, §3 (`docker/`, `Dockerfile`), §7 last paragraph; `R/Dockerfile` (whole file);
`R/.dockerignore`; `R/docker/entrypoint.sh`; `F/docker/entrypoint.sh`; R CLAUDE.md decision 9 ("ONE
container serving ONE origin", lines 74-82), the gotchas "The Dockerfile installs the OCR binaries only
for …" (line ~503) and "Bun 1.4 uses the ISOLATED linker" (line ~1045); F CLAUDE.md gotcha 50
(`PUBLIC_API_URL` must be empty); m3b plan §7.2 last bullet and §9.1; this plan decisions 2 and 3.

**Do:**

1. `cp R/Dockerfile H/Dockerfile`, then apply exactly these rewrites:
   - line 3 `# toon-recipe — one image, one origin, one port.` → `# toon-household — one image, one
     origin, one port.`;
   - the web-build `RUN` line `RUN bun --filter @toon/web build && test -f apps/web/dist/index.html &&
     test -f apps/web/dist/sw.js` → the same line followed by ` \` and a new line
     `    && ! grep -rqF 'localhost:3001' apps/web/dist`, and directly above the `RUN` add the comment
     lines: `# The bundle must not carry the dev fallback API URL: the API's CSP says connect-src 'self',`
     / `# so an absolute http://localhost:3001 would block every API call and every upload image on the`
     / `# real hostname (toon-finance gotcha 50, m3b plan §7.2). Fail the build instead.`;
   - `echo "[build] OCR weggelassen (WITH_OCR=$WITH_OCR) — Import per Foto ist deaktiviert."` →
     `echo "[build] OCR left out (WITH_OCR=$WITH_OCR): photo import is disabled."`;
   - `echo "[build] poppler weggelassen (WITH_PDF=$WITH_PDF) — Import per PDF ist deaktiviert."` →
     `echo "[build] poppler left out (WITH_PDF=$WITH_PDF): PDF import is disabled."`;
   - the comment line `# also the default \`pi\` uid — so a bind-mounted ./data is writable without
     chown).` stays; after it add `# docs/migration.md step 6 chowns a pre-filled volume to this uid.`
   Nothing else changes: `ARG BUN_VERSION=1.4.2` (equals `H/.bun-version`), the stage names, the
   `COPY tsconfig.json ./`, the three `COPY --from=deps … node_modules` lines, `ENV` block,
   `VOLUME`, `EXPOSE 3001`, `HEALTHCHECK`, `ENTRYPOINT ["/usr/bin/tini", "--",
   "/usr/local/bin/entrypoint.sh"]`, `CMD ["bun", "apps/api/src/index.ts"]`.
2. `cp R/.dockerignore H/.dockerignore`, then append this block at the end:

   ```
   # toon-household: migration inputs and outputs hold copies of production databases and, after
   # an --apply, claim links (credentials). They must never enter a build context.
   migration-in
   migration-out
   # parallel task worktrees of the build workflow (whole repo copies)
   .worktrees
   # the legacy migration fixtures live under apps/api/test (excluded above)
   ```

   Keep R's `.env`, `.env.*`, `!.env.example` lines exactly (they also exclude `.env.local-stack`).
3. `cp R/docker/entrypoint.sh H/docker/entrypoint.sh` (mode 755: `chmod 755`), then replace
   `log "SKIP_MIGRATIONS=1 — Migrationen werden übersprungen"` with
   `log "SKIP_MIGRATIONS=1 — skipping migrations"` (F's line). Nothing else.
4. Write `apps/api/test/deploy-dockerfile.test.ts` (bun:test, `readFileSync` of the repo-root files via
   `join(import.meta.dir, "../../..", …)`, header comment naming SPEC D11 and this task). Assertions:
   - `ARG BUN_VERSION=` value equals `readFileSync(".bun-version").trim()`;
   - the `web-build` stage (text between `AS web-build` and the next `FROM`) contains `ENV
     PUBLIC_API_URL=""` and `! grep -rqF 'localhost:3001' apps/web/dist`, and the `ENV` line comes
     before the `RUN bun --filter @toon/web build`;
   - `ARG WITH_OCR=0`, `ARG WITH_PDF=${WITH_OCR}`, `IMPORT_OCR_ENABLED=${WITH_OCR}`,
     `IMPORT_PDF_ENABLED=${WITH_PDF}`, `tesseract-ocr-deu`, `poppler-utils`, `tini` are present;
   - the three lines `COPY --from=deps /app/node_modules ./node_modules`,
     `COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules`,
     `COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules`;
   - one `COPY <ws>/package.json ./<ws>/` line in the manifests stage for each of `apps/api`,
     `apps/web`, `packages/shared` and `COPY tsconfig.json ./`;
   - `USER bun`, `VOLUME ["/app/data"]`, `EXPOSE 3001`, `HEALTHCHECK` containing `/api/health`,
     `DATABASE_URL="file:/app/data/local.db"`, `WEB_DIST_DIR=/app/apps/web/dist`, the exact
     `ENTRYPOINT` and `CMD` lines above;
   - `.dockerignore` has lines `.env`, `.env.*`, `!.env.example`, `**/node_modules`, `data`,
     `apps/api/test`, `migration-in`, `migration-out`, `.worktrees`, and has NO line `!.env.local-stack`;
   - `docker/entrypoint.sh` starts with `#!/bin/sh`, contains `set -eu`, `bun apps/api/scripts/migrate.ts`,
     `exec "$@"`, and `statSync(...).mode & 0o111` is non-zero.

**Must not:** run `docker` (T08 does), change any app file, add build args.

**Acceptance:** the test passes; a host production build has no `localhost:3001`; scripts parse.

**Verify.** `bun run typecheck`; `bun test apps/api/test/deploy-dockerfile.test.ts`; `sh -n docker/entrypoint.sh && test -x docker/entrypoint.sh`; `PUBLIC_API_URL= bun run build && ! grep -rlF 'localhost:3001' apps/web/dist`; `bun test`.

### T02 — docker-compose.yml, docker/env.example, .env.local-stack (build)

**Read:** SPEC D11; `git -C R show 'a369217^:docker-compose.yml'` (the base, whole file);
`F/docker-compose.yml` (the `security_opt` / `cap_drop` block and its comment, the mailpit comments);
`git -C R show 'a369217^:docker/env.example'` (whole, German) and `R/docker/env.example` (HEAD, for
anything added since); `H/.env.example` (H's variables and their wording, the `ALLOW_SEED` /
`SEED_PASSWORD` block); `H/apps/api/src/env.ts` (variables, defaults); E `env.example` (wording on
hostnames and HSTS); F CLAUDE.md gotchas 19 and 74; m3b plan §7.2; this plan decisions 1, 2, 4, 5, 6, 7.

**Do:**

1. `docker-compose.yml` from R's `a369217^` file with these changes and nothing else:
   - header comment: `toon-recipe` → `toon-household`; the two-service paragraph says the Caddy also
     serves the optional old-hostname redirects (`RECIPE_HOSTNAME` / `FINANCE_HOSTNAME`, SPEC D11,
     ADR 0008) and that they are removed after the cutover; keep the mail paragraph;
   - `name: toon-household`; `image: ${TOON_IMAGE:-ghcr.io/toonvish/toon-household:latest}`;
   - `app.environment`: add `DEFAULT_LOCALE: ${DEFAULT_LOCALE:-de}` after `API_PORT`; `MAIL_FROM:
     ${MAIL_FROM:-Haushalt <haushalt@localhost>}`; the `SESSION_SECRET` `:?` message in English
     (`SESSION_SECRET is missing - see docker/env.example`); keep `PUBLIC_API_URL: ""`,
     `TRUST_PROXY: "1"` with R's comments, adjusting the XFF comment to say the API reads the LAST hop
     (F gotcha 74) and that the overwrite is in `docker/Caddyfile`'s `(fwd)` snippet;
   - insert F's block (from `# The process runs as \`bun\` (uid 1000 …` through `- ALL`) after
     `mem_limit`, verbatim;
   - `caddy.environment`: `TOON_HOSTNAME: ${TOON_HOSTNAME:?TOON_HOSTNAME is missing - see
     docker/env.example}`, R's `TOON_TLS_ISSUER` / `TOON_HSTS_MAX_AGE` lines, and
     `RECIPE_HOSTNAME: ${RECIPE_HOSTNAME:-http://old-recipe-hostname.unset.invalid}`,
     `FINANCE_HOSTNAME: ${FINANCE_HOSTNAME:-http://old-finance-hostname.unset.invalid}` with a comment:
     set = that old hostname redirects to `TOON_HOSTNAME` (path map, ADR 0008); unset or empty = an
     http-only placeholder site that nothing ever reaches (Caddy needs a non-empty address);
   - every other line (ports incl. `"443:443/udp"`, caddy volumes, the pinned `caddy:2.11.4-alpine`,
     `networks: toon: driver: bridge`, the three volumes, `logging: &logging` / `*logging`, the
     "no local SMTP sink" comment) stays as in R.
2. `docker/env.example`: R's `a369217^` file translated to English, structure kept (REQUIRED / MAIL /
   OPTIONAL), with: `TOON_HOSTNAME=haushalt.example.org`; `SESSION_SECRET=` with R's warning about
   `/uploads` signatures plus "never reuse the old apps' secrets"; `TOON_IMAGE=ghcr.io/toonvish/
   toon-household:latest` (R's text on digests and rollback; `toon-household-deploy` pins it);
   `MAIL_FROM=Haushalt <haushalt@localhost>`; OPTIONAL gains `#RECIPE_HOSTNAME=rezepte.example.org` and
   `#FINANCE_HOSTNAME=finanzen.example.org` (cutover only, DNS must point here, remove after bookmarks
   moved), `#TOON_TLS_ISSUER=acme` / `#TOON_HSTS_MAX_AGE=31536000` described as the Caddy's settings for
   EVERY site of the stack, `#DEFAULT_LOCALE=de`, R's `TOON_MEM_LIMIT`, OCR/PDF, OAuth blocks; and a
   closing note that `bun run seed` refuses production without `ALLOW_SEED=1` + `SEED_PASSWORD`
   (both passed with `docker compose exec -e …`, never stored here). Every `${NAME…}` that
   `docker-compose.yml` interpolates must appear in this file (commented or not).
3. `.env.local-stack` per decision 5 (eight keys, `COMPOSE_PROJECT_NAME=toon-household-local` first,
   header comment).
4. `apps/api/test/deploy-compose.test.ts`: parse `docker-compose.yml` with `Bun.YAML.parse` and assert:
   `name === "toon-household"`; `Object.keys(services)` is exactly `["app", "caddy"]`; `app` has no
   `ports`, `expose` contains `"3001"`, `cap_drop` equals `["ALL"]`, `security_opt` contains
   `"no-new-privileges:true"`, `volumes` contains `"toon-data:/app/data"`, `networks` contains `toon`,
   `environment.PUBLIC_API_URL === ""`, `environment.TRUST_PROXY === "1"`,
   `environment.WEB_ORIGIN === "https://${TOON_HOSTNAME}"`, and has none of `TOON_TLS_ISSUER`,
   `TOON_HSTS_MAX_AGE`, `RECIPE_HOSTNAME`, `FINANCE_HOSTNAME`; `caddy.image === "caddy:2.11.4-alpine"`,
   `caddy.ports` equals `["80:80", "443:443", "443:443/udp"]`, `caddy.volumes` equals
   `["./docker/Caddyfile:/etc/caddy/Caddyfile:ro", "caddy-data:/data", "caddy-config:/config"]`,
   `caddy` has no `cap_drop`, `caddy.environment` has `TOON_HOSTNAME`, `TOON_TLS_ISSUER`,
   `TOON_HSTS_MAX_AGE`, `RECIPE_HOSTNAME`, `FINANCE_HOSTNAME`; `networks.toon.driver === "bridge"`;
   `Object.keys(volumes)` equals `["toon-data", "caddy-data", "caddy-config"]`; both services have
   `logging.driver === "json-file"`; every `${NAME` in the raw compose text appears in
   `docker/env.example`; `docker/env.example` has no `COMPOSE_PROJECT_NAME` line (commented or not:
   production runs under `name: toon-household`); `.env.local-stack` parses (ignore comments and blank
   lines, split at the first `=`) to exactly the eight keys of decision 5, with
   `COMPOSE_PROJECT_NAME=toon-household-local`, `TOON_TLS_ISSUER=internal`, `TOON_HSTS_MAX_AGE=0`, a
   `SESSION_SECRET` of 32+ characters not starting with `change-me`.

**Authoring aid (not a verify command):** `docker compose --env-file .env.local-stack config -q` parses
the file without starting anything, and `docker compose --env-file .env.local-stack config | head -n 1`
prints `name: toon-household-local`; run them if you like.

**Must not:** add a mailpit service; publish an app port; add `caddy` capabilities rules.

**Acceptance:** the test passes; the file keeps R's comments wherever the line is R's.

**Verify.** `bun run typecheck`; `bun test apps/api/test/deploy-compose.test.ts`; `grep -qx 'COMPOSE_PROJECT_NAME=toon-household-local' .env.local-stack`; `! git check-ignore -q .env.local-stack`; `! grep -q COMPOSE_PROJECT_NAME docker/env.example`; `bun test`.

### T03 — docker/Caddyfile with Table R, ADR 0008 (core)

**Read:** SPEC D11, §9 (path-prefix routing stays out); `git -C R show 'a369217^:docker/Caddyfile'`
(whole); `E/Caddyfile` (whole: the two snippets, the site-block pattern, the validate note);
`E/README.md` ("Warum keine Pfad-Präfixe", "Den Caddyfile ändern"); `R/apps/web/src/router.tsx` and
`F/apps/web/src/` route files (the old paths); `H/apps/web/src/router.tsx`,
`H/apps/web/src/modules/{recipe,finance}/routes.tsx` (the new paths);
`H/apps/web/src/modules/recipe/manifest.test.ts` (its `fullPaths` helper and the import order:
manifest first, then `@/modules`); F CLAUDE.md gotcha 74, R CLAUDE.md gotcha on `clientIp()` /
`TRUST_PROXY` (line ~674); `docs/adr/0007-…md` (ADR format); this plan decisions 7 to 10 and Table R.

**Do:**

1. `docker/Caddyfile`, in this order:
   - header comment: R's `a369217^` header adapted (`toon-household`; the secure-context reason;
     the two issuer modes; the CA download; the validate command
     `docker compose run --rm --no-deps --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile`
     from E; a paragraph on the optional old hostnames and ADR 0008);
   - global options `{ admin off  cert_issuer {$TOON_TLS_ISSUER:acme} }` with R's `admin off` comment
     and one comment for `cert_issuer` (decision 7);
   - a comment line saying the next two snippets are copied VERBATIM from toon-edge's Caddyfile (SPEC
     D11) and that two of their comments describe toon-edge's world (two apps, "FIRST entry"); the API
     reads the LAST hop (F gotcha 74) and also sends its own CSP (M3b), and neither changes the
     snippets;
   - `(hardening) { … }` and `(fwd) { … }` byte-identical to `E/Caddyfile` (copy the line ranges; do
     not retype);
   - `{$TOON_HOSTNAME} { tls { issuer {$TOON_TLS_ISSUER:acme} }  encode zstd gzip  reverse_proxy app:3001
     { import fwd  transport http { read_timeout 300s  write_timeout 300s } }  import hardening }` with
     E's recipe-import comment on the timeouts (now "this app's import endpoints");
   - `(retire_old_worker)` snippet: `handle /sw.js { header Content-Type "text/javascript; charset=utf-8"
     header Cache-Control "no-cache"  respond <<JS … JS 200 }` with the exact worker of decision 9
     (heredoc syntax; if 2.11.4 rejects it, a single-quoted `respond` body);
   - `{$RECIPE_HOSTNAME:http://old-recipe-hostname.unset.invalid} { import retire_old_worker  … handle
     blocks of Table R … handle { redir https://{$TOON_HOSTNAME}{uri} permanent }  import hardening }`;
     use only `handle` blocks inside (mutually exclusive, most specific path first), never bare `redir`
     beside them (`redir` sorts before `handle` and would swallow `/sw.js`). `/groups/*` uses a
     `path_regexp` matcher (`^/groups/(.*)$`) and `{re.<name>.1}`;
   - the same for `{$FINANCE_HOSTNAME:http://old-finance-hostname.unset.invalid}`;
   - `http://{$TOON_HOSTNAME} { handle /toon-root-ca.crt { … R verbatim … }  handle { redir
     https://{host}{uri} permanent } }` with R's comment.
2. Prove it while authoring (allowed here, not a verify command; T08 repeats it). Three raw `caddy
   adapt` runs with the pinned image: `docker run --rm -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile:ro"
   -e TOON_HOSTNAME=haushalt.test -e TOON_TLS_ISSUER=internal caddy:2.11.4-alpine caddy adapt --config
   /etc/caddy/Caddyfile --adapter caddyfile` (**unset**: the old hostnames are not passed at all), again
   with `-e RECIPE_HOSTNAME=rezepte.test -e FINANCE_HOSTNAME=finanzen.test` (**set**), and once with the
   old hostnames set and without `TOON_TLS_ISSUER` (**acme**). Read the JSON: in the set run the
   `rezepte.test` / `finanzen.test` routes exist and the `/sw.js` route precedes the catch-all; in the
   unset run only the two `*.unset.invalid` placeholder hosts appear; in the internal runs every site is
   on the `internal` issuer. Under zsh, never put two `-e` flags into one unquoted variable (zsh does
   not word-split it, and the run silently tests something else); write the flags out.
   Do NOT run the **set-but-empty** case with raw `docker run -e RECIPE_HOSTNAME=`: Caddy treats an
   empty variable as set and adapt fails by design (decision 7). The empty case is covered by T02's
   compose defaults; if T02's `docker-compose.yml` is already on your branch you MAY prove it with
   `docker compose --env-file <scratch file with .env.local-stack's keys but RECIPE_HOSTNAME= and
   FINANCE_HOSTNAME=> config` (the caddy service shows the two `http://…unset.invalid` defaults), else
   leave it to T08 step 3. Decision 7's fallback is taken only if the set, unset or acme run fails or
   the issuer is wrong; record any fallback in the commit body. Never edit `docker-compose.yml`.
3. `apps/api/test/deploy-caddyfile.test.ts` (text-level): the `(hardening)` and `(fwd)` blocks
   (from the line `(name) {` to the next line that is exactly `}`) have the SHA-256 you compute from
   `E/Caddyfile` at authoring time (pin the two hex digests in the test with a comment saying how they
   were computed; additionally compare against `../toon-edge/Caddyfile` next to the git common dir when
   that file exists, like `scripts/i18n-check.ts` resolves the sources); the main site block contains
   `reverse_proxy app:3001`, `import fwd`, `read_timeout 300s`, `write_timeout 300s`,
   `import hardening`, `tls {` with `issuer {$TOON_TLS_ISSUER:acme}`; the http block serves
   `/toon-root-ca.crt` from `/data/caddy/pki/authorities/local`; the global block has `admin off`;
   there is no `trusted_proxies` anywhere; both old-host blocks import `retire_old_worker` and
   `hardening` and end with the `{uri}` catch-all; the worker body equals decision 9's text.
4. `apps/web/src/legacy-redirects.test.ts` (co-located, `tsconfig.test.json`): holds Table R as data
   (`{ host: "recipe" | "finance", matcher, target }`) plus a sample concrete path per row (e.g.
   `/recipes/r1/edit`, `/groups/h1`, `/transactions/t1/edit`); asserts (a) the set of `handle` matcher →
   `redir` target pairs parsed from each old-host block of `docker/Caddyfile` equals the table exactly
   (so the file and the table cannot drift), and (b) every target, with the sample's rest substituted,
   resolves to a route of H: module paths from `fullPaths()` over `recipeModule.route` and
   `financeModule.route` (import the manifests first, as `manifest.test.ts` does), core paths
   (`/`, `/households`, `/households/$householdId`, `/settings`, `/login`, `/register`,
   `/forgot-password`, `/reset-password/$token`, `/verify-email/$token`, `/invite/$token`,
   `/oauth/callback`) read with a regex from `router.tsx`. `$param` segments match any one segment.
   (c) no source path falls through to a dead end. The test holds every R and F source path of
   section 3 as a concrete sample per host (R: `/`, `/search?q=x`, `/recipes/new`, `/recipes/r1`,
   `/recipes/r1/edit`, `/import`, `/import/d1`, `/collections`, `/collections/c1`, `/shopping`,
   `/shopping/cards`, `/shopping/history`, `/shopping/l1`, `/tags`, `/plan`, `/groups`, `/groups/g1`,
   `/settings`, `/login`, `/register`, `/forgot-password`, `/reset-password/t1`, `/verify-email/t1`,
   `/invite/t1`, `/oauth/callback`; F: `/`, `/transactions`, `/transactions/t1`,
   `/transactions/t1/edit`, `/new`, `/plan`, `/categories`, `/household`, `/settings`, `/login`,
   `/register`, `/invite/t1`, `/password/forgot`, `/password/reset?token=x`). For each sample, find the
   first matching row of its host with Caddy's matcher semantics (exact path; `/x/*` = prefix `/x/`;
   the `path_regexp`); if a row matches, its target must resolve to an H route (as in (b)); if NONE
   matches, the sample falls to the `{uri}` catch-all and the sample's own path (query stripped) must
   itself resolve to an H route. Only `/api/…` and `/uploads/…` are exempt from that resolution (a fixed two-entry exempt
   list; add `/api/health` and `/uploads/x.webp` samples to show it). So a forgotten Table R row (e.g.
   `/tags` or `/new` dropped from the Caddyfile and the table together) lands on the catch-all, does not
   resolve in H, and fails the test, instead of shipping a cached 301 to NotFound. Prove it once while
   authoring: delete the `/tags` row from the table copy in a scratch run and see (c) fail; say so in
   the commit body.
5. ADR `docs/adr/0008-old-hostnames-map-paths-and-retire-workers.md` (date 2026-10-15, context:
   decision 8's two failures, decision: Table R + the retiring worker + `{uri}` fallback, consequences:
   the table must be correct before go-live because 301s are cached; IndexedDB of the old origins is
   abandoned, hence the "open both apps online once" step; the blocks go away with the old hostnames),
   and in the same commit edit SPEC D11's sentence "The Caddyfile may serve the two old hostnames as
   `redir https://{$TOON_HOSTNAME}{uri} permanent` blocks …" to say the blocks map each source's old
   paths to the new ones, answer `/sw.js` with a self-retiring worker, and fall back to
   `redir https://{$TOON_HOSTNAME}{uri} permanent` (ADR 0008). No other SPEC edit.

**Must not:** change the snippets by a byte; add `trusted_proxies`; add a CSP header in Caddy; use path
prefixes for the main app (SPEC §9); edit `docker-compose.yml` (T02 owns it; decision 7).

**Acceptance:** both tests pass; `caddy adapt` produced the expected JSON for the three raw runs (set,
unset, acme), said in the commit body together with any fallback taken; check (c) was seen failing once
with a row removed. The set-but-empty case is not a T03 acceptance item (compose covers it, T08 step 3
proves it).

**Verify.** `bun run typecheck`; `bun test apps/api/test/deploy-caddyfile.test.ts apps/web/src/legacy-redirects.test.ts`; `test -f docs/adr/0008-old-hostnames-map-paths-and-retire-workers.md`; `grep -q 'ADR 0008' docs/SPEC.md`; `! grep -q trusted_proxies docker/Caddyfile`; `bun test`.

### T04 — docker/toon-deploy.sh with a stub-driven test (build)

**Read:** SPEC D11 ("deployed by `deploy.yml` + `docker/toon-deploy.sh` with a forced-command SSH key,
as toon-recipe does"); `F/docker/toon-deploy.sh` (whole; the base: `set -f`, argument checks);
`git -C R show 'a369217^:docker/toon-deploy.sh'` (`cmd_sync_config` that fetched the Caddyfile);
`git -C R diff 'a369217^' a369217 -- docker/toon-deploy.sh`; `E/README.md` "Deploy aus CI" and "Den
Caddyfile ändern"; this plan decisions 1, 2, 11.

**Do:**

1. `docker/toon-deploy.sh` (mode 755) = F's script with: header naming toon-household and
   `/usr/local/bin/toon-household-deploy` (`restrict,command="/usr/local/bin/toon-household-deploy"
   ssh-ed25519 AAAA… household-deploy`), the paragraph on one key per app kept (it matters during the
   cutover, when the old apps' keys still exist); `APP_DIR="${TOON_APP_DIR:-/opt/toon-household}"`,
   `IMAGE_REPO="${TOON_IMAGE_REPO:-ghcr.io/toonvish/toon-household}"`,
   `RAW_BASE="${TOON_RAW_BASE:-https://raw.githubusercontent.com/Toonvish/toon-household/main}"`;
   `HEALTH_TRIES` / `HEALTH_SLEEP` overridable from the environment (`${TOON_HEALTH_TRIES:-40}`,
   `${TOON_HEALTH_SLEEP:-3}`; the test sets the sleep to 0); every message in English (`die` prints
   `ERROR:`); `cmd_sync_config` per decision 11 (fetch both files to `*.new` with `curl -fsSL`, keep
   `*.bak`, move into place, `docker compose config -q`, caddy validate through `docker compose run`,
   restore the backups and die on failure, `docker compose restart caddy` only when `cmp -s` says the
   Caddyfile changed, `mkdir -p docker` first); `deploy` and `status` as F. The comment block that
   explained "IT NO LONGER FETCHES A CADDYFILE" becomes the opposite, with decision 11's reasons.
2. `apps/api/test/deploy-script.test.ts`: per test, a temp dir with `bin/docker` and `bin/curl` stub
   scripts (bash, append `"$@"` to a log, behave per env vars: `docker inspect` prints the value of
   `STUB_HEALTH` (`healthy` / `unhealthy`), `docker compose ps -q app` prints `cid`, `docker compose run …
   validate` exits `STUB_VALIDATE` (0/1), `curl -o <file>` writes `STUB_BODY_<n>` or a fixed text), an
   `app/` dir with `.env`, `docker-compose.yml`, `docker/Caddyfile`; run
   `bash docker/toon-deploy.sh` via `Bun.spawnSync` with `PATH=<tmp>/bin:$PATH`, `TOON_APP_DIR`,
   `TOON_HEALTH_SLEEP=0`, `SSH_ORIGINAL_COMMAND`. Cases: `deploy latest` → compose pull/up with
   `TOON_IMAGE=ghcr.io/toonvish/toon-household:latest` and `.env` gets `TOON_IMAGE=…:latest`;
   `deploy sha256:<64 hex>` → `…@sha256:…`; `deploy sha256:abc` → exit 1, no docker call; `deploy *`
   in a dir containing files → exit 1 naming `*`, not a file name (`set -f`); `deploy latest; id` and
   `deploy latest extra` → exit 1; `status x`, `sync-config x` → exit 1; `rm` / empty verb → exit 1;
   unhealthy → exit 1 and `.env` unchanged; `sync-config` with `STUB_VALIDATE=1` → exit 1 and the old
   compose and Caddyfile restored byte for byte; `sync-config` with a changed Caddyfile and validate 0 →
   files replaced, `compose restart caddy` called; with an identical Caddyfile → no restart.

**Must not:** take an image repository or path from the client; use `eval`; widen the allow-list.

**Acceptance:** `bash -n` clean; the test passes on a machine without Docker (stubs only).

**Verify.** `bash -n docker/toon-deploy.sh && test -x docker/toon-deploy.sh`; `bun test apps/api/test/deploy-script.test.ts`; `bun run typecheck`; `bun test`.

### T05 — release.yml, deploy.yml, ci.yml docker-build (port)

**Read:** SPEC D11, D14; `F/.github/workflows/release.yml`, `F/.github/workflows/deploy.yml`,
`F/.github/workflows/ci.yml` (job `docker-build`), `R/.github/workflows/release.yml` (the "Install
poppler" step and the `build-args` block with its comment), `H/.github/workflows/ci.yml`; m3b plan
§7.2; this plan decisions 1, 2, 12.

**Do:**

1. `cp F/.github/workflows/release.yml H/.github/workflows/release.yml`, then:
   - header line 1 `# Builds the container image and publishes it to GHCR (docs/spec.md §5.1).` →
     `# Builds the container image and publishes it to GHCR (SPEC D11).`; "exactly as in toon-recipe"
     → "as toon-recipe and toon-finance did"; the block before `on:` names `docs/deployment.md` instead
     of "the toon-edge README" and `toon-household-deploy` instead of `toon-finance-deploy`;
   - `on.workflow_dispatch.inputs.deploy.description: "Nach dem Build auf den Server deployen"` →
     `"Deploy to the server after the build"` (decision 2; F's line 36);
   - in the build job, after `- run: bun run typecheck`, insert R's step verbatim:
     `- name: Install poppler` / `run: sudo apt-get update && sudo apt-get install
     --no-install-recommends -y poppler-utils` with R's comment, then `- run: bun test` (keep F's comment
     about `DATABASE_URL`, changing "env.ts forces a fresh temp-file DB under NODE_ENV=test (Gotcha 2)"
     to "env.ts forces file::memory: under NODE_ENV=test (ADR 0003)");
   - in `Build and push`, insert R's `build-args: |` / `WITH_OCR=1` / `WITH_PDF=0` with R's comment
     above it (between `labels:` and `provenance:`);
   - Summary: `echo "### Image veröffentlicht"` → `echo "### Image published"`, `echo "Ausrollen
     übernimmt der Deploy-Job. Von Hand auf dem Server geht es auch:"` → `echo "Rollout is done by the
     deploy job. By hand on the server:"`, `cd /opt/toon-finance && …` →
     `cd /opt/toon-household && docker compose pull && docker compose up -d --remove-orphans`. These three
     plus the `description:` above are ALL of release.yml's German (F lines 36, 126, 134);
   - keep every step-level `uses:` line with its SHA and `# vX` comment exactly as F, and the job-level
     `uses: ./.github/workflows/deploy.yml` (a local reusable workflow, no `@sha`) exactly as F.
2. `cp F/.github/workflows/deploy.yml H/.github/workflows/deploy.yml`, then: `toon-finance-deploy` →
   `toon-household-deploy`, `finance-deploy` → `household-deploy`, `toon-finance` (package and app
   names in comments) → `toon-household`, `concurrency.group: deploy-toon-finance` →
   `deploy-toon-household` with the comment reduced to "Two deploys of this app at the same time would
   fight over the same containers.", the sentence "THE CADDYFILE IS NOT SYNCED FROM HERE — TLS lives in
   the shared toon-edge stack now." → "docker/Caddyfile is synced the same way (sync-config validates
   it first).", the toon-recipe-owns-the-name sentence → "named so it can sit beside the old apps'
   commands until the cutover removes them"; German `description:` / `::error::` strings in English
   (F lines 59, 108, 126: `Image digest (sha256:…) or empty for :latest`, `DEPLOY_SSH_KNOWN_HOSTS is
   empty. On the server run: ssh-keyscan -p <port> <host>`, `Not a valid digest: $DIGEST`; these are
   ALL of deploy.yml's German; F's `ci.yml` has none).
3. `H/.github/workflows/ci.yml`: header sentence "docker-build is added by M6 together with the
   Dockerfile." → "docker-build (pull requests only) builds the image the release would publish."; append
   F's `docker-build` job verbatim plus `build-args: |` / `WITH_OCR=1` / `WITH_PDF=0` in its
   build-push step and a one-line comment why (decision 12).
4. `apps/api/test/deploy-workflows.test.ts` (`Bun.YAML.parse` on the three files): every STEP-level
   `uses:` (each `jobs.<id>.steps[i].uses` that exists) in all three matches
   `/^[^@\s]+@[0-9a-f]{40}$/`, and there is at least one per file; every JOB-level `uses:`
   (`jobs.<id>.uses`, a reusable-workflow call) starts with `./.github/workflows/` and is NOT held to the
   SHA rule (a local reusable workflow carries no `@ref`: `Bun.YAML.parse` of F's release.yml gives
   `jobs.deploy.uses === "./.github/workflows/deploy.yml"`); `release.on.push.branches` equals `["main"]`,
   `release.on.push.tags` equals `["v*"]`; in `jobs.build.steps` the indices of `bun run typecheck`,
   `Install poppler`, `bun test` are all lower than the `Build and push` index; `Build and push.with`
   has `provenance: false`, `push: true`, `platforms` containing `linux/amd64` and `linux/arm64`,
   `build-args` containing `WITH_OCR=1` and `WITH_PDF=0`; the metadata tags contain
   `type=raw,value=latest,enable={{is_default_branch}}`; `jobs.build.outputs.digest` exists;
   `jobs.deploy.if` contains `vars.DEPLOY_ENABLED == 'true'` and `jobs.deploy.uses` is
   `./.github/workflows/deploy.yml`; `deploy.concurrency.group === "deploy-toon-household"`;
   `ci.jobs["docker-build"].if === "github.event_name == 'pull_request'"`, its build step has
   `push: false` and the same build-args; no file contains `toon-finance-deploy`, `/opt/toon-finance`
   or `/opt/toon-recipe`; no file matches `/[äöüßÄÖÜ]/` and none contains `Nach dem Build`, `oder leer`,
   `ist leer`, `Kein gültiger`, `veröffentlicht`, `Ausrollen` (decision 2);
   `release.on.workflow_dispatch.inputs.deploy.description === "Deploy to the server after the build"`.

**Must not:** move a SHA, add a registry secret, change the existing `verify` job.

**Acceptance:** the test passes; every step-level `uses:` in the three workflows is pinned to a 40-hex
SHA (job-level `./.github/workflows/…` calls excepted) and no German string is left; `git diff` of
`ci.yml` touches only the header line and the new job.

**Verify.** `bun run typecheck`; `bun test apps/api/test/deploy-workflows.test.ts`; `! grep -nP '[äöüßÄÖÜ]' .github/workflows/release.yml .github/workflows/deploy.yml .github/workflows/ci.yml`; `bun test`.

### T06 — docs/deployment.md: install, operations, variants, local stack; README; comments (build)

**Read:** SPEC D11, D15, §7; `git -C R show 'a369217^:docs/deployment.md'` (whole: the structure and
the substance to carry over); `E/README.md` (DNS first and the ACME rate limit, firewall and `ufw` vs
published ports, validate before reload, the status/logs commands, the checklist); the files T01 to T05
produced (names, variables, commands); `docs/migration.md` (only to link it); `H/.env.example`; this plan
decisions 1, 2, 5, 6, 9, 11, 12, 13 and Table R.

**Do:**

1. `docs/deployment.md` in English with these H2 sections, in this order (T07 inserts
   "## Cutover from toon-edge" between "## Operations" and "## Variants"; leave a single line
   `<!-- T07: Cutover from toon-edge -->` there):
   `## What runs` (the two services, one origin, the volume to back up, a diagram like E's but for one
   stack), `## Prerequisites`, `## Fresh install` (numbered steps: values to collect; server, user and
   key; firewall (E's `ufw` note); Docker; DNS first with `dig` and the ACME rate limit; get the image
   (GHCR visibility note: a fresh package is private, `denied` means visibility or login); the
   directory `/opt/toon-household` with `docker-compose.yml`, `docker/Caddyfile` and `.env` from
   `docker/env.example` via `curl -fsSL` of the raw base; validate the Caddyfile; start; first account
   (register in the app; never `seed` on a server, and if ever, only with `ALLOW_SEED=1` +
   `SEED_PASSWORD`); mail; first backup; auto-deploy with `toon-household-deploy` (R's step 12
   adapted: install the script, key with forced command, check it refuses `id`, host key, the five
   secrets, the `DEPLOY_ENABLED` variable, the `production` environment, `sync-config` for compose and
   Caddyfile changes); a closing checklist), `## Operations` (update, how a new version reaches the
   devices, rollback by digest, backup and restore of `toon-household_toon-data` (R's tar commands with
   the new volume name), logs, mail check, Caddy update and the validate-before-reload rule, the in-app
   scripts run as `docker compose exec app bun apps/api/scripts/<x>.ts` for `reset-password`,
   `uploads-gc`, `plan-run`), `## Variants` (LAN / internal CA with the root certificate download at
   `http://<host>/toon-root-ca.crt` and `TOON_HSTS_MAX_AGE=0`; photo/PDF import: the three build-arg
   combinations, the published image is `WITH_OCR=1 WITH_PDF=0`, `IMPORT_OCR_ENABLED` is the opt-in),
   `## Local stack test` (on a development machine, never in `/opt/toon-household`; the stack runs as
   its own compose project `toon-household-local`, set by `COMPOSE_PROJECT_NAME` in `.env.local-stack`
   AND spelled out with `-p` on every command, so its volumes are `toon-household-local_*` and a `down -v`
   can never reach the production `toon-household_toon-data` (decision 5); the exact commands:
   `docker build -t toon-household:local . > build.log 2>&1; echo "exit=$?"`,
   `docker compose -p toon-household-local --env-file .env.local-stack up -d`, the three hostnames to map
   in `/etc/hosts` or with `curl --resolve`, the CA download, the health check,
   `docker compose -p toon-household-local --env-file .env.local-stack down -v`; one sentence that the
   exit-criterion form without `-p` is equivalent because of the env file), `## Troubleshooting` (R's
   table plus: `port is already
   allocated` = the toon-edge stack or an old app stack still runs; a blank app or blocked API calls
   with CSP errors = a bundle built without `PUBLIC_API_URL=""` (the Dockerfile refuses that build);
   `EACCES` on the database after a copy-in = volume not chowned to uid 1000; old hostname shows a
   certificate warning = its DNS or `RECIPE_HOSTNAME` missing; the Caddyfile does not change after
   `sync-config` = it restarts caddy only when the file changed; GHCR `denied`), `## What is deliberately
   missing` (no mailpit, no path prefixes, no CSP in Caddy because the app sends one).
2. `README.md`: replace the stale "Status: M0 scaffold built …" paragraph with one line pointing to
   `CLAUDE.md` "Status" and add "Deployment: `docs/deployment.md`; migration of the two old apps:
   `docs/migration.md`."
3. Comment-only edits (decision 15) in the four files of section 1.1: "toon-edge" → "the stack's own
   Caddy (docker/Caddyfile, SPEC D11)"; in `originGuard.ts` keep the reasoning (sibling apps on one
   site existed under toon-edge and old hostnames may still redirect during the cutover).
4. `apps/api/test/deployment-doc.test.ts` (first describe block): the H2 sections above exist in this
   relative order (checked as a subsequence of the doc's H2 list, because T07 inserts one more);
   `## Local stack test` contains `docker build -t toon-household:local .`, `> build.log 2>&1`,
   `-p toon-household-local --env-file .env.local-stack up -d`, `toon-household-local`, and `down -v`;
   the doc names `toon-household_toon-data`, `/opt/toon-household`, `toon-household-deploy`,
   `ghcr.io/toonvish/toon-household`, `DEPLOY_ENABLED`, `ALLOW_SEED=1`; guard against a destructive
   copy-paste, asserted by section and by line: every line of the WHOLE doc that contains `down -v`
   lies inside `## Local stack test` AND contains `-p toon-household-local` (T07's step 12 deletes
   volumes with `docker volume rm`, never `down -v`); every line containing `.env.local-stack` that runs
   `docker compose` also contains `-p toon-household-local`; and `.env.local-stack` itself (read by
   the test) sets `COMPOSE_PROJECT_NAME=toon-household-local`.

**Must not:** write the cutover section (T07); duplicate `docs/migration.md`'s report explanations
(link them).

**Acceptance:** the test passes; a reader can install from the doc alone.

**Verify.** `bun run typecheck`; `bun test apps/api/test/deployment-doc.test.ts`; `grep -qF '<!-- T07: Cutover from toon-edge -->' docs/deployment.md`; `bun test`.

### T07 — docs/deployment.md "Cutover from toon-edge"; migration.md names (build)

**Read:** SPEC D11, D12, §6 (cutover order); `docs/migration.md` "Preparing the inputs", "Commands",
"The report", "Cutover order" (steps 1-9); `apps/api/test/legacy-migration-doc.test.ts`; `E/README.md`
("Migration eines bestehenden Servers": the certificate and caddy-data warning for internal CAs);
`docs/deployment.md` from T06; the Dockerfile (uid, `DATABASE_URL`), `docker-compose.yml` (volume names)
and `docker/Caddyfile` (Table R) from T01-T03; this plan decisions 1, 8, 9, 13.

**Do:**

1. Replace the `<!-- T07 … -->` line with `## Cutover from toon-edge`: an intro (what changes: three
   stacks become one, two hostnames become one plus two optional redirects, the old volumes stay as the
   backup; every step before "Retire" is reversible by starting the old stacks, edge first) and these
   numbered steps, each with commands, in exactly this order and with these bold titles (the test keys
   on them):
   0. **Before the day** (DNS of `TOON_HOSTNAME` to the server and checked with `dig`; OAuth apps get the
      new callback URLs; everybody opens both old apps online once so offline queues drain (decision 9);
      the image is pullable; read `docs/migration.md`);
   1. **Prepare the new stack without starting it** (`/opt/toon-household`, files, `.env` with a NEW
      `SESSION_SECRET`, `RECIPE_HOSTNAME` / `FINANCE_HOSTNAME` set to the old names, mail values from
      the old `.env`; `docker compose pull`; validate the Caddyfile; do NOT `up`);
   2. **Stop the old stacks, without `-v`** (recipe, finance, then toon-edge; it holds 80/443);
   3. **Copy the old volumes out** (link `docs/migration.md` step 2; `toon-recipe_toon-data`,
      `toon-finance_toon-data`);
   4. **Dry run and read the report** (both ways of decision 13; link "The report");
   5. **Apply, then apply again** (link step 5; the report is a credential);
   6. **Copy the result into `toon-household_toon-data`** (the exact command of `docs/migration.md`
      step 6 with the real name; the chown to uid 1000 = the image's `bun`; compose's "volume already
      exists but was not created by Docker Compose" warning is expected and harmless — T08 confirms
      the exact behaviour);
   7. **Start the new stack** (`docker compose up -d`, wait for `healthy`, Caddy fetches three
      certificates);
   8. **Verify** (health; old hostnames: `/` and three Table R rows each with `curl -sI`; `/sw.js` on an
      old hostname returns the worker; sign-in, balance equals the report, claim links handed over
      privately; ADR 0005 warnings acted on);
   9. **Switch deploys over** (install `toon-household-deploy`, its key and the new repository's
      secrets; set `DEPLOY_ENABLED=false` (or delete it) in the two old repositories);
   10. **Retire the old stacks and toon-edge** (remove `/opt/toon-recipe`, `/opt/toon-finance`,
       `/opt/toon-edge`, the old forced commands and their `authorized_keys` lines,
       `docker network rm toon-edge`, old images; KEEP every old volume);
   11. **Later: drop the redirects** (unset `RECIPE_HOSTNAME` / `FINANCE_HOSTNAME`, `docker compose up
       -d`, when bookmarks and installed apps have moved);
   12. **Last: delete the old volumes** (the owner's decision; `docker volume rm toon-recipe_toon-data
       toon-finance_toon-data toon-edge_caddy-data toon-edge_caddy-config` plus any `toon-recipe_caddy-*`
       left from before toon-edge; E's warning: with an internal CA the old caddy-data holds that CA's
       private key; delete `migration-in/` and the private apply report too).
   Plus a short "Rolling back" paragraph (before step 10: `docker compose down` in the new stack, start
   toon-edge, then the two old stacks).
2. `docs/migration.md` "Cutover order": replace every `<new-volume>` with `toon-household_toon-data`;
   the intro sentence "The new stack's own volume and image names come from the deployment document …
   check them against that document." → the names as facts (`toon-household_toon-data`,
   `/app/data/local.db`, `/app/data/uploads`, image `ghcr.io/toonvish/toon-household`, uid 1000 of
   its `bun` user) with the link to `docs/deployment.md#cutover-from-toon-edge`; step 7's "in the new
   stack's directory" → "in `/opt/toon-household`"; step 8 ("Verify") follows Table R (ADR 0008): its
   first sentence says both old hostnames redirect permanently to the new one PATH BY PATH (ADR 0008),
   the two curl comments become `# 301, Location: https://<new-hostname>/recipe` (recipe host) and
   `# 301, Location: https://<new-hostname>/finance` (finance host), and one line is added after them,
   `curl -s https://<old-recipe-hostname>/sw.js | head -n 1     # the retiring worker (ADR 0008)`, plus
   one sentence pointing to `docs/deployment.md#cutover-from-toon-edge` step 8 for the full row check.
   These are the only edits in migration.md. Keep every sentence `legacy-migration-doc.test.ts` asserts
   (it pins step 6, not step 8).
3. Extend `apps/api/test/deployment-doc.test.ts` with a describe block for the cutover section: it
   exists between `## Operations` and `## Variants`; the bold step titles appear in the order above;
   step 2's commands contain `docker compose down` and no `-v`; no `docker volume rm` before step 12; step
   6 contains `cp /in/toon.db /data/local.db` and `chown -R 1000:1000 /data` and the uid equals the
   Dockerfile's `bun` user's documented uid (read the Dockerfile comment "uid 1000"); the section links
   `migration.md`; it names `toon-household_toon-data`, `toon-recipe_toon-data`,
   `toon-finance_toon-data`, `RECIPE_HOSTNAME`, `FINANCE_HOSTNAME`, `/sw.js`. A second block reads
   `docs/migration.md` "Cutover order": no `<new-volume>` is left; it contains
   `Location: https://<new-hostname>/recipe`, `Location: https://<new-hostname>/finance` and `/sw.js`;
   no line matches `/Location: https:\/\/<new-hostname>\/\s*$/` (the pre-ADR-0008 expectation); its
   step 8 links `deployment.md`.

**Must not:** change `migration.md` outside "Cutover order", or inside it beyond the intro, the
`<new-volume>` names, step 7's directory and step 8's redirect lines named above; run anything against
real volumes.

**Acceptance:** both doc tests pass; the cutover reads as one runbook from DNS to volume deletion.

**Verify.** `bun run typecheck`; `bun test apps/api/test/deployment-doc.test.ts apps/api/test/legacy-migration-doc.test.ts`; `! grep -qF '<new-volume>' docs/migration.md`; `! grep -qF '<!-- T07' docs/deployment.md`; `bun test`.

### T08 — Integration: image, stack, Caddy, redirects, cutover rehearsal, record (build)

**Read:** this whole plan; CLAUDE.md (all of "Gotchas in use", especially "Headless runs", "Long
commands", "`scrollbar-gutter`"); SPEC §7, §8 M6; `docs/deployment.md`; the files of T01-T07;
`apps/api/test/fixtures/legacy/{README.md,facts.ts}` (fixture users and passwords).

Let `S` be the session scratch directory. Long commands go to the background with one log ending in
`exit=$?`; poll the log; a log without `exit=` is not finished. Never `pkill -f`; never touch containers,
volumes or networks of other compose projects on this machine. Use `curl --resolve` and Chromium's
`--host-resolver-rules`; do not edit `/etc/hosts`.

**Do, in order (each numbered result goes to section 9):**

1. **Gates** on the merged tree: `bun install --frozen-lockfile`, `bun run typecheck`, `bun test` (count
   vs 2202 + the new tests), `PUBLIC_API_URL= bun run build` then `! grep -rlF 'localhost:3001'
   apps/web/dist`, `bun run i18n:check` (exit 1 by design; parity OK; the leftover list must equal M3b's
   146 hits or every new hit is classified), the LINKS / LINKS_FIN greps of CLAUDE.md.
2. **Image (exit 1):** from the repo root, in the background: `docker build -t toon-household:local . >
   build.log 2>&1; echo "exit=$?" >> build.log` and read `exit=0` (record duration and `docker image ls`
   size). Then the published variant: `docker build --build-arg WITH_OCR=1 --build-arg WITH_PDF=0 -t
   toon-household:ocr . > S/build-ocr.log 2>&1; echo "exit=$?" >> S/build-ocr.log`. Checks:
   `docker run --rm --entrypoint id toon-household:local` prints `uid=1000(bun)`;
   `docker run --rm --entrypoint sh toon-household:local -c '! grep -rqF localhost:3001 /app/apps/web/dist
   && test -f /app/apps/web/dist/sw.js && test -d /app/apps/api/node_modules && test -d
   /app/packages/shared/node_modules && ! command -v tesseract'`;
   `docker run --rm --entrypoint sh toon-household:ocr -c 'tesseract --list-langs | grep -qx deu && !
   command -v pdftoppm'`.
3. **Caddy validate (exit 3):** first `docker compose --env-file .env.local-stack config | head -n 1`
   prints `name: toon-household-local` (decision 5). Then the four combinations, each must print
   `Valid configuration`: `docker compose --env-file .env.local-stack run --rm --no-deps --entrypoint
   caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` (old hostnames set,
   internal); the same with an env file `S/env-unset` = `.env.local-stack` minus the two old-hostname
   lines; with `S/env-empty` (`RECIPE_HOSTNAME=` and `FINANCE_HOSTNAME=` present and empty; before the
   validate, `docker compose --env-file S/env-empty config` must show the caddy service's two
   `http://…unset.invalid` defaults: this is THE proof of the set-but-empty case, which Caddy alone does
   not handle, decision 7); with `S/env-acme` (old hostnames set, no `TOON_TLS_ISSUER`,
   `TOON_HSTS_MAX_AGE` default). All four scratch env files keep `COMPOSE_PROJECT_NAME=
   toon-household-local`. Also `caddy adapt` once for the set case and check in the JSON that every
   site's issuer is `internal`. If T03 recorded a compose-side fallback (decision 7), apply it here
   first, in its own commit.
4. **Stack (exit 2):** confirm nothing listens on 80/443 (`ss -ltnu`); if something does, stop and record
   it rather than reconfigure (a scratch compose override with other ports is the fallback, recorded in
   section 10). `docker compose --env-file .env.local-stack up -d` (the exit form, no `-p`); wait with
   an until-loop until `docker inspect` of the app container says `healthy` (record the time).
   `docker volume ls` shows `toon-household-local_toon-data` and no `toon-household_toon-data` (the
   isolation of decision 5, recorded). Then, with
   `R='--resolve haushalt.test:443:127.0.0.1 --resolve rezepte.test:443:127.0.0.1 --resolve
   finanzen.test:443:127.0.0.1'`: `curl -fsS --resolve haushalt.test:80:127.0.0.1
   http://haushalt.test/toon-root-ca.crt -o S/root.crt`; `curl -fsS --cacert S/root.crt $R
   https://haushalt.test/api/health` → 200, `modules` `["recipe","finance"]`; `curl -sI … https://haushalt.test/`
   → 200 with `content-security-policy`, `strict-transport-security: max-age=0`, `x-frame-options:
   DENY`, no `server` header; `/sw.js` → `cache-control: no-cache`; `/manifest.webmanifest` →
   `application/manifest+json`; `http://haushalt.test/recipe` → 301 to `https://haushalt.test/recipe`.
5. **Proxy and app behaviour:** seed refusal then seed:
   `docker compose --env-file .env.local-stack exec app bun apps/api/scripts/seed.ts` must exit non-zero
   and write nothing; `… exec -e ALLOW_SEED=1 -e SEED_PASSWORD=<12+ chars> app bun apps/api/scripts/seed.ts`
   exits 0. Login with curl (`Origin: https://haushalt.test`, `Content-Type: application/json`) as demo,
   then `GET /api/auth/me`, a recipe list, the finance balance, an upload URL from a recipe (if the seed
   has one) loads. XFF spoof: six wrong-password logins each with a different `X-Forwarded-For` must hit
   the rate limit like six without the header (the `(fwd)` overwrite plus the LAST-hop read). A login
   POST with `Origin: https://evil.test` is refused by the origin guard.
   `docker compose … exec app bun apps/api/scripts/reset-password.ts demo@toon.local` prints a link on
   `https://haushalt.test`.
6. **Redirects (Table R):** for every row, `curl -s -o /dev/null -w '%{http_code} %{redirect_url}'
   --cacert S/root.crt $R https://rezepte.test<sample>` (and finanzen) equals `301
   https://haushalt.test<expected>`; `/sw.js` on both old hosts is 200 `text/javascript` with the worker
   body; an unknown path falls back to `{uri}`; query strings survive where the table says so;
   `http://rezepte.test/plan` ends at `https://haushalt.test/recipe/plan` (follow with `-L`).
7. **Headless smoke** (Playwright in a scratch dir outside the repo, Chromium with
   `--host-resolver-rules=MAP haushalt.test 127.0.0.1, MAP rezepte.test 127.0.0.1, MAP finanzen.test
   127.0.0.1` and `ignoreHTTPSErrors: true`; one login per run, `storageState` reused; mobile context
   `isMobile: true, hasTouch: true` 390x844 and desktop 1440x900): `/`, `/recipe`, `/recipe/plan`,
   `/finance`, `/finance/transactions`, `/settings` render, no console error (CSP violations included),
   `scrollWidth <= clientWidth`; `navigator.serviceWorker.ready` resolves within 15 s on
   `https://haushalt.test`; `https://rezepte.test/plan` lands on `https://haushalt.test/recipe/plan`,
   `https://finanzen.test/plan` on `…/finance/plan`. Retiring worker: try to register it from a page on
   `https://rezepte.test` served by `page.route` (fulfilled HTML that calls
   `navigator.serviceWorker.register("/sw.js")`); record whether the registration activates and
   disappears (`getRegistrations()` empty after the reload). If Chromium will not let the test drive it,
   record "content checked by curl only" in section 9; that is not a failure. No PNGs are committed in
   M6 (no UI changed).
8. **Cutover rehearsal on the fixtures** (docs/deployment.md "Cutover from toon-edge" steps 4 to 8 with
   fixture inputs). Precondition: `docker volume ls -q --filter name=toon-household_` lists nothing
   (this dev machine has no production stack; if a `toon-household_*` volume exists, stop and record it,
   never remove it). `docker compose -p toon-household-local --env-file .env.local-stack down -v`; in
   `S/cutover/` copy `apps/api/test/fixtures/legacy/{recipe.db,finance.db,uploads}` into `migration-in/`
   shape; run the dry run and the two applies FROM THE IMAGE exactly as decision 13 / the doc writes it
   (adapt paths only); the second apply ends with `already migrated`. The rehearsal then DELIBERATELY uses
   the production names, because it proves the doc's commands: copy into a freshly created
   `toon-household_toon-data` with the doc's step-6 command verbatim (volume name substituted only by the
   doc itself); start it as the production project with the local values,
   `docker compose -p toon-household --env-file .env.local-stack up -d` (`-p` beats the env file's
   `COMPOSE_PROJECT_NAME`, so this is exactly the project the server's step 7 runs, whose `.env` sets no
   project name); the app becomes healthy and `docker compose -p toon-household ps` shows it attached to
   `toon-household_toon-data`; log in as a fixture user from `facts.ts` with its password; `GET` the
   finance balance of the merged household and compare with the report's balance; check the doc's step 8
   lines (and `docs/migration.md` step 8's) against `rezepte.test` / `finanzen.test`. Any command the doc
   gets wrong is a defect: fix the doc (own commit) and rerun from the failing step. Record whether
   compose warned about the pre-created volume. End the rehearsal with
   `docker compose -p toon-household --env-file .env.local-stack down -v`.
9. **Teardown:** `docker compose -p toon-household-local --env-file .env.local-stack down -v` (a no-op if
   step 8 already ran it); `docker image rm toon-household:ocr` (keep `:local` or remove, record which);
   confirm 80/443 are free again and neither a `toon-household_*` nor a `toon-household-local_*` volume
   or network remains; `rm -f build.log` (ignored, but leave the tree as found).
10. **Record:** this plan's section 9 (gates, build logs summarised with exit codes, sizes, durations,
    validate outputs, curl transcript summary, redirect table results, headless numbers, rehearsal
    results, every defect with its commit) and section 10 (what changed vs plan, deviations, ADR 0008
    as written or amended); status line → DONE. CLAUDE.md: Status (M6 done, next M7), "What M6
    added", Layout (`Dockerfile`, `.dockerignore`, `docker-compose.yml`, `docker/{Caddyfile,entrypoint.sh,
    env.example,toon-deploy.sh}`, `.env.local-stack`, the workflows, `docs/deployment.md`), Commands
    (the local stack test, `caddy validate` via compose run, the in-container scripts), "Not yet
    present" (drop Docker files and `docs/deployment.md`), new gotchas (the Dockerfile's
    `localhost:3001` guard; the three `node_modules`; uid 1000 and the pre-filled volume chown; the
    global `cert_issuer` and the `http://…unset.invalid` placeholders; `handle` vs `redir` ordering in
    the old-host blocks; the retiring worker; a single-file bind mount needs a caddy restart;
    `toon-household-deploy`; GHCR starts private; `docker build` checked by `$?` from a log; Caddy treats
    an empty `{$VAR}` as set, so the empty old-hostname case lives in compose's `:-` defaults; the local
    stack is the compose project `toon-household-local`, never the production name), ADR 0008
    in the ADR list, Obligations (M6 closed; left for the owner: the real cutover, GHCR visibility,
    `DEPLOY_ENABLED`, arm64 never built locally; M7 unchanged plus documenting the deploy surface in
    `docs/API.md` where it touches the API).

**Acceptance:** the four exit criteria hold and are recorded with their outputs; all gates green; the
stack is torn down; section 9 and CLAUDE.md describe what exists.

**Verify.** `bun install --frozen-lockfile`; `bun run typecheck`; `bun test`; `docker compose --env-file .env.local-stack config -q`; `! docker volume ls -q | grep -E '^toon-household(-local)?_'`; `grep -q '^\*\*Status: DONE' docs/plans/m6-deploy.md`.

## 6. Risks

1. **The empty-hostname problem in Caddy** (decision 7): Caddy's `{$VAR:default}` DOES treat
   set-but-empty as set (verified on 2.11.4: `server block without any key …`), so an empty old hostname
   reaching Caddy breaks the config. Mitigation: compose's `:-` defaults make the value never empty, and
   every documented run or validate goes through compose; T03 proves set, unset and acme with raw `caddy
   adapt` and never treats the raw empty failure as a reason for a fallback; T08 proves the empty case
   through `docker compose config` and validates four combinations through compose. If `cert_issuer`
   itself misbehaves, decision 7's Caddyfile-only fallback applies; a compose-side fallback is T08's.
2. **Directive order in the old-host blocks:** a bare `redir` sorts before `handle` and would redirect
   `/sw.js` too. Mitigation: only `handle` blocks (T03 rule), checked by T08 step 6.
3. **301 is cached by browsers:** a wrong row in Table R sticks in users' browsers. Mitigation: the web
   test resolves every target against the real route tree; T08 curls every row before anyone sees it.
4. **The retiring worker cannot be fully proven headless.** Mitigation: content pinned by test, served
   bytes checked by curl, the Playwright attempt recorded honestly; the cutover doc's "open both apps
   online once" step limits what a stale worker can lose.
5. **Ports 80/443 on the dev machine** belong to whoever binds them first (another compose project runs
   here). Mitigation: T08 checks first; fallback is a scratch compose override with other host ports,
   never an edit of `docker-compose.yml`, and section 10 records it.
6. **Cold image build time and network:** pulling `oven/bun:1.4.2-debian`, Debian packages and the
   dependency install can take 5-15 minutes; QEMU/arm64 is never built locally (release only). The build
   runs in the background with a log ending in `exit=`; arm64 is listed as unverified.
7. **`bun install --frozen-lockfile --production` in the deps stage** might differ from R's lockfile
   behaviour (H has more workspace deps, e.g. `zxing-wasm` in web). If it fails, T08 fixes the
   Dockerfile minimally (own commit) and records it.
8. **`docker volume create` before compose:** compose warns that the volume was not created by it; the
   doc says so. If compose refuses instead of warning, T08 changes the doc's step 6 to create the volume
   through compose (`docker compose create` before the copy) and reruns the rehearsal.
9. **GitHub workflows are untested by execution.** The YAML test pins structure and SHAs; the first push
   to `main` after M6 is the first real run (owner, outside the workflow). The GHCR package starts
   private: documented.
10. **Committed dummy secret** in `.env.local-stack`: harmless by construction (local CA, `.test`
    hostnames), excluded from the build context, labelled; the production `SESSION_SECRET` refusal does
    not trigger because it does not start with `change-me`.
11. **The migration run from the image** (decision 13) may hit a path or permission assumption (the
    image's `REPO_ROOT` is `/app`, the process runs as uid 1000 and needs write access to the mounted
    work directory). T08's rehearsal is the proof; the doc follows the rehearsal.
12. **A local `down -v` reaching production data.** Without a project name of its own, the local stack
    would share `toon-household_*` volume names with production, and the cutover invites a checkout on the
    server. Mitigation (decision 5): `COMPOSE_PROJECT_NAME=toon-household-local` in `.env.local-stack`
    (pinned by T02's test), `-p toon-household-local` on every local command in the doc (pinned by T06's
    test), and T08 checks the volume names; only T08's rehearsal uses `-p toon-household`, on a machine
    shown to have no such volume first.

## 7. Deviations expected

- **ADR 0008** (decision 8): the old-hostname blocks map paths and answer `/sw.js` with a retiring worker
  instead of D11's bare `redir {uri}`; SPEC D11's sentence is edited in the same commit (T03).
- Recorded interpretations, not deviations: TLS variables documented in the stack's one `.env` for the
  Caddy service but absent from the app's environment (decision 6); a global `cert_issuer` (decision 7);
  English comments and messages in the deploy files (decision 2); `sync-config` validates and restarts
  Caddy (decision 11); `DEFAULT_LOCALE` passed through (decision 4); the Dockerfile's `localhost:3001`
  guard (decision 3).
- Anything T08 forces (ports fallback, Dockerfile install fix, volume creation, a compose-side Caddy
  fallback) goes to section 10, and to an ADR only if it changes a SPEC §1 statement.

Plan revision after review (2026-10-15), so section 10 can tell plan changes from execution changes:
(1) T05's SHA rule applies to step-level `uses:` only; job-level `./.github/workflows/…` calls are exempt
(F's `jobs.deploy.uses` has no `@sha`); (2) T05 names release.yml's `workflow_dispatch` description among
the German strings to translate and its test asserts no German is left; (3) the local stack runs as compose
project `toon-household-local` (`.env.local-stack` key plus `-p` in the doc), restoring R's `-p toonstack`
isolation (decision 5, T02, T06, T08 steps 3, 4, 8, 9); (4) T07 also corrects `docs/migration.md` step 8's
redirect expectations to Table R and adds the `/sw.js` check; (5) T03's check (c) resolves every
catch-all source path in H, so a forgotten Table R row fails; (6) decision 7 and T03 state that Caddy treats
an empty variable as set: the empty case is proven only through compose, T03 runs set, unset and acme only,
never takes a fallback over the raw empty failure, and never edits `docker-compose.yml`.

## 8. Out of this milestone

- The real cutover on the server, real DNS, real certificates, pushing to GitHub, running the workflows,
  making the GHCR package public, setting `DEPLOY_ENABLED` (all the owner's, guided by
  `docs/deployment.md`).
- Building or testing arm64 locally; a DNS-01 Caddy build; a mail sink container; deleting any old volume.
- `docs/API.md`, `docs/modules/*.md`, `docs/open-work.md` and CLAUDE.md "as built" review (M7).
- Any UI or API feature change; the owner decisions still open in CLAUDE.md (Gruppe/Haushalt, the pinned
  toon-recipe design exceptions, finance print styles, per-household PWA name, iOS install check).
- Changes to R, F or E (read-only); retiring the toon-edge repository itself.

## 9. Integration record

Written by T08 on 2026-10-15; every number below comes from a command run on the merged tree.

### 9.1 Gates on the merged tree (HEAD `0d93a88`, before T08's own commit)

| Gate | Result |
| --- | --- |
| `bun install --frozen-lockfile` | `Checked 436 installs across 625 packages (no changes)`, exit 0 |
| `bun run typecheck` | `[typecheck] OK` |
| `bun test` | **2418 pass, 0 fail, 136 files** (22.6 s; M3b closed at 2202 / 129: M6 added 7 files, the six `deploy-*` / `deployment-doc` files in `apps/api/test/` and `apps/web/src/legacy-redirects.test.ts`, and 216 tests) |
| `PUBLIC_API_URL= bun run build`, then `! grep -rlF 'localhost:3001' apps/web/dist` | build exit 0, grep finds nothing |
| `bun run i18n:check` | exit 1 by design; parity `[i18n:check] OK`; the leftover list is **146** hits, the same count as M3b's (M6 touched only four comments in `apps/api/src`, no scanned German); nothing new to classify |
| LINKS and LINKS_FIN greps (CLAUDE.md) | both empty |

### 9.2 Exit criterion 1: the image (decision 3, T01)

- `docker build -t toon-household:local . > build.log 2>&1; echo "exit=$?" >> build.log`: log ends
  **`exit=0`** (checked from the log, never through a pipe), 24 s wall clock (BuildKit, no `CACHED` step in the log: every layer ran, including both `bun install` stages and the
  web build with its `localhost:3001` guard). `docker image ls`: `toon-household:local` **356 MB**.
- `docker build --build-arg WITH_OCR=1 --build-arg WITH_PDF=0 -t toon-household:ocr .` (the image
  `release.yml` publishes): **`exit=0`**, 28 s, **464 MB**, env `IMPORT_OCR_ENABLED=1`, `IMPORT_PDF_ENABLED=0`.
- `docker run --rm --entrypoint id toon-household:local` prints `uid=1000(bun) gid=1000(bun)`; the shell
  check of T08 step 2 (`! grep -rqF localhost:3001 /app/apps/web/dist`, `sw.js` present, `apps/api/node_modules` and
  `packages/shared/node_modules` present, no `tesseract`) exits 0; on `:ocr`, `tesseract --list-langs`
  has `deu` and there is no `pdftoppm` (exit 0).
- arm64 was not built (plan section 8): unverified until the first `release.yml` run.

### 9.3 Exit criterion 3: `caddy validate` through compose (decisions 5 and 7, T03)

`docker compose --env-file .env.local-stack config | head -n 1` prints `name: toon-household-local`.
`docker compose --env-file <file> run --rm --no-deps --entrypoint caddy caddy validate --config
/etc/caddy/Caddyfile --adapter caddyfile` printed `Valid configuration` in all four combinations (the four
scratch env files all keep `COMPOSE_PROJECT_NAME=toon-household-local`):

| Combination | Env file | Result |
| --- | --- | --- |
| old hostnames set, `internal` | `.env.local-stack` | Valid configuration |
| old hostnames unset | `.env.local-stack` minus the two lines | Valid configuration |
| old hostnames set-but-empty (`RECIPE_HOSTNAME=`, `FINANCE_HOSTNAME=`) | scratch `env-empty` | Valid configuration; `docker compose --env-file env-empty config` shows the caddy service with `FINANCE_HOSTNAME: http://old-finance-hostname.unset.invalid` and `RECIPE_HOSTNAME: http://old-recipe-hostname.unset.invalid`: the proof of decision 7, compose's `:-` fills what Caddy alone would treat as set |
| old hostnames set, `acme` (no `TOON_TLS_ISSUER`, default HSTS) | scratch `env-acme` | Valid configuration |

`caddy adapt` of the set case: one TLS automation policy, no subjects, issuer `internal`, which covers the
three sites `haushalt.test`, `finanzen.test` and `rezepte.test` (global `cert_issuer`, decision 7). T03 recorded no
compose-side fallback and the global `cert_issuer` was accepted, so decision 7's fallbacks were not needed.

### 9.4 Exit criterion 2: the local stack (decision 5, T02)

- Ports: `ss -ltnu` showed nothing on 80 or 443 before the `up` (and again after the teardown).
- `docker compose --env-file .env.local-stack up -d` (the exit form, no `-p`): project **`toon-household-local`**;
  the app container `toon-household-local-app-1` was `healthy` after **7 s**; `docker volume ls` showed
  `toon-household-local_toon-data`, `toon-household-local_caddy-data`, `toon-household-local_caddy-config` and the
  network `toon-household-local_toon`, and **no** `toon-household_*` volume: the isolation of decision 5 holds.
- Caddy obtained three certificates from the `local` issuer (the three hostnames).
- curl through the local CA (`curl --cacert root.crt --resolve ...`; `/etc/hosts` untouched):
  `http://haushalt.test/toon-root-ca.crt` fetched; `GET /api/health` 200 with `"modules":["recipe","finance"]`;
  `GET /` 200 with a `content-security-policy` (the API's, hashed), `strict-transport-security: max-age=0`,
  `x-frame-options: DENY`, `alt-svc: h3=":443"` and no `server` header; `/sw.js` `cache-control: no-cache`;
  `/manifest.webmanifest` `application/manifest+json; charset=utf-8`; `http://haushalt.test/recipe` 301 to
  `https://haushalt.test/recipe`.
- Proxy and app: `exec app bun apps/api/scripts/seed.ts` exits 1 with `[seed] refusing to run with
  NODE_ENV=production. Set ALLOW_SEED=1 if you really mean it.` and wrote nothing; with `-e ALLOW_SEED=1 -e
  SEED_PASSWORD=<18 chars>` it exits 0 (finance enabled, 8 transactions and 1 settlement, plan 3 periods booked).
  Login as `demo@toon.local` 200 (`Origin: https://haushalt.test`), `/api/auth/me` returns the household with
  `modules: ["recipe","finance"]`, the recipe list returns the seeded recipes, the finance balance is 200 (128436 ct,
  12 transactions). The seed has no recipe with an image, so no upload URL was loaded here (the migrated avatar
  upload in 9.7 was). XFF spoof: after an app restart (the limiter is in memory) 12 wrong-password logins without
  the header gave `401 x10, 429 x2`; after another restart 12 wrong logins each with a different
  `X-Forwarded-For: 10.9.8.N` gave the same `401 x10, 429 x2` (the `(fwd)` overwrite plus the last-hop read hold).
  A login POST with `Origin: https://evil.test` answered 403 (origin guard). `exec app bun
  apps/api/scripts/reset-password.ts demo@toon.local` printed `https://haushalt.test/reset-password/<token>`.

### 9.5 Table R (decision 8, T03)

A scratch script curled every row of Table R through `https://rezepte.test` and `https://finanzen.test`
with `curl -s -o /dev/null -w '%{http_code} %{redirect_url}'` against the local CA, with query strings where the
table keeps them: **54 requests, 54 `301` to the expected `https://haushalt.test<target>`, 0 failures**. That covers
every row (recipe host: `/`, `/?q=…`, `/search[?q=…]`, `/recipes/new|<id>|<id>/edit|<id>?servings=4`, `/import`,
`/import/<id>`, `/collections[/<id>]`, `/tags`, `/shopping`, `/shopping/cards|history|<id>`, `/plan[?week=…]`,
`/groups`, `/groups/<id>[?x=1]`; finance host: `/`, `/transactions[?kind=…]`, `/transactions/<id>[/edit]`,
`/new`, `/plan`, `/categories`, `/household`, `/password/forgot`, `/password/reset[?token=…|/<id>]`) and the fall-through rows
(`/settings`, `/login`, `/register`, `/forgot-password`, `/reset-password/<t>`, `/verify-email/<t>`, `/invite/<t>`,
`/oauth/callback[?code&state]`, `/uploads/<f>?exp&sig`, `/api/health`, an unknown path, each equal to `{uri}`; the finance
`/password/reset` rows lose their query as the table says). `/sw.js` on both hosts: 200, `content-type: text/javascript;
charset=utf-8`, `cache-control: no-cache`, the retiring worker body (identical on the two hosts). Following the redirect:
`http://rezepte.test/plan` ends at `https://haushalt.test/recipe/plan` (200) and `http://finanzen.test/plan` at
`https://haushalt.test/finance/plan` (200).

### 9.6 Headless smoke (Playwright, scratch directory outside the repo)

Chromium 1248 with `--host-resolver-rules=MAP haushalt.test 127.0.0.1, MAP rezepte.test 127.0.0.1, MAP finanzen.test 127.0.0.1`
and `--ignore-certificate-errors` (plus `ignoreHTTPSErrors`: without the flag a service worker will not register on a
certificate the browser does not trust). One login, `storageState` reused for the mobile (`isMobile`, `hasTouch`, 390x844) and
desktop (1440x900) contexts: `/`, `/recipe`, `/recipe/plan`, `/finance`, `/finance/transactions`, `/settings` all rendered at their
own URL on both, **0 console errors and 0 page errors** (CSP violations are console errors) on all 12 loads,
`scrollWidth <= clientWidth` (390/390 on the phone; 1425/1440 on desktop, which is `scrollbar-gutter: stable`, and
`documentElement.style.scrollbarGutter = "auto"` makes it 1440/1440) and no element outside the viewport that is not inside a
clipping or scrolling ancestor. `navigator.serviceWorker.ready` resolved on `https://haushalt.test` with the worker
`activated`, scope `/`. Old hostnames in a browser: `https://rezepte.test/plan` lands on `https://haushalt.test/recipe/plan`
(the app adds `?week=<monday>`), `http://rezepte.test/plan` likewise, `https://finanzen.test/plan` on `/finance/plan`,
`https://rezepte.test/groups` on `/households`, `https://finanzen.test/` on `/finance`. 21 checks per run, 0 failures after the
two fixes of the script itself (a too strict URL equality that ignored the `week` query, and a retiring-worker test page that
looped because `page.route` kept fulfilling the reload instead of letting it reach Caddy).

**The retiring worker, driven for real:** a page served by `page.route` on `https://rezepte.test/__page?w=reg` (and on
`finanzen.test`) created a cache and registered the real `/sw.js` from Caddy. The worker installed and activated, deleted
the cache, unregistered itself and navigated the window, which then reached Caddy, got the 301 and ended at
`https://haushalt.test/__page?w=reg`. A fresh page on the old origin reported `regs=0 caches=0`. The worker therefore
retires itself in Chromium on both old hostnames; the unsent IndexedDB contents are untouched by design. No PNGs were
committed (no UI changed).

### 9.7 Cutover rehearsal from the image (decision 13, T07)

Precondition checked: `docker volume ls -q --filter name=toon-household_` listed nothing. The local stack was taken down
(`-p toon-household-local ... down -v`: its three volumes and the network removed). Then in a scratch directory with
`migration-in/recipe/{local.db,uploads}` and `migration-in/finance/local.db` copied from the fixtures:

- **Step 4 dry run, from the image** exactly as the doc writes it (`docker run --rm --user 1000:1000 -e DATABASE_URL=...
  -v "$PWD:/work" --entrypoint bun toon-household:local apps/api/scripts/migrate-legacy.ts ...`): exit 0, `== Errors == (none)`,
  all five finance households `OK` (Kasse Anna & Ben 119486 ct, Kasse Cleo & Dana 1675 ct, Emil & Fritz 1900 ct, Gina allein 2500 ct,
  Kasse Anna & Pia 2100 ct, legacy and migrated equal), `274 rows would be written, 7 files would be copied`. The one
  referenced-but-missing upload is the fixture's deliberate trap.
- **Step 5 apply** (with `-v "$PRIVATE_DIR:/private"` and `--report /private/apply.json`): exit 0, `applied: 274 rows written, 7 files
  copied`; the second apply: exit 0, `[migrate:legacy] already migrated: nothing written.` Both ran as uid 1000 with no
  permission change (the scratch directory belongs to uid 1000, as the doc says).
- **Step 6, the doc's command verbatim:** `docker volume create toon-household_toon-data`, then the `alpine sh -c 'cp ... && chown -R
  1000:1000 /data'`: exit 0; `ls -la /data` shows `local.db`, `local.db-wal`, `uploads/` owned by `1000 1000`.
- **Step 7 as the production project:** `docker compose -p toon-household --env-file .env.local-stack up -d` printed `level=warning
  msg="volume \"toon-household_toon-data\" already exists but was not created by Docker Compose. Use `external: true` to use an
  existing volume"` (the warning the doc announces; it is a warning, not a refusal), the app was `healthy` after 7 s, `docker inspect`
  shows `toon-household_toon-data -> /app/data`, the log shows `[db:migrate] done` (a no-op on the migrated database) and
  the new project's own volumes `toon-household_caddy-data` and `toon-household_caddy-config`.
- **Step 8:** the three step-8 old-host rows of the doc and of `docs/migration.md` (`/`, `/plan`, `/shopping` on `rezepte.test`;
  `/`, `/plan`, `/new` on `finanzen.test`) printed the expected `301` lines, `sw.js` is `HTTP/2 200` with the first line `// Retires the
  service worker ...` on both hosts, `curl -sI .../` shows the 301 with `location: https://haushalt.test/recipe|finance`, and
  `/api/health` lists both modules. Login as `anna@example.test` with the recipe password (`recipe-pass-anna`, the recipe row wins
  for a user in both apps) answered 200; `/api/auth/me` lists the two merged households ("Familie Beispiel" and "Freundeskreis")
  with both modules; the recipe list of the first returned its migrated recipes, and the avatar URL of the profile is a signed
  `/uploads/…` URL. Finance balances: "Freundeskreis" (`…0002`) 2100 ct, equal to the report; "Familie Beispiel" (`…0001`)
  **222286 ct**, not the report's 119486 ct: see the defect below.
- **Defect found by the rehearsal (the doc's "balance must equal the migrated balance" was wrong), fixed in commit `ab93a10`:** the first
  boot runs the finance `start` hook, the fixed-cost catch-up (`plan:run`), and the fixture's plan (`startPeriod 2026-07`, `lastBookedPeriod`
  behind) booked two `fixed_plan` rows `Fixkostenanteil 09/2026` and `10/2026` of 51400 ct each at 10:59:36, the moment of the boot:
  119486 + 2 x 51400 = 222286. Not a data defect (the migrated rows equal the report), but a check that a real operator would
  have read as a failure. `docs/deployment.md` step 8 and `docs/migration.md` step 8 now say that the balance equals the report plus any
  plan rows the first boot booked, and that the balance without those rows must match. The deployment-doc and legacy-migration-doc tests
  still pass.
- Teardown of the rehearsal: `docker compose -p toon-household --env-file .env.local-stack down -v` removed the containers, the
  network and the two compose-created volumes, **but not `toon-household_toon-data`**: a volume that `docker volume create` made
  before compose carries no compose label, so `down -v` leaves it. It was removed by name afterwards (`docker volume rm
  toon-household_toon-data`; it was created by the rehearsal on a machine that had no such volume). The doc does not use `down -v` for the
  production project (its rollback is `docker compose down` without a flag), so no doc change.

### 9.8 Teardown (step 9)

`docker compose -p toon-household-local --env-file .env.local-stack down -v` (a no-op after step 8: "No resource found to
remove"), `docker image rm toon-household:ocr` and `toon-household:local` (both removed; the pulled base images
`oven/bun:1.4.2-debian`, `caddy:2.11.4-alpine` and `alpine` stay in the local image cache), ports 80 and 443 free,
`docker volume ls -q | grep -E '^toon-household(-local)?_'` empty, no `toon-household*` network or container, `build.log` removed,
`git status` clean. The other compose projects on the machine (`default-ma-59179`, `toonfin_*`, others) were never touched.

### 9.9 Defects

| Commit | File | Defect |
| --- | --- | --- |
| `ab93a10` | `docs/deployment.md`, `docs/migration.md` | step 8 said the balance equals the report; the first boot's plan catch-up adds `Fixkostenanteil` rows (9.7) |

No defect in the Dockerfile, the compose file, the Caddyfile, the script or the workflows; no ADR change (0008 stands as written
by T03). The workflows (`release.yml`, `deploy.yml`, the `ci.yml` docker-build job) were checked statically by their tests only: the first push
to `main` is the first real run.


## 10. What changed vs plan

Against plan sections 2 to 7:

- **Deviations from SPEC section 1:** none beyond ADR 0008 (D11, written by T03: path-by-path redirects and the retiring worker). No new ADR.
- **No fallback was needed:** the global `cert_issuer` was accepted (decision 7), the compose-side Caddy fallback of T03 was never
  recorded, ports 80 and 443 were free (no scratch compose override), `bun install --frozen-lockfile --production` worked in the deps stage as
  in R (risk 7), `docker volume create` before compose gave a warning, not a refusal (risk 8: the doc's step 6 stands), and the
  migration from the image (decision 13) ran as written, as uid 1000 (risk 11).
- **Execution against the plan:** the image builds took 24 s and 28 s, not the 5 to 15 minutes of risk 6 (BuildKit on 16 cores);
  the rehearsal's own `down -v` leaves a volume that was created by hand (9.7), so it was removed by name; Chromium needed
  `--ignore-certificate-errors` next to `ignoreHTTPSErrors` for the service worker to register on the internal CA's
  certificate; the retiring-worker test needs the reload to reach the network, which is how the real flow runs (9.6).
- **One doc defect fixed in its own commit** (9.9): the balance check in step 8 of the cutover and of `docs/migration.md`.
- **Commit trailers:** the earlier M6 commits carry `Co-Authored-By: Claude Fable 5.1` (the workflow's text); T08's commits carry the
  trailer the session's harness prescribes, `Claude Sonnet 5.5`. Only the trailer differs.
- **Left for the owner (plan section 8, unchanged):** the real cutover on the server, real DNS and certificates, pushing, the first
  `release.yml` and `deploy.yml` runs, GHCR visibility, the `DEPLOY_ENABLED` variable, arm64 (never built locally). M7 is unchanged and
  documents the deploy surface where it touches the API.

