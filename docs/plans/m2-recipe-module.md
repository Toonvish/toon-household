# M2 — recipe module: plan

**Status: PLANNED (2026-10-14), revised after plan review (rev. 2).** Sections 9 (integration record)
and 10 (what changed vs plan) are filled in by M2-T12 and the milestone review.

Rev. 2 changes: T09 split into T09a (import API), T09b (shopping API), T09c (restored placeholders +
cross-household sweep); T11 split into T11a (screen port) and T11b (core wiring); decisions 13
(recipe count after ADR 0001), 14 (import query keys) and 15 (manifest import graph, no cycle)
added; Table A gains `invalidate.groups(`/`queryKeys.groups(`, Table D the relative `nav`/`hooks`
specifiers, Table G `useUrlRecipeFilters("/")`; every web port task greps for unprefixed link
targets (decision 10 no longer claims `tsc` checks recipe links); T01 owns the
`core/schemas/common.ts` comment; T06 owns the `files.ts:184` comment; T05's seed line ranges fixed;
T10 depends on T03 (`zxing-wasm`).

Milestone M2 of `docs/SPEC.md` §8, written by the planner of the `build-household` workflow. Paths:
`H` = `/home/erics/software/toon-household` (this repo), `R` = `/home/erics/software/toon-recipe`,
`F` = `/home/erics/software/toon-finance` (both READ-ONLY: `cat`, `grep`, `git log`, `cp` FROM them
only; never run `bun install`, `bun test` or any script inside them).

## 1. Context

State of `H` at plan time (`c13085b`, M1 closed): the five gates are green (`bun test`: 431 pass in
30 files; `bun run i18n:check` parity OK, leftover half 16 comment-quote hits). The core is complete;
there is **no module**: `API_MODULES` and `WEB_MODULES` are `[]`, `/api/health` reports
`modules: []`, `MODULE_CATALOGS_DE/EN` are `{}`. What M2 builds on, by seam:

- shared: `packages/shared/src/index.ts` re-exports `core/index.ts` + `modules/registry.ts`; `core/`
  holds R's `schemas/{common,user,auth}`, `household.ts`, `text.ts` (byte-identical to R's),
  `calendar.ts`, `i18n/` (runtime + the COMPLETE server catalogs incl. every `server.import.*`,
  `server.card.*`, `server.shopping.*` key). `ServerFeaturesSchema` is
  `{ verifiedEmailRequired }.catchall(z.boolean())` — recipe's `ocrImport`/`pdfImport` ride in the
  catchall. `packages/shared/test/i18n.test.ts:137` and `core.test.ts:93` carry `M2` placeholders.
- api: `src/modules/{index,types,mount}.ts` (`ApiModule`: `householdRouter`, `userRouter`, `schema`,
  `healthFeatures`, `onHouseholdCreated`, `onEnable`, `legacyMigration`); `mountModules` applies
  `requireSession()` → `requireHouseholdRole("member")` → `requireModule(id)` at
  `/api/households/:householdId/<id>/*` and mounts `userRouter` at `/api/<id>`; `db/schema.ts`
  re-exports `db/schema/core.ts` only; `db/migrate.ts` = migrate only (the fold backfill is an M2
  obligation); `core/services/households/{support,membership,mappers,validation,modules}.ts`
  (R's `services/groups/*` renamed; `support.ts` has `withTransaction`, `foldSql`, `likeFolded`,
  `likeStoredFold`, `eqFolded`, `nowMs`, `DbLike`); `core/services/media/{uploads,thumbnails}.ts`
  (R's `services/recipes/uploads.ts` and `services/media/thumbnails.ts`); `core/services/auth/*`;
  `apps/api/scripts/{migrate,seed,reset-password}.ts` (seed has an `M2:` placeholder);
  `env.ts` is byte-identical to R's (OCR/PDF flags, `IMPORT_ALLOW_PRIVATE_HOSTS`, …). Tests with
  `M2:` placeholders: `uploads.test.ts:263`, `verified-email-gate.test.ts:142`,
  `households.test.ts:162,560`; `smoke.test.ts:68` asserts `modules: []`.
- web: `modules/{types,index,catalogs,persist,enabled,layout}.ts(x)`; `router.tsx` maps
  `WEB_MODULES` to one layout route each with `routes: AnyRoute[]` children (open seam: children
  cannot reach that layout without importing `router.tsx`); `components/layout/nav-items.ts`
  (`NavPath` already admits `/recipe/...`); `app.tsx` already calls every manifest's
  `mutationDefaults` and `buildPersistPolicy(WEB_MODULES)`; `lib/{api,queries,format}.ts` are R's
  minus every recipe function; `lib/{nav.tsx,permissions.ts,share.ts}` are core (R's
  `features/recipes/lib/nav.tsx`, `hasAtLeast`, the share block); `lib/i18n/catalogs/common.de.ts`
  already holds the nav labels (`common.nav.recipes|plan|shopping|collections|tags`, "Rezepte" …);
  `vite.config.ts` has only `/api/auth/` NetworkOnly and `/uploads/` CacheFirst plus a placeholder
  comment for module rules. `scripts/i18n-check.ts` `ALLOW_LIST` already names the M2 target paths of
  the content-language files (`packages/shared/src/modules/recipe/{units,ingredients,numbers,
  duration,tags}.ts`, `apps/api/src/modules/recipe/services/import/{ocr/quantity-fix,ocr/segment,
  url/schema-map,url/adapters,url/fetch,url/ssrf,url/image,parsed,times}.ts`).

What R holds that M2 ports (counted 2026-10-14): shared 13 source + 10 test files; api 51 source
files (`routes/{recipes,imports,shopping,plan,cards}.ts`, `services/{recipes,import,ocr,plan,
shopping,cards}/**` minus `recipes/uploads.ts`), 18 test files + 7 fixtures, 554-line `seed.ts`
(recipe part), `uploads-gc.ts`, 9 migrations; web 104 feature files (`features/{recipes,
collections,tags,import,shopping,cards,plan}/**` incl. 6 co-located tests and `recipes/print.css`),
5 catalog namespaces (+ the collection/tag keys of `groups.*`), the recipe halves of
`lib/{api,queries,format,persist}.ts` and `router.tsx`, the SW rules of `vite.config.ts`.

**Goal** (SPEC §8 M2; D1, D2, D6–D10, D13, §2–§5): every recipe feature in `modules/recipe` on the
three workspaces with the prefixed tables and the new paths — recipes, tags, collections, import
(URL/photo/PDF, the two flags, OCR subprocesses), meal plan + cook log, shopping lists with the
offline outbox, cards, uploads + thumbnails — the manifests on both sides, the migration, seed and
`uploads:gc`, the SW rules, every R test ported.

**Exit criteria**: gates green; every file under `R/apps/api/test`, `R/packages/shared/test` and
R's co-located web tests has a passing counterpart (map in §8); the recipe tabs and every secondary
screen work at 390 px and 1440 px with R's "Navigation" reachability rules; a URL import, a
shopping-list offline check-off replay and a card render pass in the headless browser; `i18n:check`
shows only the known false-positive classes.

### Decisions this plan takes (binding for the tasks below)

1. **Target layout** (SPEC §3; the i18n-check `ALLOW_LIST` already fixes several paths):
   - shared: `packages/shared/src/modules/recipe/{units,ingredients,numbers,duration,tags,shopping,
     barcode,qr}.ts`, `packages/shared/src/modules/recipe/schemas/{recipe,plan,import,shopping,
     card}.ts`, barrel `packages/shared/src/modules/recipe/index.ts`, re-exported from
     `packages/shared/src/index.ts` (still the ONLY entry). Tests stay flat in
     `packages/shared/test/` under R's file names.
   - api: `apps/api/src/modules/recipe/{index.ts,schema.ts,migrate.ts,seed.ts}`,
     `routes/{index,recipes,imports,shopping,plan,cards}.ts`,
     `services/{recipes,import,ocr,plan,shopping,cards}/**` mirroring R's `services/` subtree
     one-to-one (R `src/services/import/url/fetch.ts` → `src/modules/recipe/services/import/url/
     fetch.ts`). Tests in `apps/api/test/` under R's names (`import/` subdir kept), fixtures in
     `apps/api/test/fixtures/import/`.
   - web: `apps/web/src/modules/recipe/features/{recipes,collections,tags,import,shopping,cards,
     plan}/**` mirroring R's `features/` one-to-one; `modules/recipe/lib/{api,queries,format}.ts`
     (the recipe halves of R's `lib/`, decision 9); `modules/recipe/catalogs/*.{de,en}.ts` +
     `catalogs/index.ts`; `modules/recipe/{index.ts,routes.tsx,HomeCard.tsx}`. Nothing under
     `apps/web/src/features/`.
2. **Tables** (SPEC D7, §4). Every recipe SQL table gains the prefix `recipe_` (`recipes` →
   `recipe_recipes`, `tags` → `recipe_tags`, `recipe_tags` → `recipe_recipe_tags`, `cards` →
   `recipe_cards`, …, 17 tables, list in T03). Column `group_id` → `household_id` referencing
   `households.id` (cascade unchanged). **TS identifiers of the tables stay R's** (`recipes`,
   `recipeIngredients`, `tags`, `recipeTags`, `collections`, `cards`, `shoppingLists`, …) so the
   services port with path changes only; the column property `groupId` → `householdId`. Every
   index name gets the prefix `recipe_` and `group` → `household` inside it
   (`recipes_group_title_fold_idx` → `recipe_recipes_household_title_fold_idx`); SQLite index names
   are global and finance has a `tags` table too. M3 must therefore give finance's TS identifiers a
   `finance` prefix (`financeTags`, …) because `db/schema.ts` re-exports both flat (handed on, §8).
   Raw SQL strings (`sql\`…\`` templates, `client.execute`, `explain` strings in tests) follow the
   same mapping. The recipe schema defines relations for recipe tables only; core relations
   (`usersRelations`, `householdsRelations`) gain no recipe side (no relational query uses them —
   verified: R has no `db.query.*` call outside auth/groups).
3. **API mount** (D8). `modules/recipe/routes/index.ts` composes
   `recipeHouseholdRouter = new Hono<AppEnv>().route("/imports", importRoutes)
   .route("/shopping-lists", shoppingRoutes).route("/plan", planRoutes).route("/", recipeRoutes)`
   (imports and shopping BEFORE the recipe router, R's order) and
   `recipeUserRouter = new Hono<AppEnv>().route("/cards", cardRoutes)`. Paths:
   `/api/households/:householdId/recipe/{recipes,tags,collections,imports,shopping-lists,plan}/…`,
   cards `/api/recipe/cards/…` (user-owned, NOT behind `requireModule`: a card follows its owner,
   R decision 11). Because `mountModules` already runs `requireSession()` →
   `requireHouseholdRole("member")` → `requireModule("recipe")`, the ported routers DELETE their own
   `use("*", requireSession…)` and `use("*", requireGroupRole("member"))` lines and KEEP
   `use("*", requireVerifiedEmail())` (and the per-route `requireHouseholdRole("admin")` on tag
   delete). `cardRoutes` keeps `requireSession()` (a `userRouter` does its own, `mount.ts`).
   R's `services/import/middleware-bridge.ts` is NOT ported: it existed only to resolve the session
   and group middleware lazily while R's agents wrote them concurrently, and the mount chain now
   runs the real middleware before the import router, so the bridge's test seam could no longer
   replace it; the two import route tests move to real sessions (T09a).
4. **`ApiModule` contract extensions** (SPEC §2, recorded like M0's `persistMutationNamespaces`;
   T12 updates the §2 text): `afterMigrate?(database: Database): Promise<void>` (called by
   `runMigrations` after `migrate()`, for every build module, reading `API_MODULES` inside the
   function), `shutdown?(): Promise<void>` (called by `index.ts`'s SIGTERM/SIGINT handler, R's
   `shutdownOcr` wiring), `seedDemo?(database, { householdId, userId }): Promise<void>` (called by
   `scripts/seed.ts` after the core demo rows), `uploadReferences?(database): Promise<string[]>`
   (raw stored values every module row references; `uploads:gc` keeps a file iff core or any module
   references it). The core still reaches a module only through `modules/index.ts`.
5. **Fold columns** (R gotcha "Recipe search reads PRE-FOLDED columns"). `title_fold`,
   `description_fold`, `name_fold` stay `.notNull()` with NO drizzle default; the fresh
   `CREATE TABLE` of `0001_recipe.sql` therefore has `NOT NULL` without `DEFAULT ''` (no populated
   table to alter — R's `DEFAULT ''` existed only for `ALTER TABLE`). `backfillFoldedColumns` moves
   verbatim to `modules/recipe/migrate.ts` and runs as the module's `afterMigrate`, without a
   transaction, idempotent (M5's `migrate:legacy` relies on it). `last_cooked_at` stays nullable.
6. **Web URLs** (D6). The recipe module's base path is `/recipe`; every R path gains the prefix:
   `/` → `/recipe`, `/recipes/new` → `/recipe/recipes/new`, `/recipes/$recipeId[/edit]` →
   `/recipe/recipes/$recipeId[/edit]`, `/plan` → `/recipe/plan`, `/shopping` → `/recipe/shopping`,
   `/shopping/$listId|cards|history` → `/recipe/shopping/…`, `/import[/$draftId]` →
   `/recipe/import[/…]`, `/collections[/$collectionId]` → `/recipe/collections[/…]`, `/tags` →
   `/recipe/tags`, `/search` (redirect, R gotcha "`/search` must keep declaring the SAME params") →
   `/recipe/search` redirecting to `/recipe`. Tabs: Rezepte `/recipe` (exact) · Plan
   `/recipe/plan` · Einkauf `/recipe/shopping` · Profil (shell). Secondary: Sammlungen
   `/recipe/collections` · Tags `/recipe/tags` (R's order; the shell appends Gruppen).
7. **Catalog keys** (D10). Values byte-identical; keys gain the module prefix: `recipes.*` →
   `recipe.recipes.*`, `shopping.*` → `recipe.shopping.*`, `plan.*` → `recipe.plan.*`, `import.*`
   → `recipe.import.*`, `cards.*` → `recipe.cards.*`; from R's `groups.*` the recipe-owned keys
   `groups.collections.*`, `groups.collectionDetail.*`, `groups.tags.*`, `groups.tagCombobox.*`,
   `groups.count.recipes` → `recipe.collections.*`, `recipe.collectionDetail.*`, `recipe.tags.*`,
   `recipe.tagCombobox.*`, `recipe.count.recipes` (ADR 0001 removed the count from the CORE; the
   module owns it and keeps R's value). Recipe screens' `groups.common.*` / `groups.count.members`
   → the existing `household.common.*` / `household.count.members`; `ui.*` → `common.*`. The module
   name and nav labels reuse `common.nav.*`. No new German is planned; if the home card truly needs
   one, it is added to the recipe catalog AND `NEW_GERMAN` with a reason (T11b).
8. **Query keys and persistence** (D9). `["toon","group",id,<seg>,…]` →
   `["toon","household",id,"recipe",<seg>,…]` with R's segment names unchanged (`recipes`,
   `recipe`, `tags`, `collections`, `collection`, `imports`, `import`, `shopping-lists`,
   `shopping-list`, `plan`, `plan-shopping`, `shopping-bought`, `shopping-catalog`); cards
   `["toon","cards"]` → `["toon","recipe","cards"]`; shopping mutation keys `["toon","shopping",op]`
   → `["toon","recipe","shopping",op]`. Manifest `persistQueryAllowList` = household
   `["recipe",s]` for s ∈ {`recipes`,`recipe`,`tags`,`collections`,`collection`,`shopping-lists`,
   `shopping-list`,`plan`,`shopping-bought`} + user `["recipe","cards"]` exact (R's
   `PERSISTED_GROUP_SEGMENTS` minus the core `detail`, and R's `isCardsKey`);
   `persistMutationNamespaces: [["recipe","shopping"]]`; `mutationDefaults:
   registerShoppingMutationDefaults` (R's module-scope call `registerShoppingMutationDefaults(
   queryClient)` is deleted — `app.tsx` runs the manifest hook before the persister restores).
   `PERSIST_BUSTER` stays `household-v1` (no household build has shipped a cache yet).
9. **Web data layer = module shims over the core lib.** `modules/recipe/lib/api.ts` starts with
   `export * from "@/lib/api";` and adds R's recipe fetchers (R `lib/api.ts` lines 699–1496);
   `modules/recipe/lib/queries.ts` starts with `export * from "@/lib/queries";` and declares local
   `queryKeys = { ...coreQueryKeys, <recipe keys> }` and `invalidate = { ...coreInvalidate,
   <recipe entries> }` (a local export shadows the star export), plus R's recipe `queryOptions`
   and `invalidateAfterRecipeMutation` / `invalidateAfterPlanMutation`;
   `modules/recipe/lib/format.ts` = `export * from "@/lib/format";` + R's `formatMinutes`,
   `formatServingsLabel`. Every ported recipe file then imports `@/modules/recipe/lib/{api,queries,
   format}` where R imported `@/lib/{api,queries,format}` — a pure specifier rewrite. No `fetch`
   outside `lib/api.ts` except R's documented `importApi.ts` XHR exception.
10. **Web module contract: the module owns its layout route.** `WebModule.routes: AnyRoute[]`
    becomes `route: AnyRoute` — the module's layout route at `basePath`, built in the module's
    `routes.tsx` with `component: moduleLayoutComponent(id)` and `getParentRoute: () =>
    householdScopedRoute`, children attached with `addChildren`. `rootRoute`, `appRoute` and
    `householdScopedRoute` move from `router.tsx` to a new core file `apps/web/src/route-roots.tsx`
    that never imports `@/modules` (closing M0's open seam without a cycle). `WEB_MODULES =
    [recipeModule] as const satisfies readonly WebModule[]` with `recipeModule` declared WITHOUT a
    type annotation (`satisfies WebModule<"recipe">`), and `router.tsx` adds
    `...WEB_MODULES.map((m) => m.route)` — so the registered tree is strict again
    (`<Link to="/recipe/nope">` fails `tsc`). If TanStack's types refuse that shape after a real
    attempt, T11b keeps the loose tree and records it (§6). **Scope of that check:** the strict
    tree types only a raw `<Link>`/`useNavigate()` (core screens). Every recipe screen navigates
    through `AppLink`/`useAppNavigate` (`@/lib/nav`, `to: string`) or `import/lib/navigation.ts`'s
    template-string `go(…)`, which `tsc` does NOT check. Recipe link targets (Table G) are
    therefore enforced by a grep verify in every web port task (T04, T07, T08, T10, T11a, T11b —
    the `LINKS` command in §3) and by T12's headless run, never by the route tree.
    `route-roots.tsx` holds no shell (decision 15).
11. **Dependencies.** `unpdf@^1.8.1` (api) and `zxing-wasm@^3.1.3` (web) are added once, by T03,
    with `bun add` (R's versions); no other M2 task touches a `package.json` or `bun.lock`.
12. **Cross-household guard (D8).** R's services already scope every by-id lookup by
    `groupId`; the rename keeps it. T09c adds one sweep test that addresses every by-id route with
    another household's id and expects `404 not_found` (cards: another user's card → 404).
13. **Recipe count (ADR 0001 consequence).** `HouseholdWithRole` has no `recipeCount`; R's
    `RecipeListPage.tsx:92,98` renders it in `recipes.list.groupSummary` ("{name} · {count}
    Rezepte") and, via `groups.count.recipes`, in `recipes.list.sharedSummary`. The module supplies
    the number itself, as ADR 0001's Consequences prescribe: T04 adds
    `useHouseholdRecipeCount(householdId)` to `features/recipes/lib/queries.ts` — an UNFILTERED
    `recipesQuery(householdId, { limit: 1 })` whose response `total` is the count (key under
    `recipesRoot`, so `invalidate.recipes` refreshes it after every recipe mutation; persisted like
    every `recipes` key, so it works offline). T11a feeds it into both strings; the subtitle renders
    only once the count is known (never "0 Rezepte" while loading, R's own rule for the search
    placeholder). The filtered list's `total` is NOT used (wrong whenever a filter is set). Catalog
    keys and values stay byte-identical (`recipe.recipes.list.groupSummary`,
    `recipe.recipes.list.sharedSummary`, `recipe.count.recipes`); no ADR needed. R's sidebar
    per-item counts stay out (§7, M4).
14. **Import query keys** (D9). R's `features/import/lib/queries.ts` keys (`["import", …]`) are not
    rooted at `"toon"`; T08 rewrites them: `importKeys = { all: (householdId) => ["toon",
    "household", householdId, "recipe", "import"], drafts: (householdId, status) => [...all,
    "drafts", status ?? "all"], tags: (householdId) => [...all, "tags"], draftRoot: ["toon",
    "recipe", "import-draft"], draft: (draftId) => ["toon", "recipe", "import-draft", draftId] }`.
    The draft key is user-scoped because `useDraft` resolves a draft across the user's households
    (`candidateHouseholdIds`). R's `invalidateQueries({ queryKey: importKeys.all })` (commit and
    delete) becomes two calls: `importKeys.all(variables.householdId)` and `importKeys.draftRoot` —
    the same set R's prefix reached. None of these segments (`import`, `import-draft`) is in the
    persist allow-list, so — as in R — no import data is persisted. The segment `import` is distinct
    from the core-lib `imports` segment of `queryKeys.importDrafts` (decision 8).
15. **The manifest's static import graph never reaches the shell.** `modules/index.ts` evaluates
    `WEB_MODULES = [recipeModule]`; anything statically imported by `modules/recipe/index.ts` that
    imports `@/modules` (the registry) or the shell (`AppShell`, `BottomTabBar`, `SideNav`,
    `ModuleSwitcher`, `use-nav-items`, the `@/components/layout` barrel) re-enters
    `modules/index.ts` while `recipe/index.ts` is still evaluating — a TDZ `ReferenceError` the
    moment a test imports the manifest before `@/modules`. Therefore: `route-roots.tsx` defines
    `rootRoute` (component `RootLayout` = `SessionProvider` + `Outlet`; `notFoundComponent:
    NotFoundPage`, which imports no layout), `appRoute` WITHOUT a component, and
    `householdScopedRoute` (`RequireActiveHousehold`); `AppLayout` (`RequireAuth` + `AppShell`)
    stays in `router.tsx`, which attaches it with `appRoute.update({ component: AppLayout })`
    before `createRouter` (router-core 1.171.28 `Route.update`, `route.d.ts:227`). `HomeCard.tsx`
    and `routes.tsx` import no `@/components/layout` path and no `@/modules` (the registry);
    every screen in `routes.tsx` is a `lazyRouteComponent(() => import(…))`, so screens (which do
    import `PhoneHeaderRow` from the layout barrel) stay out of the static graph. The manifest and
    persist tests import `./index` FIRST, without `@/modules`, which proves it.

## 2. Rewrite tables (R → H)

Every port task applies the rows that occur in its files, in code AND in comments. "Identifier"
rows are `\b`-anchored and never touch German strings, `server.group.*` keys or `{groupName}`
placeholders.

**A — identifiers** (M1's table plus M2's rows):

| R | H |
| --- | --- |
| `groupId`, `groupIds` (params, fields, DTO wire fields, `membership.groupId`) | `householdId`, `householdIds` |
| tables `groups`, `groupMembers`, `groupInvites` | `households`, `householdMembers`, `householdInvites` |
| `GroupRole`, `requireGroupRole` | `HouseholdRole`, `requireHouseholdRole` |
| `listsPerGroup` (`SHOPPING_LIMITS`) | `listsPerHousehold` |
| `assertRecipesInGroup`, `collectionNotInGroup`, `collectionsNotInGroup` | `assertRecipesInHousehold`, `collectionNotInHousehold`, `collectionsNotInHousehold` |
| web `useActiveGroup()` → `{ groupId, group, groups }`, `useRequiredGroupId`, `RequireActiveGroup`, `activeGroupId`, `storageKeys.activeGroupId` | `useActiveHousehold()` → `{ householdId, household, households }`, `useRequiredHouseholdId`, `RequireActiveHousehold`, `activeHouseholdId`, `storageKeys.activeHouseholdId` |
| web `queryKeys.group(`, `invalidate.group(` | `queryKeys.household(`, `invalidate.household(` |
| web `queryKeys.groups(`, `invalidate.groups(` (R `invalidateAfterRecipeMutation`) | `queryKeys.households(`, `invalidate.households(` (both exist in H `lib/queries.ts`) |
| web import feature: `useGroupTags`, `listGroupTags`, `candidateGroupIds`, `ResolvedDraft.groupId` | `useHouseholdTags`, `listHouseholdTags`, `candidateHouseholdIds`, `ResolvedDraft.householdId` |
| web `GroupSwitcher` (`@/features/groups/GroupSwitcher`) | `HouseholdSwitcher` (`@/core/features/households/HouseholdSwitcher`) |
| register body `groupName`; auth response `groups`, `activeGroupId`; POST `/api/groups` response `{ group }` | `householdName`; `households`, `activeHouseholdId`; `{ household }` |
| comments: "group" meaning the owning group | "household" (comments only; "group heading" = ingredient/step section, "version group" in `qr.ts`, `groupBy`, `grouped`, `optgroup`, `hgroup` stay) |

**B — API paths and relative imports** (api files moved from `src/services/<x>/` to
`src/modules/recipe/services/<x>/`, i.e. two levels deeper, and from `src/routes/` to
`src/modules/recipe/routes/`):

| R specifier (in a moved file) | H specifier |
| --- | --- |
| services depth 1 (`services/<x>/*.ts`): `"../../db/`, `"../../lib/`, `"../../env.ts"` | `"../../../../db/`, `"../../../../lib/`, `"../../../../env.ts"` |
| depth 1: `"../groups/<f>"`, `"../auth/<f>"`, `"../media/<f>"` | `"../../../../core/services/households/<f>"`, `"../../../../core/services/auth/<f>"`, `"../../../../core/services/media/<f>"` |
| services depth 2 (`services/import/{url,ocr,html}/*.ts`): `"../../../lib/`, `"../../../env.ts"`, `"../../media/<f>"` | `"../../../../../lib/`, `"../../../../../env.ts"`, `"../../../../../core/services/media/<f>"` |
| any specifier between two moved service files (`"./x.ts"`, `"../plan/…"`, `"../../ocr/…"`, `"../../html/…"`) | unchanged |
| routes: `"../db/`, `"../lib/`, `"../middleware/` | `"../../../db/`, `"../../../lib/`, `"../../../middleware/` |
| routes: `"../services/groups/validation.ts"`, `"../services/auth/rateLimit.ts"`, `"../services/recipes/uploads.ts"` | `"../../../core/services/households/validation.ts"`, `"../../../core/services/auth/rateLimit.ts"`, `"../../../core/services/media/uploads.ts"` |
| routes: `import { requireGroupRole, requireSession, requireVerifiedEmail } from "../services/groups/access.ts"` | import only what remains used after decision 3: `requireVerifiedEmail` from `"../../../middleware/verifiedEmail.ts"`, `requireHouseholdRole` from `"../../../middleware/household.ts"`, `requireSession` from `"../../../middleware/session.ts"` (cards only) |
| routes: `"../services/<recipes|import|ocr|plan|shopping|cards>/…"` | unchanged (now the module's own `services/`) |
| strings `/api/groups/${expr}/…`, `/api/groups/:groupId/…` (Location headers, comments — incl. the doc comment `GET /api/groups/:groupId/imports/:draftId/source` at R `services/import/files.ts:184`, T06) | `/api/households/${expr}/recipe/…`, `/api/households/:householdId/recipe/…` |
| `/api/cards` | `/api/recipe/cards` |
| tests: `"../src/services/<recipes|import|ocr|plan|shopping|cards>/` (and `"../../src/…"` in `test/import/`) | `"../src/modules/recipe/services/<same>/` |
| tests: `"../src/services/media/`, `"../src/services/groups/`, `"../src/services/auth/` | `"../src/core/services/media/`, `"../src/core/services/households/`, `"../src/core/services/auth/` |
| tests: `backfillFoldedColumns` from `"../src/db/migrate.ts"` | from `"../src/modules/recipe/migrate.ts"` |
| test URLs (ERE, in this order): `/api/groups/([^/"\`]+)/(recipes|tags|collections|imports|shopping-lists|plan)` | `/api/households/\1/recipe/\2` |
| then remaining `/api/groups` (create, detail, members, invites) | `/api/households` |
| `/api/cards` | `/api/recipe/cards` |

**C — SQL names** (schema, raw SQL, test `explain` strings and index assertions): table `x` →
`recipe_x` (`recipes` → `recipe_recipes`, `recipe_ingredients` → `recipe_recipe_ingredients`,
`shopping_lists` → `recipe_shopping_lists`, `groups` → `households`); column `group_id` →
`household_id`; index `n` → `recipe_` + `n` with `group` → `household`
(`meal_plan_entries_group_date_idx` → `recipe_meal_plan_entries_household_date_idx`,
`recipes_group_last_cooked_idx` → `recipe_recipes_household_last_cooked_idx`,
`recipe_ingredients_recipe_position_idx` → `recipe_recipe_ingredients_recipe_position_idx`).

**D — web file moves and import specifiers** (R `apps/web/src/features/<f>/P` →
`H/apps/web/src/modules/recipe/features/<f>/P`; applies to static and dynamic `import()`
specifiers, string literals AND comments — R's `recipes/index.ts:5` quotes one in a comment):

| R specifier | H specifier |
| --- | --- |
| `@/features/<f>/…` for f ∈ recipes, collections, tags, import, shopping, cards, plan | `@/modules/recipe/features/<f>/…` |
| `@/features/recipes/lib/nav` | `@/lib/nav` (core; R's `nav.tsx` is NOT copied) |
| relative imports of R's `nav.tsx`: `"./nav"` (`recipes/lib/url-filters.ts:19`, T04), `"../lib/nav"` (`recipes/components/{RecentlyCookedShelf,RecipeEditorialRow,RecipeForm,RecipeFilterRail}.tsx`, T07), `"./lib/nav"` (`recipes/{RecipeListPage,RecipeNewPage,RecipeEditPage,RecipeDetailPage}.tsx`, T11a; `recipes/index.ts`, T07 — see its brief) | `"@/lib/nav"` (same imported names; `useNavigationGuard` exists there too) |
| `recipes/RecipeDetailPage.tsx:90` `import { copyToClipboard, shareOrCopy, useCheckedSteps } from "./lib/hooks";` | two lines: `import { useCheckedSteps } from "./lib/hooks";` and `import { copyToClipboard, shareOrCopy } from "@/lib/share";` (T11a) |
| `"../lib/hooks"` / `"./lib/hooks"` importing anything else (`moveItem`, `useWakeLock`, `CheckedSteps`, …) | unchanged (the module's own `recipes/lib/hooks.ts`, minus only the share block) |
| `hasAtLeast` from `@/features/recipes/lib/permissions` | `@/lib/permissions` (`canModifyOwn` stays in the module's `features/recipes/lib/permissions.ts`) |
| `shareOrCopy`, `copyToClipboard`, `ShareResult` from `@/features/recipes/lib/hooks` | `@/lib/share` |
| `@/features/groups/lib/roleLabels`, `@/features/groups/GroupSwitcher` | `@/core/features/households/lib/roleLabels`, `@/core/features/households/HouseholdSwitcher` |
| `@/lib/api`, `@/lib/queries`, `@/lib/format` (in a ported recipe file) | `@/modules/recipe/lib/api`, `@/modules/recipe/lib/queries`, `@/modules/recipe/lib/format` |
| every other `@/lib/…`, `@/components/…` | unchanged |
| API strings `` `/api/groups/${groupId}/`` and R `importApi.ts`'s `groupBase(groupId)` = `` `/api/groups/${encodeURIComponent(groupId)}` `` | `` `/api/households/${householdId}/recipe/`` and `householdBase(householdId)` = `` `/api/households/${encodeURIComponent(householdId)}/recipe` `` |
| `"/api/cards"`, `` `/api/cards/`` | `"/api/recipe/cards"`, `` `/api/recipe/cards/`` |

**E — catalog keys** (every string or template literal that STARTS with the old prefix, in source
and tests, `"…"`, `'…'` or `` `…` ``): `recipes.` → `recipe.recipes.`; `shopping.` →
`recipe.shopping.`; `plan.` → `recipe.plan.`; `import.` → `recipe.import.`; `cards.` →
`recipe.cards.`; `groups.collections.` → `recipe.collections.`; `groups.collectionDetail.` →
`recipe.collectionDetail.`; `groups.tags.` → `recipe.tags.`; `groups.tagCombobox.` →
`recipe.tagCombobox.`; `groups.count.recipes` → `recipe.count.recipes`; `groups.common.` →
`household.common.`; `groups.count.members` → `household.count.members`; `ui.` → `common.`. Values
never change. `tsc` is the safety net (`MessageKey` is a literal union): a key that does not exist
fails the build.

**F — query and mutation keys**: `["toon", "group", <id>, <seg>, …]` →
`["toon", "household", <id>, "recipe", <seg>, …]`; `["toon", "shopping", …]` →
`["toon", "recipe", "shopping", …]`; `["toon", "recipes", "disabled"]` →
`["toon", "recipe", "recipes", "disabled"]`; `["toon", "cards"]` → `["toon", "recipe", "cards"]`;
the import feature's own `importKeys` (`["import", …]`) per decision 14 (T08).

**G — link targets** (`to=`, `to:`, `navigate({ to })`, `redirect({ to })` in recipe files only):
`"/"` → `"/recipe"`; `"/recipes/…"` → `"/recipe/recipes/…"`; `"/plan"` → `"/recipe/plan"`;
`"/shopping…"` → `"/recipe/shopping…"`; `"/import…"` → `"/recipe/import…"`;
`"/collections…"` → `"/recipe/collections…"`; `"/tags"` → `"/recipe/tags"`; `"/search"` →
`"/recipe/search"`; `"/groups"` → `"/households"`; `"/groups/$groupId"` + `params={{ groupId }}`
→ `"/households/$householdId"` + `params={{ householdId }}`; `/settings`, `/login`, `/register`
unchanged. The same rows apply to `go("…")` / `` go(`…`) `` in `import/lib/navigation.ts`
(`"/import"` → `"/recipe/import"`, `` `/import/${…}` `` → `` `/recipe/import/${…}` ``,
`` `/recipes/${…}` `` → `` `/recipe/recipes/${…}` ``, its doc comment's path list likewise) and to
the route argument `useUrlRecipeFilters("/")` (`RecipeListPage.tsx:60`) → `useUrlRecipeFilters(
"/recipe")` (its doc comment in `url-filters.ts:80`, `("/")` → `("/recipe")`). R has 46 such
targets across 21 feature files; `tsc` checks none of them (decision 10), the `LINKS` grep of §3
does.

## 3. Task list and waves

List order is the structured-output order; the orchestrator takes up to three ready tasks per wave
in that order. Waves shown for `maxParallel = 3`; deps are what is binding.

| Wave | Task | Tier | Title | Deps |
| --- | --- | --- | --- | --- |
| 1 | M2-T01 | port | Shared recipe module (src + tests) | — |
| 1 | M2-T02 | port | Web recipe catalogs + SW rules | — |
| 2 | M2-T03 | core | API foundation: schema, migration, manifest, contract hooks, uploads:gc, deps | T01 |
| 2 | M2-T04 | port | Web data layer: lib shims, recipes/tags/collections/plan/shopping lib, recipe count | T01, T02 |
| 3 | M2-T05 | port | API recipes, tags, collections, cook log, plan, cards + seed | T03 |
| 3 | M2-T06 | port | API import pipeline + OCR services + unit tests + fixtures | T03 |
| 3 | M2-T07 | port | Web recipe components, collections screens, AddRecipeToListDialog | T04 |
| 4 | M2-T08 | port | Web import feature (incl. import query keys) | T04 |
| 4 | M2-T09a | build | API import draft/commit services + routes, import route tests on real sessions, OCR shutdown hook | T05, T06 |
| 4 | M2-T09b | port | API shopping services + routes + shopping tests | T05 |
| 5 | M2-T11a | port | Web plan screens + recipe pages + print.css | T07 |
| 5 | M2-T10 | port | Web cards + shopping screens | T07, T03 |
| 5 | M2-T09c | build | Restored M1/T05 placeholders + cross-household sweep test | T09a, T09b |
| 6 | M2-T11b | core | Web wiring: route roots, module route tree, manifest, home card, persist + manifest tests | T08, T10, T11a |
| 7 | M2-T12 | build | Integration: gates, curl, headless, CLAUDE.md, SPEC §2/§3 sync | all |

Tier note: T09b is a port (services and routes copied with Tables A–C, tests ported unchanged in
substance); T09a stays build because its two route tests are rewritten onto real sessions; T09c is
new test code. T11a is mechanical (Tables A, D, E, F, G plus the decision-13 snippet); T11b defines
the module route contract and stays core.

File ownership is disjoint inside every wave. Shared files and their single owner:
`packages/shared/src/index.ts`, `packages/shared/src/core/schemas/common.ts` — T01;
`apps/web/src/modules/catalogs.ts`, `apps/web/src/lib/i18n/i18n.test.ts`, `apps/web/vite.config.ts`
— T02; every `package.json`, `bun.lock`, `apps/api/src/{index.ts,db/schema.ts,db/migrate.ts,
modules/index.ts,modules/types.ts}`, `apps/api/scripts/{seed,uploads-gc}.ts`, `apps/api/drizzle/**`,
`apps/api/test/smoke.test.ts` — T03; `apps/api/src/modules/recipe/index.ts` — created by T03, edited
by T05 (wave 3, `seedDemo`) and T09a (wave 4, `shutdown`), serial through deps (T09b never touches
it); the five route stubs `apps/api/src/modules/recipe/routes/{recipes,plan,cards}.ts` — replaced by
T05, `imports.ts` — replaced by T09a, `shopping.ts` — replaced by T09b; T05's test files holding a
`// M2-T09c:` placeholder — restored by T09c only; `apps/api/test/{uploads,verified-email-gate,
households}.test.ts` — T09c; `scripts/i18n-check.ts` — T05 (ALLOW_LIST row), later T11b (only if
new German); `.github/workflows/ci.yml` — T06; `apps/web/src/modules/recipe/features/recipes/lib/
queries.ts` (incl. `useHouseholdRecipeCount`) — T04; `apps/web/src/{router.tsx,route-roots.tsx,
modules/index.ts,modules/types.ts}`, the test fakes in `components/layout/*.test.ts` and
`modules/*.test.ts(x)` — T11b; `CLAUDE.md`, `docs/SPEC.md`, this plan — T12.

**`LINKS` — the unprefixed-link-target check** (decision 10, Table G), run by T04, T07, T08, T10,
T11a, T11b and T12 over `apps/web/src/modules/recipe` (it finds R's 46 targets plus the
`useUrlRecipeFilters("/")` argument in R's tree, and nothing in a correctly rewritten one):

```sh
cd /home/erics/software/toon-household && ! grep -rnE "(\bto[=:] ?|\bgo\(|\bgoTo\()[\"'\`]/(recipes|plan|shopping|import|collections|tags|search|groups)\b|\bto[=:] ?[\"']/[\"']|useUrlRecipeFilters\([\"']/[\"']\)" apps/web/src/modules/recipe
```

Every brief also implies: read `H/docs/SPEC.md` §1–§5, `H/CLAUDE.md` (Conventions, Gotchas in use),
this plan §1–§2, and the source files named. Copy with `cp` from R, then edit; a German string, a
comment and the code shape stay as they are unless a rewrite row says otherwise. Commit with a body
naming the SPEC decision and the R files served, ending with the workflow's `Co-Authored-By` line;
no pushes. A ported test that needs code of a later task is removed with ONE comment naming the
returning task (`// M2-T09c: … returns with the shopping routes.`), never skipped; the later task
restores it. `apps/api/tsconfig.json` includes `test/**` only: never create `apps/api/tests/`.

## 4. Tasks

### M2-T01 — Shared recipe module (port)

**Goal.** R's pure recipe logic and wire contract under `packages/shared/src/modules/recipe/`,
re-exported from the package entry, with every R shared test file that covers it.

**Read.** SPEC D10, D13, §3; R/CLAUDE.md gotchas "INTERFACE LANGUAGE AND CONTENT LANGUAGE ARE TWO
DIFFERENT AXES" (units/ingredients/numbers/duration are content), "`parseDuration` /
`parseServings` return the UPPER bound", "THE BARCODE ENCODERS ARE HAND-ROLLED…",
"`normalizeBarcodeValue` is forgiving…", "The card form's `format` and `value` are one field",
"`shoppingItemKey`'s separator is U+001F", "`foldText`/`FOLD_PAIRS` live in `@toon/shared`".
Sources: `R/packages/shared/src/{units,ingredients,numbers,duration,tags,shopping,barcode,qr}.ts`,
`R/packages/shared/src/schemas/{recipe,plan,import,shopping,card}.ts`, `R/packages/shared/src/
index.ts`, `R/packages/shared/test/{barcode,cards,duration,ingredients,numbers,qr,schemas,shopping,
tags,units,i18n}.test.ts`; `H/packages/shared/src/{index.ts,core/index.ts}`,
`H/packages/shared/test/{i18n,core}.test.ts`.

**Copies.** `R/packages/shared/src/<f>.ts` → `H/packages/shared/src/modules/recipe/<f>.ts` for f ∈
units, ingredients, numbers, duration, tags, shopping, barcode, qr; `R/…/src/schemas/<s>.ts` →
`H/…/src/modules/recipe/schemas/<s>.ts` for s ∈ recipe, plan, import, shopping, card;
`R/packages/shared/test/<t>.test.ts` → `H/packages/shared/test/<t>.test.ts` for t ∈ barcode, cards,
duration, ingredients, numbers, qr, shopping, tags, units; R's `schemas.test.ts` →
`H/packages/shared/test/recipe-schemas.test.ts` (see rewrite 5).

**Rewrites.**
1. In `modules/recipe/*.ts`: `"./i18n/` → `"../../core/i18n/`; `"./text.ts"` →
   `"../../core/text.ts"`; `"./calendar.ts"` → `"../../core/calendar.ts"`; `"./schemas/common.ts"` →
   `"../../core/schemas/common.ts"`; other specifiers (`./numbers.ts`, `./units.ts`,
   `./schemas/recipe.ts`, `./schemas/import.ts`) unchanged.
2. In `modules/recipe/schemas/*.ts`: `"../i18n/` → `"../../../core/i18n/`; `"./common.ts"` →
   `"../../../core/schemas/common.ts"`; `"./user.ts"` → `"../../../core/schemas/user.ts"`;
   `"../calendar.ts"` → `"../../../core/calendar.ts"`; `"../barcode.ts"` and `"./recipe.ts"`
   unchanged.
3. Table A: the six wire fields `groupId: IdSchema` (`schemas/plan.ts:48`, `schemas/shopping.ts:55`,
   `schemas/recipe.ts:64,78,92`, `schemas/import.ts:91`) → `householdId: IdSchema`;
   `SHOPPING_LIMITS.listsPerGroup` → `listsPerHousehold`; comments per Table A (the "group heading"
   comments in `schemas/recipe.ts:19,38` and `qr.ts`'s "version group" stay).
   `H/packages/shared/src/core/schemas/common.ts:55` (M1's port of R's error-code list) still names
   the old limit in a doc comment; change exactly that line to
   `/** The household already has `SHOPPING_LIMITS.listsPerHousehold` lists. */` — nothing else in
   that file changes (the `group_name_taken` code and line 24's comment stay).
4. New `modules/recipe/index.ts`: the export lines of R's `src/index.ts` for the 13 moved files,
   paths relative to the new barrel (`export * from "./schemas/recipe.ts";` … `export * from
   "./qr.ts";`), in R's order. `H/packages/shared/src/index.ts` gains exactly one line after the
   registry export: `export * from "./modules/recipe/index.ts";`.
5. Tests: `"../src/<f>.ts"` → `"../src/modules/recipe/<f>.ts"` for the moved files;
   `"../src/schemas/<s>.ts"` → `"../src/modules/recipe/schemas/<s>.ts"`; `"../src/i18n/` →
   `"../src/core/i18n/`; `"../src/text.ts"` → `"../src/core/text.ts"`; `"../src/index.ts"`
   unchanged; Table A in fixtures (`groupId:` → `householdId:`, `GroupRole` → `HouseholdRole`).
   `recipe-schemas.test.ts` = R's `schemas.test.ts` WITHOUT its `ApiErrorSchema` and
   `RegisterRequestSchema` describes (already in `core.test.ts`) and without unused imports of
   them; its header comment says "Ported from toon-recipe packages/shared/test/schemas.test.ts (the
   recipe cases; the core cases live in core.test.ts)". `core.test.ts:93`'s comment changes to
   "…the recipe cases of that file live in recipe-schemas.test.ts".
6. `H/packages/shared/test/i18n.test.ts`: replace the two placeholder comment lines at 137–138 with
   R's `describe("formatDuration — locale-aware, byte-identical German default", …)` block (R
   `packages/shared/test/i18n.test.ts` lines 137–end of that describe) with
   `import("../src/duration.ts")` → `import("../src/modules/recipe/duration.ts")`.

**Files.** `packages/shared/src/modules/recipe/{units,ingredients,numbers,duration,tags,shopping,
barcode,qr,index}.ts`, `packages/shared/src/modules/recipe/schemas/{recipe,plan,import,shopping,
card}.ts`, `packages/shared/src/index.ts`, `packages/shared/src/core/schemas/common.ts` (one comment line),
`packages/shared/test/{barcode,cards,duration,
ingredients,numbers,qr,shopping,tags,units,recipe-schemas,i18n,core}.test.ts`.

**Acceptance.** All 13 sources and 10 test files exist at the target paths; `bun test
packages/shared` passes with every R test case present (R's counts: compare `grep -c "test("`
per file); `diff` of each moved source against R shows only import-path lines and Table A rows;
`@toon/shared` exports `formatDuration`, `encodeQr`, `RecipeSchema`, `SHOPPING_LIMITS` (used by
the tests); no `groupId` token and no `listsPerGroup` in `packages/shared/src` (the
`server.group.groupIdMissing` catalog key does not match `\bgroupId\b`).

**Verify.** `cd H && bun run typecheck`; `cd H && bun test packages/shared`; `cd H && bun test`;
`cd H && ! grep -rnE '\bgroupId\b|listsPerGroup' packages/shared/src`;
`cd H && test "$(grep -c 'test(' packages/shared/test/units.test.ts)" -eq "$(grep -c 'test(' /home/erics/software/toon-recipe/packages/shared/test/units.test.ts)"`.

---

### M2-T02 — Web recipe catalogs + SW rules (port)

**Goal.** Every web string of the recipe features as the module's `recipe.*` catalogs (values
byte-identical), registered literal-typed through `modules/catalogs.ts`; the recipe service-worker
rules.

**Read.** SPEC D9, D10; R/CLAUDE.md gotchas "The i18n layer is hand-rolled and its typing is the
enforcement", "German copy is a REFACTOR", "THE SERVICE WORKER…" (`NetworkOnly` order),
"`/api/groups/:groupId/shopping-lists` is `NetworkOnly`", "THE BARCODE ENCODERS…" (wasm not
precached); R/docs/i18n.md §1, §9; `H/CLAUDE.md` gotchas "`MessageKey` must stay a literal union",
"Service worker". Sources: `R/apps/web/src/lib/i18n/catalogs/{recipes,shopping,plan,import,cards,
groups}.{de,en}.ts`, `R/apps/web/vite.config.ts` lines 43–96; `H/apps/web/src/modules/catalogs.ts`,
`H/apps/web/src/lib/i18n/catalogs/{index,household.de}.ts`, `H/apps/web/src/lib/i18n/
i18n.test.ts`, `H/apps/web/vite.config.ts`.

**Copies.** `R/…/catalogs/<ns>.<loc>.ts` → `H/apps/web/src/modules/recipe/catalogs/<ns>.<loc>.ts`
for ns ∈ recipes, shopping, plan, import, cards and loc ∈ de, en. New
`H/apps/web/src/modules/recipe/catalogs/organise.{de,en}.ts` = R `groups.<loc>.ts`'s lines (with
their comments) whose key starts with `groups.collections.`, `groups.collectionDetail.`,
`groups.tags.`, `groups.tagCombobox.`, plus the `groups.count.recipes` line; header comment
"German/English — the recipe module's collection and tag strings (R `groups.*`, keys renamed per
SPEC D10)", export names `organiseDe` / `organiseEn`, type `OrganiseCatalog`.

**Rewrites.**
1. Table E on every key (and on key names quoted in comments). Values, comments and order
   untouched.
2. `as const satisfies NamespaceCatalog<"recipes">` (and `"shopping"`, `"plan"`, `"import"`,
   `"cards"`, `"groups"`) → `as const satisfies NamespaceCatalog<"recipe">`. Export and type names
   (`recipesDe`, `RecipesCatalog`, `importEn`, …) and each en file's
   `LocaleCatalog<…Catalog>` annotation stay as they are.
3. New `modules/recipe/catalogs/index.ts`:
   `export const recipeDe = { ...recipesDe, ...shoppingDe, ...planDe, ...importDe, ...cardsDe,
   ...organiseDe } as const;` and `recipeEn` likewise from the six en exports — NO type annotation
   on either (the literal-union rule).
4. `H/apps/web/src/modules/catalogs.ts`: `import { recipeDe, recipeEn } from
   "./recipe/catalogs/index.ts";` and `MODULE_CATALOGS_DE = { ...recipeDe } as const;`,
   `MODULE_CATALOGS_EN = { ...recipeEn } as const;` (header comment: M2 registered recipe).
5. `i18n.test.ts`: the `prefixes` array of "every namespace's keys are prefixed…" gains
   `"recipe."`; add one test that `MODULE_CATALOGS_DE` has exactly the same key set as
   `MODULE_CATALOGS_EN`.
6. `vite.config.ts`: replace the placeholder comment ("Module rules (recipe in M2…) …") with R's
   five rules (R lines 43–96, comments kept) in R's order, regexes rewritten:
   `/\/api\/groups\/[^/]+\/imports/` → `/\/api\/households\/[^/]+\/recipe\/imports/`;
   `…\/shopping-lists/` → `/\/api\/households\/[^/]+\/recipe\/shopping-lists/`; `…\/plan/` →
   `/\/api\/households\/[^/]+\/recipe\/plan/`; `/\/api\/cards/` → `/\/api\/recipe\/cards/`;
   `/\/api\/groups\/[^/]+\/(recipes|tags|collections)/` →
   `/\/api\/households\/[^/]+\/recipe\/(recipes|tags|collections)/` (NetworkFirst,
   `cacheName: "toon-api-recipes"` unchanged). The four NetworkOnly rules must stay before the
   NetworkFirst one; the `/api/auth/` rule stays first. Comment text: `/api/groups/…` →
   `/api/households/…/recipe/…`, `/api/cards` → `/api/recipe/cards`. Keep the paragraph that says
   module rules are NetworkOnly-before-NetworkFirst.

**Files.** `apps/web/src/modules/recipe/catalogs/{recipes,shopping,plan,import,cards,organise}.
{de,en}.ts`, `apps/web/src/modules/recipe/catalogs/index.ts`, `apps/web/src/modules/catalogs.ts`,
`apps/web/src/lib/i18n/i18n.test.ts`, `apps/web/vite.config.ts`.

**Acceptance.** The recipe key count equals R's (verify 4); the parity half of `i18n:check` is OK
(verify 5); every de/en pair typechecks (`LocaleCatalog`); `MessageKey` stays a literal union (the
existing `@ts-expect-error` test still compiles); the built `sw.js` contains
`recipe\/shopping-lists` and the NetworkOnly rules precede the `toon-api-recipes` rule.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/lib/i18n`;
`cd H && bun run build`;
`cd H && test "$(cat apps/web/src/modules/recipe/catalogs/recipes.de.ts apps/web/src/modules/recipe/catalogs/shopping.de.ts apps/web/src/modules/recipe/catalogs/plan.de.ts apps/web/src/modules/recipe/catalogs/import.de.ts apps/web/src/modules/recipe/catalogs/cards.de.ts apps/web/src/modules/recipe/catalogs/organise.de.ts | grep -cE '^\s*"recipe\.')" -eq "$(( $(cat /home/erics/software/toon-recipe/apps/web/src/lib/i18n/catalogs/recipes.de.ts /home/erics/software/toon-recipe/apps/web/src/lib/i18n/catalogs/shopping.de.ts /home/erics/software/toon-recipe/apps/web/src/lib/i18n/catalogs/plan.de.ts /home/erics/software/toon-recipe/apps/web/src/lib/i18n/catalogs/import.de.ts /home/erics/software/toon-recipe/apps/web/src/lib/i18n/catalogs/cards.de.ts | grep -cE '^\s*"(recipes|shopping|plan|import|cards)\.') + $(grep -cE '^\s*"groups\.(collections|collectionDetail|tags|tagCombobox)\.|^\s*"groups\.count\.recipes"' /home/erics/software/toon-recipe/apps/web/src/lib/i18n/catalogs/groups.de.ts) ))"`;
`cd H && mkdir -p data && { bun run i18n:check > data/m2-t02-i18n.log 2>&1; true; } && sed -n '/1\/2 German catalog parity/{n;p;}' data/m2-t02-i18n.log | grep -qx '\[i18n:check\] OK'`;
`cd H && grep -q 'recipe\\/shopping-lists' apps/web/vite.config.ts`.

---

### M2-T03 — API foundation (core)

**Goal.** The recipe module exists on the API side: prefixed schema, generated migration, the
manifest registered in `API_MODULES` with stub routers, the `ApiModule` hooks of decision 4 wired
into `runMigrations`, `seed`, `uploads:gc` and the shutdown handler, the fold backfill, the OCR/PDF
capability flags in `/api/health`, and both new dependencies.

**Read.** SPEC D2, D7, D8, D13, §2, §4; this plan §1 decisions 2–5, 11; R/CLAUDE.md gotchas "Recipe
search reads PRE-FOLDED columns" (all four points + `last_cooked_at`), "`FOLD_PAIRS` CANNOT BE
COMPLETED", "`bun:sqlite` IS A NEWER SQLite", "libSQL 0.17.4 discarded a `file::memory:` DB",
"PHOTO AND PDF IMPORT ARE TWO FEATURE FLAGS", "A LIST never renders `imageUrl`" (thumbnails, GC
point 4), locked decisions 1, 7, 11; `H/CLAUDE.md` gotchas "Migrations are generated",
"`file::memory:` is per client", "Middleware chain order", "A `household_modules` row is the enabled
state" (`API_MODULES` read inside functions only). Sources: `R/apps/api/src/db/schema.ts` lines
238–935 (recipes → cards) and 937–1065 (relations), `R/apps/api/drizzle/0003_folded_search_columns.
sql`, `R/apps/api/src/db/migrate.ts` (`backfillFoldedColumns`), `R/apps/api/src/services/import/
capabilities.ts`, `R/apps/api/src/index.ts` (shutdown block), `R/apps/api/scripts/uploads-gc.ts`;
`H/apps/api/src/{index.ts,db/schema.ts,db/schema/core.ts,db/migrate.ts,modules/*.ts}`,
`H/apps/api/scripts/{migrate,seed}.ts`, `H/apps/api/drizzle/**`, `H/apps/api/test/{smoke,modules,
middleware}.test.ts`.

**Work.**
1. `apps/api/src/modules/recipe/schema.ts`: R's table definitions `recipes` … `cards` with
   decision 2 / Table C: SQL names `recipe_recipes`, `recipe_recipe_ingredients`,
   `recipe_recipe_steps`, `recipe_tags`, `recipe_recipe_tags`, `recipe_collections`,
   `recipe_collection_recipes`, `recipe_meal_plan_entries`, `recipe_recipe_cook_log`,
   `recipe_import_drafts`, `recipe_shopping_lists`, `recipe_shopping_list_items`,
   `recipe_shopping_list_catalog`, `recipe_shopping_bought_items`, `recipe_shopping_list_recipes`,
   `recipe_shopping_mutations`, `recipe_cards` (17, SPEC §4's list; R's schema defines exactly
   these between those lines); `group_id` →
   `household_id` referencing `households.id` (import `households`, `users` from
   `../../db/schema/core.ts`, never from `db/schema.ts` — no cycle); index names per Table C; TS
   identifiers and every column comment kept (comments: "group" → "household" per Table A). The
   recipe relations (`recipesRelations` … `shoppingListRecipesRelations`, `cardsRelations`) with
   `group: one(groups…)` → `household: one(households…)`; no `usersRelations`/`householdsRelations`
   here. Export `recipeTables` = an object of the table constants (the manifest's `schema`).
2. `db/schema.ts`: `export * from "../modules/recipe/schema.ts";` after the core line; header
   comment updated. `bunx drizzle-kit generate --name recipe` (in `apps/api`) →
   `drizzle/0001_recipe.sql` + `meta/0001_snapshot.json` + journal; never hand-edited. Check the
   DDL through `@libsql/client` (the test below), not `bun:sqlite`.
3. `modules/recipe/migrate.ts`: R's `backfillFoldedColumns` verbatim (its doc comment adapted:
   "runs as the recipe module's `afterMigrate`"), imports from `../../db/{client,schema}.ts`.
4. `modules/types.ts`: the four optional hooks of decision 4 with doc comments; `db/migrate.ts`:
   after `migrate()`, `for (const module of API_MODULES) await module.afterMigrate?.(database);`
   (import inside the file, read inside the function; header comment updated).
5. `modules/recipe/services/import/capabilities.ts`: port of R's file (Table B; the `../auth/
   verifiedEmail.ts` import → `../../../../core/services/auth/verifiedEmail.ts`).
6. `modules/recipe/routes/{recipes,imports,shopping,plan,cards}.ts`: STUBS, each exactly
   `export const <name>Routes = new Hono<AppEnv>();` (`recipeRoutes`, `importRoutes`,
   `shoppingRoutes`, `planRoutes`, `cardRoutes`) with a one-line comment naming the task that
   replaces it (T05: recipes, plan, cards; T09a: imports; T09b: shopping). `routes/index.ts` composes the
   two routers of decision 3.
7. `modules/recipe/index.ts`: `export const recipeModule: ApiModule = { id: "recipe",
   householdRouter: recipeHouseholdRouter, userRouter: recipeUserRouter, schema: recipeTables,
   healthFeatures: () => ({ ocrImport: isOcrImportEnabled(), pdfImport: isPdfImportEnabled() }),
   afterMigrate: backfillFoldedColumns (wrapped to return void), uploadReferences }` where
   `uploadReferences(db)` returns every `recipes.imageUrl`, `collections.coverImageUrl`,
   `importDrafts.sourceMeta?.storedPath`, `importDrafts.parsed?.imageUrl` (R uploads-gc's recipe
   half). `modules/index.ts`: `API_MODULES = [recipeModule]`.
8. `core/services/media/references.ts`: `collectUploadReferences(db, modules = API_MODULES):
   Promise<Set<string>>` — the bare filenames referenced by `users.avatarUrl`,
   `households.imageUrl` and every module's `uploadReferences` (R's `filenameOf` /
   `normalizeStoredUploadUrl` logic). `apps/api/scripts/uploads-gc.ts`: R's script with the
   collect block replaced by `collectUploadReferences(db)` and `originalOfThumbnail` from
   `../src/core/services/media/thumbnails.ts`; English output unchanged.
9. `scripts/seed.ts`: replace the `M2:` comment with `for (const module of API_MODULES) await
   module.seedDemo?.(db, { householdId, userId });` (import `API_MODULES`). `index.ts`: R's shutdown
   block (registered once, guarded, never under test) calling `await module.shutdown?.()` for every
   module; log lines in English ("[api] SIGTERM — stopping modules …").
10. `bun add unpdf@^1.8.1` in `apps/api`, `bun add zxing-wasm@^3.1.3` in `apps/web`; scripts
    `"uploads:gc": "bun scripts/uploads-gc.ts"` (api) and `"uploads:gc": "bun --filter @toon/api
    uploads:gc --"` (root). Long installs to the background with a log ending `exit=$?`.
11. Tests: `smoke.test.ts` expects `modules: ["recipe"]` and `features.ocrImport === false`,
    `features.pdfImport === false` (the comment at line 67 updated). New
    `apps/api/test/recipe-module.test.ts`: (a) after `runMigrations(db)` `sqlite_master` (through
    the libSQL `client`) lists the 17 `recipe_*` tables and no unprefixed `recipes`/`tags`/`cards`;
    (b) the indexes `recipe_recipes_household_title_fold_idx` and
    `recipe_recipes_household_last_cooked_idx` exist; (c) a recipe inserted with `titleFold: ""` is
    folded by a second `runMigrations(db)` (the hook runs) and a third run changes nothing;
    (d) deleting a household removes its `recipe_recipes` rows (cascade); (e)
    `collectUploadReferences` returns the avatar, household image, recipe image, collection cover,
    draft scan and draft parsed image filenames (bare, signed and absolute forms all reduce);
    (f) `recipeModule.healthFeatures()` follows `setOcrImportEnabled`/`setPdfImportEnabled` (reset in
    `afterAll`).

**Files.** `apps/api/src/modules/recipe/{index,schema,migrate}.ts`,
`apps/api/src/modules/recipe/routes/{index,recipes,imports,shopping,plan,cards}.ts`,
`apps/api/src/modules/recipe/services/import/capabilities.ts`,
`apps/api/src/modules/{index,types}.ts`, `apps/api/src/db/{schema,migrate}.ts`,
`apps/api/src/index.ts`, `apps/api/src/core/services/media/references.ts`,
`apps/api/scripts/{seed,uploads-gc}.ts`, `apps/api/drizzle/0001_recipe.sql`,
`apps/api/drizzle/meta/{0001_snapshot.json,_journal.json}`, `apps/api/package.json`,
`apps/web/package.json`, `package.json`, `bun.lock`, `apps/api/test/{smoke,recipe-module}.test.ts`.

**Acceptance.** `/api/health` reports `modules: ["recipe"]` and both OCR flags; `db:generate`
finds no drift; a fresh `file:` DB migrates and seeds; `uploads:gc --dry-run` runs; the core
reaches the module only through `modules/index.ts` (`grep` finds no `modules/recipe` import in
`src/core` or `src/db` other than `db/schema.ts`'s re-export); existing tests stay green.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/recipe-module.test.ts apps/api/test/smoke.test.ts apps/api/test/middleware.test.ts apps/api/test/modules.test.ts`;
`cd H && bun test`;
`cd H/apps/api && bunx drizzle-kit generate --name m2_drift_check 2>&1 | grep -q 'No schema changes'`;
`cd H && rm -f data/m2-t03.db* && DATABASE_URL=file:$PWD/data/m2-t03.db bun run db:migrate`;
`cd H && DATABASE_URL=file:$PWD/data/m2-t03.db SESSION_SECRET=0123456789abcdef0123456789abcdef bun run seed`;
`cd H && DATABASE_URL=file:$PWD/data/m2-t03.db SESSION_SECRET=0123456789abcdef0123456789abcdef bun run uploads:gc -- --dry-run`;
`cd H && grep -q 'CREATE TABLE `recipe_recipes`' apps/api/drizzle/0001_recipe.sql`;
`cd H && ! grep -rn 'modules/recipe' apps/api/src/core apps/api/src/db/migrate.ts apps/api/src/db/client.ts`.

---

### M2-T04 — Web data layer (port)

**Goal.** The recipe module's data layer on the web: the three lib shims (decision 9), the `lib/`
of the recipes feature, the tags feature, and the `lib/` of collections, plan and shopping (incl.
the offline outbox and its test) — everything the screens of T07, T08, T10, T11a import.

**Read.** SPEC D9; this plan decisions 8, 9 and Tables A, D, E, F; R/CLAUDE.md "Architecture"
(data flow), gotchas "THE SHOPPING LIST IS THE ONE THING EDITABLE OFFLINE" (all four pieces),
"`useCanMutate()` must NOT be used on the shopping screens", "Recipe list/search filters live in
the URL", "A SAVED CARD IS READ OFFLINE AND WRITTEN ONLINE", "The persisted offline cache is
namespaced per user id"; `H/CLAUDE.md` "Persist policy comes from the manifests". Sources:
`R/apps/web/src/lib/api.ts` (lines 1–98 imports, 699–1496 recipe sections),
`R/apps/web/src/lib/queries.ts` (lines 1–180 keys, 261–501), `R/apps/web/src/lib/format.ts`
(lines 183–201), `R/apps/web/src/features/recipes/lib/{format,formState,hooks,permissions,queries,
url-filters,difficultyLabels}.ts`, `R/apps/web/src/features/tags/**`,
`R/apps/web/src/features/collections/lib/queries.ts`, `R/apps/web/src/features/plan/lib/queries.ts`,
`R/apps/web/src/features/shopping/lib/{queries,offline,offline.test,parse,useLongPress}.ts`;
`H/apps/web/src/lib/{api,queries,format,share,permissions,nav}.ts(x)`.

**Copies and rewrites.**
1. `modules/recipe/lib/api.ts`: header comment ("The recipe module's API functions — R
   `lib/api.ts` §recipes…§saved cards; the ONLY fetch is still `request` in `@/lib/api`");
   `export * from "@/lib/api";`; `import { request, queryString, fileForm, assertUploadSize, type
   RequestOptions } from "@/lib/api";` (only what the copied lines use); the `@toon/shared` type
   imports the copied lines need (subset of R lines 14–96); then R lines 699–1496 verbatim with
   Table A, Table D's API-string rows. The `api` facade (R 1497+) is NOT copied (no feature uses
   it).
2. `modules/recipe/lib/queries.ts`: header comment with the key layout of decision 8;
   `export * from "@/lib/queries";`; `import { queryKeys as coreQueryKeys, invalidate as
   coreInvalidate, STALE_TIME, filterKey, shouldRetry, retryDelay } from "@/lib/queries";` (as
   used); `export const queryKeys = { ...coreQueryKeys, <R lines 105–178: recipes … catalogPage> }
   as const;` with every key tuple rewritten per Table F (`[ROOT, "group", groupId, "recipes", …]`
   → `[ROOT, "household", householdId, "recipe", "recipes", …]`, `cards: () => [ROOT, "recipe",
   "cards"] as const`); R's recipe `queryOptions` (R 261–420: `recipesQuery` … `catalogPageQuery`,
   none of the core ones); `export const invalidate = { ...coreInvalidate, <R 435–461 recipe
   entries> };`; `invalidateAfterRecipeMutation`, `invalidateAfterPlanMutation` (R 465–501, doc
   comments included). Fetchers from `./api`. In `invalidateAfterRecipeMutation` apply Table A's
   row `invalidate.groups(qc)` → `invalidate.households(qc)` (the core's `invalidate.households`;
   there is no `.groups` in H, so a literal port fails `tsc`), keep `invalidate.me(qc)`, and
   replace the doc comment's second paragraph ("`invalidate.me` is in this `Promise.all` because
   the sidebar and the group switcher read `recipeCount` off `["toon","me"]`…") with: "The
   household recipe count is the unfiltered `recipes` page of `useHouseholdRecipeCount` (plan
   decision 13), refreshed by `invalidate.recipes`; `households` and `me` stay in this
   `Promise.all` as in toon-recipe (ADR 0001 took `recipeCount` off them)." 
3. `modules/recipe/lib/format.ts`: `export * from "@/lib/format";` + R's `formatMinutes` and
   `formatServingsLabel` with Table E (`"ui.common.dash"` → `"common.common.dash"`,
   `"ui.servings.defaultUnit"` → `"common.servings.defaultUnit"`) and their imports
   (`formatDuration`, `formatServings`, `type Servings` from `@toon/shared`; `translate`,
   `getLocale` from where H's `lib/format.ts` imports them).
4. Feature files, R `features/<f>/P` → `H/apps/web/src/modules/recipe/features/<f>/P`:
   `recipes/lib/{format,formState,hooks,permissions,queries,url-filters,difficultyLabels}.ts`
   (NOT `nav.tsx`); `tags/{TagsPage.tsx,index.ts,components/TagChip.tsx,components/
   TagCombobox.tsx,lib/queries.ts}`; `collections/lib/queries.ts`; `plan/lib/queries.ts`;
   `shopping/lib/{queries,offline,offline.test,parse,useLongPress}.ts`. Apply Tables A, D, E, F, G.
5. `recipes/lib/url-filters.ts`: `import { useAppNavigate } from "./nav";` →
   `import { useAppNavigate } from "@/lib/nav";` (Table D); the doc comment's `("/")` at line 80
   → `("/recipe")` (Table G). `recipes/lib/queries.ts`: after `totalCount` add, verbatim (decision
   13; `recipesQuery` imported from `@/modules/recipe/lib/queries`, `useQuery` is already imported):
   ```ts
   /**
    * The household's recipe count for the library subtitle (`recipe.recipes.list.groupSummary`,
    * `recipe.count.recipes`). ADR 0001 took `recipeCount` off `HouseholdWithRole` — the core never
    * counts a module's rows — so the module asks its own list endpoint: an UNFILTERED page of one
    * whose `total` is the count. The key sits under `recipesRoot`, so `invalidate.recipes`
    * refreshes it after every recipe mutation. `undefined` until known.
    */
   export function useHouseholdRecipeCount(householdId: string | null): number | undefined {
     const { data } = useQuery({
       ...recipesQuery(householdId ?? "", { limit: 1 }),
       enabled: householdId !== null,
     });
     return data?.total;
   }
   ```
6. `recipes/lib/hooks.ts`: delete the share block (`ShareResult`, `ShareLike`, `shareOrCopy`,
   `copyToClipboard`, R lines ~174–229 — they live in `@/lib/share`). `recipes/lib/
   permissions.ts`: keep only `canModifyOwn`, importing `hasAtLeast` from `@/lib/permissions`
   (`GroupRole` → `HouseholdRole`); doc comment unchanged otherwise.
7. `shopping/lib/offline.ts`: `SHOPPING_MUTATION_KEYS` → `["toon", "recipe", "shopping", <op>]`;
   the doc comment's `["toon","shopping",<operation>]` likewise; DELETE the last line
   `registerShoppingMutationDefaults(queryClient);` and the then-unused `queryClient` import, and
   replace R's comment "Called once at module load for the app's client" with "Called by the recipe
   manifest's `mutationDefaults` (app.tsx) before the persister restores, and callable in a test
   with a throwaway client". `offline.test.ts`: Table F on its keys.

**Files.** `apps/web/src/modules/recipe/lib/{api,queries,format}.ts`,
`apps/web/src/modules/recipe/features/recipes/lib/{format,formState,hooks,permissions,queries,
url-filters,difficultyLabels}.ts`, `apps/web/src/modules/recipe/features/tags/{TagsPage.tsx,
index.ts,components/TagChip.tsx,components/TagCombobox.tsx,lib/queries.ts}`,
`apps/web/src/modules/recipe/features/collections/lib/queries.ts`,
`apps/web/src/modules/recipe/features/plan/lib/queries.ts`,
`apps/web/src/modules/recipe/features/shopping/lib/{queries,offline,offline.test,parse,
useLongPress}.ts`.

**Acceptance.** Typecheck green with the new files; `offline.test.ts` passes unchanged in substance;
no `@/features/`, `/api/groups`, `"group"` key segment or `groupId` token under
`apps/web/src/modules/recipe`; `registerShoppingMutationDefaults` is exported and NOT called at
module scope; `useHouseholdRecipeCount` exists and `invalidateAfterRecipeMutation` calls
`invalidate.households`; no relative `./nav` import; the `LINKS` check (§3) passes.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/modules/recipe`;
`cd H && bun test`; `cd H && bun run build`;
`cd H && ! grep -rnE '@/features/|/api/groups|"group",|\bgroupId\b' apps/web/src/modules/recipe`;
`cd H && ! grep -nE '^registerShoppingMutationDefaults\(' apps/web/src/modules/recipe/features/shopping/lib/offline.ts`;
`cd H && grep -q 'export function useHouseholdRecipeCount' apps/web/src/modules/recipe/features/recipes/lib/queries.ts && grep -q 'invalidate.households(qc)' apps/web/src/modules/recipe/lib/queries.ts`;
`cd H && ! grep -rnE 'from "(\./|\.\./lib/|\./lib/)nav"' apps/web/src/modules/recipe`;
`LINKS` (§3).

---

### M2-T05 — API recipes, tags, collections, cook log, plan, cards + seed (port)

**Goal.** The recipe, tag, collection, cook-log, meal-plan and card services and routes behind the
module routers, the recipe demo seed, and their six R test files.

**Read.** SPEC D1, D7, D8, §4; this plan decisions 2, 3, 5, Tables A–C; R/CLAUDE.md locked
decisions 1, 11, conventions "IDs/Timestamps" (`planned_on` text), "PATCH semantics", gotchas
"Recipe search reads PRE-FOLDED columns" (`last_cooked_at` single writer `cookLog.ts`), "`routes/
cards.ts` throws the raw `ZodError`", "`normalizeBarcodeValue`…", "A LIST never renders
`imageUrl`" (`listImageUrlFor` in slim mappers), "`/uploads/:filename` needs a signature"
(`normalizeStoredUploadUrl` on write); R/docs/API.md "Recipes", "Tags", "Collections", "Meal plan",
"Cards". Sources: `R/apps/api/src/services/recipes/{collections.service,cookLog,mappers,
recipes.service,tags.service}.ts`, `R/apps/api/src/services/plan/{mappers,plan.service}.ts`,
`R/apps/api/src/services/cards/cards.service.ts`, `R/apps/api/src/routes/{recipes,plan,cards}.ts`,
`R/apps/api/scripts/seed.ts` (lines 1–84 imports and helpers, 137–547 recipe content),
`R/apps/api/test/{recipes,recipes-cooked,recipes-search,tags-kind,plan,cards}.test.ts`;
`H/apps/api/src/modules/recipe/{index,schema}.ts`, `H/apps/api/scripts/seed.ts`.

**Copies.** R `src/services/<x>/<f>` → `H/apps/api/src/modules/recipe/services/<x>/<f>` for the
eight service files; R `src/routes/{recipes,plan,cards}.ts` → `H/…/modules/recipe/routes/` (replace
the T03 stubs); R tests → `H/apps/api/test/` same names.

**Rewrites.**
1. Tables A, B, C. Services import tables from `../../../../db/schema.ts` (the flat re-export).
2. Routes: delete `recipeRoutes.use("*", requireSession());`,
   `recipeRoutes.use("*", requireGroupRole("member"));` and the same two lines in `planRoutes`
   (decision 3); keep the `requireVerifiedEmail()` line and its comment; tag delete keeps
   `requireHouseholdRole("admin")`. `cardRoutes` keeps both its `use` lines. Header comments:
   "Mounted at /api/groups/:groupId" → "Mounted at /api/households/:householdId/recipe (via
   modules/recipe/routes/index.ts, behind the module chain)"; cards "Mounted at /api/recipe/cards
   (userRouter)". `created(c, …, \`/api/groups/${membership.groupId}/recipes/${id}\`)` →
   `` `/api/households/${membership.householdId}/recipe/recipes/${id}` `` (Table B).
3. `modules/recipe/seed.ts`: `export async function seedRecipeDemo(db: Database, { householdId,
   userId }: { householdId: string; userId: string }): Promise<void>`. Module level: R seed's
   lines 45–84 minus lines 47–48 (`DEMO_EMAIL`, `DEMO_PASSWORD` — the core seed owns the login),
   i.e. `DAY_MS`, `HEADING_LINE` and `parseSectionedSteps`, plus the imports the copied lines use
   (from R lines 1–44: tables from `../../db/schema.ts`, `Database` from `../../db/client.ts`,
   the `@toon/shared` parsers, `drizzle-orm` operators — never `client`, `runMigrations`,
   `groups`, `groupMembers`, `users`). Function body: first line `const now = Date.now();` (R
   line 88, outside both ranges; the body uses it throughout), then R lines **137–547** (from
   `const tagNames = …` to the closing `}` of the shopping-list-recipes loop) — NOT R 548–554:
   the `[seed] done` / `Login:` / `Passwort:` lines are printed by the core `scripts/seed.ts`,
   and `client.close()` there runs after every module's `seedDemo` (M3's finance seed comes
   after this one, so the module must never close the shared client). Tables A and C,
   `groupId` → `householdId`; idempotency checks unchanged; `console.log` lines unchanged
   (English). Manifest: `seedDemo: seedRecipeDemo`. `scripts/i18n-check.ts`
   `ALLOW_LIST`: add `"apps/api/src/modules/recipe/seed.ts",` after `"apps/api/scripts/seed.ts",`
   (content language moved with the code).
4. Tests: Table B paths and URLs; `{ group: { id: string } }` → `{ household: { id: string } }`,
   `.group.id` → `.household.id`; tables per Table A; raw SQL and index-name assertions per Table C
   (`recipes-search.test.ts:373,376,395,404`, `recipes-cooked.test.ts:374–380`, `plan.test.ts:13,
   554–561`). Where a test inserts a household row DIRECTLY (`db.insert(households)`) and then calls
   a `/recipe/` route, add right after it `await db.insert(householdModules).values({ householdId:
   <id>, moduleId: "recipe" });` (import `householdModules`); households created through `POST
   /api/households` already have the row. A test that exercises a route of T09a/T09b (imports,
   shopping) is removed with a `// M2-T09c: … returns with the <imports|shopping> routes.`
   comment and restored by T09c (the only later task that edits T05's test files).

**Files.** `apps/api/src/modules/recipe/services/recipes/{collections.service,cookLog,mappers,
recipes.service,tags.service}.ts`, `apps/api/src/modules/recipe/services/plan/{mappers,
plan.service}.ts`, `apps/api/src/modules/recipe/services/cards/cards.service.ts`,
`apps/api/src/modules/recipe/routes/{recipes,plan,cards}.ts`, `apps/api/src/modules/recipe/
seed.ts`, `apps/api/src/modules/recipe/index.ts`, `scripts/i18n-check.ts`,
`apps/api/test/{recipes,recipes-cooked,recipes-search,tags-kind,plan,cards}.test.ts`.

**Acceptance.** The six test files pass with R's test count each (`grep -c 'test('` equal, minus
any `M2-T09c` placeholder named in the commit); `bun run seed` on a fresh DB writes the demo recipes,
plan entries, cook log, shopping list and is idempotent on a second run; cross-household cases R
already has (recipes.test "a recipe of another group…", plan.test "404 for an entry id from another
group") pass.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/recipes.test.ts apps/api/test/recipes-cooked.test.ts apps/api/test/recipes-search.test.ts apps/api/test/tags-kind.test.ts apps/api/test/plan.test.ts apps/api/test/cards.test.ts`;
`cd H && bun test`;
`cd H && rm -f data/m2-t05.db* && DATABASE_URL=file:$PWD/data/m2-t05.db SESSION_SECRET=0123456789abcdef0123456789abcdef bun run seed && DATABASE_URL=file:$PWD/data/m2-t05.db SESSION_SECRET=0123456789abcdef0123456789abcdef bun run seed`;
`cd H && ! grep -rnE '\bgroupId\b|/api/groups|requireGroupRole' apps/api/src/modules/recipe/services/recipes apps/api/src/modules/recipe/services/plan apps/api/src/modules/recipe/services/cards apps/api/src/modules/recipe/routes/recipes.ts apps/api/src/modules/recipe/routes/plan.ts apps/api/src/modules/recipe/routes/cards.ts`.

---

### M2-T06 — API import pipeline + OCR services (port)

**Goal.** R's URL/text parsing pipeline, the OCR engine and PDF rasterizer subprocess wrappers
and the import OCR segmentation under the module, with the seven unit-level import test files,
the fixtures, and poppler in CI. The import ROUTES and draft/commit services are T09a.

**Read.** SPEC D13; R/CLAUDE.md locked decisions 5, 6, gotchas "THE URL importer's SSRF guard",
"A JSON-LD property can be a `@graph` REFERENCE", "The hero image is a CANDIDATE LIST", "OCR AND PDF
RASTERIZATION ARE NATIVE SUBPROCESSES" (all points), "`test/import/pdf-rasterize.test.ts` is the
only test that uses the REAL rasterizer" (must fail, never skip, without `pdftoppm`),
"`mock.module` LEAKS ACROSS TEST FILES" (use the seams `setPdfRasterizer`, `setOcrEngine`, reset in
`afterEach`), "Bun 1.4 no longer installs OPTIONAL peer dependencies" (`unpdf` `extractText`
only), "INTERFACE LANGUAGE AND CONTENT LANGUAGE…" (the parsers are content). Sources (copy the
whole subtrees): `R/apps/api/src/services/ocr/{index,pdf,preprocess,tesseract,types}.ts`,
`R/apps/api/src/services/import/{files,parsed,times}.ts`, `R/apps/api/src/services/import/html/
{entities,parse}.ts`, `R/apps/api/src/services/import/ocr/{index,quantity-fix,segment}.ts`,
`R/apps/api/src/services/import/url/{fetch,image,index,jsonld,meta,microdata,schema-map,sections,
ssrf}.ts`, `R/apps/api/src/services/import/url/adapters/{chefkoch,generic,index,types,wprm}.ts`,
`R/apps/api/test/import/{helpers,url-extract,url-pipeline,ssrf,ocr-segment,ocr-tesseract,
pdf-rasterize}.ts`, `R/apps/api/test/fixtures/import/*` (7 files), `R/.github/workflows/ci.yml`
(the poppler step, lines ~42–48).

**Copies (scripted).** `mkdir -p` the targets, then `cp` each listed R file to
`H/apps/api/src/modules/recipe/services/<same subpath under services/>`, the tests to
`H/apps/api/test/import/`, `cp R/apps/api/test/fixtures/import/* H/apps/api/test/fixtures/import/`.

**Rewrites.** Only Table B's depth rows and one comment line, applied with these exact
substitutions:
- in `services/ocr/*.ts` and `services/import/{files,parsed,times}.ts`: `"../../env.ts"` →
  `"../../../../env.ts"`; `"../../lib/` → `"../../../../lib/`; `"../media/thumbnails.ts"` →
  `"../../../../core/services/media/thumbnails.ts"`;
- in `services/import/{url,ocr,html}/*.ts`: `"../../../lib/` → `"../../../../../lib/`;
  `"../../../env.ts"` → `"../../../../../env.ts"`; `"../../media/thumbnails.ts"` →
  `"../../../../../core/services/media/thumbnails.ts"`;
- `services/import/files.ts` line 184 (doc comment, Table B string row): the text
  `GET /api/groups/:groupId/imports/:draftId/source` → `GET /api/households/:householdId/recipe/
  imports/:draftId/source` (one line in the file, backticks around it kept; the only
  `/api/groups`/`groupId` token in T06's files — checked against R with `grep -rnE
  '\bgroupId\b|/api/groups'`; T09a's verify greps the whole module tree);
- `services/import/url/adapters/*.ts`: no change;
- tests: `"../../src/services/` → `"../../src/modules/recipe/services/` for
  import/ocr subpaths, `"../../src/lib/`, `"../../src/env.ts"` unchanged;
- Table A on comments/identifiers (expected: none or comments only); content-language strings
  (German vocabulary, `Accept-Language: de-DE…`, `TESSERACT_LANGS`) never change.
- `H/.github/workflows/ci.yml`: replace the comment line "M2 re-adds the poppler install…" with
  R's "Install poppler" step and its comment, verbatim, between Install and Typecheck.

**Files.** `apps/api/src/modules/recipe/services/ocr/{index,pdf,preprocess,tesseract,types}.ts`,
`apps/api/src/modules/recipe/services/import/{files,parsed,times}.ts`,
`apps/api/src/modules/recipe/services/import/html/{entities,parse}.ts`,
`apps/api/src/modules/recipe/services/import/ocr/{index,quantity-fix,segment}.ts`,
`apps/api/src/modules/recipe/services/import/url/{fetch,image,index,jsonld,meta,microdata,
schema-map,sections,ssrf}.ts`, `apps/api/src/modules/recipe/services/import/url/adapters/
{chefkoch,generic,index,types,wprm}.ts`, `apps/api/test/import/{helpers.ts,url-extract.test.ts,
url-pipeline.test.ts,ssrf.test.ts,ocr-segment.test.ts,ocr-tesseract.test.ts,
pdf-rasterize.test.ts}`, `apps/api/test/fixtures/import/{biancazapatka-wprm.html,
chefkoch-graph.html,chefkoch-jsonld.html,graph-howtosection.html,howtostep-array.html,
microdata-only.html,ocr-zwiebelkuchen.txt}`, `.github/workflows/ci.yml`.

**Acceptance.** `diff` of each copied file against R shows only import-specifier lines, plus the
one comment line `files.ts:184`; the seven test files pass with R's test counts (pdf-rasterize uses the real `pdftoppm`, present on this
machine at `/bin/pdftoppm`); `i18n:check`'s ALLOW_LIST paths now exist (parsed, times, segment,
quantity-fix, schema-map, adapters, fetch, ssrf, image).

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/import/url-extract.test.ts apps/api/test/import/url-pipeline.test.ts apps/api/test/import/ssrf.test.ts apps/api/test/import/ocr-segment.test.ts apps/api/test/import/ocr-tesseract.test.ts apps/api/test/import/pdf-rasterize.test.ts`;
`cd H && bun test`; `cd H && grep -q 'poppler-utils' .github/workflows/ci.yml`;
`cd H && test "$(find apps/api/src/modules/recipe/services/import apps/api/src/modules/recipe/services/ocr -name '*.ts' | wc -l)" -ge 27`;
`cd H && for f in apps/api/src/modules/recipe/services/import/url/adapters/*.ts; do diff -q "$f" "/home/erics/software/toon-recipe/apps/api/src/services/import/url/adapters/$(basename "$f")" || exit 1; done`;
`cd H && ! grep -rnE '\bgroupId\b|/api/groups' apps/api/src/modules/recipe/services/ocr apps/api/src/modules/recipe/services/import apps/api/test/import`;
`cd H && grep -q 'GET /api/households/:householdId/recipe/imports/:draftId/source' apps/api/src/modules/recipe/services/import/files.ts`.

---

### M2-T07 — Web recipe components, collections screens, AddRecipeToListDialog (port)

**Goal.** The recipes feature's components and barrel, the collections screens, and the one
shopping component the plan and recipe pages need, so T10 and T11a have their imports.

**Read.** SPEC D5, D6; Tables A, D, E, F, G; R/docs/redesign/SPEC.md (design system: type scale,
`.eyebrow`, `font-display font-medium`, tokens); R/CLAUDE.md "Navigation" (the filter-rail links
to collections/tags are the enforcement), gotchas "`controlClasses` carries `min-w-0`",
"A `<fieldset>` carries … `min-inline-size`", "`block` beats `line-clamp-N`" + "A RECIPE TITLE
NEVER TRUNCATES", "A LIST never renders `imageUrl`", "The recipe list switches MARKUP at `sm`",
"A header gets ONE overflow trigger", "No arrow … is ever a text glyph", "`autoFocus` only acts on
MOUNT", "An idle TanStack mutation reports `error: null`", the two-gates rule ("the recipe detail
screen carries TWO DIFFERENT GATES" — `AddRecipeToListDialog` uses
`useEmailVerificationBlock()`). Sources: `R/apps/web/src/features/recipes/components/*.tsx` (17),
`R/apps/web/src/features/recipes/index.ts`, `R/apps/web/src/features/collections/{CollectionsPage,
CollectionDetailPage}.tsx`, `R/apps/web/src/features/collections/index.ts`,
`R/apps/web/src/features/shopping/components/AddRecipeToListDialog.tsx`.

**Copies.** R `features/<f>/P` → `H/apps/web/src/modules/recipe/features/<f>/P` for:
`recipes/components/{CookMode,CourseEyebrow,IngredientList,IngredientsEditor,LibraryCreateMenu,
RecentlyCookedShelf,RecipeDetailBottomBar,RecipeEditorialRow,RecipeFilterRail,RecipeFilterSheet,
RecipeForm,RecipeHeroMobile,RecipeImagePicker,RecipeStatRow,ServingsScaler,StepList,
StepsEditor}.tsx`, `recipes/index.ts`, `collections/{CollectionsPage,CollectionDetailPage}.tsx`,
`collections/index.ts`, `shopping/components/AddRecipeToListDialog.tsx`.

**Rewrites.** Tables A, D, E, F, G. `recipes/index.ts`: the `./lib/nav` re-export line becomes
`export { AppLink, useAppNavigate, useRouteParam, useRouteParams, type AppLinkProps } from
"@/lib/nav";`; from `./lib/hooks` drop `copyToClipboard, shareOrCopy` and add the line
`export { copyToClipboard, shareOrCopy } from "@/lib/share";`; the permissions line becomes
`export { canModifyOwn } from "./lib/permissions";` + `export { hasAtLeast } from
"@/lib/permissions";`. `LibraryCreateMenu`'s targets `/import` → `/recipe/import`, `/recipes/new` →
`/recipe/recipes/new`; `RecipeFilterRail`'s "Sammlungen verwalten"/"Tags verwalten" links →
`/recipe/collections`, `/recipe/tags` (reachability enforcement, keep the comments). Relative
imports of R's uncopied `nav.tsx` per Table D: `import { AppLink } from "../lib/nav";` in
`RecentlyCookedShelf`, `RecipeEditorialRow`, `RecipeFilterRail` and `import { useNavigationGuard }
from "../lib/nav";` in `RecipeForm` → `from "@/lib/nav"`. `../lib/hooks` imports (`StepList`,
`StepsEditor`, `CookMode`, `IngredientsEditor`) stay. `CollectionDetailPage`'s
`@/features/recipes/lib/hooks` (`moveItem`, `useDebouncedValue`) →
`@/modules/recipe/features/recipes/lib/hooks`.

**Files.** the 22 targets above.

**Acceptance.** Typecheck green; no forbidden token (verify); every German literal still comes from
the catalog (no new string literal with umlauts in the ported files: `grep` against R shows the
same lines); the filter links point at `/recipe/collections` and `/recipe/tags`; no relative
`nav` import; the `LINKS` check (§3) passes (`tsc` does not check `AppLink` targets).

**Verify.** `cd H && bun run typecheck`; `cd H && bun test`; `cd H && bun run build`;
`cd H && ! grep -rnE '@/features/|/api/groups|"group",|\bgroupId\b' apps/web/src/modules/recipe`;
`cd H && grep -q '"/recipe/collections"' apps/web/src/modules/recipe/features/recipes/components/RecipeFilterRail.tsx && grep -q '"/recipe/tags"' apps/web/src/modules/recipe/features/recipes/components/RecipeFilterRail.tsx`;
`cd H && grep -q '"/recipe/import"' apps/web/src/modules/recipe/features/recipes/components/LibraryCreateMenu.tsx`;
`cd H && ! grep -rnE 'from "(\./|\.\./lib/|\./lib/)nav"' apps/web/src/modules/recipe`;
`LINKS` (§3).

---

### M2-T08 — Web import feature (port)

**Goal.** R's whole import feature (URL/text/photo/PDF entry, drafts, review editor, source viewer,
autosave, error mapping) under the module, with its three co-located tests.

**Read.** SPEC D10; Tables A, D, E, G; R/CLAUDE.md conventions "Web: no `fetch` outside
`lib/api.ts` (the one exception is `features/import/lib/importApi.ts`)", "UI primitives … `features/
import/lib/shell.tsx` is a typing seam", gotchas "THE IMPORT FEATURE'S ERRORS CARRY KEYS, NOT
SENTENCES", "PHOTO AND PDF IMPORT ARE TWO FEATURE FLAGS" (UI: `useOcrImportAvailable`/
`usePdfImportAvailable`, unknown = unavailable; H's `features` is a catchall, `=== true` still
works), "A bottom action bar needs `bottom-tabbar`" (review footer), "`lib/unsavedWork.ts`",
"`/uploads/:filename` needs a signature" (source scans served by the membership-checked source
endpoint). Sources: `R/apps/web/src/features/import/**` (23 files).

**Copies.** `R/apps/web/src/features/import/<P>` → `H/apps/web/src/modules/recipe/features/import/
<P>` for: `ImportPage.tsx`, `ImportReviewPage.tsx`, `index.ts`, `components/{ConfidenceBadge,
ImageCaptureButton,ImportErrorPanel,OcrProgressPanel,ParsedRecipeEditor,PendingDraftsList,
SourceViewer,UploadProgress}.tsx`, `lib/{confidence,confidence.test,draftEdit,draftEdit.test,image,
importApi,importErrors.test,importErrorText,navigation,queries,useAutosave}.ts`, `lib/shell.tsx`.

**Rewrites.** Tables A, D, E, F, G. `importApi.ts`: `const groupBase = (groupId: string) =>
\`/api/groups/${encodeURIComponent(groupId)}\`` → `const householdBase = (householdId: string) =>
\`/api/households/${encodeURIComponent(householdId)}/recipe\``, every `groupBase(groupId)` →
`householdBase(householdId)`, `listGroupTags` → `listHouseholdTags` (and its callers), comment
`GET /api/groups/:groupId/imports/:draftId/source` → `GET /api/households/:householdId/recipe/
imports/:draftId/source`. `importErrors.test.ts`: Table E on every expected key
(`"import.error.network.title"` → `"recipe.import.error.network.title"`); it reads `CATALOGS` from
`@/lib/i18n/catalogs/index.ts`, which now contains the recipe keys (T02). `lib/navigation.ts`
targets per Table G: `go("/import", …)` → `go("/recipe/import", …)`,
`` go(`/import/${encodeURIComponent(draftId)}`, …) `` → `` go(`/recipe/import/${…}`, …) ``,
`` go(`/recipes/${encodeURIComponent(recipeId)}`, …) `` → `` go(`/recipe/recipes/${…}`, …) ``,
and its header's "Paths used:" line likewise.

`lib/queries.ts` (decision 14, Table F): replace R's `importKeys` object (lines 26–31) with
```ts
export const importKeys = {
  all: (householdId: string) => ["toon", "household", householdId, "recipe", "import"] as const,
  drafts: (householdId: string, status?: ImportDraftStatus) =>
    ["toon", "household", householdId, "recipe", "import", "drafts", status ?? "all"] as const,
  tags: (householdId: string) => ["toon", "household", householdId, "recipe", "import", "tags"] as const,
  /** User-scoped: `useDraft` resolves a draft id across the user's households. */
  draftRoot: ["toon", "recipe", "import-draft"] as const,
  draft: (draftId: string) => ["toon", "recipe", "import-draft", draftId] as const,
};
```
and each of the two `void queryClient.invalidateQueries({ queryKey: importKeys.all });`
(`useCommitDraft`, `useDeleteDraft`) with the two lines
`void queryClient.invalidateQueries({ queryKey: importKeys.all(variables.householdId) });` and
`void queryClient.invalidateQueries({ queryKey: importKeys.draftRoot });`. In `useCommitDraft`
the predicate block (`predicate: (query) => JSON.stringify(query.queryKey).toLowerCase()
.includes("recipe")` and its two-line comment) would now match EVERY recipe-module key (all of
them contain `"recipe"`); replace it with `void invalidateAfterRecipeMutation(queryClient,
variables.householdId);` (import from `@/modules/recipe/lib/queries`; recipes, tags,
collections, households, me — what a committed draft changes) and the comment "A committed
draft is a new recipe (possibly with new tags and collections): same refresh as any recipe
create." Table A's import-feature row: `useGroupTags` → `useHouseholdTags` (also in
`index.ts`'s export line and its callers), `listGroupTags` → `listHouseholdTags`,
`candidateGroupIds` → `candidateHouseholdIds`, `ResolvedDraft.groupId` → `householdId` (with
its doc comment "Household the draft actually lives in — may differ from the active
household."), the `useDraft` doc comment's "group(s)" → "household(s)".

**Files.** the 23 targets above.

**Acceptance.** The three tests pass with R's counts; `importApi.ts` is the only file under
`modules/recipe` that calls `XMLHttpRequest`/`fetch` (`grep`); no forbidden token; every import
query key starts with `"toon"` (decision 14); the `LINKS` check (§3) passes.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/modules/recipe/features/import`;
`cd H && bun test`; `cd H && bun run build`;
`cd H && ! grep -rnE '@/features/|/api/groups|"group",|\bgroupId\b' apps/web/src/modules/recipe/features/import`;
`cd H && test -z "$(grep -rlE '\bfetch\(|XMLHttpRequest' apps/web/src/modules/recipe | grep -v 'features/import/lib/importApi.ts')"`;
`cd H && ! grep -rnE '\["import"|importKeys\.all\b[^(]|candidateGroupIds|useGroupTags|listGroupTags' apps/web/src/modules/recipe/features/import`;
`LINKS` (§3).

---

### M2-T09a — API import draft/commit services + routes, real-session route tests, OCR shutdown (build)

**Goal.** The import draft/commit services and the import router behind the module chain, R's
three route-level import test files (two rewritten onto real sessions), and the OCR shutdown hook.

**Read.** SPEC D1, D8, D13; this plan decisions 3, 4, Tables A–C; R/CLAUDE.md locked decisions 5,
6, gotchas "PHOTO AND PDF IMPORT ARE TWO FEATURE FLAGS" (the guard runs FIRST; `/file` sniff
exception; 501 `ocr_disabled`; seams reset in `afterAll`), "Import endpoints must stay bounded"
(`enforceRateLimit`, `withOcrSlot`, `withOcrTimeout`), "AN UNCONFIRMED E-MAIL ADDRESS MAKES AN
ACCOUNT READ-ONLY", "`/uploads/:filename` needs a signature" (source scans), "libSQL 0.17.4
discarded a `file::memory:` DB" (`services/import/db.ts` test DB), "`mock.module` LEAKS ACROSS
TEST FILES"; `H/CLAUDE.md` "Middleware chain order", "`file::memory:` is per client". Sources:
`R/apps/api/src/services/import/{commit,db,drafts}.ts`, `R/apps/api/src/services/import/
middleware-bridge.ts` (read only — not ported, decision 3), `R/apps/api/src/routes/imports.ts`,
`R/apps/api/test/import/{commit,routes,ocr-disabled}.test.ts`; `H/apps/api/test/middleware.test.ts`
(how a real session cookie is minted), `H/apps/api/src/modules/recipe/index.ts`.

**Work.**
1. Port (Tables A–C) `services/import/{commit,db,drafts}.ts` and `routes/imports.ts` (replacing
   T03's stub). In `imports.ts` delete the `middleware-bridge.ts` import line, the four comment
   lines below it (R 73–76, "Straight from the middleware, NOT through middleware-bridge.ts…")
   and the two `use` lines `importRoutes.use("*", requireSession);` /
   `importRoutes.use("*", requireGroupRole("member"));` with the comment above them (keep
   `requireVerifiedEmail()` and its comment). Header comments that describe router-level
   session/member middleware say instead that the module chain (`modules/mount.ts`) applies
   `requireSession()` → `requireHouseholdRole("member")` → `requireModule("recipe")`. Grep every
   moved file for raw table names (Table C).
2. Port R's three test files to `apps/api/test/import/` with Table B/C. `routes.test.ts` and
   `ocr-disabled.test.ts` used `setAuthMiddlewareForTests` to stub session + membership; the
   module chain now runs the REAL middleware against the shared `db` first, so rewrite their
   setup: seed the user, a real session (`createSession(db, userId)` → `toon_session` cookie, as
   `middleware.test.ts` does), the household, membership and the `household_modules` recipe row in
   the shared `db` (after `runMigrations(db)`), send the cookie, keep `setImportDbForTests` for
   the file-backed import DB and seed the same user/household rows there (FK targets). Every R
   assertion stays; record the setup change in the commit body. `commit.test.ts` ports with
   Tables B/C only.
3. Manifest `apps/api/src/modules/recipe/index.ts`: `shutdown: shutdownOcr` (import from
   `./services/ocr/index.ts`).

**Files.** `apps/api/src/modules/recipe/services/import/{commit,db,drafts}.ts`,
`apps/api/src/modules/recipe/routes/imports.ts`, `apps/api/src/modules/recipe/index.ts`,
`apps/api/test/import/{commit,routes,ocr-disabled}.test.ts`.

**Acceptance.** The three test files pass with R's test counts (commit 16, routes 30,
ocr-disabled 14); `ocr_disabled` is still a 501 before the body is read; no
`setAuthMiddlewareForTests` or `middleware-bridge` anywhere; the manifest has `shutdown`.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/import`;
`cd H && bun test`;
`cd H && test "$(grep -c 'test(' apps/api/test/import/routes.test.ts)" -eq "$(grep -c 'test(' /home/erics/software/toon-recipe/apps/api/test/import/routes.test.ts)"`;
`cd H && test "$(grep -c 'test(' apps/api/test/import/ocr-disabled.test.ts)" -eq "$(grep -c 'test(' /home/erics/software/toon-recipe/apps/api/test/import/ocr-disabled.test.ts)"`;
`cd H && ! grep -rnE '\bgroupId\b|/api/groups|requireGroupRole|middleware-bridge|setAuthMiddlewareForTests' apps/api/src/modules/recipe apps/api/test/import`;
`cd H && grep -q 'shutdown' apps/api/src/modules/recipe/index.ts`.

---

### M2-T09b — API shopping services + routes + shopping tests (port)

**Goal.** R's shopping services (incl. the idempotency ledger) and router behind the module chain,
with R's three shopping test files.

**Read.** SPEC D1, D8, D9; this plan decision 3, Tables A–C; R/CLAUDE.md locked decision 7 (all of
it: merge by `(name, unit)`, no `checked` column, bought log, `ingredientIds`, `Gekauftes leeren`
watermark, catalog hide), gotchas "THE SHOPPING LIST IS THE ONE THING EDITABLE OFFLINE" (server
side: `mutationId` ledger, exactly-once log append on `DELETE … RETURNING`), "`shoppingItemKey`'s
separator". Sources: `R/apps/api/src/services/shopping/{bought.service,fromPlan.service,
idempotency,items.service,lists.service,mappers}.ts`, `R/apps/api/src/routes/shopping.ts`,
`R/apps/api/test/{shopping,shopping-bought,shopping-from-plan}.test.ts`.

**Copies and rewrites.** R `src/services/shopping/<f>` → `H/apps/api/src/modules/recipe/services/
shopping/<f>` (6 files, Tables A–C: `"../groups/membership.ts"`, `"../groups/support.ts"` →
`"../../../../core/services/households/<f>"`, `"../media/thumbnails.ts"` →
`"../../../../core/services/media/thumbnails.ts"`, `"../plan/…"`, `"../recipes/…"` unchanged);
R `src/routes/shopping.ts` → `H/…/modules/recipe/routes/shopping.ts` (replaces T03's stub; Table B
route rows; delete the two session/member `use` lines; import `requireVerifiedEmail` from
`../../../middleware/verifiedEmail.ts`; header comment as in T09a step 1). `lists.service.ts`'s raw
`sql\`` preview query: `shopping_list_items` → `recipe_shopping_list_items`, `shopping_lists` →
`recipe_shopping_lists`, `l.group_id` → `l.household_id` (Table C); grep every moved file for other
raw table names. Tests → `H/apps/api/test/` same names, Tables A–C (`{ group: … }` →
`{ household: … }`, URLs per Table B; a household inserted directly gets its `household_modules`
recipe row as in T05 rewrite 4).

**Files.** `apps/api/src/modules/recipe/services/shopping/{bought.service,fromPlan.service,
idempotency,items.service,lists.service,mappers}.ts`, `apps/api/src/modules/recipe/routes/
shopping.ts`, `apps/api/test/{shopping,shopping-bought,shopping-from-plan}.test.ts`.

**Acceptance.** The three test files pass with R's counts (shopping 42, shopping-bought 14,
shopping-from-plan 6); a replayed `mutationId` is applied once (R's shopping tests).

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/shopping.test.ts apps/api/test/shopping-bought.test.ts apps/api/test/shopping-from-plan.test.ts`;
`cd H && bun test`;
`cd H && for t in shopping shopping-bought shopping-from-plan; do test "$(grep -c 'test(' apps/api/test/$t.test.ts)" -eq "$(grep -c 'test(' /home/erics/software/toon-recipe/apps/api/test/$t.test.ts)" || exit 1; done`;
`cd H && ! grep -rnE '\bgroupId\b|/api/groups|requireGroupRole|\bshopping_list_items\b|\bshopping_lists\b|\bgroup_id\b' apps/api/src/modules/recipe/services/shopping apps/api/src/modules/recipe/routes/shopping.ts`.

---

### M2-T09c — Restored placeholders + cross-household sweep (build)

**Goal.** The `M2:` placeholders of M1's tests and any `// M2-T09c:` placeholder T05 left are
restored; one sweep test proves every by-id recipe route refuses another household's id (D8).

**Read.** SPEC D8; this plan decision 12; `H/CLAUDE.md` "Cross-household guard", "Middleware chain
order"; R/docs/API.md (route list); R/CLAUDE.md "AN UNCONFIRMED E-MAIL ADDRESS MAKES AN ACCOUNT
READ-ONLY". Sources: `R/apps/api/test/{uploads,verified-email-gate}.test.ts`,
`R/apps/api/test/groups.test.ts` (the cascade test); `H/apps/api/test/{uploads,verified-email-gate,
households,middleware}.test.ts`; the ported routers `H/apps/api/src/modules/recipe/routes/*.ts`.

**Work.**
1. `uploads.test.ts` — R's "the stored column never holds a signature" test and the "import source
   scans" describe (Tables A–C), replacing the `M2:` comment.
2. `verified-email-gate.test.ts` — ADD R's recipe/tag/collection, import (incl. "reject BEFORE
   reading the body"), shopping and card write cases and the recipe/tag reads of the invite test
   next to M1's retargeted core cases (keep those); remove the `M2:` comment.
3. `households.test.ts:560` — create a recipe through the API before the delete and assert its
   `recipe_recipes` row is gone after; `households.test.ts:162` — replace the comment with "Counts
   per module are not reported (ADR 0001)".
4. Every `// M2-T09c:` placeholder in T05's test files (`grep -rn 'M2-T09c' apps/api/test`) is
   replaced by R's original test, ported with Tables A–C.
5. New `apps/api/test/recipe-cross-household.test.ts`: households A and B (recipe enabled), user U
   member of A only; with U's cookie, every by-id route under `/api/households/A/recipe/…`
   addressed with an id from B answers `404` `not_found`: recipe GET/PATCH/DELETE/image/scale/
   cooked, tag PATCH/DELETE (U admin of A), collection GET/PATCH/DELETE/add-recipe/remove-recipe,
   collection create with B's recipe id, import draft GET/PATCH/commit/DELETE/source, shopping list
   GET/PATCH/DELETE/items/item PATCH+DELETE/check/catalog PATCH/bought undo/add-recipe with B's
   recipe, plan entry PATCH/DELETE, plan create with B's recipe; cards: user V's card id with U's
   cookie on `/api/recipe/cards/:id` PATCH/DELETE/used → 404. Use the route list in R docs/API.md
   and the ported routers (no route invented; a route R does not have is left out and named in the
   commit body). Every test hands back the flag seams it touches in `afterAll`.

**Files.** `apps/api/test/{uploads,verified-email-gate,households,recipe-cross-household}.test.ts`,
plus every T05 test file holding an `// M2-T09c:` placeholder.

**Acceptance.** Every listed test passes; uploads reaches R's 27 tests, verified-email-gate ≥ 17
incl. M1's core cases; no `M2:` and no `M2-T09c` comment left in `apps/api/test`; the sweep test
covers every by-id route of the five household routers and the card router.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/uploads.test.ts apps/api/test/verified-email-gate.test.ts apps/api/test/households.test.ts apps/api/test/recipe-cross-household.test.ts`;
`cd H && bun test`;
`cd H && ! grep -rnE 'M2:|M2-T09c' apps/api/test`;
`cd H && test "$(grep -c 'test(' apps/api/test/uploads.test.ts)" -ge 27`.

---

### M2-T10 — Web cards + shopping screens (port)

**Goal.** The saved-cards wallet (display, form, scanner, encoders round trip) and every shopping
screen and component except `AddRecipeToListDialog` (T07).

**Read.** SPEC D1 (cards belong to the user), D9; Tables A, D, E, F, G; R/docs/redesign/SPEC.md;
R/CLAUDE.md locked decisions 7, 11, gotchas "THE BARCODE ENCODERS ARE HAND-ROLLED AND THE DECODER
IS A DEPENDENCY" (lazy `zxing-wasm` in `scan.ts` only, roundtrip test never simplified, black on
white, `crispEdges`), "A SAVED CARD IS READ OFFLINE AND WRITTEN ONLINE" (cards screens use
`useCanMutate()`), "`useCanMutate()` must NOT be used on the shopping screens" (they use
`useEmailVerificationBlock()` + `isOnline` for list create/rename/delete, `Gekauftes leeren`,
catalog hide/unhide, "Rezept von der Liste entfernen"), "A `sticky bottom-*` bar can only be pushed
UP" (flex chain), "A bottom action bar needs `bottom-tabbar`", "A page component must NOT re-apply
`mx-auto max-w-content px-gutter pt-4 pb-tabbar`", "`autoFocus` only acts on MOUNT", "Navigation"
(`CardsCard` is the ONLY phone route to the wallet). Sources: `R/apps/web/src/features/cards/**`
(11 files), `R/apps/web/src/features/shopping/{ShoppingListsPage,ShoppingListDetailPage,
ShoppingHistoryPage}.tsx`, `R/apps/web/src/features/shopping/components/{AddItemBar,
AddPlanToListDialog,BoughtHistoryPanel,BoughtSection,EditItemDialog,FrequentlyUsed,
ItemDetailDialog,ListRecipesPanel,ShoppingItemCard,ShoppingItemTile,ShoppingListPreviewCard,
WeekPlanPanel}.tsx`.

**Copies.** R `features/<f>/P` → `H/apps/web/src/modules/recipe/features/<f>/P` for the 26 files
listed.

**Rewrites.** Tables A, D, E, F, G. `ShoppingListDetailPage`'s `useIsMutating({ mutationKey:
["toon", "shopping"] })` → `["toon", "recipe", "shopping"]`; `CardsCard` link → `/recipe/shopping/
cards`; `roundtrip.test.ts` keeps `Bun.resolveSync("zxing-wasm/reader/zxing_reader.wasm", …)`
(the dependency is added by T03, which is why T10 depends on T03 directly — `scan.ts` and
`roundtrip.test.ts` need `zxing-wasm` installed; a T10 worktree without T03 fails typecheck).
`ShoppingListDetailPage` imports `shareOrCopy` through the recipes barrel (`@/modules/recipe/
features/recipes`, which re-exports it from `@/lib/share`, T07) — unchanged.

**Files.** `apps/web/src/modules/recipe/features/cards/{CardsPage.tsx,components/{BarcodeImage,
CardDisplayDialog,CardFormDialog,CardsCard,ScannerDialog}.tsx,lib/{formats,formats.test,queries,
roundtrip.test,scan}.ts}`, `apps/web/src/modules/recipe/features/shopping/{ShoppingListsPage,
ShoppingListDetailPage,ShoppingHistoryPage}.tsx`, `apps/web/src/modules/recipe/features/shopping/
components/{AddItemBar,AddPlanToListDialog,BoughtHistoryPanel,BoughtSection,EditItemDialog,
FrequentlyUsed,ItemDetailDialog,ListRecipesPanel,ShoppingItemCard,ShoppingItemTile,
ShoppingListPreviewCard,WeekPlanPanel}.tsx`.

**Acceptance.** `formats.test.ts` and `roundtrip.test.ts` pass with R's counts (the round trip
decodes every Code 39/128 char and all four QR ECC levels); `scan.ts` is the only importer of
`zxing-wasm`; the shopping screens never CALL `useCanMutate` (comment mentions are R's and stay), the cards screens do;
the `LINKS` check (§3) passes (`CardsCard` → `/recipe/shopping/cards`, every `/shopping…` target
prefixed).

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/modules/recipe/features/cards`;
`cd H && bun test`; `cd H && bun run build`;
`cd H && ! (grep -rn 'useCanMutate' apps/web/src/modules/recipe/features/shopping | grep -vE ':[0-9]+:\s*(\*|//|/\*)')`;
`cd H && test "$(grep -rlE 'from "zxing-wasm|import\("zxing-wasm' apps/web/src/modules/recipe | grep -v '\.test\.ts$' | tr -d '\n')" = 'apps/web/src/modules/recipe/features/cards/lib/scan.ts'`;
`cd H && ! grep -rnE '@/features/|/api/groups|"group",|\bgroupId\b' apps/web/src/modules/recipe`;
`LINKS` (§3).

---

### M2-T11a — Web plan screens + recipe pages + print.css (port)

**Goal.** The last recipe screens — the planner (page + five components + barrel) and the library,
new, detail and edit pages with `print.css` — ported under the module. They are not routed yet
(T11b); they typecheck on their own because `AppLink`/`useAppNavigate` are string-typed.

**Read.** SPEC D5, D6, D10; this plan decisions 6, 10, 13, Tables A, D, E, F, G; R/CLAUDE.md
"Navigation" ("Search is not a destination"), gotchas "Recipe list/search filters live in the
URL", "`features/recipes/print.css` is invisible to all five gates" (both phone panels stay in the
DOM, `hidden` attribute), "The recipe list switches MARKUP at `sm`", "A header gets ONE overflow
trigger", "THREE SCREENS HAVE NO ARTBOARD" (`/plan` phone layout = seven day rows), the two-gates
rule on the recipe detail screen, "`/plan` uses `useCanMutate()`"; ADR 0001. Sources:
`R/apps/web/src/features/plan/{PlanPage.tsx,index.ts,components/{PlanDayCard,PlanRecipePicker,
PlanServingsDialog,PlanWeekNav,WeekStrip}.tsx}`, `R/apps/web/src/features/recipes/{RecipeListPage,
RecipeNewPage,RecipeDetailPage,RecipeEditPage}.tsx`, `R/apps/web/src/features/recipes/print.css`.

**Copies.** R `features/<f>/P` → `H/apps/web/src/modules/recipe/features/<f>/P` for the 11 files
and `print.css` (`RecipeDetailPage`'s `import "./print.css"` unchanged).

**Rewrites.** Tables A, D, E, F, G on every file. Specifically:
1. `./lib/nav` → `@/lib/nav` in `RecipeListPage`, `RecipeNewPage`, `RecipeEditPage`,
   `RecipeDetailPage`; `@/features/recipes/lib/nav` → `@/lib/nav` in `PlanPage`, `PlanDayCard`,
   `WeekStrip`; `RecipeDetailPage.tsx:90` split into `import { useCheckedSteps } from
   "./lib/hooks";` + `import { copyToClipboard, shareOrCopy } from "@/lib/share";` (Table D).
2. Link targets (Table G): `"/"` → `"/recipe"` (RecipeEditPage 47, RecipeNewPage 79,
   RecipeDetailPage 236, 423, 607, 778), `"/recipes/…"` → `"/recipe/recipes/…"`, `"/import"` →
   `"/recipe/import"`, `"/groups"` → `"/households"` (RecipeNewPage 62), `"/plan"` →
   `"/recipe/plan"` (PlanDayCard 475 — the `+N` link, PlanPage 81, WeekStrip 153; PlanDayCard 227
is a `/recipes/$recipeId` target), `useUrlRecipeFilters("/")` →
   `useUrlRecipeFilters("/recipe")` (RecipeListPage 60). Use the `LINKS` grep of §3 against the
   copied R file first to list every hit, then rewrite until it is empty.
3. `RecipeListPage` recipe count (decision 13): `const { group } = useActiveGroup();` →
   `const { household } = useActiveHousehold();` (Table A); after `const collections =
   useCollections(householdId);` add `const recipeCount = useHouseholdRecipeCount(householdId);`
   (add `useHouseholdRecipeCount` to the existing `./lib/queries` import); the subtitle condition
   `{group ? (` → `{household && recipeCount !== undefined ? (`; both `group.recipeCount` →
   `recipeCount`; `group.name` → `household.name`; `group.memberCount` → `household.memberCount`;
   keys per Table E (`recipe.recipes.list.groupSummary`, `recipe.recipes.list.sharedSummary`,
   `household.count.members`, `recipe.count.recipes`). No catalog value changes.

**Files.** `apps/web/src/modules/recipe/features/plan/{PlanPage.tsx,index.ts,components/
{PlanDayCard,PlanRecipePicker,PlanServingsDialog,PlanWeekNav,WeekStrip}.tsx}`,
`apps/web/src/modules/recipe/features/recipes/{RecipeListPage,RecipeNewPage,RecipeDetailPage,
RecipeEditPage}.tsx`, `apps/web/src/modules/recipe/features/recipes/print.css`.

**Acceptance.** Typecheck green; `diff` of each file against R shows only Table A/D/E/F/G lines and
the decision-13 lines; no `recipeCount` read off a household object; `print.css` byte-identical to
R's; no relative `nav` import; the `LINKS` check passes.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test`; `cd H && bun run build`;
`cd H && cmp apps/web/src/modules/recipe/features/recipes/print.css /home/erics/software/toon-recipe/apps/web/src/features/recipes/print.css`;
`cd H && grep -q 'useHouseholdRecipeCount(householdId)' apps/web/src/modules/recipe/features/recipes/RecipeListPage.tsx && ! grep -nE '(group|household)\.recipeCount' apps/web/src/modules/recipe/features/recipes/RecipeListPage.tsx`;
`cd H && grep -q 'useUrlRecipeFilters("/recipe")' apps/web/src/modules/recipe/features/recipes/RecipeListPage.tsx`;
`cd H && ! grep -rnE '@/features/|/api/groups|"group",|\bgroupId\b' apps/web/src/modules/recipe`;
`cd H && ! grep -rnE 'from "(\./|\.\./lib/|\./lib/)nav"' apps/web/src/modules/recipe`;
`LINKS` (§3).

---

### M2-T11b — Web wiring: route roots, module route tree, manifest, home card (core)

**Goal.** The module made real in the shell: module-owned route tree at `/recipe` (decision 10),
`route-roots.tsx` without the shell (decision 15), `recipeModule` manifest with three tabs and two
secondary items, the home card, the persist allow-list + outbox namespace + its test, registration
in `WEB_MODULES`, the strict tree for raw `<Link>`s.

**Read.** SPEC D2, D5, D6, D9, §2, §5; this plan decisions 6, 8, 10, 13, 15; R/CLAUDE.md
"Navigation" (whole section: tabs, the three reachability mechanisms, "Search is not a
destination"), gotchas "Recipe list/search filters live in the URL" (`RECIPE_FILTER_PARAMS`;
`/search` declares the same params), "SCREENS ARE CODE-SPLIT WITH `lazyRouteComponent`" (H
`router.tsx` header); R/docs/redesign/SPEC.md; `H/CLAUDE.md` gotchas "No module-level constants
over `WEB_MODULES`", "Open type seam for M2", "Persist policy comes from the manifests",
"`MessageKey` must stay a literal union". Sources: `R/apps/web/src/router.tsx` (lines 50–95
helpers/params, 205–350 recipe routes), `R/apps/web/src/lib/persist.ts` (lines 160–215),
`R/apps/web/src/lib/persist.test.ts`, `R/apps/web/src/components/layout/nav-items.ts`;
`H/apps/web/src/{router.tsx,app.tsx}`, `H/apps/web/src/modules/{types,index,layout,persist,
enabled}.ts(x)`, `H/apps/web/src/components/layout/{nav-items,module-switcher-items,index}.ts`,
`H/apps/web/src/core/features/home/HomePage.tsx`, `H/apps/web/src/lib/session.tsx`
(`SessionProvider`, `RequireAuth`, `RequireActiveHousehold` — no registry import),
`H/node_modules/.bun/@tanstack+router-core@1.171.28/node_modules/@tanstack/router-core/dist/esm/
route.d.ts:227` (`Route.update`).

**Work.**
1. `apps/web/src/route-roots.tsx` (decision 15): move out of `router.tsx` verbatim `RootLayout`,
   `rootRoute` (with `notFoundComponent: NotFoundPage`), `appRoute` — WITHOUT its `component`
   line — and `householdScopedRoute` (with its `RequireActiveHousehold` layout), plus the
   `pick`/`optionalString` helpers (exported). Its imports are limited to `@tanstack/react-router`,
   `@/lib/session`, `@/components/layout/NotFoundPage` (direct file, never the barrel) and React:
   no `@/modules`, no `AppShell`, no `@/components/layout` barrel. `router.tsx` keeps `AppLayout`
   (`RequireAuth` + `AppShell` + `Outlet`) and calls `appRoute.update({ component: AppLayout });`
   at module scope before building the tree, with a comment naming decision 15 (why the shell is
   attached here, not in `route-roots.tsx`); it adds `...WEB_MODULES.map((module) => module.route)`
   as children of `householdScopedRoute`; header and the M0/M1 seam comments updated. If
   `update({ component })` is refused by the types, record the exact `tsc` error in the commit and
   §6, and fall back to a `route-roots.tsx` `appRoute` whose component is a shell-free
   `RequireAuth` + `Outlet`, with `AppShell` wrapped around the router's outlet in `router.tsx`'s
   `RootLayout` replacement — never by importing `AppShell` into `route-roots.tsx`.
2. `modules/types.ts`: `routes: AnyRoute[]` → `route: AnyRoute` (doc: the module's layout route
   at `basePath`, built with `moduleLayoutComponent(id)` and parent `householdScopedRoute` from
   `@/route-roots`, first child = module home). Update the fakes in
   `components/layout/nav-items.test.ts`, `components/layout/module-switcher-items.test.ts`,
   `modules/persist.test.ts`, `modules/layout.test.tsx` (if they build `WebModule`s).
3. `modules/recipe/routes.tsx`: `recipeLayoutRoute` (`path: "/recipe"`, `component:
   moduleLayoutComponent("recipe")`, `getParentRoute: () => householdScopedRoute`) and its
   children from R's `router.tsx` with decision 6's paths and parent `recipeLayoutRoute`: library
   at `/` (index child, `validateSearch` with `RECIPE_FILTER_PARAMS`), `search` (redirect to
   `/recipe`, same params), `recipes/new`, `recipes/$recipeId`, `recipes/$recipeId/edit`,
   `import`, `import/$draftId`, `collections`, `collections/$collectionId`, `shopping`,
   `shopping/cards`, `shopping/history` (`SHOPPING_HISTORY_PARAMS` sanitising), `shopping/$listId`,
   `tags`, `plan` (`week` normalised to Monday); every screen a `lazyRouteComponent(() =>
   import(...))` of its default export (never a static screen import — decision 15); R's route
   comments kept; `redirect({ to: "/recipe", … })` for `/search`. Imports: `@/route-roots`,
   `@/modules/layout`, the param helpers from `features/recipes/lib/url-filters` and the shopping
   history params — no `@/modules` registry, no `@/components/layout`. Export `recipeRouteTree =
   recipeLayoutRoute.addChildren([...])`.
4. `modules/recipe/HomeCard.tsx`: a `Card` per D5 (design-system primitives from
   `@/components/ui` and type scale only, no arbitrary `text-[…px]`) with the module name
   (`common.nav.recipes`), this week's planned recipes (from `planQuery` for the current week via
   `@toon/shared` calendar helpers, titles linking via `AppLink` to `/recipe/recipes/$recipeId`),
   the open item count of the active shopping lists (`shoppingListsQuery`,
   `recipe.shopping.list.itemCount`), links to `/recipe/plan` and `/recipe/shopping`. Reuse existing
   catalog keys (`recipe.plan.thisWeek`, `recipe.plan.title`, …); a genuinely new German string
   goes into the recipe catalog AND `NEW_GERMAN` in `scripts/i18n-check.ts` with a reason. Empty
   states render nothing extra (R "THREE SCREENS…" consequence). It imports no `@/components/
   layout` path and no `@/modules` registry (decision 15). M4 polishes it.
5. `modules/recipe/index.ts`: `export const recipeModule = { id: "recipe", nameKey:
   "common.nav.recipes", icon: BookOpen, basePath: "/recipe", route: recipeRouteTree, navItems: [
   { to: "/recipe", labelKey: "common.nav.recipes", icon: BookOpen, exact: true }, { to:
   "/recipe/plan", labelKey: "common.nav.plan", icon: CalendarDays, exact: false }, { to:
   "/recipe/shopping", labelKey: "common.nav.shopping", icon: ShoppingBasket, exact: false } ],
   secondaryNavItems: [ { to: "/recipe/collections", labelKey: "common.nav.collections", icon:
   Folder, exact: false }, { to: "/recipe/tags", labelKey: "common.nav.tags", icon: Tag, exact:
   false } ], homeCard: RecipeHomeCard, persistQueryAllowList: <decision 8>,
   persistMutationNamespaces: [["recipe", "shopping"]], mutationDefaults:
   registerShoppingMutationDefaults, catalogs: { de: recipeDe, en: recipeEn } } satisfies
   WebModule<"recipe">;` (no annotation). `modules/index.ts`: `export const WEB_MODULES =
   [recipeModule] as const satisfies readonly WebModule[];` — header updated.
6. Tests. Both new test files have `import { recipeModule } from "./index";` as their FIRST
   import and never import `@/modules` before it (decision 15: a TDZ crash here is the bug).
   `modules/recipe/persist.test.ts` — R `lib/persist.test.ts`'s recipe cases through
   `buildPersistPolicy([recipeModule])` with Table F keys (recipes, recipe detail, tags,
   collections, shopping lists, plan and bought persisted; `imports`, `import`, `import-draft`,
   `plan-shopping`, `shopping-catalog` not; `["toon","recipe","cards"]` exact yes,
   `…,"cards","x"` no; a PAUSED `["toon","recipe","shopping","check"]` mutation persisted, a
   settled one and `["toon","recipe","recipes","delete"]` not). `modules/recipe/manifest.test.ts`
   — three nav items + Profil from `primaryNavItems` at `/recipe/plan`; secondary = Sammlungen,
   Tags, Gruppen in that order; every secondary path has a phone route (the route tree's paths
   contain `/recipe/collections`, `/recipe/tags`, `/recipe/shopping/cards`); `mutationDefaults`
   registers a default for every `SHOPPING_MUTATION_KEYS` entry on a throwaway `QueryClient`. A
   type-level check in a test file: `// @ts-expect-error unknown route` above `const bad:
   LinkProps["to"] = "/recipe/does-not-exist";` (proves the strict tree for raw `<Link>`s; if
   decision 10 has to fall back, delete it and record why). The strict tree does NOT check
   `AppLink` targets; the `LINKS` grep does.
7. Fix any core `<Link to>` the strict tree rejects (each fix listed in the commit body).

**Files.** `apps/web/src/modules/recipe/{index.ts,routes.tsx,HomeCard.tsx,persist.test.ts,
manifest.test.ts}`, `apps/web/src/route-roots.tsx`, `apps/web/src/router.tsx`,
`apps/web/src/modules/{index,types}.ts`, `apps/web/src/modules/{persist.test.ts,layout.test.tsx}`,
`apps/web/src/components/layout/{nav-items.test.ts,module-switcher-items.test.ts}`,
`scripts/i18n-check.ts` (only if new German), core files with a `<Link>` the strict tree rejects.

**Acceptance.** `WEB_MODULES` has the recipe manifest; typecheck green with the strict tree (or a
recorded fallback); the module's tests pass when run alone (manifest imported first, no TDZ);
`bun run build` emits a chunk per lazy screen; the library route keeps `RECIPE_FILTER_PARAMS` on
both `/recipe` and `/recipe/search`; `route-roots.tsx` imports neither `@/modules` nor the shell;
no `apps/web/src/features/` directory; Home renders the recipe card for a household with recipe
enabled (verified in T12).

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/web/src/modules/recipe/manifest.test.ts`;
`cd H && bun test apps/web/src/modules/recipe/persist.test.ts`;
`cd H && bun test apps/web/src/modules apps/web/src/components/layout`;
`cd H && bun test`; `cd H && bun run build`;
`cd H && grep -q 'recipeModule' apps/web/src/modules/index.ts`;
`cd H && ! grep -nE '@/modules"|@/modules/index|AppShell|@/components/layout"' apps/web/src/route-roots.tsx`;
`cd H && ! grep -nE 'from "@/modules"|@/components/layout' apps/web/src/modules/recipe/index.ts apps/web/src/modules/recipe/routes.tsx apps/web/src/modules/recipe/HomeCard.tsx`;
`cd H && test ! -d apps/web/src/features`;
`cd H && ! grep -rnE '@/features/|/api/groups|"group",|\bgroupId\b' apps/web/src/modules/recipe`;
`LINKS` (§3).

---

### M2-T12 — Integration (build)

**Goal.** Prove the exit criteria on the merged tree: gates, a fresh DB walkthrough, the headless
checks at 390 px and 1440 px, then sync the docs (CLAUDE.md, SPEC §2/§3 text, this plan's §9).

**Read.** SPEC §5, §7, §8 (M2 exit); this plan §1, §5–§8; R/CLAUDE.md "Navigation", gotchas
"Verify a phone layout in a real headless browser" (log in with `fetch("/api/auth/login")` from the
page, `scrollWidth`, never match the tab bar by aria-label), "A CAMERA FEATURE CAN BE TESTED
HEADLESS" (optional), "THE SHOPPING LIST IS THE ONE THING EDITABLE OFFLINE", "The URL importer's
SSRF guard" (`IMPORT_ALLOW_PRIVATE_HOSTS=1`, dev only); `H/CLAUDE.md` gotcha "`scrollbar-gutter:
stable`" (`scrollWidth <= clientWidth`), "Long commands"; M1 plan §7 (how the headless run was
done).

**Work.**
1. Gates, each to its own log under `data/` ending in `exit=$?`: `bun install --frozen-lockfile`,
   `bun run typecheck`, `bun test`, `bun run build`, `bun run i18n:check` — classify every
   leftover hit (expected classes: comment quotes of German labels; content vocabulary such as
   `UNIT_SUGGESTIONS`, ingredient paste placeholders, `STEP_HEADING_RE`, `html/entities.ts`; NEW in
   H: files under `features/plan` and `features/cards`, which R's `PORTED_ROOTS` never scanned —
   classify them, never suppress the check). Parity half must be OK.
2. Fresh `data/m2.db`: `db:migrate`, `seed` (twice: idempotent), `uploads:gc -- --dry-run`; dev
   server with `IMPORT_ALLOW_PRIVATE_HOSTS=1`; a static server (scratch dir, port 4599) serving a
   copy of `apps/api/test/fixtures/import/chefkoch-graph.html`. Curl walkthrough with cookie jars:
   health (`modules: ["recipe"]`, OCR flags), recipe list/create/detail/scale/cooked, tag create,
   collection create + add recipe, plan create/read, shopping list create, add items twice with the
   same `mutationId` (applied once), check-off, bought history, import from URL → draft → commit,
   card create/list, `DELETE …/modules/recipe` → `404 module_disabled` on a recipe route →
   re-enable.
3. Headless (Playwright in a scratch dir outside the repo, chromium, one log ending `exit=$?`,
   demo login), at 390×844 and 1440×900, no console errors, `scrollWidth <= clientWidth` on each:
   Home (recipe card), `/recipe`, `/recipe/recipes/new`, `/recipe/recipes/$id`,
   `/recipe/recipes/$id/edit`, `/recipe/plan`, `/recipe/shopping`, `/recipe/shopping/$listId`,
   `/recipe/shopping/history`, `/recipe/shopping/cards`, `/recipe/collections`,
   `/recipe/collections/$id`, `/recipe/tags`, `/recipe/import`, `/recipe/import/$draftId`,
   `/settings`. Tab bar (`nav.fixed`) at 390 inside `/recipe` = Rezepte, Plan, Einkauf, Profil;
   sidebar at 1440 = the same + ORGANISIEREN Sammlungen, Tags, Gruppen. Reachability at 390: the
   library `+` opens the sheet with Importieren and Neues Rezept; the Filter sheet has the links to
   `/recipe/collections` and `/recipe/tags`; `/recipe/shopping` shows `CardsCard` linking to
   `/recipe/shopping/cards`; `/settings` shows the Gruppen card. Recipe count (decision 13): at 390
`/recipe`'s subtitle reads "Familie · N Rezepte" and at 1440 "Geteilt mit Familie · 1 Mitglied ·
N Rezepte", N = the household's recipe count from the API (`GET …/recipe/recipes?limit=1` →
`total`), and N stays the same with a filter set (`?q=…`). Every recipe link clicked during the
run lands on a `/recipe/…` URL (no `NotFoundPage`). Flows: (a) URL import of the
   fixture through the UI to a committed recipe; (b) offline check-off replay — preferably against
   the built app (`bun run build`, `WEB_DIST_DIR=./apps/web/dist bun run start`, SW active): open a
   list with items, `context.setOffline(true)`, tick an item ("1 Änderung wartet"), reload, still
   queued, `setOffline(false)`, the replay empties the queue and the API shows the item gone and
   logged once; if the SW cannot be used, the no-reload variant and the reason go in §9; (c) card
   render — create an EAN-13 card via the API, open it on `/recipe/shopping/cards`, an `<svg>` with
   `shape-rendering="crispEdges"` on a white surface; (d) M1's handed-on check: disable `recipe`,
   load `/recipe` → Home with the toast "Dieses Modul ist für diesen Haushalt nicht aktiviert.",
   re-enable.
4. Docs: `CLAUDE.md` (Status: M2 done; Layout: the module directories; Commands: `uploads:gc`;
   Gotchas in use: the M2 ones — module routers drop session/member middleware, `route-roots.tsx`
   and the module-owned layout route, table/index naming and M3's TS-prefix duty, fold backfill as
   `afterMigrate`, import tests use real sessions, plan/cards now scanned by i18n:check;
   Obligations: what §8 hands on; also the decision-15 import-graph rule, the decision-14 import
   keys, `useHouseholdRecipeCount`, and that `AppLink` targets are checked by the `LINKS` grep,
   not by `tsc`), `docs/SPEC.md` §2 (the `ApiModule` hooks, `WebModule.route`)
   and §3 (`route-roots.tsx` without the shell, module `lib/` shims) — prose only, never §1; this plan §9 with the
   gate results, the classified i18n hits, the curl transcript summary and the headless results.
   Any fix found here is its own commit naming the failing check.

**Files.** `CLAUDE.md`, `docs/SPEC.md` (§2, §3), `docs/plans/m2-recipe-module.md`, and any file a
failing check requires (each fix its own commit).

**Acceptance.** All of §1's exit criteria with evidence in §9; no `M2:` placeholder left in the
tree; CLAUDE.md names no file that does not exist.

**Verify.** `cd H && bun install --frozen-lockfile`; `cd H && bun run typecheck`; `cd H && bun test`;
`cd H && bun run build`;
`cd H && mkdir -p data && { bun run i18n:check > data/m2-t12-i18n.log 2>&1; true; } && sed -n '/1\/2 German catalog parity/{n;p;}' data/m2-t12-i18n.log | grep -qx '\[i18n:check\] OK'`;
`cd H && grep -q '## 9. Integration record' docs/plans/m2-recipe-module.md`;
`cd H && grep -q 'M2 recipe' CLAUDE.md`;
`LINKS` (§3);
`cd H && ! grep -rn --exclude-dir=node_modules --exclude-dir=dist 'M2:' apps packages scripts --include='*.ts' --include='*.tsx'`.

## 5. Risks

1. **Port size.** T06 copies ~34 TypeScript files; it is a directory move whose only edits are the
   import-depth rows of Table B, given as exact substitutions, and the adapters must `diff`
   identical. T04's shim split of R's 1,610-line `lib/api.ts` and 501-line `lib/queries.ts` is
   given by line ranges; `tsc` catches a missing fetcher or key.
2. **Catalog key rewrite is prefix-based** (`"plan.`, `"import.` …). `MessageKey` is a literal union
   so a wrong or missed key fails `tsc`; a non-key string that happens to start with a prefix would
   be wrongly rewritten — the port briefs limit the rule to literals that START with the prefix and
   the verifier diffs against R.
3. **Import cycles.** API: `core/services/households/modules.ts` → `modules/index.ts` → recipe
   manifest → routes → `plan.service.ts` → `core/services/auth/users.ts` →
   `households/modules.ts` (cycle). Safe only while `API_MODULES` and imported functions are read
   inside functions (H gotcha). Web: rev. 1 had `route-roots.tsx` → `AppShell` → `BottomTabBar` →
   `use-nav-items` → `@/modules` → recipe manifest → `routes.tsx` → `route-roots.tsx`, which is NOT
   safe: `modules/index.ts` evaluates `WEB_MODULES = [recipeModule]` while `recipe/index.ts` is
   still evaluating, so any importer that reaches the manifest before `@/modules` (a manifest
   test) dies with a TDZ `ReferenceError`; only `app.tsx`'s import order hid it. Decision 15 cuts
   the cycle: `route-roots.tsx` holds no shell (`AppLayout` attached in `router.tsx` via
   `appRoute.update`), and the manifest's static graph (`routes.tsx`, `HomeCard.tsx`, catalogs,
   `offline.ts`) never imports the registry or `@/components/layout`; screens are lazy. T11b's
   tests import the manifest first and its verify greps the three files.
4. **Strict route tree** (decision 10) may hit TanStack/TS 7 type limits or reveal broken core
   links written while the tree was loose. Fallback: keep `AnyRoute`, record it. Either way the
   tree checks only raw `<Link>`s; recipe screens use string-typed `AppLink`/`useAppNavigate`/
   `go()`, so a missed Table G rewrite would compile — the `LINKS` grep (§3, in every web port
   task) and T12's headless run are the recipe link checks.
4a. **`Route.update` typing** (decision 15). `appRoute.update({ component })` exists in router-core
   1.171.28; if its `UpdatableRouteOptions` typing rejects `component`, T11b takes the recorded
   fallback (shell-free `appRoute`, shell attached in `router.tsx`), never an `AppShell` import in
   `route-roots.tsx`.
5. **Import route tests lose their auth stub** (decision 3). T09a rewrites the setup to real
   sessions in the shared DB plus the file-backed import DB; assertions stay R's.
6. **i18n:check's leftover half grows**: H scans `apps/web/src/modules`, which includes `plan` and
   `cards` — R never scanned those (`PORTED_ROOTS`). Every new hit is classified in §9; content
   files are on `ALLOW_LIST`, comment quotes are the known class.
7. **Tests share one process**: OCR/PDF flag seams, `setMailer`, `setVerifiedEmailRequired`,
   `setOcrEngine`, `setPdfRasterizer`, `setImportDbForTests` must be handed back in
   `afterAll`/`afterEach`; `mock.module` is not used (R gotcha).
8. **pdf-rasterize needs `pdftoppm`** (present at `/bin/pdftoppm` here; CI gets poppler from T06).
   It must fail, never skip, without it.
9. **Offline replay in a headless browser** needs the SW for the reload half; the dev server has
   no SW. T12 uses the built app; the fallback is documented.
10. **Merge conflicts on the manifest** (`apps/api/src/modules/recipe/index.ts`) are avoided by
    deps: T03 → T05 → T09a is a chain (T09b never edits it).
11. **Task size.** Rev. 1's T09 (22 files) and T11 (26 files, mixed port/core) exceeded the
    45–120-minute budget; rev. 2 splits them (T09a/b/c, T11a/b). The largest remaining port is
    T10 (26 files, mechanical) and T06 (~41 files, scripted copy with exact substitutions).

## 6. Deviations expected (to be confirmed in "what changed vs plan")

None from SPEC §1. Plan-level choices to confirm:

- URL scheme: every R path under `/recipe` (`/recipe/recipes/$id` …); D6 fixes only the tab paths.
- `ApiModule` gains `afterMigrate`, `shutdown`, `seedDemo`, `uploadReferences`; `WebModule.routes`
  becomes `route` (module-owned layout route) and `route-roots.tsx` is a new core file (SPEC §2/§3
  text updated by T12).
- TS table identifiers stay R's; SQL table and index names are prefixed; M3 must prefix finance's
  TS identifiers.
- The fresh migration declares the fold columns `NOT NULL` without `DEFAULT ''`.
- Recipe routers no longer apply `requireSession`/`requireHouseholdRole("member")` themselves;
  `middleware-bridge.ts` is not ported; the import route tests use real sessions.
- Cards (`/api/recipe/cards`) are not gated by `requireModule` (user-owned, R decision 11).
- `recipe.count.recipes` lives in the recipe catalog (ADR 0001 removed only the core's copy).
- Recipe drizzle relations have no reverse side on `users`/`households`.
- `index.ts`'s shutdown log line is English (ops output rule), not R's German.
- The home card is functional, not designed (M4).
- The library subtitle's recipe count comes from an unfiltered `recipes?limit=1` query
  (`useHouseholdRecipeCount`, decision 13), not from the household object; the subtitle renders
  only once the count is known. Catalog values unchanged, so no ADR (ADR 0001's Consequences
  foresaw this).
- The import feature's query keys move under `"toon"` (decision 14: household-scoped lists/tags,
  user-scoped draft); `useCommitDraft`'s "contains `recipe`" predicate becomes
  `invalidateAfterRecipeMutation` because every module key now contains `"recipe"`.
- `AppLayout` (the shell) is attached to `appRoute` from `router.tsx` via `Route.update`, so
  `route-roots.tsx` imports no shell (decision 15).
- Recipe link targets are not type-checked (string-typed `AppLink`, as in R); a grep gate stands
  in for `tsc` (§3 `LINKS`).

## 7. Out of this milestone

Finance (M3); the home cards' final design, R's sidebar per-item counts and the Plan "Neu" pill,
the PWA manifest `shortcuts` (`/recipe/import`, `/recipe/recipes/new`), print-to-PDF verification of
`print.css`, "Gruppe" vs "Haushalt" copy (M4); redirects from R's old paths (`/recipes/…`, `/plan`,
`/shopping`, `/import`) for bookmarks arriving through the old-hostname redirect (M6, with the
Caddyfile); `migrate:legacy` and its use of `afterMigrate` (M5); Dockerfile `WITH_OCR`/`WITH_PDF`
(M6); `docs/API.md`, `docs/modules/recipe.md` (M7); real OCR in tests (R never runs it).

## 8. Obligations

**Closed by M2** (from M0/M1): `formatDuration` tests (T01); remaining `schemas.test.ts` cases
(T01); `formatMinutes`/`formatServingsLabel` re-homed (T04); fold backfill (T03); recipe SW rules
(T02); poppler in CI (T06); `hasAtLeast` from `@/lib/permissions`, share helpers from `@/lib/share`
(T04, T07, T11a); the `M2:` placeholders of `uploads`, `verified-email-gate`, `households`, `seed`
(T09c, T03/T05); cross-household guard tests for the recipe module (T09c);
`persistMutationNamespaces` next to `mutationDefaults` with a paused-mutation test (T11b);
literal-typed registry and module routes reaching their layout without a cycle (T11b); ADR 0001's
"the recipe module supplies [the counts]" for the library subtitle (T04 + T11a); headless
disabled-module redirect (T12).

**R test file → H counterpart.** api: `recipes`, `recipes-cooked`, `recipes-search`, `tags-kind`,
`plan`, `cards` (T05); `import/{helpers,url-extract,url-pipeline,ssrf,ocr-segment,ocr-tesseract,
pdf-rasterize}` (T06); `import/{commit,routes,ocr-disabled}` (T09a); `shopping`,
`shopping-bought`, `shopping-from-plan` (T09b); `uploads`, `verified-email-gate` (T09c); `groups` →
`households` (M1 + T09c); `auth`, `mail`, `mail/smtp`, `password-reset`, `smoke`, `static-web`, `thumbnails`,
`support/files` (M1, unchanged). shared: `barcode`, `cards`, `duration`, `ingredients`, `numbers`,
`qr`, `shopping`, `tags`, `units`, `schemas` → `recipe-schemas` + `core` (T01); `calendar`, `i18n`
(M0/M1 + T01). web: `cards/lib/{formats,roundtrip}.test` (T10); `import/lib/{confidence,draftEdit,
importErrors}.test` (T08); `shopping/lib/offline.test` (T04); `lib/persist.test` (core M1 +
`modules/recipe/persist.test`, T11b); `lib/i18n/i18n.test`, `lib/unsavedWork.test`,
`lib/validation.test` (M0/M1).

**Handed on.** M3: finance TS table identifiers prefixed (`financeTags`, …) because `db/schema.ts`
re-exports both modules flat; finance's `onEnable` participant check (from M1). M4: as in §7. M5:
`migrate:legacy` maps R tables to `recipe_*` (Table C) and relies on `afterMigrate` for folds. M6:
old-path redirects for bookmarks; image `WITH_OCR=1 WITH_PDF=0`.
