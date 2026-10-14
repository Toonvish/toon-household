# CLAUDE.md — toon-household

The household app: `toon-recipe` and `toon-finance` merged into one modular Bun/Hono/React PWA,
with room for more modules. The next session has no memory of this one, so the docs are the spec.

## Read order

1. `docs/SPEC.md` — the fixed decisions (§1), the module contract (§2), the target layout (§3), the
   schema mapping (§4), the shell (§5), the migration (§6), the gates (§7), the milestones (§8).
2. The two source repos' `CLAUDE.md` files, read-only: `/home/erics/software/toon-recipe/CLAUDE.md`
   and `/home/erics/software/toon-finance/CLAUDE.md`. Their locked decisions and gotchas stay
   binding inside the module that inherits them (SPEC D13). The source trees are never modified.
3. `docs/plans/` — one plan per milestone (`m0-scaffold.md` …), written by the workflow; a plan names
   tasks, files and verify commands and, once done, its "what changed vs plan" section.
4. `docs/adr/` — one record per deviation from SPEC §1 (`NNNN-slug.md`: date, context, decision,
   consequences; the ADR edits the SPEC text in the same commit).

## Fixed decisions

SPEC §1 (D1–D15) is fixed and changes only through an ADR. Do not re-litigate a decision in code or
review; if a task forces a deviation, make the smallest one and record it.

## Building it

`.claude/workflows/build-household.js` builds the app milestone by milestone (SPEC §8). Run it from
this directory with `Workflow build-household` and `args: { milestones: ["M0"] }`, one or two
milestones per invocation, and read the result before the next. Opus plans and reviews, Sonnet
implements and verifies, Haiku does verbatim ports and runs the gates. The workflow writes the plan
to `docs/plans/` and commits per task; it never pushes.

## Status

Milestones done: **M0 scaffold** (2026-10-13, plan `docs/plans/m0-scaffold.md`, "what changed vs
plan" in its section 6), **M1 core** (2026-10-14, plan `docs/plans/m1-core.md`, section 8) and
**M2 recipe module** (2026-10-14, plan `docs/plans/m2-recipe-module.md`; section 9 is the
integration record with the gate logs, curl walkthrough and headless results; section 10 "what
changed vs plan" is written by the milestone review). Next: M3 finance module (SPEC §8).

What exists after M2: the three workspaces build, typecheck and test green (`bun test`: 1391 pass in
69 files). The recipe module is complete and is the only module (`API_MODULES` and `WEB_MODULES` are
`[recipe]`, `/api/health` reports `modules: ["recipe"]` plus the `ocrImport` / `pdfImport` flags):
recipes with search and filters, tags (course vs free), collections, URL / photo / PDF import with
the draft review, meal plan with the cook log, shopping lists with the offline outbox, cards
(EAN-13 / UPC / Code128 / QR), uploads with thumbnails, `uploads:gc`, the recipe demo data in `seed`,
the service-worker rules, and the Home card. The web tabs are Rezepte `/recipe`, Plan `/recipe/plan`,
Einkauf `/recipe/shopping`, Profil (shell); secondary Sammlungen `/recipe/collections`, Tags
`/recipe/tags`, then the shell's Gruppen. Every toon-recipe test file has a counterpart (map in the
plan's section 8). Verified on the merged tree by a fresh-DB curl walkthrough and a headless
Chromium run at 390 and 1440 px (146 checks, plus the offline replay on the built app); see the
plan's section 9. Still **no finance**, no `plan:run`, no `migrate:legacy`, no Docker files.

`bun run i18n:check` exits 1 by design; its parity half is OK and its leftover-German half reports
120 hits: 110 German labels or umlaut examples quoted in doc comments and 10 lines of content
vocabulary (the ingredient-paste placeholder, `UNIT_SUGGESTIONS`, `STEP_HEADING_RE`, the seven
`html/entities.ts` umlaut entities). All are false positives; classify each hit, never suppress the
check. The files under `features/plan` and `features/cards` are scanned here (toon-recipe never
scanned them); their hits are comment quotes.

ADRs: `docs/adr/0001-household-copy-without-recipe-counts.md` (D10: `household.detail.meta` and
`household.danger.warning` lose their recipe count, `household.count.recipes` is not ported, because
the core cannot count a module's rows; the recipe module supplies its own count, see
`useHouseholdRecipeCount`). M2 deviated from nothing else in SPEC §1; its plan-level choices (module
hooks, URL scheme, table identifiers) are in the plan's section 6 and SPEC §2 / §3.

## Layout (as built)

Package names are `@toon/shared`, `@toon/api`, `@toon/web`; the root is `toon-household`. Paths per
SPEC §3 with what M0 to M2 actually created:

- `packages/shared/src/` — `index.ts` (the ONLY entry: the vite alias maps exactly `"@toon/shared"`,
  never import a subpath), `core/` (`i18n/` runtime + `catalogs/server.{de,en}.ts`, `schemas/`
  `common|household|user|auth`, `calendar.ts`, `text.ts`), `modules/registry.ts` (`MODULE_IDS`,
  `ModuleIdSchema`, `DEFAULT_ENABLED_MODULES = ["recipe"]`), `modules/recipe/` (`units`,
  `ingredients`, `numbers`, `duration`, `tags`, `shopping`, `barcode`, `qr`, `schemas/{recipe,plan,
  import,shopping,card}.ts`, `index.ts` barrel re-exported from the package entry). Tests flat in
  `packages/shared/test/` under toon-recipe's file names (the recipe schema tests are
  `recipe-schemas.test.ts` plus `core.test.ts`).
- `apps/api/src/` — `index.ts` wiring (health, `/uploads/:filename` inline, `mountModules`,
  `/api/auth`, `/api/households`, SIGTERM/SIGINT calling each module's `shutdown`, static web LAST),
  `env.ts`, `db/{client,migrate,schema}.ts` + `db/schema/core.ts`, `lib/`,
  `middleware/{session,household,module,verifiedEmail,staticWeb}.ts`, `modules/{index,types,mount}.ts`,
  `core/routes/{auth,households,members,invites,modules}.ts` (the last three export
  `register…Routes(router)` onto the one `householdRoutes` instance in `households.ts`),
  `core/services/{auth,households,mail,media}/` (`households/modules.ts` holds `enabledModulesFor`,
  `initializeHousehold`, `enableModule`, `disableModule`; `media/` holds `uploads.ts`,
  `references.ts` and the sharp thumbnails).
  `modules/recipe/` is `index.ts` (the `ApiModule`), `schema.ts` (the 17 `recipe_` tables),
  `migrate.ts` (the fold backfill, run as `afterMigrate`), `seed.ts` (`seedDemo`), `routes/{index,
  recipes,imports,shopping,plan,cards}.ts` and `services/{recipes,import,ocr,plan,shopping,cards}/`
  mirroring toon-recipe's `services/` one to one (`import/` has `url/`, `html/`, `ocr/`).
  `apps/api/scripts/{migrate,seed,reset-password,uploads-gc}.ts`, `apps/api/drizzle/{0000_core,
  0001_recipe}.sql` (both generated by drizzle-kit). Tests in `apps/api/test/` (`core-walkthrough`,
  `modules`, `households`, `auth`, `middleware`, `import-order`, `recipe-module`,
  `recipe-cross-household`, `recipes*`, `tags-kind`, `plan`, `cards`, `shopping*`, `uploads`,
  `import/` with its fixtures in `test/fixtures/import/`, …).
- `apps/web/src/` — `main.tsx`, `app.tsx`, `route-roots.tsx` (`rootRoute`, `appRoute` without a
  component, `householdScopedRoute`; imports no shell and no registry), `router.tsx` (attaches
  `AppLayout` = `RequireAuth` + `AppShell` with `appRoute.update`, builds the tree: public auth
  routes, `/households`, `/households/$householdId`, `/settings`, `/` Home, and
  `WEB_MODULES.map((m) => m.route)`), `lib/` (`api`, `queries`, `query-client`, `session.tsx`,
  `persist`, `storage`, `nav.tsx`, `permissions.ts`, `share.ts`, `i18n/`, small libs),
  `components/ui/` (toon-recipe's primitives plus barrel; the only primitives), `components/layout/`
  (AppShell, BottomTabBar, SideNav, ModuleSwitcher, PhoneHeaderRow, UnverifiedEmailBanner,
  `nav-items.ts`, `use-nav-items.ts`, `module-switcher-items.ts`), `core/features/{auth,home,
  households,settings}/`, `modules/{index,catalogs,persist,types,enabled,layout}.ts(x)`, `styles/`.
  `modules/recipe/` is `index.ts` (the `WebModule`), `routes.tsx` (the module's own layout route and
  children, every screen a `lazyRouteComponent`), `HomeCard.tsx`, `catalogs/` (six namespace files
  `recipes|organise|plan|shopping|import|cards` plus `index.ts`), `lib/{api,queries,format}.ts` (shims:
  `export * from "@/lib/<x>"` plus the module's own fetchers, keys and formatters) and
  `features/{recipes,collections,tags,import,shopping,cards,plan}/` mirroring toon-recipe's
  `features/` (`recipes/print.css` included). Catalogs of the core live in
  `lib/i18n/catalogs/{common,home,auth,household}.{de,en}.ts`. Tests are co-located `*.test.ts(x)`
  under `tsconfig.test.json` (`modules/recipe/{manifest,persist}.test.ts` among them). Nothing lives
  under `apps/web/src/features/` (SPEC §3).
- `scripts/` — `dev.ts`, `typecheck.ts`, `i18n-check.ts`. `.github/workflows/ci.yml` (verify job with
  a poppler step for `pdf-rasterize.test.ts`; no docker-build until M6; `i18n:check` is a local gate
  because it needs the sibling source repos). `docs/design/recipe-redesign/` is the copied design
  record (D5).
- Core DB tables (unprefixed): `users`, `oauth_accounts`, `sessions`, `password_reset_tokens`,
  `email_verification_tokens`, `households`, `household_members`, `household_invites`,
  `household_modules`, `legacy_ids` (its column is named `table` per D12; the TS property is
  `tableName`). Recipe tables are all `recipe_*` (`recipe_recipes`, `recipe_tags`,
  `recipe_recipe_tags`, `recipe_cards`, …), `group_id` is `household_id`.

Not yet present (so do not look for them): `modules/finance` on either side, `plan:run` (M3),
`migrate:legacy` (M5), Dockerfile and compose (M6), `docs/API.md`, `docs/modules/*.md` (M7).

## Commands

Run from the repo root. Bun 1.4.2 (`.bun-version`); `bun install --frozen-lockfile` first.

- `bun run dev`: API (`:3001`, `bun --watch`) and Vite web (`:5173`, proxies `/api`) together. Needs
  `DATABASE_URL` and `SESSION_SECRET` (16+ chars) in the environment or a root `.env` (copy
  `.env.example`), and a migrated DB, e.g.
  `DATABASE_URL=file:./data/m2.db SESSION_SECRET=<32 hex chars> bun run dev` (then `bun run seed`
  for the demo login).
- `bun run dev:api` / `bun run dev:web`: the same two processes one at a time.
- `bun run start`: the API without watch (production); with `WEB_DIST_DIR=./apps/web/dist` it also
  serves the built shell (needs `bun run build` first).
- `bun run typecheck`: `tsc --noEmit` over packages/shared, apps/api and the three apps/web projects.
- `bun test`: all unit and API tests (API uses an in-memory libSQL DB).
- `bun run build`: Vite build plus the generated PWA service worker into `apps/web/dist`.
- `bun run i18n:check`: German catalog parity plus no German left in ported source; grep-shaped and
  exits non-zero even when the tree is correct, so read its output (comment quotes of German labels
  are expected false positives).
- `bun run db:generate`: drizzle-kit generates a migration from `apps/api/src/db/schema`.
- `bun run db:migrate`: applies the migrations to `DATABASE_URL` (e.g. `file:./data/m2.db`) and every build module's `afterMigrate`.
- `bun run db:studio`: drizzle-kit studio on the configured DB.
- `bun run seed`: idempotent demo data on `DATABASE_URL` (migrates first; needs `SESSION_SECRET`):
  user `demo@toon.local` / `demo1234`, the household "Familie" with the default module rows, then each
  build module's `seedDemo` (recipe: tags, three recipes, a plan week, cook log, the shopping list
  "Rewe" with bought history).
- `bun run uploads:gc [-- --dry-run] [-- --min-age-hours=N]`: deletes files in `UPLOAD_DIR` that no
  row references (the core's avatars and household images plus every module's `uploadReferences`;
  generated `*.thumb.webp` follow their original); files younger than 24 h are always kept.
- `bun run auth:reset-password <email> [--send]`: prints a password-reset link for a locked-out
  account (works without mail; `--send` also mails it when a transport is configured).

Environment switches of the recipe module (`env.ts`): `IMPORT_OCR_ENABLED` (photo import, needs the
`tesseract` binary), `IMPORT_PDF_ENABLED` (unset follows the OCR flag; needs `pdftoppm`),
`IMPORT_ALLOW_PRIVATE_HOSTS=1` (dev only, ignored in production: lets the URL importer fetch a
localhost fixture, otherwise the SSRF guard blocks it), `UPLOAD_DIR`. All default off.

Arrive later: `bun run plan:run` (M3), `bun run migrate:legacy` (M5).

## Conventions

The conventions are toon-recipe's `CLAUDE.md` "Conventions" plus toon-finance's "Konventionen"
(money is integer cents everywhere; no float touches a user amount), with these household-wide rules
from SPEC and M0 to M2:

- Tables prefixed per module (`recipe_`, `finance_`), core tables not. API paths under
  `/api/households/:householdId/<module>/` (user-scoped: `/api/<module>/`). Query keys
  `["toon","household",id,"<module>",…]`; user data `["toon","<module>",…]`.
- German UI strings byte-identical to the sources; new German only for new screens, listed in
  `NEW_GERMAN` in `scripts/i18n-check.ts`. Content language never goes through `t()`.
- toon-recipe's web namespace `ui.*` is core `common.*` here (a pure KEY rename, values unchanged,
  so `ui.common.dash` is `common.common.dash`; `UiCatalog` is `CommonCatalog`). Every later port of a
  recipe screen applies `"ui.` → `"common.`. Module namespaces are `recipe.*`, `finance.*`.
- Renames from toon-recipe (apply them to every later port): `group` → `household`, `groupId` →
  `householdId`, `activeGroupId` → `activeHouseholdId`, `requireGroupRole` → `requireHouseholdRole`,
  `createOwnedGroup` → `createOwnedHousehold`, `useActiveGroup` → `useActiveHousehold`,
  `RequireActiveGroup` → `RequireActiveHousehold`, `/api/groups` → `/api/households`, web catalog
  keys `groups.*` → `household.*` (group management only), `auth.register.groupName.*` →
  `auth.register.householdName.*`, `auth.settings.groups.*` → `auth.settings.households.*`. The
  German VALUES keep "Gruppe" and `DEFAULT_HOUSEHOLD_NAME` stays "Meine Rezepte" (D10; a rename to
  "Haushalt" is an owner decision, M4 at the earliest, and needs an ADR). Server keys `server.group.*`
  and `{groupName}` placeholders keep their names.
- Core helpers a recipe port needs are core, not module code: `@/lib/nav` (`AppLink`,
  `useAppNavigate`, `useRouteParam(s)`, `useNavigationGuard`), `@/lib/permissions` (`hasAtLeast`),
  `@/lib/share` (`shareOrCopy`, `copyToClipboard`); `canModifyOwn` stays with the recipe module.
- Module boundary: the core imports a module only through `modules/index.ts` (and, on the web, its
  catalogs through `modules/catalogs.ts`); a module never imports another module's directory.
- Docs in English, commit messages ending with the harness's `Co-Authored-By` line, no pushes from
  agent sessions. Tests: `apps/api/test/` (never `tests/`), web co-located, `packages/shared/test/`.
- Ported tests that need unported code are removed with a placeholder comment naming the returning
  milestone, never skipped silently.

## Gotchas in use (M0 to M2)

Binding gotchas of the sources stay binding inside their module (SPEC D13); these are the ones
the code actually relies on or introduced.

- **D7 pragmas.** `db/client.ts` sends WAL + `synchronous = FULL` (finance's ledger choice, not
  recipe's `NORMAL`), on every connection to a local `file:` DB, never to `libsql://` or `:memory:`.
  `test/db-pragmas.test.ts` pins it. Do not "optimise" it back.
- **`file::memory:` is per client.** A test going through `app.request` must use the shared `db` +
  `runMigrations(db)`; `createDatabase({url:"file::memory:"})` is a different database. Under
  `NODE_ENV=test` env.ts forces `file::memory:`.
- **Migrations are generated.** `0000_core.sql` comes from `bun run db:generate`, never by hand; DDL
  is verified through `@libsql/client` (`bun:sqlite` is a newer SQLite). `db:migrate` needs only
  `DATABASE_URL`: it supplies a placeholder `SESSION_SECRET` (never overriding a real one) and
  imports the db modules dynamically so `env.ts` validates after that.
- **Middleware chain order is load-bearing.** `mountModules` applies `requireSession()` →
  `requireHouseholdRole("member")` → `requireModule(id)`: no cookie is 401 first, a non-member is
  403 before the module row is read (so a foreign household's enabled modules never leak),
  a disabled module is `404 module_disabled`. `test/middleware.test.ts` pins the order. Because the
  chain already ran, a module's `householdRouter` has no `requireSession()` / `requireHouseholdRole(
  "member")` of its own (toon-recipe's routers had them; the port deleted them); it adds
  `requireVerifiedEmail()` itself and `requireHouseholdRole("admin")` per route where needed. A
  `userRouter` (`/api/recipe/cards`) runs `requireSession()` itself and is NOT behind `requireModule`:
  a card belongs to its owner, not to a household. Mount order in `index.ts` (pinned by tests): health,
  `/uploads`, `mountModules`, `/api/auth`, `/api/households`, static web LAST; inside
  `householdRoutes` the invite-token routes (`/invites/:token`, `/invites/accept`) come before
  `/:householdId`. Module routers must stay before the `/api/households` router.
- **A `household_modules` row is the enabled state.** Every household-creation path (register,
  OAuth sign-up, `POST /api/households`, seed) goes through `initializeHousehold(db, id)`, which
  writes the `DEFAULT_ENABLED_MODULES` rows (even for a module the build lacks; the UI filters by
  `WEB_MODULES`) and then runs each build module's `onHouseholdCreated`. `enableModule` runs the
  module's `onEnable` BEFORE the upsert (a refusal writes nothing); under `bun test` there is no
  real transaction (`file::memory:`, `support.ts` `withTransaction`), so that order is what the
  "refused enable writes nothing" test actually proves. `disableModule` deletes the row (settings
  lost, module data kept). `API_MODULES` is read inside functions only: `initializeHousehold` imports
  `modules/index.ts` from a core service, so a top-level read becomes an import cycle once a module
  imports `core/services/households/*`.
- **`HouseholdWithRole` has `modules: string[]`, no counts (ADR 0001).** It travels in `/api/auth/me`
  (the one persisted core query, `["toon","me"]`) and drives the shell: `moduleGuard(enabledIds, id)`
  (`modules/enabled.ts`, pure) decides `RequireModule`, which `moduleLayoutComponent(id)` wraps
  around every module layout's `<Outlet/>`. The query client's `onError` invalidates
  `["toon","me"]` on `404 module_disabled`, so a stale bundle and a live disable take one path. Core
  query-key segments (`me`, `sessions`, `oauth-providers`, `households`, `invite`, `detail`, `members`,
  `invites`) never equal a module id.
- **Finance enable is unchecked until M3.** Nothing refuses `POST …/modules/finance` for a household
  without its two participants (D3) because the build has no finance module; finance's `onEnable`
  must throw an `ApiError` then (the hook contract and a "refused enable writes nothing" test exist).
- **Uploads are signed, not cookie-checked.** `/uploads/:filename` answers 404 for an unsigned,
  forged or expired URL (`lib/uploadUrls.ts`); `<name>.thumb.webp` is built with `sharp` on first
  request and falls back to the original (short cache) when sharp cannot convert.
- **Cross-household guard (D8).** The household comes from `:householdId` only. Every by-id lookup in
  a module service filters by `membership.householdId` and answers `404 not_found` for another
  household's id; `test/recipe-cross-household.test.ts` addresses every recipe by-id route with
  another household's id (cards: another user's card). Each finance resource gets the same test in
  M3.
- **`MessageKey` must stay a literal union (D10).** `modules/catalogs.ts` objects
  (`MODULE_CATALOGS_DE/EN`) are literal-typed with no annotation, ever: an index-signature type
  turns `MessageKey` into `string` and every `t()` typo compiles. A literal-union test and a
  `@ts-expect-error` in `i18n.test.ts` guard it. Catalogs reach the registry through
  `modules/catalogs.ts`, never through `modules/index.ts` (which imports screens that import i18n:
  a cycle).
- **No module-level constants over `WEB_MODULES`** in files a manifest imports; nav items are
  computed by functions at render time (`nav-items.ts`, `use-nav-items.ts`).
- **Persist policy comes from the manifests (D9).** `buildPersistPolicy(WEB_MODULES)` feeds
  `createShouldPersistQuery` / `createShouldPersistMutation` (`lib/persist.ts`); a module that
  declares `persistMutationNamespaces` must also register `mutationDefaults` for each namespace (a
  restored mutation carries its variables, not its function). `PERSIST_BUSTER = "household-v1"`.
  The persisted cache is keyed per user id and purged on account switch (toon-recipe's data-leak
  guard, unchanged).
- **Service worker.** `vite.config.ts` rules, first match wins, so every `NetworkOnly` rule precedes
  the one `NetworkFirst` rule: `/api/auth/`, the recipe `imports`, `shopping-lists`, `plan` and
  `/api/recipe/cards` (all NetworkOnly: a cached copy would hand TanStack a stale list or wallet),
  then `recipes|tags|collections` (NetworkFirst, cache `toon-api-recipes`), and `/uploads/` (CacheFirst).
  M3 appends finance's rules the same way (union of both sources' lists, D9). `/api` and `/uploads`
  stay out of the navigation fallback; `skipWaiting` is off. The dev server has no service worker:
  check offline behaviour on the built app (`bun run build`, then `WEB_DIST_DIR=./apps/web/dist bun
  run start`).
- **The route tree is strict, with one hole.** `WEB_MODULES = [recipeModule] as const satisfies
  readonly WebModule[]` and `recipeModule` carries no type annotation, so `router.tsx`'s
  `WEB_MODULES.map((m) => m.route)` keeps the concrete route types and a raw
  `<Link to="/recipe/nope">` fails `tsc`. The hole: recipe screens navigate through `AppLink` /
  `useAppNavigate` (`@/lib/nav`, `to: string`) and `import/lib/navigation.ts`'s template-string
  `go(…)`, which `tsc` does NOT check (toon-recipe's own shape). An unprefixed target (`/plan`
  instead of `/recipe/plan`) compiles and lands on `NotFoundPage`. **The LINKS grep is the check,
  not `tsc`** (it also finds toon-recipe's 46 old targets in the source tree, and nothing in this
  one):
  `! grep -rnE "(\bto[=:] ?|\bgo\(|\bgoTo\()[\"'\`]/(recipes|plan|shopping|import|collections|tags|search|groups)\b|\bto[=:] ?[\"']/[\"']|useUrlRecipeFilters\([\"']/[\"']\)" apps/web/src/modules/recipe`.
  Run it after every web port; a headless pass that clicks the links is the second check.
- **A module owns its layout route and its static import graph stays shell-free (SPEC §2).**
  `WebModule.route` is built in `modules/<id>/routes.tsx` with `getParentRoute: () =>
  householdScopedRoute` from `route-roots.tsx`, which imports neither `@/modules` nor the shell;
  `AppLayout` is attached in `router.tsx` via `appRoute.update({ component })`. Nothing the manifest
  imports statically (`index.ts`, `routes.tsx`, `HomeCard.tsx`, catalogs, `offline.ts`) may import
  `@/modules`, `@/components/layout` or `use-nav-items`: the registry would re-enter a manifest that
  is still evaluating (TDZ `ReferenceError` when a test imports the manifest first; only `app.tsx`'s
  import order hid it). Screens are `lazyRouteComponent`s, which keeps them (and the layout barrel
  they import) out of that graph. `manifest.test.ts` and `persist.test.ts` import `./index` first
  without `@/modules`, which proves it.
- **API import cycle: read the registry inside functions, declare handlers as functions.**
  `middleware/session.ts` → `auth/users.ts` → `households/modules.ts` → `modules/index.ts` → recipe
  manifest → `routes/cards.ts` calls `requireSession()` at module scope while `session.ts` is still
  evaluating. `requireHandler` / `optionalHandler` are therefore hoisted function declarations (as
  `const` arrows the real server died with "Cannot access 'requireHandler' before initialization"
  while every in-process test passed). `test/import-order.test.ts` imports each real entry point
  first, in a fresh process. A new module-scope call into a core middleware or service needs the same
  care, and `API_MODULES` is never read at module top level.
- **Recipe tables and indexes are prefixed, their TS identifiers are not.** SQL names are `recipe_*`
  (index names `recipe_…_household_…`, because SQLite index names are global), but the drizzle
  identifiers stay toon-recipe's (`recipes`, `tags`, `recipeTags`, `cards`, `shoppingLists`, …) so the
  services port with path changes only; the column property is `householdId`. `db/schema.ts` re-exports
  every module's schema FLAT, so **M3 must give finance's TS identifiers a `finance` prefix**
  (`financeTags`, …), or `tags` collides. Raw SQL strings and `explain` text follow the SQL names.
- **Fold columns and the backfill.** `title_fold`, `description_fold`, `name_fold` are `NOT NULL`
  with no default (the fresh `0001_recipe.sql` has no `DEFAULT ''`; services write them through
  `foldText`). `backfillFoldedColumns` lives in `modules/recipe/migrate.ts` and runs as the module's
  `afterMigrate` after every `runMigrations` (db:migrate, seed, tests): idempotent, no transaction.
  M5's `migrate:legacy` relies on it for imported rows.
- **Import route tests use real sessions.** toon-recipe's `services/import/middleware-bridge.ts` is not
  ported: it only stubbed the session and group middleware, and the mount chain now runs the real
  ones. `test/import/routes.test.ts` and `ocr-disabled.test.ts` log in through the shared DB plus the
  file-backed import DB (`setImportDbForTests`). OCR and PDF flags, `setMailer`,
  `setVerifiedEmailRequired`, `setOcrEngine`, `setPdfRasterizer` are handed back in `afterAll`; never
  `mock.module`. `pdf-rasterize.test.ts` needs poppler's `pdftoppm` and fails, not skips, without it.
- **Import query keys are rooted at `"toon"` (decision 14).** `["toon","household",id,"recipe","import",
  "drafts"|"tags",…]` for household lists and `["toon","recipe","import-draft",draftId]` for the
  user-scoped draft (a draft resolves across the user's households). Commit and delete invalidate both
  roots; none of these segments is in the persist allow-list, so no import data is persisted.
  `useCommitDraft` calls `invalidateAfterRecipeMutation` (every module key now contains `"recipe"`,
  so R's "contains recipe" predicate would match everything).
- **The library's recipe count is the module's own query (ADR 0001, decision 13).**
  `useHouseholdRecipeCount(householdId)` (`features/recipes/lib/queries.ts`) is an UNFILTERED
  `recipesQuery(householdId, { limit: 1 })` whose `total` is the count; its key sits under
  `recipesRoot`, so every recipe mutation refreshes it, and it is persisted like every `recipes` key.
  `RecipeListPage` feeds it into `recipe.recipes.list.groupSummary` ("Familie · N Rezepte" on a
  phone) and `sharedSummary` ("Geteilt mit Familie · 1 Mitglied · N Rezepte" at `lg`) and renders the
  subtitle only once the count is known. Never use the filtered list's `total` there (wrong whenever a
  filter is set; the headless run checks the subtitle stays at N under `?q=`).
- **The shopping list outbox is wired through the manifest.** `registerShoppingMutationDefaults` is
  the manifest's `mutationDefaults` (no module-scope call any more), `persistMutationNamespaces:
  [["recipe","shopping"]]` persists only paused `["toon","recipe","shopping",…]` mutations, and every
  queued write carries a client-minted `mutationId` (the API applies one `mutationId` once, so a
  replayed request cannot turn 500 g into 1 kg). toon-recipe's gotcha "THE SHOPPING LIST IS THE ONE
  THING EDITABLE OFFLINE" and its `useCanMutate` split (shopping uses `useEmailVerificationBlock`,
  plan and cards use `useCanMutate`) stay binding.
- **Inherited recipe gotchas stay binding inside `modules/recipe`** (SPEC D13): read toon-recipe's
  `CLAUDE.md` before touching search (pre-folded columns), import (SSRF guard, JSON-LD `@graph`
  references), OCR subprocesses, cards (EAN check digits, crispEdges), print styles and the shopping
  merge rules.
- **Headless runs.** Install Playwright in a scratch directory outside the repo (a `bun add` log ending
  in `exit=$?`), log in with `fetch("/api/auth/login")` from the page, assert `scrollWidth <=
  clientWidth`, and never match the tab bar by its `aria-label` (`SideNav` carries the same one and
  reports a zero rect on a phone): the tab bar is `nav.fixed`, the sidebar `aside[data-app-shell]`.
  Login is rate limited per address in memory, so a script that logs in five times per run gets `429`
  after a few runs: restart the API. `position: fixed` elements have `offsetParent === null`; test
  visibility with `getBoundingClientRect` and computed `display`. A module disabled through the API
  behind the SPA's back is noticed on the first `404 module_disabled` (the query client invalidates
  `["toon","me"]`), not before: re-enable through the Home "Aktivieren" button in a test.
- **`scrollbar-gutter: stable`** on `<html>` (toon-recipe's) makes `scrollWidth` 375/1425 against
  `clientWidth` 390/1440 under classic scrollbars; check no-overflow as `scrollWidth <= clientWidth`.
- **i18n-check from worktrees** resolves the source repos via the git common dir; it needs
  `toon-recipe` and `toon-finance` next to the main checkout (or `I18N_CHECK_SOURCES`).
- **Long commands** (cold `bun install`, docker build, headless browser) go to the background with one
  log ending in `exit=$?`.

## Obligations handed to later milestones

Each later plan lists and closes them (full text: `docs/plans/m2-recipe-module.md` §8 and its §9;
earlier ones in `docs/plans/m0-scaffold.md` §4 and `docs/plans/m1-core.md` §6 and §8). M0, M1 and M2
closed theirs.

- M3: finance's TS table identifiers get a `finance` prefix (`financeTags`, …), because
  `db/schema.ts` re-exports every module flat; finance's `onEnable` refuses a household without its
  two participants (D3; the hook contract and a "refused enable writes nothing" test exist); a
  cross-household sweep test like `recipe-cross-household.test.ts` for every finance by-id route;
  finance's service-worker rules (NetworkOnly before NetworkFirst); `persistMutationNamespaces`
  next to `mutationDefaults` with a paused-mutation persistence test, as `modules/recipe/persist.test.ts`;
  the `LINKS` grep adapted to `apps/web/src/modules/finance` for every finance port; finance's
  `afterMigrate` only if a SQL migration cannot express a data fix.
- M4: "Gruppe" vs "Haushalt" copy (owner decision, ADR), `NotFoundPage`'s recipe icon, the phone
  module chip as a real `ActionMenu` sheet, `scrollWidth` measurement with the scrollbar gutter; the
  Home cards' final design, toon-recipe's sidebar per-item counts and the Plan "Neu" pill, the PWA
  manifest `shortcuts` (`/recipe/import`, `/recipe/recipes/new`), print-to-PDF verification of
  `print.css`.
- M5: `migrate:legacy` maps toon-recipe's tables to `recipe_*` (plan m2 Table C) and relies on
  `afterMigrate` for the folded columns.
- M6: redirects from toon-recipe's old paths (`/recipes/…`, `/plan`, `/shopping`, `/import`) for
  bookmarks arriving through the old-hostname redirect (with the Caddyfile); image build with
  `WITH_OCR=1 WITH_PDF=0`.
- M7: `docs/API.md`, `docs/modules/recipe.md`.
