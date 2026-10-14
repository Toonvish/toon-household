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
plan" in its section 6) and **M1 core** (2026-10-14, plan `docs/plans/m1-core.md`, section 8). Next:
M2 recipe module, then M3 finance (SPEC §8).

What exists after M1: the three workspaces build, typecheck and test green (`bun test`: 431 pass in
30 files); the core works end to end. Over the API and in `apps/api/test/core-walkthrough.test.ts`:
register, logout and login, create a household, invite and accept, switch the active household,
enable and disable a module (a member gets 403), and `GET /api/households/:id` returning `modules`.
On the web: login/register/forgot/reset/verify/OAuth/invite screens, households list and detail,
`/settings` (profile, language, theme, e-mail, households card, then each enabled module's
`settingsSections`), Home with the household name and the enable-module empty state ("Familie" /
"Noch keine Module aktiviert" at 390 px and 1440 px, no console errors), the household switcher, the
module switcher (renders nothing while the build has no module), the unverified-e-mail banner and
the module-less tab bar ("Start", "Profil"). There are still **no modules** (`API_MODULES` and
`WEB_MODULES` are empty, `/api/health` reports `modules: []`), so no module route, `homeCard` or
`settingsSections` exists yet and the code carries `M2:` / `M3:` comments at the seams.

`bun run i18n:check` exits 1 by design; its parity half is OK and its leftover-German half reports
16 hits, every one a German label or umlaut example quoted in a doc comment (false positives;
classify each hit, never suppress the check).

ADRs: `docs/adr/0001-household-copy-without-recipe-counts.md` (D10: `household.detail.meta` and
`household.danger.warning` lose their recipe count, `household.count.recipes` is not ported, because
the core cannot count a module's rows). M0 and the rest of M1 deviated from nothing else in SPEC §1.

## Layout (as built)

Package names are `@toon/shared`, `@toon/api`, `@toon/web`; the root is `toon-household`. Paths per
SPEC §3 with what M0 and M1 actually created:

- `packages/shared/src/` — `index.ts` (the ONLY entry: the vite alias maps exactly `"@toon/shared"`,
  never import a subpath), `core/` (`i18n/` runtime + `catalogs/server.{de,en}.ts`, `schemas/`
  `common|household|user|auth`, `calendar.ts`, `text.ts`), `modules/registry.ts` (`MODULE_IDS`,
  `ModuleIdSchema`, `DEFAULT_ENABLED_MODULES = ["recipe"]`). Tests in `packages/shared/test/`.
- `apps/api/src/` — `index.ts` wiring (health, `/uploads/:filename` inline, `mountModules`,
  `/api/auth`, `/api/households`, static web LAST), `env.ts`, `db/{client,migrate,schema}.ts` +
  `db/schema/core.ts`, `lib/`, `middleware/{session,household,module,verifiedEmail,staticWeb}.ts`,
  `modules/{index,types,mount}.ts`, `core/routes/{auth,households,members,invites,modules}.ts` (the
  last three export `register…Routes(router)` onto the one `householdRoutes` instance in
  `households.ts`), `core/services/{auth,households,mail,media}/` (`households/modules.ts` holds
  `enabledModulesFor`, `initializeHousehold`, `enableModule`, `disableModule`; `media/` holds
  `uploads.ts` and the sharp thumbnails). `apps/api/scripts/{migrate,seed,reset-password}.ts`,
  `apps/api/drizzle/0000_core.sql` (generated by drizzle-kit). Tests in `apps/api/test/`
  (`core-walkthrough`, `modules`, `households`, `auth`, `password-reset`, `middleware`, …).
- `apps/web/src/` — `main.tsx`, `app.tsx`, `router.tsx` (root with `SessionProvider` → the public
  auth routes; pathless `app` = `RequireAuth` + `AppShell` → `/households`, `/households/$householdId`,
  `/settings`, and pathless `household-scoped` = `RequireActiveHousehold` → `/` Home + one layout per
  module), `lib/` (`api`, `queries`, `query-client`, `session.tsx`, `persist`, `storage`, `nav.tsx`,
  `permissions.ts`, `share.ts`, `i18n/`, small libs), `components/ui/` (toon-recipe's primitives plus
  barrel, 26 files; the only primitives), `components/layout/` (AppShell, BottomTabBar, SideNav,
  ModuleSwitcher, PhoneHeaderRow, UnverifiedEmailBanner, `nav-items.ts`, `use-nav-items.ts`,
  `module-switcher-items.ts`), `core/features/{auth,home,households,settings}/`,
  `modules/{index,catalogs,persist,types,enabled,layout}.ts(x)`, `styles/`. Catalogs live in
  `lib/i18n/catalogs/{common,home,auth,household}.{de,en}.ts`. Tests are co-located `*.test.ts(x)`
  under `tsconfig.test.json`. Nothing lives under `apps/web/src/features/` (SPEC §3).
- `scripts/` — `dev.ts`, `typecheck.ts`, `i18n-check.ts`. `.github/workflows/ci.yml` (verify job only;
  no poppler step until M2, no docker-build until M6; `i18n:check` is a local gate because it needs
  the sibling source repos). `docs/design/recipe-redesign/` is the copied design record (D5).
- Core DB tables (unprefixed): `users`, `oauth_accounts`, `sessions`, `password_reset_tokens`,
  `email_verification_tokens`, `households`, `household_members`, `household_invites`,
  `household_modules`, `legacy_ids` (its column is named `table` per D12; the TS property is
  `tableName`).

Not yet present (so do not look for them): any module directory (`modules/recipe`, `modules/finance`
on either side), module routes, `homeCard`s, `uploads:gc` (M2), `plan:run` (M3), `migrate:legacy`
(M5), Dockerfile and compose (M6), `docs/API.md`, `docs/modules/*.md` (M7).

## Commands

Run from the repo root. Bun 1.4.2 (`.bun-version`); `bun install --frozen-lockfile` first.

- `bun run dev`: API (`:3001`, `bun --watch`) and Vite web (`:5173`, proxies `/api`) together. Needs
  `DATABASE_URL` and `SESSION_SECRET` (16+ chars) in the environment or a root `.env` (copy
  `.env.example`), and a migrated DB, e.g.
  `DATABASE_URL=file:./data/m1.db SESSION_SECRET=<32 hex chars> bun run dev` (then `bun run seed`
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
- `bun run db:migrate`: applies the migrations to `DATABASE_URL` (e.g. `file:./data/m1.db`).
- `bun run db:studio`: drizzle-kit studio on the configured DB.
- `bun run seed`: idempotent demo data on `DATABASE_URL` (migrates first; needs `SESSION_SECRET`):
  user `demo@toon.local` / `demo1234` and the household "Familie" with the default module rows.
- `bun run auth:reset-password <email> [--send]`: prints a password-reset link for a locked-out
  account (works without mail; `--send` also mails it when a transport is configured).

Arrive later: `bun run uploads:gc` (M2), `bun run plan:run` (M3), `bun run migrate:legacy` (M5).

## Conventions

The conventions are toon-recipe's `CLAUDE.md` "Conventions" plus toon-finance's "Konventionen"
(money is integer cents everywhere; no float touches a user amount), with these household-wide rules
from SPEC, M0 and M1:

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

## Gotchas in use (M0, M1)

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
  a disabled module is `404 module_disabled`. `test/middleware.test.ts` pins the order. A module
  router adds `requireVerifiedEmail()` itself. Mount order in `index.ts` (pinned by tests): health,
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
  household's id; each resource gets a test (obligation of M2/M3).
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
- **Service worker.** Only `/api/auth/` (NetworkOnly) and `/uploads/` (CacheFirst) rules exist in
  `vite.config.ts`; module rules (union of both sources' lists, D9) arrive in M2/M3, NetworkOnly rules
  before any NetworkFirst one. `/api` and `/uploads` stay out of the navigation fallback. `skipWaiting`
  is off. Some comments in `vite.config.ts` and `lib/persist.ts` still describe recipe-only rules
  (zxing, cards, import endpoints): they are inherited and become true again in M2.
- **Open type seam for M2.** With `WEB_MODULES: readonly WebModule[]` and `routes: AnyRoute[]` the
  registered route tree is loose (`<Link to="/nonexistent">` compiles); `NavItem.to` is the
  hand-written `NavPath` union and renderers pass it through `linkTo()`. M2 should keep the registry
  literal-typed to restore a strict tree, and must give module routes a way to reach the module
  layout route without importing `router.tsx` (router-core calls `getParentRoute()` at init).
- **`scrollbar-gutter: stable`** on `<html>` (toon-recipe's) makes `scrollWidth` 375/1425 against
  `clientWidth` 390/1440 under classic scrollbars; check no-overflow as `scrollWidth <= clientWidth`.
- **i18n-check from worktrees** resolves the source repos via the git common dir; it needs
  `toon-recipe` and `toon-finance` next to the main checkout (or `I18N_CHECK_SOURCES`).
- **Long commands** (cold `bun install`, docker build, headless browser) go to the background with one
  log ending in `exit=$?`.

## Obligations handed to later milestones

Each later plan lists and closes them (full text: `docs/plans/m0-scaffold.md` §4 and
`docs/plans/m1-core.md` §6 and §8). M0's M1 obligations are closed.

- M2: restore the `M2:` placeholders (`uploads.test.ts` recipe-route cases, the recipe half of
  `verified-email-gate.test.ts` next to the retargeted core cases, the recipe-row cascade in
  `households.test.ts`, the recipe content in `seed.ts`); the remaining cases of toon-recipe's
  `packages/shared/test/schemas.test.ts` with their schemas; restore the three `formatDuration` tests
  with `modules/recipe/duration.ts`; re-home recipe's formatters (`formatMinutes`,
  `formatServingsLabel`), the fold backfill from `migrate.ts`, the recipe service-worker rules; add
  poppler to CI; import `hasAtLeast` from `@/lib/permissions` and the share helpers from `@/lib/share`
  (drop the share block from the module's `lib/hooks.ts`); run the headless check that disabling
  `recipe` redirects `/recipe` to Home with the toast; keep the registry literal-typed and give
  module routes a way to reach the module layout route (the open type seam above).
- M3: finance's `onEnable` refuses a household without its two participants (D3).
- M2 and M3: the cross-household guard tests above; `persistMutationNamespaces` next to
  `mutationDefaults` with a test that a paused mutation of that namespace is persisted.
- M4: "Gruppe" vs "Haushalt" copy (owner decision, ADR), `NotFoundPage`'s recipe icon, the phone
  module chip as a real `ActionMenu` sheet, `scrollWidth` measurement with the scrollbar gutter.
