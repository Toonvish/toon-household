# CLAUDE.md — toon-household

The household app: `toon-recipe` and `toon-finance` merged into one modular Bun/Hono/React PWA, with room for
more modules. The next session has no memory of this one, so the docs are the spec. This file holds the core and
the cross-cutting rules; each module's knowledge lives in its own doc (`docs/modules/<id>.md`).

## Read order

1. `docs/SPEC.md` — the fixed decisions (§1), the module contract (§2), the target layout (§3), the schema mapping
   (§4), the shell (§5), the migration (§6), the gates (§7), the milestones (§8).
2. This file.
3. Before touching a module, its doc: `docs/modules/recipe.md` or `docs/modules/finance.md` (what the module owns,
   its source's locked decisions with their status here, its gotchas, the source's gotchas mapped one by one).
4. The two source repos' `CLAUDE.md` files, read-only: `/home/erics/software/toon-recipe/CLAUDE.md` and
   `/home/erics/software/toon-finance/CLAUDE.md`. Their locked decisions and gotchas stay binding inside the
   module that inherits them (SPEC D13). The source trees are never modified.
5. `docs/API.md` — the HTTP contract: conventions, error codes, middleware chain and mount order, security, every
   core endpoint, then the sections "Recipe module" and "Finance module" (one table row per served route).
6. `docs/migration.md` — the operator's guide to `migrate:legacy` (inputs, rules, report, cutover order).
7. `docs/deployment.md` — the operator's guide to the stack (fresh install, operations, the cutover from
   toon-edge, variants, the local stack test).
8. `docs/open-work.md` — what is deliberately not done (owner actions and decisions, deferred, observations).
9. `docs/adr/` — one record per deviation from SPEC §1 (`NNNN-slug.md`: date, context, decision, consequences;
   the ADR edits the SPEC text in the same commit).
10. `docs/plans/` — one plan per milestone (`docs/plans/m0-scaffold.md` …): tasks, files, verify commands, the
    integration record and "what changed vs plan". Dated records: history lives there, not here.

## Fixed decisions

SPEC §1 (D1–D15) is fixed and changes only through an ADR. Do not re-litigate a decision in code or review; if a
task forces a deviation, make the smallest one and record it. The ADRs so far (`docs/adr/`): 0001 household
copy without recipe counts (D10); 0002 finance's generic Zod messages use the core's wording (D10); 0003 finance
tests on the shared memory DB (D13), superseded by 0009; 0004 finance participant churn rules (`409
member_has_ledger`, the slot-1 re-seat, `onMemberRemoving`; D3, D13); 0005 ledger states only the legacy
migration may write (D2, D3, SPEC §6); 0006 placeholder members and claim invites (D1, D4, D12, SPEC §4, §6);
0007 toon-finance `1715207` adaptations: leave rule, CSP additions, origin guard trusting `WEB_ORIGIN` (D13); 0008
old hostnames map their own paths and retire their service workers (D11); 0009 the whole test suite on a temp file
DB (restores toon-finance gotcha 2); 0010 a header row per shell screen instead of a global top bar (D1, D6); 0011
the service worker's runtime rules are the union of both sources' (D9, D13).

## Building it

`.claude/workflows/build-household.js` builds the app milestone by milestone (SPEC §8). Run it from this
directory with `Workflow build-household` and `args: { milestones: ["M0"] }`, one or two milestones per
invocation, and read the result before the next. Opus plans and reviews, Sonnet implements and verifies, Haiku
does verbatim ports and runs the gates. The workflow writes the plan to `docs/plans/` and commits per task; it
never pushes.

## Status

All milestones are done: M0 scaffold (`docs/plans/m0-scaffold.md`), M1 core (`docs/plans/m1-core.md`), M2 recipe
module (`docs/plans/m2-recipe-module.md`), M3 finance module (`docs/plans/m3-finance-module.md`), M3b finance-sync
(`docs/plans/m3b-finance-sync.md`, toon-finance `cbdec67..1715207` plus placeholders), M4 design pass
(`docs/plans/m4-design-pass.md`), M5 migration (`docs/plans/m5-migration.md`), M6 deploy (`docs/plans/m6-deploy.md`)
and M7 harden (`docs/plans/m7-harden.md`), 2026-10-13 to 2026-10-15; each plan's last sections are its
integration record and "what changed vs plan". Two modules are built (`API_MODULES` and `WEB_MODULES` are
`[recipe, finance]`, `/api/health` reports `modules: ["recipe","finance"]`). The tree typechecks, builds and tests
green (`bun test`: 2434 pass in 138 files at M7-T09; M7's integration record has the final numbers). What is left
is the owner's (see "Open work").

## Layout (as built)

Package names are `@toon/shared`, `@toon/api`, `@toon/web`; the root is `toon-household`. Paths per SPEC §3.

- `packages/shared/src/index.ts` is the ONLY entry (the vite alias maps exactly `"@toon/shared"`; never import a
  subpath). `packages/shared/src/core/` holds `i18n/` (runtime plus
  `packages/shared/src/core/i18n/catalogs/server.{de,en}.ts`), `schemas/{common,household,user,auth}.ts`,
  `calendar.ts`, `text.ts`. `packages/shared/src/modules/registry.ts` has `MODULE_IDS`, `ModuleIdSchema`,
  `DEFAULT_ENABLED_MODULES = ["recipe"]`; `packages/shared/src/modules/recipe/` and
  `packages/shared/src/modules/finance/` are the module barrels, re-exported FLAT from the entry (finance's tag
  schemas and 50/200 pagination are therefore `FinanceTag…` / `FinancePaginationQuery…`). Tests flat in
  `packages/shared/test/`.
- `apps/api/src/index.ts` wires health, `/uploads/:filename`, `mountModules`, `/api/auth`, `/api/households`,
  SIGTERM/SIGINT calling each module's `shutdown`, the static web LAST. Beside it: `apps/api/src/env.ts`,
  `apps/api/src/db/{client,migrate,schema}.ts` plus `apps/api/src/db/schema/core.ts`, `apps/api/src/lib/`,
  `apps/api/src/middleware/{session,household,module,verifiedEmail,staticWeb,originGuard,securityHeaders}.ts`,
  `apps/api/src/modules/{index,types,mount}.ts` (the registry, the contract, the mount chain).
- Core API: `apps/api/src/core/routes/{auth,households,members,invites,modules}.ts` (the last three export
  `register…Routes(router)` onto the one `householdRoutes` of `households.ts`) and
  `apps/api/src/core/services/{auth,households,mail,media}/`;
  `apps/api/src/core/services/households/modules.ts` holds `enabledModulesFor`, `initializeHousehold`,
  `enableModule`, `disableModule`; `apps/api/src/core/services/media/` holds the uploads, the module reference
  scan and the sharp thumbnails.
- Module APIs: `apps/api/src/modules/recipe/` and `apps/api/src/modules/finance/` (manifest `index.ts`,
  `schema.ts`, `routes/`, `services/`, seed; details in the module docs).
- Migrations: `apps/api/drizzle/{0000_core,0001_recipe,0002_finance,0003_placeholder_members}.sql`, generated by
  drizzle-kit (`0003` has three generator defects corrected by hand, ADR 0006).
- Scripts: `apps/api/scripts/{migrate,seed,reset-password,uploads-gc,plan-run,finance-import-xlsx,migrate-legacy}.ts`;
  `apps/api/scripts/legacy/` is the `migrate:legacy` library (`claims.ts` is the placeholders' claim-invite step),
  `apps/api/scripts/finance-import/` the workbook parsers. Root `scripts/{dev,typecheck,i18n-check,icons}.ts`.
- API tests in `apps/api/test/` (`apps/api/test/support/` for harnesses, `apps/api/test/import/`,
  `apps/api/test/fixtures/import/`, `apps/api/test/fixtures/legacy/`); the doc guards are
  `apps/api/test/api-doc.test.ts` (every served route has a `docs/API.md` row and every row is served; every
  `ERROR_CODES` value is named) and `apps/api/test/docs-paths.test.ts` (every repo path in this file,
  `docs/API.md`, the module docs and `docs/open-work.md` exists).
- Web: `apps/web/src/{main,app,route-roots,router}.tsx` (`route-roots.tsx` imports no shell and no registry;
  `router.tsx` attaches `AppLayout` = `RequireAuth` + `AppShell` and builds the tree: auth routes,
  `/households`, `/households/$householdId`, `/settings`, `/` Home, `WEB_MODULES.map((m) => m.route)`),
  `apps/web/src/lib/` (`api`, `queries`, `query-client`, `session.tsx`, `persist`, `nav.tsx`, `permissions.ts`,
  `share.ts`, `i18n/` with the core catalogs), `apps/web/src/components/ui/` (toon-recipe's primitives, the only
  ones), `apps/web/src/components/layout/` (AppShell, BottomTabBar, SideNav, ModuleSwitcher, PhoneHeaderRow,
  nav items), `apps/web/src/core/features/{auth,home,households,settings}/`,
  `apps/web/src/modules/{index,catalogs,persist,types,enabled}.ts`, `apps/web/src/styles/{theme,index,fonts}.css`;
  the web modules `apps/web/src/modules/recipe/` and `apps/web/src/modules/finance/` (manifest, `routes.tsx`,
  `HomeCard.tsx`, `catalogs/`, `lib/`, `features/`). Nothing lives under `apps/web/src/features/` (SPEC §3). Web
  tests are co-located `*.test.ts(x)` under `apps/web/tsconfig.test.json`. PWA: `apps/web/pwa-manifest.ts`,
  `apps/web/public/icons/` and `apps/web/public/favicon.svg` (from `scripts/icons.ts`).
- CI and deploy: `.github/workflows/ci.yml` (verify job with a poppler step and SHA-pinned actions; the
  `docker-build` job on pull requests builds the image without pushing), `.github/workflows/release.yml` (push to
  `main` and `v*` tags: typecheck, test, the multi-arch image to `ghcr.io/toonvish/toon-household`),
  `.github/workflows/deploy.yml` (gated by the repository variable `DEPLOY_ENABLED`, one SSH forced command).
  `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.local-stack`,
  `docker/{Caddyfile,entrypoint.sh,env.example,toon-deploy.sh}`; nothing of it is built by `bun run build`.
- Docs: see "Read order"; plus `docs/plans/screenshots/` and `docs/design/recipe-redesign/` (design record, D5).
- Core DB tables (unprefixed): `users`, `oauth_accounts`, `sessions`, `password_reset_tokens`,
  `email_verification_tokens`, `households`, `household_members`, `household_invites`, `household_modules`,
  `legacy_ids` (its column is named `table` per D12; the TS property is `tableName`). Recipe tables are all
  `recipe_*`, finance tables all `finance_*` (lists in the module docs; `group_id` became `household_id`).

## Commands

Run from the repo root. Bun 1.4.2 (`.bun-version`); `bun install --frozen-lockfile` first.

- `bun run dev`: API (`:3001`, `bun --watch`) and Vite web (`:5173`, proxies `/api`); `dev:api` / `dev:web` one
  at a time. Needs `DATABASE_URL` and `SESSION_SECRET` (16+ chars) in the environment or a root `.env` (copy
  `.env.example`) and a migrated DB, e.g. `DATABASE_URL=file:./data/m2.db SESSION_SECRET=<32 hex> bun run dev`.
- `bun run start`: the API without watch (production); with `WEB_DIST_DIR=./apps/web/dist` it also serves the
  built shell (needs `bun run build` first).
- `bun run typecheck`: `tsc --noEmit` over packages/shared, apps/api and the three apps/web projects.
- `bun test`: all unit and API tests, on a fresh temp file DB per process (ADR 0009; `TEST_DATABASE_URL`
  overrides it).
- `bun run build`: Vite build plus the generated PWA service worker into `apps/web/dist`.
- `bun run i18n:check`: German catalog parity plus no German left in ported source. Exits 1 by design: parity
  OK, and about 146 leftover-German hits, all false positives (German quoted in doc comments, 10 lines of recipe
  content vocabulary). Classify each hit, never suppress the check. `apps/api/scripts` is not scanned.
- `bun run db:generate`: drizzle-kit generates a migration from `apps/api/src/db/schema`.
- `bun run db:migrate`: applies the migrations to `DATABASE_URL` (e.g. `file:./data/m2.db`) and every build
  module's `afterMigrate`. `bun run db:studio`: drizzle-kit studio on the configured DB.
- `bun run seed`: idempotent demo data on `DATABASE_URL` (migrates first; needs `SESSION_SECRET`). One password
  for every login: `SEED_PASSWORD`, else `demo1234`; under `NODE_ENV=production` it refuses (exit 1) unless
  `ALLOW_SEED=1` and a 10+ character `SEED_PASSWORD` are set; modules get it in the `seedDemo` context
  (`demoPassword`). Logins: `demo@toon.local` (household "Familie"), `robin@toon.local` (finance slot 2),
  `kim@toon.local` (member WITHOUT a slot); the module docs list each module's demo data.
- `bun run icons`: regenerates the PNGs in `apps/web/public/icons/` from `apps/web/public/favicon.svg` with
  `sharp` (`rsvg-convert` is the fallback). Committed; CI never runs it; only when the mark changes.
- `bun run plan:run [householdId]`: the fixed-cost catch-up by hand (the API runs it at boot and every 6 hours);
  without an argument every household with finance enabled; a disabled or incomplete plan is reported.
- `bun run finance:import-xlsx -- <Haushalt.xlsx> [--household <id>] [--dry-run] [--excel-text-quirk]`:
  toon-finance's one-off workbook import (`docs/modules/finance.md`).
- `bun run uploads:gc [-- --dry-run] [-- --min-age-hours=N]`: deletes files in `UPLOAD_DIR` no row references
  (core avatars and household images plus every module's `uploadReferences`; `*.thumb.webp` follow their
  original); files younger than 24 h are always kept.
- `bun run auth:reset-password <email> [--send]`: prints a password-reset link (works without mail).
- `bun run migrate:legacy -- [--recipe-db <file>] [--recipe-uploads <dir>] [--finance-db <file>] [--mapping
  <json>] [--apply] [--report <file>]`: the one-off legacy import (guide: `docs/migration.md`). Target:
  `DATABASE_URL` (a local `file:` URL, process environment or the root `.env`) and `UPLOAD_DIR`; relative paths
  resolve against the repo root. Without `--apply` nothing is written, not even the target file (the dry run
  runs on a scratch copy); `--apply` repeats the dry pass and writes only if it is clean; a second `--apply` ends
  with `[migrate:legacy] already migrated: nothing written.` Exit 0 success, 1 errors found, 2 usage or input.
  Fixture run: `D=$(mktemp -d); NODE_ENV=development DATABASE_URL=file:$D/target.db UPLOAD_DIR=$D/uploads bun
  run migrate:legacy -- --recipe-db apps/api/test/fixtures/legacy/recipe.db --recipe-uploads
  apps/api/test/fixtures/legacy/uploads --finance-db apps/api/test/fixtures/legacy/finance.db` (add `--apply`
  twice). `bun run` prefixes each line with `@toon/api migrate:legacy: `; the `--report` JSON has none.
- **The local stack test** (the whole image, compose file, Caddyfile and redirects on this machine; guide:
  `docs/deployment.md` "Local stack test"; never in `/opt/toon-household`), compose project
  `toon-household-local`: `docker build -t toon-household:local . > build.log 2>&1; echo "exit=$?" >> build.log`
  (read `exit=0`; `--build-arg WITH_OCR=1 --build-arg WITH_PDF=0` for the published variant), then
  `docker compose --env-file .env.local-stack up -d` (ports 80 and 443 free), wait for the app container to be
  `healthy`, `curl --resolve haushalt.test:80:127.0.0.1 http://haushalt.test/toon-root-ca.crt -o root.crt`, then
  `curl --cacert root.crt --resolve haushalt.test:443:127.0.0.1 https://haushalt.test/api/health`; the old
  hostnames are `rezepte.test` and `finanzen.test` (`--resolve` for curl, `--host-resolver-rules` for Chromium,
  plus `--ignore-certificate-errors` for a service worker to register). Tear down with
  `docker compose -p toon-household-local --env-file .env.local-stack down -v`.
- **`caddy validate`** only through compose, so the stack's `.env` is interpolated as `up` does: `docker compose
  --env-file <env> run --rm --no-deps --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile --adapter
  caddyfile` (no `caddy` binary on the host; never a raw `docker run -e RECIPE_HOSTNAME=`, see the gotcha).
- **Scripts inside the running container:** `docker compose exec app bun apps/api/scripts/<script>.ts`
  (`seed.ts` refuses production without `-e ALLOW_SEED=1 -e SEED_PASSWORD=<10+ chars>`, `reset-password.ts
  <email>`, `uploads-gc.ts`, `plan-run.ts`; `migrate-legacy.ts` via `docker run --entrypoint bun` as in the
  cutover guide).

Environment switches of the recipe module (`apps/api/src/env.ts`): `IMPORT_OCR_ENABLED`, `IMPORT_PDF_ENABLED`,
`IMPORT_ALLOW_PRIVATE_HOSTS=1` (dev only), `UPLOAD_DIR`; all default off (`docs/modules/recipe.md`).

## Conventions

The conventions are toon-recipe's `CLAUDE.md` "Conventions" plus toon-finance's "Konventionen" (money is integer
cents everywhere; no float touches a user amount), with these household-wide rules:

- Tables prefixed per module (`recipe_`, `finance_`), core tables not. API paths under
  `/api/households/:householdId/<module>/` (user-scoped: `/api/<module>/`). Query keys
  `["toon","household",id,"<module>",…]`; user data `["toon","<module>",…]`.
- German UI strings byte-identical to the sources; new German only for new screens, listed in `NEW_GERMAN` in
  `scripts/i18n-check.ts`. Content language never goes through `t()`.
- toon-recipe's web namespace `ui.*` is core `common.*` here (a pure KEY rename, values unchanged, so
  `ui.common.dash` is `common.common.dash`; `UiCatalog` is `CommonCatalog`). Every port of a recipe screen
  applies `"ui.` → `"common.`. Module namespaces are `recipe.*`, `finance.*`.
- Renames from toon-recipe (apply them to every port): `group` → `household`, `groupId` → `householdId`,
  `activeGroupId` → `activeHouseholdId`, `requireGroupRole` → `requireHouseholdRole`, `createOwnedGroup` →
  `createOwnedHousehold`, `useActiveGroup` → `useActiveHousehold`, `RequireActiveGroup` →
  `RequireActiveHousehold`, `/api/groups` → `/api/households`, web catalog keys `groups.*` → `household.*`
  (group management only), `auth.register.groupName.*` → `auth.register.householdName.*`,
  `auth.settings.groups.*` → `auth.settings.households.*`. The German VALUES keep "Gruppe" and
  `DEFAULT_HOUSEHOLD_NAME` stays "Meine Rezepte" (D10; a rename to "Haushalt" is an owner decision and needs an
  ADR). Server keys `server.group.*` and `{groupName}` placeholders keep their names.
- Renames from toon-finance (apply them to every port): `household_members` → `finance_participants` (by user
  id; `HouseholdContext` is `FinanceParticipantContext`, imported as `requireFinanceParticipantContext as
  requireHouseholdContext` so route bodies stay F's), `members.service` → `participants.service`,
  `useHousehold` / `useOtherMember` → `useFinanceHousehold` / `useOtherParticipant`, F's unprefixed catalog keys
  (`transactions.list.title`) → `finance.…`, F's URLs `/transactions`, `/new`, `/plan`, `/categories` →
  `/finance/…` (F's `/` is `/finance`, F's `/household` is the core's Gruppen plus the participants section on
  `/settings`), typed router hooks (`Link`, `useNavigate`, `useParams`, `useBlocker`) → `@/lib/nav`. Finance's
  TS identifiers carry a `finance` prefix and ported files import them aliased (`docs/modules/finance.md`).
- Core helpers a recipe port needs are core, not module code: `@/lib/nav` (`AppLink`, `useAppNavigate`,
  `useRouteParam(s)`, `useNavigationGuard`), `@/lib/permissions` (`hasAtLeast`), `@/lib/share` (`shareOrCopy`,
  `copyToClipboard`); `canModifyOwn` stays with the recipe module.
- Module boundary: the core imports a module only through `apps/api/src/modules/index.ts` /
  `apps/web/src/modules/index.ts` (and, on the web, its catalogs through `apps/web/src/modules/catalogs.ts`); a
  module never imports another module's directory.
- Docs in English; a living doc names every repo file repo-relative from the root (`apps/api/test/docs-paths.test.ts`
  checks them). Commit messages end with the harness's `Co-Authored-By` line; no pushes from agent sessions.
- Tests: `apps/api/test/` (never `apps/api/tests/`), web co-located, `packages/shared/test/`. Ported tests that
  need unported code are removed with a placeholder comment naming the returning milestone, never skipped
  silently.

## Gotchas in use

Binding gotchas of the sources stay binding inside their module (SPEC D13). These are the core and cross-cutting
ones; the module gotchas are indexed below and live in the module docs.

### Database and API

- **D7 pragmas.** `apps/api/src/db/client.ts` sends WAL + `synchronous = FULL` (finance's ledger choice, not
  recipe's `NORMAL`), `foreign_keys = ON` and the busy timeout on every connection to a local `file:` DB, never
  to `libsql://` or `:memory:`; the busy timeout also goes to `createClient` as `timeout`, because libSQL's pool
  runs the pragmas on its first connection only (ADR 0009). `apps/api/test/db-pragmas.test.ts` pins it,
  including a second pooled connection. Do not "optimise" it back.
- **Migrations are generated.** `apps/api/drizzle/0000_core.sql` comes from `bun run db:generate`, never by
  hand; DDL is verified through `@libsql/client` (`bun:sqlite` is a newer SQLite). `db:migrate` needs only
  `DATABASE_URL`: it supplies a placeholder `SESSION_SECRET` (never overriding a real one) and imports the db
  modules dynamically so `apps/api/src/env.ts` validates after that.
- **Middleware chain order is load-bearing.** `mountModules` (`apps/api/src/modules/mount.ts`) applies
  `requireSession()` → `requireHouseholdRole("member")` → `requireModule(id)`: no cookie is 401 first, a
  non-member is 403 before the module row is read (a foreign household's enabled modules never leak), a disabled
  module is `404 module_disabled`. `apps/api/test/middleware.test.ts` pins the order. A module's
  `householdRouter` therefore has no `requireSession()` / `requireHouseholdRole("member")` of its own; it adds
  `requireVerifiedEmail()` itself and `requireHouseholdRole("admin")` per route where needed. A `userRouter`
  (`/api/recipe/cards`) runs `requireSession()` itself and is NOT behind `requireModule`. Mount order in
  `apps/api/src/index.ts` (pinned by tests; `docs/API.md` "Middleware chain and mount order"): security headers,
  `cors()`, the origin guard on `/api/*`, health, `/uploads`, `mountModules`, `/api/auth`, `/api/households`,
  static web LAST; module routers stay before `/api/households`, and inside `householdRoutes` the invite-token
  routes (`/invites/:token`, `/invites/accept`) come before `/:householdId`.
- **A `household_modules` row is the enabled state.** Every household-creation path (register, OAuth sign-up,
  `POST /api/households`, seed) goes through `initializeHousehold(db, id)`, which writes the
  `DEFAULT_ENABLED_MODULES` rows (even for a module the build lacks; the UI filters by `WEB_MODULES`) and then
  runs each build module's `onHouseholdCreated`. `enableModule` runs the module's `onEnable` BEFORE the upsert, so
  a refusal writes nothing even where `withTransaction` degrades (an explicit `TEST_DATABASE_URL=file::memory:`).
  `disableModule` deletes the row (settings lost, module data kept). The legacy migration (ADR 0005) is the one
  writer that bypasses this path. `API_MODULES` is read inside functions only: `initializeHousehold` imports
  `apps/api/src/modules/index.ts` from a core service, so a top-level read becomes an import cycle.
- **`HouseholdWithRole` has `modules: string[]`, no counts (ADR 0001).** It travels in `/api/auth/me` (the one
  persisted core query, `["toon","me"]`) and drives the shell: `moduleGuard(enabledIds, id)`
  (`apps/web/src/modules/enabled.ts`, pure) decides `RequireModule`, which `moduleLayoutComponent(id)` wraps
  around every module layout's `<Outlet/>`. The query client's `onError` invalidates `["toon","me"]` on
  `404 module_disabled`, so a stale bundle and a live disable take one path. Core query-key segments (`me`,
  `sessions`, `oauth-providers`, `households`, `invite`, `detail`, `members`, `invites`) never equal a module id.
- **Uploads are signed, not cookie-checked.** `/uploads/:filename` answers 404 for an unsigned, forged or expired
  URL (`apps/api/src/lib/uploadUrls.ts`); `<name>.thumb.webp` is built with `sharp` on first request and falls
  back to the original (short cache) when sharp cannot convert.
- **Cross-household guard (D8).** The household comes from `:householdId` only. Every by-id lookup in a module
  service filters by `membership.householdId` and answers `404 not_found` for another household's id;
  `apps/api/test/recipe-cross-household.test.ts` and `apps/api/test/finance-cross-household.test.ts` address
  every by-id route with another household's id (cards: another user's card). A new by-id route gets its case
  in the same commit.
- **API import cycle: read the registry inside functions, declare handlers as functions.**
  `apps/api/src/middleware/session.ts` → `apps/api/src/core/services/auth/users.ts` →
  `apps/api/src/core/services/households/modules.ts` → `apps/api/src/modules/index.ts` → recipe manifest →
  `apps/api/src/modules/recipe/routes/cards.ts` calls `requireSession()` at module scope while `session.ts` is
  still evaluating. `requireHandler` / `optionalHandler` are therefore hoisted function declarations (as `const`
  arrows the real server died with "Cannot access 'requireHandler' before initialization" while every in-process
  test passed); so is finance's `requireFinanceParticipant`. `apps/api/test/import-order.test.ts` imports each
  real entry point first, in a fresh process. A new module-scope call into a core middleware or service needs
  the same care, and `API_MODULES` is never read at module top level.
- **Placeholders and claim invites (ADR 0006, plan m3b decisions 1-6).** A placeholder is a core user row with
  `email IS NULL AND password_hash IS NULL`: `isPlaceholderUser` (`apps/api/src/core/services/auth/users.ts`) is
  the one predicate (an OAuth-only account also has a NULL hash). It has no OAuth link, session or avatar and
  cannot sign in; `toUserDto` answers 401 for one, and every reader of `users.email` narrows it
  (`requireAccountEmail`). `claimPlaceholderUser` is ONE conditional `UPDATE … WHERE id = ? AND password_hash IS
  NULL AND email IS NULL RETURNING id` (F gotcha 72: never check-then-write; zero rows is `409
  member_has_account`, a unique violation `409 email_taken`; `apps/api/test/placeholders.test.ts` races two
  claims). A claim invite is redeemed ONLY by `POST /api/auth/register { inviteToken }` (same user id, so every
  payer, income person, membership and seat stays valid); `POST /api/households/invites/accept` answers `409
  invite_claim_requires_register` unless the caller IS the claimed user. Creating one is admin+ and revokes the
  older pending one; a spent claim token is `404 invite_invalid` (F gotcha 55). The claimed account is
  unconfirmed (read-only until confirmed). Placeholders never hold finance slot 1; deleting a household deletes
  its placeholder users. `removeMember` runs every build module's `onMemberRemoving` veto first (finance's:
  "A seated participant cannot leave while the ledger has rows." in `docs/modules/finance.md`).
- **The origin guard trusts `WEB_ORIGIN` (plan m3b decision 15, F gotcha 66).**
  `apps/api/src/middleware/originGuard.ts` runs on `/api/*` for unsafe methods before the routers: an `Origin`
  listed in `WEB_ORIGIN` (`env.webOrigins`) passes (the dev setup calls the API from `:5173`, the same SITE,
  which F's rule would refuse); otherwise `Sec-Fetch-Site: cross-site|same-site`, `Origin: null` and an `Origin`
  host other than the request host answer `403` with `server.error.originMismatch`; no `Origin` (curl, tests)
  passes; only the host is compared (TLS ends at the Caddy). It sits after `cors()` and before `mountModules`,
  and `readJson` in `apps/api/src/core/routes/auth.ts` wants `Content-Type: application/json`. A second origin
  that legitimately calls the API must be listed in `WEB_ORIGIN`, comma-separated.
- **The CSP and the baked API URL (plan m3b decision 16, F gotchas 67 and 50, ADR 0007).**
  `apps/api/src/middleware/securityHeaders.ts` hashes every inline `<script>` of the built `index.html` at boot
  and sends `script-src 'self' 'wasm-unsafe-eval' <hashes>` (zxing-wasm), `style-src 'self'`, `img-src 'self'
  data: blob: https:`, `media-src 'self' blob:`, `connect-src 'self'`, `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `nosniff`; no HSTS (the Caddy's, D11), no `Permissions-Policy` (it would block the
  camera). **`connect-src 'self'` presumes a build with `PUBLIC_API_URL=""`:** an absolute value is baked into
  the bundle and, served from any other origin, blocks every API call and `/uploads` image, which a run at
  `localhost:3001` hides. Build the served app with the variable EMPTY (`.env.example` keeps the absolute value
  for `bun run dev`); unset in a production build is relative too (`apps/web/src/lib/api.ts`). Only a browser
  sees a CSP break: check a served build at a second origin (`127.0.0.1:3001`) with the console open.
- **Core hardening from `1715207` (F gotchas 18 and 74).** `clientIp` reads the LAST `X-Forwarded-For` entry
  (what the trusted proxy appends; keep `header_up X-Forwarded-For {remote_host}` in the Caddyfile), e-mail
  invites are rate limited per user (10/h; a claim invite without an address is not) and `POST /api/households`
  too (5/h, so a headless script that creates households must restart the API between passes), a production
  API refuses the `change-me…` `SESSION_SECRET`, `apps/api/src/db/client.ts` creates the data directory `0o700`,
  passwords are capped at 200 characters before argon2, display and household names refuse control characters,
  and a 401 in the web app purges the persisted cache like a logout.
- **Claim links are credentials (plan m3b decision 14).** Whoever holds a claim link becomes that person. The
  migration's `--apply` report and stdout carry live links (`<first WEB_ORIGIN>/invite/<token>`; never a dry run)
  and must stay outside any repository (`docs/migration.md`); the claim-link dialogs show the link to an admin
  and copy it (`shareOrCopy` / `copyToClipboard`); a record of a real run names counts only.
- **Core copy stays module-neutral (plan m3b decision 8).** The core Gruppe screens and the auth pages say
  "Gruppe" and never "Buchungen", "Platz" or "Haushalt": F's module-neutral strings are in the core catalogs
  byte-identical, F's finance-flavoured ones live only in `finance.settings.household.*`. Five core web strings
  are NEW German (`auth.register.claimHint`, `auth.invite.claimSubtitle`, `household.placeholder.removeConfirm`,
  `household.claim.hint`, `household.claim.linkHint`), listed in `NEW_GERMAN` with the server keys
  `server.household.placeholderRole` and `server.finance.placeholderSlotOne`. A person's name is content and
  never goes through `t()`.

### Web shell

- **`MessageKey` must stay a literal union (D10).** `apps/web/src/modules/catalogs.ts` objects
  (`MODULE_CATALOGS_DE/EN`) are literal-typed with no annotation, ever: an index-signature type turns `MessageKey`
  into `string` and every `t()` typo compiles. A literal-union test and a `@ts-expect-error` in
  `apps/web/src/lib/i18n/i18n.test.ts` guard it. Catalogs reach the registry through `catalogs.ts`, never through
  `apps/web/src/modules/index.ts` (which imports screens that import i18n: a cycle).
- **No module-level constants over `WEB_MODULES`** in files a manifest imports; nav items are computed by
  functions at render time (`apps/web/src/components/layout/nav-items.ts`,
  `apps/web/src/components/layout/use-nav-items.ts`).
- **Persist policy comes from the manifests (D9).** `buildPersistPolicy(WEB_MODULES)` feeds
  `createShouldPersistQuery` / `createShouldPersistMutation` (`apps/web/src/lib/persist.ts`); a module that
  declares `persistMutationNamespaces` must also register `mutationDefaults` for each namespace (a restored
  mutation carries its variables, not its function). `PERSIST_BUSTER = "household-v1"`. The persisted cache is
  keyed per user id and purged on account switch (toon-recipe's data-leak guard, unchanged).
- **Service worker.** `apps/web/vite.config.ts` rules, first match wins, so every `NetworkOnly` rule precedes the
  one `NetworkFirst` rule: `/api/auth/`, the recipe `imports`, `shopping-lists`, `plan` and `/api/recipe/cards`,
  and finance's `/api/households/<id>/finance/…` (toon-finance gotcha 11: the offline ledger IS the persisted
  TanStack cache; a `NetworkFirst` hit would overwrite an optimistic row) are `NetworkOnly`; then
  `recipes|tags|collections` (`NetworkFirst`, cache `toon-api-recipes`) and `/uploads/` (`CacheFirst`), ADR 0011.
  `/api` and `/uploads` stay out of the navigation fallback; `skipWaiting` is off. The dev server has no service
  worker: check offline behaviour on the built app (`bun run build`, then `WEB_DIST_DIR=./apps/web/dist bun run
  start`).
- **The route tree is strict, with one hole.** `WEB_MODULES = [recipeModule, financeModule] as const satisfies
  readonly WebModule[]` and neither manifest carries a type annotation (`satisfies WebModule<"…">` only), so
  `router.tsx`'s `WEB_MODULES.map((m) => m.route)` keeps the concrete route types and a raw
  `<Link to="/recipe/nope">` fails `tsc`. The hole: module screens navigate through `AppLink` / `useAppNavigate`
  (`apps/web/src/lib/nav.tsx`, `to: string`) and template-string helpers, which `tsc` does NOT check; an
  unprefixed target (`/plan` instead of `/recipe/plan`) compiles and lands on `NotFoundPage`. The LINKS greps are
  the check, not `tsc`: recipe's in `docs/modules/recipe.md` section 5, `LINKS_FIN` with `NOROUTER`, `NOCORE`
  and `NOSHADOW` in `docs/modules/finance.md` section 5.1. Run them after every web port; a headless pass that
  clicks the links is the second check.
- **A module owns its layout route and its static import graph stays shell-free (SPEC §2).** `WebModule.route`
  is built in `modules/<id>/routes.tsx` with `getParentRoute: () => householdScopedRoute` from
  `apps/web/src/route-roots.tsx`, which imports neither `@/modules` nor the shell; `AppLayout` is attached in
  `apps/web/src/router.tsx` via `appRoute.update({ component })`. Nothing the manifest imports statically
  (`index.ts`, `routes.tsx`, `HomeCard.tsx`, catalogs, `offline.ts`, the `settingsSections` and `enableDialog`
  components) may import `@/modules`, `@/components/layout` or `use-nav-items`: the registry would re-enter a
  manifest that is still evaluating (TDZ `ReferenceError` when a test imports the manifest first). Screens are
  `lazyRouteComponent`s, which keeps them out of that graph. `apps/web/src/modules/recipe/manifest.test.ts`,
  `apps/web/src/modules/finance/manifest.test.ts` and the two `persist.test.ts` import `./index` first.
- **The offline queue survives a second reload (M3-T12 fix).** TanStack's `onlineManager` starts "online" and
  only changes on a browser event, so an app reloaded while offline believed it was online: the restored paused
  write re-ran, failed and waited in an unpaused retry, which the persist policy (paused mutations only) dropped,
  and a second reload lost the booking. `apps/web/src/lib/query-client.ts` `seedOnlineManager()` seeds the
  manager from `navigator.onLine` once at boot. The shell has no sync badge; a module shows its own note
  (finance's `PendingSyncNote`).
- **`ActionMenu` has `renderTrigger` and `item.current`.** `renderTrigger(props)`
  (`apps/web/src/components/ui/ActionMenu.tsx`) replaces the icon button with the caller's element (spread
  `props`; the phone module chip is one); a `current` item is the brand-soft row with `aria-current="true"` and a
  check. Both are optional.
- **Every shell screen renders `PhoneHeaderRow` itself** (no global top bar, ADR 0010): the recipe screens
  (guard `apps/web/src/modules/recipe/phone-header.test.ts`, reading `routes.tsx` for the screen list; the detail
  is exempt: its hero owns the top edge), finance's (`apps/web/src/modules/finance/phone-header.test.ts` and its
  `PageHeader`), and the core's Home, Settings, Gruppen and Gruppe detail
  (`apps/web/src/core/features/phone-header.test.ts`). It is a `<header data-app-shell>`: `print.css` hides it.
- **The design-system test is the Table D gate (M4-T08).** `apps/web/src/styles/design-system.test.ts` makes the
  design greps permanent: the four `apps/web/src/styles/theme.css` blocks define the same 39 tokens, no
  `fonts.googleapis`, arbitrary `text-[…]` sizes only where the pinned record says (the 34 inherited toon-recipe
  hits in 17 files; a cleanup edits the record in the same commit), `bottom-0` only on the tab bar and the recipe
  hero overlay, no `font-display` beside `font-semibold`, no bare `1fr` track in an arbitrary grid template, text
  arrows only on the four pinned catalog lines, `data-app-shell` only on header/nav/aside. A new violation fails
  `bun test` with file:line and the rule; never relax a rule to get green. Table D is in plan
  `docs/plans/m4-design-pass.md` §2.
- **Hand-written utilities beat breakpoint variants.** `.px-gutter`, `.bleed-gutter`, `.bleed-gutter-inset`,
  `.pb-tabbar`, `.bottom-tabbar` in `apps/web/src/styles/index.css` are emitted after everything Tailwind
  generates, so `lg:mx-0` / `lg:px-8` cannot override them (a media query adds no specificity); change the
  `--gutter` variable (`lg:[--gutter:2rem]` on `<main>`) instead. `-mx-gutter` does NOT exist: use
  `bleed-gutter` or `bleed-gutter-inset`. `top-topbar` is dead (a sticky header uses `top-0`, the status-bar
  inset is `<main>`'s). `.bottom-tabbar` adds 1px for the tab bar's own top border.
- **Theme colour has one source.** `apps/web/src/lib/theme-colors.ts` `THEME_COLORS = { light: "#faf5ee", dark:
  "#17120f" }` (the light and dark `--bg`); `apps/web/index.html`'s inline pre-paint script keeps the literals
  (it cannot import), `apps/web/src/lib/theme.ts` and the manifest import the module;
  `apps/web/src/lib/theme-colors.test.ts` enforces agreement with `theme.css`. Tokens, `body` background and
  `<meta name="theme-color">` follow the resolved scheme in all four combinations (OS light/dark x no
  preference/the opposite explicit `toon.theme`). Built CSS is minified (`#291f180d`): compare colours as RGBA.
- **The manifest.** `apps/web/pwa-manifest.ts` (a plain `as const` object plus a mutable-typed copy for the
  plugin) holds name/short_name "Haushalt", the German `description`, the four icons and the three shortcuts
  (`/recipe/import`, `/recipe/recipes/new`, `/finance/new`); a shortcut into a module the household has not
  enabled lands on Home with the module-disabled toast. `.webmanifest` is served as `application/manifest+json`
  (`apps/web/src/pwa-manifest.test.ts` reads the manifest).

### Testing and tooling

- **Headless runs.** Install Playwright in a scratch directory outside the repo (a `bun add` log ending in
  `exit=$?`), log in with `fetch("/api/auth/login")` from the page, assert `scrollWidth <= clientWidth`, and never
  match the tab bar by its `aria-label` (`SideNav` carries the same one): the tab bar is `nav.fixed`, the sidebar
  `aside[data-app-shell]`. Login is rate limited per address in memory (`429` after a few runs): reuse a saved
  `storageState` per user across contexts and runs, or restart the API. `position: fixed` elements have
  `offsetParent === null`; test visibility with `getBoundingClientRect` and computed `display`. A module disabled
  through the API behind the SPA's back is noticed on the first `404 module_disabled`: re-enable through the Home
  "Aktivieren" button. `["toon","me"]` is persisted, so a household created through the API after the SPA visited
  `/` is unknown to it: create it from a non-SPA page (`goto("/api/health")`, then `fetch`). The active household
  is `localStorage` `toon.activeHouseholdId`, then the profile's `activeHouseholdId` (switch: PATCH
  `/api/auth/me` and set the key on a non-SPA page; accepting an invite also moves it). Phone screenshots use
  `isMobile: true, hasTouch: true` at 390x844. Never `pkill -f` a pattern that also matches the shell running it;
  kill the server's pid.
- **`scrollbar-gutter: stable`** on `<html>` (toon-recipe's) makes `scrollWidth` 375/1425 against `clientWidth`
  390/1440 under classic scrollbars (a desktop-Chromium context; a mobile context with overlay scrollbars
  measures 390/390); check no-overflow as `scrollWidth <= clientWidth` plus no element's right edge beyond
  `innerWidth` + 0.5, and when the two numbers differ show once that `documentElement.style.scrollbarGutter =
  "auto"` makes them equal. A bar that bleeds to the viewport edge ends at 375 beside the gutter, 390 without.
- **i18n-check from worktrees** resolves the source repos via the git common dir; it needs `toon-recipe` and
  `toon-finance` next to the main checkout (or `I18N_CHECK_SOURCES`).
- **Long commands** (cold `bun install`, docker build, headless browser) go to the background with one log
  ending in `exit=$?`. A `docker build` is judged by `$?` written to its log, never through a pipe (`docker build
  ... | tail` reports tail's status); the repo-root `build.log` is ignored by `*.log` and removed after the check.

### Legacy migration (`migrate:legacy`, `docs/migration.md`)

- **`migrate:legacy` reads snapshots and writes only through a redirected, validated path (plan m5 decisions 3,
  5, 6, 16).** `apps/api/scripts/legacy/sources.ts` copies each legacy file and its `-wal` (never `-shm`) into a
  scratch directory and opens the copy with a plain `createClient` (not `createDatabase`: its WAL pragma rewrites
  a header) plus `PRAGMA query_only = 1`; a copy of the main file alone loses every page still in the WAL, so the
  operator copies the whole volume. A schema gate (exit 2) wants recipe at 9 migrations / `0008_shopping_bought`
  and finance at 3 / `0002_placeholder_members`. Dry run = the full pipeline against a scratch copy of the
  target; `--apply` = that pass, then the real write only if it is clean, then a balance re-check. Every row and
  its `legacy_ids` entry go in the same `client.batch(…, "write")` (chunks of 500); a mapped row is never updated
  again (a one-shot cutover that resumes, not a sync).
- **The CLI never imports `src/env.ts`, and its import order is load-bearing.** `apps/api/src/env.ts` freezes
  `env.databaseUrl` on first load and `apps/api/src/db/client.ts` opens that database on import, so importing
  either before the redirect would create and switch to WAL the REAL target during a dry run.
  `apps/api/scripts/migrate-legacy.ts` imports only `node:` builtins and types statically, resolves
  `DATABASE_URL` and `UPLOAD_DIR` itself (`resolveCliEnv`: process environment, then the root `.env` and
  `.env.local` with env.ts's rules, kept in step by hand), points `process.env.DATABASE_URL` at the scratch copy
  BEFORE its first dynamic import, then imports `src/db/client.ts`, then `src/db/migrate.ts`, and only then
  `./legacy/*`. A relative `file:` target resolves against the repo root computed in the CLI file. The library
  takes the target `db` and `client` as parameters and never uses the shared `db`.
  `apps/api/test/legacy-cli.test.ts` guards the order textually and by subprocess (no target file and no `-wal`
  after a dry run).
- **Subprocess tests of the CLI set `NODE_ENV=development`.** The child inherits `NODE_ENV=test`, under which
  `apps/api/src/env.ts` picks its own temp test DB and `resolveCliEnv` reads no `.env`; they also pass an
  absolute `DATABASE_URL`, an explicit `UPLOAD_DIR` and a placeholder `SESSION_SECRET`. Migration tests use their
  own temp-file targets and temp upload directories, never the shared test `db` and never `env.uploadDir`.
- **Claimed ids and the verified-only e-mail match (users, households).** `migrateUsers` decides every recipe
  user first, then the finance-only ones, with an in-run `Set` of claimed target ids next to the DB lookup (the
  fixture's gina has toon-finance's id equal to cleo's toon-recipe id, both in one batch: a DB lookup alone would
  fail the primary key and "fix" the wrong row). A claimed id gets `crypto.randomUUID()` and a warning (household
  ids too), random per pass, so a dry run and the `--apply` after it print different ones. A legacy user whose
  e-mail matches a target account is mapped onto it ONLY when that account has `email_verified_at`, else exit 1
  ("unverified target account <email> blocks the merge"), on a resumed run too. An OAuth-only recipe account
  keeps no password when a finance row has its e-mail (finance never verified addresses: account takeover).
  Finance-only users start unconfirmed.
- **Ledger states the runtime refuses are written by the migration alone (ADR 0005).** A one-participant finance
  household gets its `finance` module row, a lone slot-2 participant is re-seated in slot 1, a plan payer who is
  not a participant is re-pointed to slot 1 and an income naming a non-participant is kept, each a warning; the
  migration writes `household_modules` and `finance_participants` directly and never calls
  `initializeHousehold`, `onHouseholdCreated` or `onEnable` (they would seed default categories next to the
  copied ones). The balance invariant is identity-based: computed from the perspective of the legacy user who
  holds slot 1 in the TARGET and compared with `getBalance` on the migrated rows (balance, count, amount sum).
- **The legacy fixtures are built, checked and tracked on purpose.** `apps/api/test/fixtures/legacy/build.ts`
  rebuilds `recipe.db`, `finance.db` and `uploads/` deterministically from verbatim copies of the two sources'
  migration SQL and `apps/api/test/fixtures/legacy/facts.ts` (argon2id hashes precomputed; Bun's hash is
  salted); `build.ts --check` and `apps/api/test/legacy-fixtures.test.ts` compare a logical dump with the
  committed files. The repo ignores `*.db`; `.gitignore` un-ignores exactly `apps/api/test/fixtures/legacy/*.db`
  (rollback journal, so no `-wal` is ever produced). Never edit the migration copies or the databases by hand;
  change `facts.ts` or `build.ts` and rebuild.
- **Migration evidence stays out of the tree.** `migration-in/` and `migration-out/` are in `.gitignore`; real
  copies of the owner's data never get committed, and a record of a real run names counts and OK/FAIL only.
- **The claim test cleans the shared DB (plan m3b decision 18).** `apps/api/test/legacy-placeholders.test.ts`
  runs a real `apply` of a FINANCE-ONLY input into the shared test DB (it must: `app.request` sees only that DB)
  and registers with the migrated claim token. To keep later files order-independent it asserts first that no
  fixture e-mail exists, records the counts of `users`, `households`, `household_invites` and `legacy_ids`, and
  in `afterAll` deletes every household and user the run wrote (households first so the cascade takes the
  finance rows) and asserts the counts are back. The merge path is proven on the legacy harness's temp DBs.

### Deploy (`docs/deployment.md`)

- **The Dockerfile refuses a bundle with the dev API URL (M6).** The web-build stage sets `PUBLIC_API_URL=""`
  (set and empty) and its `RUN` ends in `! grep -rqF 'localhost:3001' apps/web/dist`, so an image whose bundle
  carries the dev fallback of `apps/web/src/lib/api.ts` cannot be built (the CSP's `connect-src 'self'`,
  toon-finance gotcha 50). Bun 1.4's isolated linker needs THREE `node_modules` copies in the runtime stage
  (`/app/node_modules`, `/app/apps/api/node_modules`, `/app/packages/shared/node_modules`; `apps/web` is
  absent on purpose): copying only the root builds, starts and dies with "Cannot find module
  '@libsql/client'". The runtime user is `bun` (uid 1000) with no capability (`cap_drop: [ALL]`,
  `no-new-privileges`); a volume PRE-FILLED by a root container (the migration's copy-in) keeps root
  ownership, which is why `docs/migration.md` step 6 ends in `chown -R 1000:1000 /data`.
- **Caddy treats an empty `{$VAR}` as set (M6, plan m6 decision 7).** `{$VAR:default}` falls back only when the
  variable is UNSET; a set-but-empty `RECIPE_HOSTNAME` leaves a site block without an address and `caddy adapt`
  fails with "server block without any key is global configuration, and if used, it must be first". The
  `docker/Caddyfile` defaults `http://old-recipe-hostname.unset.invalid` and
  `http://old-finance-hostname.unset.invalid` cover the unset case only; set-but-empty is covered by compose's
  `${RECIPE_HOSTNAME:-http://…unset.invalid}` defaults. Prove the empty case through compose (`docker compose
  --env-file <empty> config`, then `run … caddy validate`); a raw `docker run -e RECIPE_HOSTNAME=` failing is
  expected, never a reason to change the Caddyfile. One global `cert_issuer {$TOON_TLS_ISSUER:acme}` serves every
  site, so the old-hostname sites need no `tls` block (one on the `.invalid` placeholder is a config error).
- **The old-hostname blocks use `handle`, never a bare `redir` (ADR 0008).** Caddy sorts `redir` before
  `handle`, so a bare `redir` would swallow `/sw.js`; every route of an old-host block is a `handle`, and
  `/sw.js` answers 200 with the retiring worker (`(retire_old_worker)`: deletes the caches, claims, unregisters
  itself, reloads every window onto the 301). A 301 is cached by browsers, so a Table R row must be right before
  go-live (`apps/web/src/legacy-redirects.test.ts` resolves every target against the route tree). The worker
  leaves IndexedDB alone: the cutover guide tells everybody to open both old apps online once first.
  `apps/api/test/deploy-caddyfile.test.ts` pins the verbatim `(hardening)` and `(fwd)` snippets by digest: the
  `header_up X-Forwarded-For {remote_host}` overwrite makes the API's LAST-hop read safe, and a
  `trusted_proxies` line would re-open the rate-limit bypass.
- **A single-file bind mount pins the old inode (M6).** `docker-compose.yml` mounts `./docker/Caddyfile` as one
  file; replacing it (`curl -o`, `mv`) leaves the running Caddy on the old config, and `deploy` never recreates
  caddy. `toon-household-deploy sync-config` downloads the compose file AND the Caddyfile, validates both
  (`config -q`, `caddy validate` through compose), restores the `*.bak` copies on any failure and restarts the
  caddy container when the Caddyfile changed. `docker/toon-deploy.sh` is the forced command of ONE ssh key
  (`toon-household-deploy`; verbs `deploy [latest|sha256:<64 hex>]`, `sync-config`, `status`; `set -f`),
  distinct from the old `toon-deploy` and `toon-finance-deploy` keys.
- **A freshly published GHCR package is private (M6).** `.github/workflows/release.yml` pushes on `main` and `v*`
  tags (typecheck and test first, `provenance: false`, SHA-pinned actions, `WITH_OCR=1 WITH_PDF=0`); the package
  stays private until the owner makes it public or the server runs `docker login`, and
  `.github/workflows/deploy.yml` runs only when the repository VARIABLE `DEPLOY_ENABLED` is `true` (a job-level
  `if` cannot read secrets). Both are verified by their YAML tests only until the first push to `main`.
- **The local stack is the compose project `toon-household-local`, never the production name (M6, plan m6
  decision 5).** The compose file says `name: toon-household`, so without a project name of its own a local `up`
  would use `toon-household_toon-data` and a local `down -v` would delete the production data volume.
  `.env.local-stack` sets `COMPOSE_PROJECT_NAME=toon-household-local` (it beats the file's `name:`; `-p` beats
  both), every local command in `docs/deployment.md` also spells `-p toon-household-local`
  (`apps/api/test/deployment-doc.test.ts` pins every `down -v`), and the production `.env` never sets it. Only
  the cutover REHEARSAL uses `-p toon-household`, on a machine shown to have no `toon-household_*` volume; a
  volume made by `docker volume create` has no compose label, so `down -v` leaves it (remove it by name; compose
  only WARNS it "was not created by Docker Compose"). Check with
  `docker volume ls -q | grep -E '^toon-household(-local)?_'` (empty when nothing is left).
- **The first boot catches the fixed-cost plan up, so a migrated balance moves (M6).** `ApiModule.start` runs
  `plan:run` once at boot; an enabled plan whose periods since the old finance app last ran are unbooked gets
  `Fixkostenanteil MM/YYYY` rows (origin `fixed_plan`) at that boot. After a cutover the balance equals the
  report's plus those rows; without them it must match (the legacy fixtures: 119486 ct in the report, 222286 ct
  after the boot, two rows of 51400 ct).

### Module gotchas (moved to the module docs)

Each quoted title is a gotcha of its module doc's section 4a, verbatim; read it there before touching the module.

`docs/modules/recipe.md`: "Recipe tables and indexes are prefixed, their TS identifiers are not."; "Fold columns
and the backfill." (`migrate:legacy` relies on the `afterMigrate` backfill); "Import route tests use real
sessions."; "Import query keys are rooted at `"toon"` (decision 14)."; "The library's recipe count is the
module's own query (ADR 0001, decision 13)."; "The shopping list outbox is wired through the manifest.";
"Inherited recipe gotchas stay binding inside `modules/recipe`" (section 4b maps toon-recipe's 83); "Printing a
recipe (verified by printing to PDF, M4-T09)." (re-verify by print-to-PDF at 390 and 1440).

`docs/modules/finance.md`: "A seated participant cannot leave while the ledger has rows." (the finance side of
the core `removeMember` hook `onMemberRemoving`: `409 member_has_ledger`, the seat delete, the slot-1 re-seat,
ADR 0004); "Plan payer and income person must be participants (M4-T01, finding B)."; "Enabling finance needs
two participants (D3)."; "Finance TS identifiers carry a `finance` prefix; ported files import them aliased.";
"Participants and the gate (D3, plan m3 decisions 3-5)."; "The `start` hook and the clock.";
"`settingsSections` are rendered."; "Finance server catalog (ADR 0002)."; "The finance test harness gives
toon-finance's names H semantics (plan m3 decision 18)."; "The finance greps" (`LINKS_FIN`, `NOROUTER`, `NOCORE`,
`NOSHADOW`; run after every finance port); "`FinanceGate` renders `PendingSyncNote` as a Fragment sibling of the
outlet, never inside a wrapper `div`."; "Inherited finance gotchas stay binding inside `modules/finance`"
(section 4b maps F1 to F74); "The Erfassen sheet is module-local and has no FAB (plan m3b decisions 9 and 10, F
gotchas 62, 63, 65)."; "F gotcha numbers are F's numbering at `1715207`."

### Retired gotchas

- **`file::memory:` is per client.** Retired by ADR 0009: `bun test` no longer forces `file::memory:`; under
  `NODE_ENV=test` `apps/api/src/env.ts` gives each process a fresh temp file DB, so every `withTransaction` is a
  real transaction. What remains: a test going through `app.request` must use the shared `db`;
  `createDatabase({ url: "file::memory:" })` is a separate, empty database, and an `EXPLAIN` against the shared
  client goes through `apps/api/test/support/explain.ts`.

## Open work

What is deliberately not done lives in `docs/open-work.md`: owner actions (the real cutover, the first
`release.yml` / `deploy.yml` runs, GHCR visibility, `DEPLOY_ENABLED`, OAuth callbacks, arm64, the old hostnames
and volumes, an iOS install check), owner decisions ("Gruppe" vs "Haushalt", toon-recipe's pinned design
exceptions, finance print styles, a per-household PWA name or icon), items deferred by design (the N-person
ledger, D3; the member-leaves veto beyond finance) and recorded observations. New open items go there, not here.
