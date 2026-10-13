# M0 — scaffold: plan

Milestone M0 of `docs/SPEC.md` §8. Written 2026-10-13 by the planner of the `build-household`
workflow. Paths: `H` = `/home/erics/software/toon-household` (this repo), `R` =
`/home/erics/software/toon-recipe`, `F` = `/home/erics/software/toon-finance` (both READ-ONLY).
Revised the same day after plan review: unported-code tests (T02, T06), `CommonCatalog` (T06),
literal-typed module catalogs (T11), schema header/imports/Row names (T05), `legacy_ids.table`
kept per D12, manifest-assembled mutation persistence (T08/T11), the cross-household guard as a
named M2/M3 obligation, chain-order tests (T09).

## 1. Context

State of `H` at plan time: one commit (`a9e57f5`), holding `README.md`, `CLAUDE.md`, `.gitignore`,
`.bun-version` (1.4.2), `docs/SPEC.md`, `docs/plans/.gitkeep` and the workflow. No code, no
`package.json`, no lockfile. Every gate fails today because there is nothing to run.

Goal (SPEC §8 M0): the monorepo skeleton per SPEC §3, copied from toon-recipe where D13 allows —
root workspace + scripts, `packages/shared` core (i18n runtime + server catalogs, calendar, text,
http url schema, list envelope, `modules/registry.ts`), `apps/api` foundation (env, db client with
D7 pragmas, migrate, the core schema with the household tables, lib, the five middlewares, health
reporting `modules`, empty module registry), `apps/web` foundation (vite + PWA + three tsconfigs,
styles, fonts, `components/ui`, the shell with an empty module-less tab bar, `lib/*`, i18n, empty
module registry, router with a placeholder Home), the smoke test, CI, CLAUDE.md "Commands".

Exit criteria: `bun install`, `bun run typecheck`, `bun test`, `bun run build` green and
`bun run i18n:check` clean (every hit classified into a known false-positive class);
`bun run dev` serves `/api/health` with `{"ok":true,…,"modules":[]}` and the web app renders the
empty shell; CLAUDE.md "Commands" lists what exists.

### Decisions this plan takes (binding for the tasks below)

1. **Package names stay `@toon/shared`, `@toon/api`, `@toon/web`**; the root package is
   `toon-household`. Every consumer imports the shared package through the barrel
   `"@toon/shared"` only — the vite alias maps exactly that specifier to
   `packages/shared/src/index.ts`, so a deep import like `"@toon/shared/core/…"` would break the
   build. Moving files inside `packages/shared` therefore changes no consumer import.
2. **toon-recipe's web namespace `ui.*` becomes core `common.*`** (SPEC D10 names the core
   namespaces `common.*`, `auth.*`, `household.*`, `home.*`; `ui` is not one of them). It is a pure
   KEY rename (`"ui.` → `"common.` on keys and call sites); values stay byte-identical. So
   `ui.common.dash` becomes `common.common.dash` — accepted, a mechanical rename beats a redesign.
   Every later port of a recipe screen applies the same `"ui.` → `"common.` rewrite.
3. **Fixed new identifiers** (tasks in different waves rely on them):
   - shared: `HouseholdRoleSchema`, `HouseholdRole`, `InvitableRoleSchema`, `InvitableRole`,
     `ROLE_RANK`, `roleAtLeast` in `core/schemas/household.ts`; `MODULE_IDS`, `ModuleId`,
     `isModuleId` in `modules/registry.ts`; `UserSchema.activeHouseholdId`;
     `ERROR_CODES` gains `"module_disabled"`; server key `"server.module.disabled"`.
   - api schema exports: `users`, `oauthAccounts`, `sessions`, `passwordResetTokens`,
     `emailVerificationTokens`, `households`, `householdMembers`, `householdInvites`,
     `householdModules`, `legacyIds`; `users.activeHouseholdId` (column `active_household_id`);
     `householdMembers.{id,householdId,userId,role,createdAt}`; `legacyIds.{tableName,
     legacySource,legacyId,newId,createdAt}` with `tableName` mapped to the SQL column `table`
     (D12's name, quoted by drizzle). Row types, exactly these names: `UserRow`, `NewUserRow`,
     `OAuthAccountRow`, `NewOAuthAccountRow`, `SessionRow`, `NewSessionRow`,
     `PasswordResetTokenRow`, `NewPasswordResetTokenRow`, `EmailVerificationTokenRow`,
     `NewEmailVerificationTokenRow`, `HouseholdRow`, `NewHouseholdRow`, `HouseholdMemberRow`,
     `NewHouseholdMemberRow`, `HouseholdInviteRow`, `NewHouseholdInviteRow`, `HouseholdModuleRow`,
     `NewHouseholdModuleRow`, `LegacyIdRow`, `NewLegacyIdRow` (R's `GroupRow`/`GroupMemberRow`/
     `GroupInviteRow` families are renamed, never aliased).
   - api: `Membership = { householdId, userId, role: HouseholdRole }`; `API_MODULES`;
     `requireHouseholdRole`, `requireModule`, `mountModules`.
   - web: `CATALOGS`/`MessageKey` from `lib/i18n/catalogs/index.ts`; `commonDe`/`commonEn` and
     `type CommonCatalog` (R's `UiCatalog`, renamed); `homeDe`/`homeEn`; `WEB_MODULES`
     (`modules/index.ts`), `MODULE_CATALOGS_DE/EN` (`modules/catalogs.ts`, literal-typed, never
     `Record<string, …>`); `QueryKeyPrefix`, `createShouldPersistQuery`,
     `createShouldPersistMutation` (`lib/persist.ts`); `PERSIST_BUSTER = "household-v1"` (D9);
     `WebModule.persistMutationNamespaces` and `buildPersistPolicy` (`modules/persist.ts`).
   - New German copy (D10, the only new German in M0; `i18n-check.ts` lists each key in
     `NEW_GERMAN`): `server.module.disabled` = „Dieses Modul ist für diesen Haushalt nicht
     aktiviert.", `home.appName` = „Haushalt", `home.nav.label` = „Start", `home.title` = „Start",
     `home.empty.title` = „Noch keine Module aktiviert", `home.empty.body` = „Sobald ein Modul für
     diesen Haushalt aktiviert ist, erscheint es hier." (en: "This module is not enabled for this
     household.", "Household", "Home", "Home", "No modules enabled yet", "Once a module is enabled
     for this household, it shows up here.").
4. **Health shape**: toon-recipe's `{status, version, time, database, features}` plus
   `ok: true` and `modules: string[]` (the BUILD's modules, SPEC §2). `features` is the core
   `verifiedEmailRequired` plus whatever each module's `healthFeatures()` returns
   (`ServerFeaturesSchema` = known core keys + `.catchall(z.boolean())`).
5. **D7 pragmas**: toon-recipe's `db/client.ts` with `synchronous = FULL` and toon-finance's
   rationale comment (D13 names this override explicitly; recipe's "NORMAL" gotcha is superseded).
6. **Circular-import guards on the web side**: module catalogs reach the i18n registry through
   `apps/web/src/modules/catalogs.ts` (imports ONLY each module's `catalogs/` files), never through
   `modules/index.ts` (which imports routes and screens); nav items are computed by functions at
   render time, never as module-level constants over `WEB_MODULES`.
7. **`legacy_ids` keeps D12's column name `table`.** Drizzle quotes every identifier (drizzle-kit
   emits `` `table` `` for SQLite), so the SQL keyword is harmless; the TS property is
   `tableName` (`tableName: text("table").notNull()`). No deviation, no ADR.
8. **Persisted mutations are assembled from the manifests too (D9).** `WebModule` gains
   `persistMutationNamespaces?: readonly (readonly string[])[]` (each entry a key path after
   `"toon"`, e.g. `["finance","tx"]`); a §2 contract EXTENSION, recorded in §4 (§2 is not §1, no
   ADR). `app.tsx` feeds both factories from `WEB_MODULES` through `buildPersistPolicy`.
9. **Cross-household guard (D8).** Module routes take the household from `:householdId` only;
   R's recipe/collection/tag/draft resolvers in `group.ts` are dropped. The guard moves into the
   services: every by-id lookup in a module service is scoped by `membership.householdId` and
   answers `404 not_found` otherwise, with one cross-household test per resource. Binding on
   M2/M3 (§4 "Obligations"); T09 writes the rule into the `household.ts` and `modules/types.ts`
   doc comments.

## 2. Task list and waves

The orchestrator takes up to three ready tasks per wave in list order; a wave of one runs on main.

| Wave | Task | Tier | Title | Deps |
| --- | --- | --- | --- | --- |
| 1 | M0-T01 | build | Workspace skeleton | — |
| 2 | M0-T02 | port | Shared core | T01 |
| 2 | M0-T03 | port | Web static assets, styles, design record | T01 |
| 2 | M0-T04 | build | Tooling: household i18n-check + CI | T01 |
| 3 | M0-T05 | core | API foundation: env, lib, db (D7), core schema, health, registry | T02 |
| 3 | M0-T06 | port | Web i18n runtime, `common` catalog, api transport, small libs | T02 |
| 4 | M0-T07 | port | API core services (mail, auth sessions/users/verifiedEmail) + staticWeb | T05 |
| 4 | M0-T08 | build | Web data layer: queries, query-client, persist (D9) | T06 |
| 4 | M0-T10 | port | `components/ui` primitives | T06 |
| 5 | M0-T09 | build | API middleware chain + module mounting | T05, T07 |
| 5 | M0-T11 | core | Web shell: layout, module registry, router, Home | T03, T08, T10 |
| 6 | M0-T12 | build | Integration: gates, dev boot, headless render, CLAUDE.md Commands | all |

File ownership per wave is disjoint (see each task's "Files"). Shared files: root/workspace
`package.json` + `bun.lock` belong to T01 alone (no later M0 task adds a dependency);
`apps/api/src/index.ts` is a T01 stub → rewritten by T05 → edited by T09; `apps/web/src/main.tsx`
is a T01 stub → rewritten by T11; `lib/i18n/catalogs/index.ts` and `lib/i18n/i18n.test.ts` are
created by T06 and edited by T11; `apps/api/test/smoke.test.ts` is created by T05 and edited by
T09; `apps/api/src/modules/types.ts` is created by T05 and gets one doc-comment line from T09;
`CLAUDE.md` belongs to T12.

Every task's brief also implies: read `H/docs/SPEC.md` §1 and §3, `H/CLAUDE.md`, and the source
files named; commit with a body naming the SPEC decision / source file served, ending with the
`Co-Authored-By` line the workflow prescribes; no pushes. Long `bun install` runs go to the
background with a log ending in `exit=$?`.

---

### M0-T01 — Workspace skeleton (build)

**Goal.** Root workspace, the three workspace packages, all tsconfigs, `scripts/dev.ts` +
`scripts/typecheck.ts`, vite config + `index.html`, the lockfile, and the minimum inputs so that
all five tsc projects, `bun test` and `bun run build` are green from the first commit.

**Read.** SPEC §3 (`package.json` row, workspaces), §7, D9 (SW rules), D14. R/CLAUDE.md
"Architecture", gotchas "`apps/api/tsconfig.json` only includes `test/**`", "`apps/web` IS THREE TS
PROJECTS", "Vite must keep `envDir`…", "The service worker is generated by `vite-plugin-pwa`",
"`skipWaiting` is OFF", "Bun 1.4 uses the ISOLATED linker", "TypeScript 7 … `baseUrl`". Sources:
R/package.json, R/tsconfig.json, R/bun.lock, R/apps/api/{package.json,tsconfig.json},
R/apps/web/{package.json,tsconfig.json,tsconfig.node.json,tsconfig.test.json,vite.config.ts,index.html},
R/apps/web/src/{env.d.ts,lib/unsavedWork.ts,lib/unsavedWork.test.ts},
R/packages/shared/{package.json,tsconfig.json}, R/scripts/{dev.ts,typecheck.ts}.

**Steps.**
1. If `docs/plans/m0-scaffold.md` is untracked, commit it with your first commit (worktrees of
   later waves need it).
2. `package.json` from R: `"name": "toon-household"`; scripts exactly `dev`, `dev:api`, `dev:web`,
   `build`, `start`, `test`, `typecheck`, `i18n:check`, `db:generate`, `db:migrate`, `db:studio`
   (drop `seed`, `auth:reset-password`, `uploads:gc` — their scripts arrive in M1/M2);
   devDependencies verbatim. `tsconfig.json` verbatim. `.bun-version` stays `1.4.2`.
3. `packages/shared/{package.json,tsconfig.json}` verbatim.
4. `apps/api/package.json` from R minus scripts `seed`, `auth:reset-password`, `uploads:gc` and
   minus dependencies `sharp`, `unpdf` (M1 media / M2 import add them). Keep `arctic`,
   `@hono/zod-validator`, `@libsql/client`, `drizzle-orm`, `hono`, `zod`, `@toon/shared`.
   `apps/api/tsconfig.json` verbatim.
5. `apps/web/package.json` from R minus `zxing-wasm` (M2 cards). The three web tsconfigs verbatim,
   comments included.
6. `scripts/dev.ts`, `scripts/typecheck.ts` verbatim.
7. `apps/web/vite.config.ts` from R with exactly these rewrites: manifest `name` and `short_name`
   `"Rezepte"` → `"Haushalt"`; delete the manifest `description`; delete `shortcuts` (M4 adds
   `/recipe/import` and `/finance/new`); `categories` → `["lifestyle", "productivity"]`;
   `RUNTIME_CACHING` keeps ONLY the `/\/api\/auth\//` NetworkOnly rule and the `/\/uploads\//`
   CacheFirst rule (with their comments) — delete the imports/shopping-lists/plan/cards NetworkOnly
   rules and the recipes|tags|collections NetworkFirst rule, and in their place leave a comment:
   module rules are added by M2/M3 under `/api/households/[^/]+/<module>/…`, as the union of both
   sources' lists (SPEC D9), and every NetworkOnly rule must precede any NetworkFirst rule (order is
   load-bearing, R/CLAUDE.md). Every other line and comment unchanged (envDir, envPrefix,
   navigateFallbackDenylist, skipWaiting false, proxy, aliases, `sourcemap: false`).
8. `apps/web/index.html` from R: `<title>` and the `application-name` /
   `apple-mobile-web-app-title` contents `Rezepte` → `Haushalt`; delete the
   `<meta name="description">` element; everything else byte-identical (noscript German, theme
   script, font preloads, the status-bar comment).
9. `apps/web/src/env.d.ts`, `apps/web/src/lib/unsavedWork.ts`, `apps/web/src/lib/unsavedWork.test.ts`
   verbatim.
10. Stubs (TS18003: tsc fails on a project without inputs, and `bun test` needs ≥1 test file),
    each with a one-line comment naming the task that replaces it:
    `packages/shared/src/index.ts` (`export {};` → T02), `apps/api/src/index.ts` (`export {};` → T05),
    `apps/web/src/main.tsx` (`export {};` → T11).
11. `cp R/bun.lock bun.lock` (so retained packages resolve to the versions toon-recipe verified),
    then `bun install` in the background (`> $LOG 2>&1; echo "exit=$?" >> $LOG`), poll until
    `exit=`. Commit `bun.lock`. `.gitignore` already covers `node_modules`, `dist`, `data`,
    `.worktrees`; do not edit it.

**Files.** `package.json`, `bun.lock`, `tsconfig.json`, `scripts/dev.ts`, `scripts/typecheck.ts`,
`packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`,
`apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/index.ts`, `apps/web/package.json`,
`apps/web/tsconfig.json`, `apps/web/tsconfig.node.json`, `apps/web/tsconfig.test.json`,
`apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/env.d.ts`, `apps/web/src/main.tsx`,
`apps/web/src/lib/unsavedWork.ts`, `apps/web/src/lib/unsavedWork.test.ts`, `docs/plans/m0-scaffold.md`.

**Acceptance.** `bun install --frozen-lockfile` exits 0; `bun run typecheck` checks five projects
and prints `[typecheck] OK`; `bun test` passes (the unsavedWork tests); `bun run build` emits
`apps/web/dist/{index.html,sw.js}` and a `.webmanifest` whose name is "Haushalt"; `bun.lock`
contains no `sharp`, `unpdf`, `zxing-wasm`.

**Verify.** `bun install --frozen-lockfile`; `bun run typecheck`; `bun test`; `bun run build`;
`test -f apps/web/dist/sw.js`; `grep -q '"Haushalt"' apps/web/dist/manifest.webmanifest`;
`! grep -q zxing-wasm bun.lock`.

---

### M0-T02 — Shared core (port)

**Goal.** `packages/shared/src/core/` (i18n runtime + server catalogs, calendar, text, common /
user / household-role schemas), `modules/registry.ts`, the barrels and the core tests.

**Read.** SPEC §2 (registry block), §3 (`packages/shared/src/core/`), D1, D2, D8, D10.
R/CLAUDE.md gotchas "The i18n layer is hand-rolled and its typing is the enforcement", "German copy
is a REFACTOR", "`foldText`/`FOLD_PAIRS` live in `@toon/shared`", "`FOLD_PAIRS` CANNOT BE COMPLETED",
"Anything a client can put in an `href` must be `HttpUrlSchema`". R/docs/i18n.md §1, §2, §4, §9.
Sources: R/packages/shared/src/{index.ts,calendar.ts,text.ts}, R/packages/shared/src/i18n/**,
R/packages/shared/src/schemas/{common.ts,user.ts,group.ts}, R/packages/shared/test/{i18n,calendar}.test.ts.

**Copies (verbatim unless a rewrite is listed).**
- `R/packages/shared/src/i18n/{index,locale,translate,types,zod}.ts` → `packages/shared/src/core/i18n/`
- `R/packages/shared/src/i18n/catalogs/{index,server.de,server.en}.ts` → `packages/shared/src/core/i18n/catalogs/`
- `R/packages/shared/src/{calendar,text}.ts` → `packages/shared/src/core/`
- `R/packages/shared/src/schemas/common.ts` → `packages/shared/src/core/schemas/common.ts`
- `R/packages/shared/src/schemas/user.ts` → `packages/shared/src/core/schemas/user.ts`
- `R/packages/shared/test/{i18n,calendar}.test.ts` → `packages/shared/test/`
Relative imports inside these files stay valid (`../i18n/zod.ts` from `core/schemas/` resolves to
`core/i18n/zod.ts`).

**Rewrites.**
1. `core/schemas/common.ts`: append to `ERROR_CODES`, after `"meal_plan_day_full"`:
   a doc comment "The household has not enabled the module this route belongs to (SPEC D2/D8).
   404, not 403: for that household the module's routes do not exist." and `"module_disabled",`.
   Replace the whole `ServerFeaturesSchema` declaration (its doc comment through
   `export type ServerFeatures`) with: keep the top doc comment's first paragraph, add "Core
   features are named here; each module's `healthFeatures()` merges its own booleans in (SPEC §2) —
   recipe's `ocrImport`/`pdfImport` return with M2. An unknown key reads as unavailable.", then
   `export const ServerFeaturesSchema = z.object({ verifiedEmailRequired: z.boolean().optional() }).catchall(z.boolean());`
   keeping the original `verifiedEmailRequired` doc comment on the property, and
   `export type ServerFeatures = z.infer<typeof ServerFeaturesSchema>;`. In `HealthResponseSchema`
   add as FIRST property `ok: z.literal(true),` (doc: "Always true on a healthy answer; what
   uptime probes and the M0 exit check read.") and after `database` add
   `modules: z.array(z.string()),` (doc: "The modules this BUILD contains (SPEC §2), not what a
   household enabled. Strings, not `ModuleId`, so an old client tolerates a newer server.").
2. `core/schemas/user.ts`: identifier renames `activeGroupId` → `activeHouseholdId`,
   `groupName` → `householdName`; in comments "group" → "household" where it names the group
   entity. Nothing else.
3. NEW `core/schemas/household.ts`: copy from `R/…/schemas/group.ts` ONLY the role block —
   `GroupRoleSchema` → `HouseholdRoleSchema`, `GroupRole` → `HouseholdRole`, `InvitableRoleSchema`,
   `InvitableRole`, `ROLE_RANK: Record<HouseholdRole, number>`, `roleAtLeast(role: HouseholdRole,
   required: HouseholdRole)`, with their doc comments ("group" → "household"). Imports: only
   `import { z } from "zod";`. Header comment: "Household DTOs (the renamed GroupSchema family) are
   ported by M1 (SPEC D1)."
4. `core/i18n/catalogs/server.de.ts`: add before the `/* mail */` section comment:
   `/* ---- modules ---- */` and
   `"server.module.disabled": "Dieses Modul ist für diesen Haushalt nicht aktiviert.",`.
   `server.en.ts`: `"server.module.disabled": "This module is not enabled for this household.",`.
   No other catalog change: every existing value and key stays byte-identical (including
   `server.group.*` and the `{groupName}` placeholders — M1 decides those).
5. NEW `packages/shared/src/modules/registry.ts`:
   ```ts
   /** The modules this codebase knows (SPEC §2). Order is display order. */
   export const MODULE_IDS = ["recipe", "finance"] as const;
   export type ModuleId = (typeof MODULE_IDS)[number];
   export function isModuleId(value: string): value is ModuleId {
     return (MODULE_IDS as readonly string[]).includes(value);
   }
   ```
6. NEW `packages/shared/src/core/index.ts`: `export *` from `./schemas/common.ts`,
   `./schemas/user.ts`, `./schemas/household.ts`, `./text.ts`, `./calendar.ts`, `./i18n/index.ts`.
   REPLACE the T01 stub `packages/shared/src/index.ts` with R's header comment ("toon-recipe" →
   "toon-household"; add "Module code lives in `modules/<id>/` and is re-exported here when the
   module lands.") and `export * from "./core/index.ts"; export * from "./modules/registry.ts";`.
7. Tests: in `test/i18n.test.ts` `"../src/i18n/index.ts"` → `"../src/core/i18n/index.ts"` and
   `"../src/i18n/zod.ts"` → `"../src/core/i18n/zod.ts"`; then DELETE the last describe block,
   `describe("formatDuration — locale-aware, byte-identical German default", …)` (R lines
   137–157, its three tests `await import("../src/duration.ts")`, which M0 does not port), and
   put in its place exactly this comment:
   `// formatDuration's three tests return in M2 with packages/shared/src/modules/recipe/duration.ts`
   `// (import path "../src/modules/recipe/duration.ts"); see docs/plans/m0-scaffold.md §4.`
   Every other line of the file stays byte-identical. In `test/calendar.test.ts`
   `"../src/calendar.ts"` → `"../src/core/calendar.ts"`. NEW `test/core.test.ts`: `MODULE_IDS`
   equals `["recipe","finance"]`; `isModuleId("recipe")` true, `isModuleId("groups")` false;
   `HealthResponseSchema.parse` accepts `{ok:true,status:"ok",version:"0.1.0",time:<iso>,
   database:"file",modules:[],features:{verifiedEmailRequired:false,ocrImport:true}}` and rejects
   the same object without `ok`; `ERROR_CODES` contains `"module_disabled"`; `roleAtLeast` matrix
   (owner≥admin≥member, member<admin); `resolveWireKey("de","server.module.disabled")` returns the
   German sentence above and `"en"` the English one.

Not ported (later milestones): `schemas/{auth,group(DTOs),recipe,plan,import,shopping,card}.ts`,
`units/ingredients/numbers/duration/tags/shopping/barcode/qr.ts` (M1/M2), `test/schemas.test.ts`.

**Files.** `packages/shared/src/index.ts`, `packages/shared/src/core/**`,
`packages/shared/src/modules/registry.ts`, `packages/shared/test/{i18n,calendar,core}.test.ts`.

**Acceptance.** shared typechecks; the three shared test files pass; `git diff --no-index` of
every copied file against its R source shows only the listed rewrites; `server.de.ts` differs from
R only by the one added key.

**Verify.** `bun run typecheck`; `bun test packages/shared`;
`diff R/packages/shared/src/text.ts packages/shared/src/core/text.ts`;
`diff R/packages/shared/src/calendar.ts packages/shared/src/core/calendar.ts`;
`diff -r R/packages/shared/src/i18n/translate.ts packages/shared/src/core/i18n/translate.ts`;
`! grep -q 'src/duration.ts"' packages/shared/test/i18n.test.ts`;
`grep -q "return in M2" packages/shared/test/i18n.test.ts`.

---

### M0-T03 — Web static assets, styles, design record (port)

**Goal.** Self-hosted fonts, icons, favicon, the three stylesheets, and toon-recipe's design record
copied to `docs/design/recipe-redesign/` (SPEC D5).

**Read.** SPEC D5. R/CLAUDE.md gotchas "THE PALETTE IS DECLARED FOUR TIMES…", "THE DISPLAY FAMILY
SHIPS EXACTLY ONE WEIGHT", "NEVER write `px-4 px-safe`". R/docs/redesign/SPEC.md §2.

**Steps (all verbatim, no rewrites).**
1. `cp -r R/apps/web/public/. apps/web/public/` (favicon.svg, fonts/ with 4 woff2 + 2 licences,
   icons/ with 6 png). The recipe icons stay until M4 replaces them.
2. `cp R/apps/web/src/styles/{index.css,theme.css,fonts.css} apps/web/src/styles/`.
3. Design record, TRACKED files only: `git -C R archive HEAD docs/redesign | tar -x -C <scratch>`
   then move `<scratch>/docs/redesign/*` to `docs/design/recipe-redesign/` (never copy the
   untracked `docs/redesign/briefs/`).
Styles are imported by `main.tsx` in T11; nothing imports them yet.

**Files.** `apps/web/public/**`, `apps/web/src/styles/{index.css,theme.css,fonts.css}`,
`docs/design/recipe-redesign/**`.

**Acceptance.** byte-identical copies; the four theme blocks intact; build still green.

**Verify.** `diff -r R/apps/web/public apps/web/public`;
`diff -r R/apps/web/src/styles apps/web/src/styles`;
`test -f docs/design/recipe-redesign/SPEC.md`; `bun run build`.

---

### M0-T04 — Tooling: household i18n-check + CI (build)

**Goal.** `scripts/i18n-check.ts` that proves German parity against the two SOURCE repos (the
household's own history has none of the ported strings) and scans the household layout for
leftover German; `.github/workflows/ci.yml`.

**Read.** SPEC D10, §7. R/scripts/i18n-check.ts (whole), R/CLAUDE.md "Verification gates" (the
three false-positive classes) and gotcha "German copy is a REFACTOR"; R/docs/i18n.md §11;
R/.github/workflows/ci.yml; F/CLAUDE.md "Verifikations-Gates" (no i18n:check there; subsumed).

**Changes to the R script.**
1. Catalog roots: `packages/shared/src/core/i18n/catalogs`, `apps/web/src/lib/i18n/catalogs`, and
   every existing `apps/web/src/modules/*/catalogs` and `packages/shared/src/modules/*/catalogs`.
2. Parity: a fragment passes when `git grep -F -q -e <fragment> <base>` finds it in this repo's
   base commit (unchanged logic) OR `git -C <source> grep -F -q -e <fragment> HEAD` finds it in a
   source repo. Sources: env `I18N_CHECK_SOURCES` (colon-separated absolute paths); default the
   siblings `toon-recipe` and `toon-finance` of the MAIN checkout, resolved through
   `git rev-parse --path-format=absolute --git-common-dir` → parent dir → its parent (so the
   script works from `.worktrees/<task>`). Print the resolved sources first; a missing source
   prints a warning and is skipped. Cache results per fragment.
3. `NEW_GERMAN`: keep R's `server.zod.*` entries; add `server.module.disabled`, `home.appName`,
   `home.nav.label`, `home.title`, `home.empty.title`, `home.empty.body`, each commented "M0: new
   household copy (SPEC D10)".
4. Leftover check: `PORTED_ROOTS` = `apps/web/src/core`, `apps/web/src/modules`,
   `apps/web/src/components`, `apps/web/src/lib`, `apps/api/src`, `packages/shared/src`.
   `ALLOW_LIST` mapped to the household paths: `packages/shared/src/core/text.ts`,
   `packages/shared/src/modules/recipe/{units,ingredients,numbers,duration,tags}.ts`,
   `apps/api/src/modules/recipe/services/import/ocr/{quantity-fix,segment}.ts`,
   `apps/api/src/modules/recipe/services/import/url/{schema-map.ts,adapters,fetch.ts,ssrf.ts,image.ts}`,
   `apps/api/src/modules/recipe/services/import/{parsed,times}.ts`, `apps/api/scripts/seed.ts`.
   `isAllowed` additionally treats any path containing `/catalogs/` under `apps/web/src/modules/`
   or `packages/shared/src/modules/` as a catalog.
5. Output lines and exit-code semantics unchanged.

**CI.** Port R/.github/workflows/ci.yml: keep name, triggers, concurrency, permissions and the
`verify` job (checkout, setup-bun from `.bun-version`, cache, `bun install --frozen-lockfile`,
typecheck, test, build with `PUBLIC_API_URL: ""`, the PWA-output assertion). Drop the poppler step
(comment: M2 re-adds it with the PDF rasterize test) and the `docker-build` job (M6 adds it with the
Dockerfile). No i18n:check step (comment: it needs the two source repos next to the checkout; it is
a local gate).

**Files.** `scripts/i18n-check.ts`, `.github/workflows/ci.yml`.

**Acceptance.** `bun run i18n:check` prints the base commit, the resolved source paths and both
sections; a temporary `apps/web/src/lib/i18n/catalogs/zz.de.ts` with a made-up German value is
reported by check 1 and a value copied from `R/apps/web/src/lib/i18n/catalogs/ui.de.ts` is not
(delete the temp file before committing); running from a worktree resolves the sources to
`/home/erics/software/toon-recipe` and `/home/erics/software/toon-finance`.

**Verify.** `(bun run i18n:check 2>&1 || true) | grep -q "base commit"`;
`(bun run i18n:check 2>&1 || true) | grep -q "toon-recipe"`; `grep -q "frozen-lockfile" .github/workflows/ci.yml`;
`bun run typecheck`.

---

### M0-T05 — API foundation (core)

**Goal.** env, lib, the D7 db client, the merged core schema (households renamed from recipe's
groups, `household_modules`, `legacy_ids`) with its first migration, migrate, the module registry
types, the API entry with the new health, the smoke and pragma tests, `.env.example`.

**Read.** SPEC D1, D2, D7, D8, D12 (legacy_ids), D13, §2, §4 (core table), §7. R/CLAUDE.md
"Conventions" (errors, IDs/timestamps, lists), gotchas "THE CONNECTION PRAGMAS IN `db/client.ts`
ARE LOAD-BEARING" (superseded on `synchronous` by D7), "A local libSQL file is ONE SERIALISED LANE",
"libSQL 0.17.4 discarded a `file::memory:` DB…", "`bun test` forces `DATABASE_URL=file::memory:`",
"`bun:sqlite` IS A NEWER SQLite", "`clientIp()` ignores `X-Forwarded-For`". F/apps/api/src/db/client.ts
(lines 28–64, the FULL rationale). Sources: R/apps/api/src/{env.ts,index.ts}, R/apps/api/src/lib/*.ts,
R/apps/api/src/db/{client,migrate,schema}.ts, R/apps/api/{drizzle.config.ts,scripts/migrate.ts},
R/apps/api/test/smoke.test.ts, R/.env.example.

**Work.**
1. `src/env.ts` verbatim (OCR/import/mail variables stay; splitting module env is out of M0).
2. `src/lib/{errors,http,cookies,locale,timingSafe,uploadUrls,oauth}.ts` verbatim. `src/lib/types.ts`:
   `GroupRole` → `HouseholdRole`; `Membership.groupId` → `householdId`; docs "requireGroupRole" →
   "requireHouseholdRole", "/api/groups/:groupId/*" → "/api/households/:householdId/*";
   `requireMembership` keeps the key `"server.group.noAccess"`.
3. `src/db/client.ts` from R; `LOCAL_FILE_PRAGMAS` sends `synchronous = FULL`; replace the
   NORMAL-trade paragraph of the doc comment with F's rationale adapted ("the finance module's
   ledger lives in this file — SPEC D7"); everything else verbatim.
4. `src/db/schema/core.ts`: R schema.ts users…group_invites (lines 1–234) with these and only
   these changes:
   - **Header** (R lines 1–13) rewritten: first line "Core Drizzle (libSQL/SQLite) schema for
     toon-household: users/auth, households with their members and invites, household_modules
     and legacy_ids (SPEC §4). Module tables live in `schema/<module>.ts` (SPEC D7)."; the
     Conventions bullets kept, the last one reading "every FK used for listing has an index;
     household-scoped tables cascade from `households`"; the authorship paragraph kept with
     "shared groups" → "shared households" and "the group" → "the household".
   - **Imports**: DELETE R line 14 `import type { ImportSourceMeta, ParsedRecipe, TagKind } from
     "@toon/shared";` (recipe/import types, not exported in M0); keep `relations` and the
     `drizzle-orm/sqlite-core` import, minus any name no longer used (`real`, if so).
   - **Renames**: `groups`→`households` (table `households`), `groupMembers`→`householdMembers`
     (`household_members`, column `household_id`), `groupInvites`→`householdInvites`
     (`household_invites`, `household_id`), `users.activeGroupId`→`activeHouseholdId`
     (`active_household_id`), every `group` inside an index name → `household`
     (`group_invites_group_id_idx` → `household_invites_household_id_idx`); section comments and
     doc comments "group" → "household".
   - **Relations** of these tables only (from R's relations block; drop `cards` and every recipe
     relation).
   - **Row types**: exactly the twenty names of §1 decision 3, placed at the end of the file.
   - **New tables**: `household_modules(household_id FK→households cascade, module_id text,
     enabled_at int notNull default now, settings text JSON nullable, PK(household_id, module_id))`
     and `legacy_ids` per D12 and §1 decision 7: `tableName: text("table").notNull()`,
     `legacySource: text("legacy_source").notNull()`, `legacyId: text("legacy_id").notNull()`,
     `newId: text("new_id").notNull()`, `createdAt: integer("created_at").notNull().$defaultFn(now)`,
     `primaryKey({ columns: [table.tableName, table.legacySource, table.legacyId] })`.
   `src/db/schema.ts` = `export * from "./schema/core.ts";` plus a comment that module schemas are
   re-exported here (D7).
5. `src/db/migrate.ts`: `MIGRATIONS_FOLDER` + `runMigrations(database = sharedDb)` = migrate only;
   comment that recipe's JS fold backfill returns with the recipe module in M2. `scripts/migrate.ts`
   and `drizzle.config.ts` verbatim. Generate `drizzle/0000_core.sql` + meta with
   `cd apps/api && bunx drizzle-kit generate --name core`; never hand-edit it.
6. `src/modules/types.ts`: `ApiModule` per SPEC §2 with concrete types (`Hono<AppEnv>` routers,
   `schema: Record<string, SQLiteTable>` or a narrower table type, `healthFeatures?():
   Record<string, boolean>`, `onHouseholdCreated?`/`onEnable?` taking a db-or-transaction type,
   `legacyMigration?` as a placeholder interface M5 fills). `src/modules/index.ts`:
   `export const API_MODULES: readonly ApiModule[] = [];`.
7. `src/index.ts` (replaces the T01 stub) from R: header adapted; Hono app, onError/notFound,
   logger (not in tests), CORS, `localeMiddleware`, `GET /api/health` returning
   `{ ok: true, status: "ok", version, time, database, modules: API_MODULES.map(m => m.id),
   features: Object.assign({}, ...API_MODULES.map(m => m.healthFeatures?.() ?? {})) }`; drop the
   `/uploads` route (M1, with media thumbnails), the feature routers and the OCR shutdown block;
   leave comments marking where T09 mounts modules + staticWeb (LAST) and where M1 mounts
   `/api/auth`, `/api/households`; keep `if (!env.isTest) { await dbReady; console.log(…) }` with
   "toon-household API" and the default export.
8. `.env.example` (root): R's file with the header "toon-recipe environment" → "toon-household
   environment"; every variable kept (env.ts reads them).
9. Tests: `test/smoke.test.ts` adapted from R (env in-memory; health 200 with `ok === true`,
   `status "ok"`, `database "file"`, `modules` `[]`, `HealthResponseSchema.parse(body)` succeeds
   — do NOT assert `features` is empty, T09 adds `verifiedEmailRequired`; 404 envelope;
   `ApiError.toBody()`; migrations create all ten tables; deleting a household cascades its
   members, invites and module rows but not users; `users.email` unique; duplicate `legacy_ids`
   key and duplicate `(household_id, module_id)` rejected; `PRAGMA table_info(legacy_ids)` lists
   the columns `table`, `legacy_source`, `legacy_id`, `new_id`, `created_at`). NEW `test/db-pragmas.test.ts`: a
   temp-dir `file:` DB via `createDatabase({ url })`, `await ready`, `PRAGMA synchronous` = 2 and
   `PRAGMA journal_mode` = `wal`; `:memory:` gets no pragmas. Verify DDL through `@libsql/client`,
   never `bun:sqlite`.

**Files.** `apps/api/src/env.ts`, `apps/api/src/lib/**`, `apps/api/src/db/**`, `apps/api/drizzle/**`,
`apps/api/drizzle.config.ts`, `apps/api/scripts/migrate.ts`, `apps/api/src/modules/{types,index}.ts`,
`apps/api/src/index.ts`, `apps/api/test/{smoke,db-pragmas}.test.ts`, `.env.example`.

**Verify.** `bun run typecheck`; `bun test apps/api/test`;
`rm -rf /tmp/m0-t05 && DATABASE_URL=file:/tmp/m0-t05/a.db bun run db:migrate`;
`grep -q "synchronous = FULL" apps/api/src/db/client.ts`;
`grep -q '`table` text NOT NULL' apps/api/drizzle/0000_core.sql`;
`! grep -q "ImportSourceMeta\|toon-recipe\|GroupRow" apps/api/src/db/schema/core.ts`.

---

### M0-T06 — Web i18n runtime, `common` catalog, api transport, small libs (port)

**Goal.** The web i18n layer with the `common` namespace, `lib/api.ts` reduced to the core
transport, and the self-contained libs.

**Read.** SPEC D9, D10, §3 (`apps/web/src/lib`). R/CLAUDE.md "Conventions" (Web: no fetch outside
`lib/api.ts`), gotchas "The i18n layer is hand-rolled…", "The language picker's third state is
`system`", "German copy is a REFACTOR". R/docs/i18n.md §1, §2, §6, §7, §10. Sources:
R/apps/web/src/lib/i18n/**, R/apps/web/src/lib/{api,cn,storage,theme,viewport,navigation,format,pwa,validation}.ts,
R/apps/web/src/lib/validation.test.ts.

**Copies + rewrites (source → target under `apps/web/src/`).**
1. `lib/i18n/{I18nProvider.tsx,index.ts,locale.ts,store.ts}` verbatim (store.ts keeps
   `import { updateProfile } from "@/lib/api"`).
2. The two catalog files are produced by sed and nothing else (the rename of the type
   `UiCatalog` → `CommonCatalog` is part of it; R's `ui.en.ts` imports `type UiCatalog` from
   `./ui.de.ts` and `ui.de.ts` line 146 exports `type UiCatalog = typeof uiDe`):
   ```sh
   S=/home/erics/software/toon-recipe/apps/web/src/lib/i18n/catalogs
   sed -e 's/uiDe/commonDe/g' -e 's/UiCatalog/CommonCatalog/g' \
       -e 's/NamespaceCatalog<"ui">/NamespaceCatalog<"common">/' \
       -e 's/namespace "ui"/namespace "common"/' -e 's/"ui\./"common./g' \
       $S/ui.de.ts > apps/web/src/lib/i18n/catalogs/common.de.ts
   sed -e 's/uiEn/commonEn/g' -e 's/UiCatalog/CommonCatalog/g' -e 's/ui\.de\.ts/common.de.ts/g' \
       -e 's/namespace "ui"/namespace "common"/' -e 's/"ui\./"common./g' \
       $S/ui.en.ts > apps/web/src/lib/i18n/catalogs/common.en.ts
   ```
   Values stay byte-identical (no value contains `"ui.`, `uiDe`, `UiCatalog` or `ui.de.ts`;
   check with `git diff --no-index --word-diff` before committing). The D10 rename is noted in
   `catalogs/index.ts`'s header, not in the catalog files.
3. `lib/i18n/catalogs/index.ts`: keep R's header comment and add one line "`common` is
   toon-recipe's `ui` namespace, renamed per SPEC D10 (values unchanged)."; import only
   `commonDe`/`commonEn`, `const de = { ...commonDe }; const en = { ...commonEn };`, export
   `CATALOGS` and `MessageKey` unchanged in shape. (T11 adds `home` and the module catalogs.)
4. `lib/i18n/i18n.test.ts`: the `prefixes` array becomes `["common."]`; every `"ui.` key literal
   → `"common.` (including `"ui.does.not.exist"` → `"common.does.not.exist"` on both sides).
   DELETE the two tests of `describe("locale preference")` that read the `auth` namespace —
   `"every locale has a picker label, in every catalog"` and `"language names are autonyms —
   identical across catalogs"` (R lines 117–133) — because M0 ports no `auth` catalog (the first
   would fail at runtime, the second's `as MessageKey` cast fails typecheck). In their place,
   inside the describe block, exactly this comment:
   `// M1 restores two tests here with auth.de.ts/auth.en.ts: "every locale has a picker label,`
   `// in every catalog" and "language names are autonyms — identical across catalogs" (R gotcha`
   `// "The language picker's third state is system"; docs/plans/m0-scaffold.md §4).`
   The other two locale-preference tests stay verbatim.
5. `lib/{cn,theme,viewport,navigation,pwa}.ts` verbatim. `lib/storage.ts`: key
   `activeGroupId: \`${PREFIX}activeGroupId\`` → `activeHouseholdId: \`${PREFIX}activeHouseholdId\``
   and the `lastShoppingListId` doc's "group" → "household"; nothing else.
6. `lib/format.ts`: delete `formatMinutes` and `formatServingsLabel` and the now-unused imports
   `formatDuration`, `formatServings`, `type Servings` (recipe formatters return in M2 under
   `modules/recipe`); `"ui.` → `"common.` in every `translate(…)`; nothing else.
7. `lib/api.ts`: source lines 1–392 (header, base url, `mediaUrl`, `thumbnailUrl`, `ApiError`,
   401 handling, `queryString`, `request`, error mapping, `assertUploadSize`, `fileForm`,
   `fetchHealth`) + `updateProfile` (source lines 434–439) + a facade
   `export const api = { health: fetchHealth, auth: { updateProfile } };`. The import block from
   `@toon/shared` shrinks to `MAX_UPLOAD_BYTES`, `type HealthResponse`, `type UpdateProfileRequest`,
   `type UserResponse`. `async function request` → `export async function request`;
   `function assertUploadSize` / `function fileForm` → exported. Add to the header: "Module API files
   (`apps/web/src/modules/<id>/api.ts`) build on `request`; they never call `fetch` (SPEC §2)."
   `"ui.` → `"common.` in every `translate(…)`. The other endpoint groups arrive with M1/M2.
8. `lib/validation.ts` and `lib/validation.test.ts` verbatim except `"ui.` → `"common.`.
After step 8, `grep -rn '"ui\.' apps/web/src/lib` must print nothing.

**Files.** `apps/web/src/lib/i18n/**`, `apps/web/src/lib/{api,cn,storage,theme,viewport,navigation,format,pwa,validation}.ts`,
`apps/web/src/lib/validation.test.ts`.

**Verify.** `bun run typecheck`; `bun test apps/web/src/lib`;
`diff R/apps/web/src/lib/pwa.ts apps/web/src/lib/pwa.ts`; `! grep -rn '"ui\.' apps/web/src/lib`;
`! grep -rn "UiCatalog\|auth\.settings\.language" apps/web/src/lib`;
`grep -q "M1 restores two tests" apps/web/src/lib/i18n/i18n.test.ts`;
the step-2 sed of `ui.de.ts` piped into `diff - apps/web/src/lib/i18n/catalogs/common.de.ts`
(and of `ui.en.ts` into `diff - …/common.en.ts`) prints nothing.

---

### M0-T07 — API core services + staticWeb (port)

**Goal.** The services the M0 middleware needs: mail (console/smtp/resend/templates), auth
`sessions`, `users` (renamed), `verifiedEmail`; `middleware/staticWeb.ts`; their tests.

**Read.** SPEC D4, D13, §3 (`core/services/{auth,households,mail,media}/`). R/CLAUDE.md gotchas "AN
UNCONFIRMED E-MAIL ADDRESS MAKES AN ACCOUNT READ-ONLY…", "A failed mail send must never fail its
action", "`delivered` ALONE IS NOT…", "`bun test` gets a silent ConsoleMailer", "`net.Server.close(cb)`
WAITS…", "`new TLSSocket(…)`…", "`servername` must be omitted for an IP literal", "`sw.js` and
`index.html` must never be cached", "A missing file WITH an extension must 404", "`mock.module`
LEAKS ACROSS TEST FILES" (use `setMailer`, restore in `afterAll`).

**Copies (source → target).**
- `R/apps/api/src/services/mail/{index,console,smtp,resend,templates,types}.ts` → `apps/api/src/core/services/mail/`
- `R/apps/api/src/services/auth/{sessions,users,verifiedEmail}.ts` → `apps/api/src/core/services/auth/`
- `R/apps/api/src/middleware/staticWeb.ts` → `apps/api/src/middleware/staticWeb.ts` (verbatim)
- `R/apps/api/test/mail.test.ts` → `apps/api/test/mail.test.ts`; `R/apps/api/test/mail/smtp.test.ts`
  → `apps/api/test/mail/smtp.test.ts`; `R/apps/api/test/static-web.test.ts` → `apps/api/test/static-web.test.ts`

**Rewrites.**
1. Every relative import beginning with `../../` in the moved service files gains one level
   (`../../db/…` → `../../../db/…`, `../../lib/…` → `../../../lib/…`, `../../env.ts` →
   `../../../env.ts`); sibling imports (`./types.ts`, `../mail/index.ts`) unchanged.
2. `users.ts`: `groups` → `households`, `groupMembers` → `householdMembers`, `groupId` →
   `householdId`, `activeGroupId` → `activeHouseholdId`, `createOwnedGroup` →
   `createOwnedHousehold`, `setActiveGroup` → `setActiveHousehold`, `DEFAULT_GROUP_NAME` →
   `DEFAULT_HOUSEHOLD_NAME` (VALUE stays `"Meine Rezepte"` — M1 decides the household default), doc
   comments "group" → "household". `toUserDto` emits `activeHouseholdId`.
3. Tests: `"../src/services/` → `"../src/core/services/`; `"../../src/services/` →
   `"../../src/core/services/`. Nothing else.
`sessions.ts`, `verifiedEmail.ts`, all mail files and `staticWeb.ts` otherwise verbatim.

**Files.** `apps/api/src/core/services/mail/**`, `apps/api/src/core/services/auth/{sessions,users,verifiedEmail}.ts`,
`apps/api/src/middleware/staticWeb.ts`, `apps/api/test/mail.test.ts`, `apps/api/test/mail/smtp.test.ts`,
`apps/api/test/static-web.test.ts`.

**Verify.** `bun run typecheck`; `bun test apps/api/test/mail.test.ts apps/api/test/mail apps/api/test/static-web.test.ts`;
`diff R/apps/api/src/middleware/staticWeb.ts apps/api/src/middleware/staticWeb.ts`.

---

### M0-T08 — Web data layer (build)

**Goal.** `lib/queries.ts` (core keys, D9 roots), `lib/query-client.ts`, `lib/persist.ts` whose
query allow-list AND mutation namespaces are ASSEMBLED from inputs (T11 feeds both from the
manifests: `persistQueryAllowList` and `persistMutationNamespaces`, §1 decision 8), with tests.

**Read.** SPEC D9, §2 (`persistQueryAllowList`, `mutationDefaults`). R/CLAUDE.md gotchas "The
persisted offline cache is namespaced per user id…", "THE SHOPPING LIST IS THE ONE THING EDITABLE
OFFLINE" (why the mutation allow-list exists). Sources: R/apps/web/src/lib/{queries,query-client,persist,persist.test}.ts.

**Work.**
1. `lib/query-client.ts` verbatim (comment about the shopping outbox → "module outboxes register
   their mutation defaults on this instance (SPEC D9)").
2. `lib/queries.ts`: R's cache-policy block (`STALE_TIME`, `shouldRetry`, `retryDelay`), `filterKey`,
   `ROOT = "toon"`, `queryKeys` with `all`, `health()`, `me()`, `household(householdId)` =
   `["toon","household",id]`, `householdModule(householdId, moduleId: ModuleId)` =
   `["toon","household",id,moduleId]`, `userModule(moduleId)` = `["toon",moduleId]`;
   `healthQuery`; a minimal `invalidate` (health). Every other key returns with M1/M2.
3. `lib/persist.ts`: R's file with `DB_NAME = "toon-household"`, `PERSIST_BUSTER = "household-v1"`;
   user-scoped key, purge and persister unchanged. Replace `PERSISTED_GROUP_SEGMENTS`/`isCardsKey`
   with `export type QueryKeyPrefix = { scope: "household" | "user"; path: readonly string[];
   exact?: boolean }` (household: matches `["toon","household",<id>,...path,...rest]`; user:
   `["toon",...path,...rest]`; `exact` forbids `rest`) and
   `createShouldPersistQuery(allowList: readonly QueryKeyPrefix[])` (keeps R's success/null guards
   and the bootstrap `["toon","me"]` rule); `createShouldPersistMutation(namespaces: readonly
   (readonly string[])[])` matching `["toon", ...namespace, ...rest]` on PAUSED mutations only.
   Keep `shouldPersistQuery`/`shouldPersistMutation` exports as the factories applied to `[]`.
   Header comments updated to the household key shapes.
4. Tests: `lib/persist.test.ts` ported — the user-namespacing, bootstrap, pending/failed and
   non-paused cases verbatim in substance; the recipe-shaped cases rewritten against a FAKE
   allow-list (`{scope:"household",path:["recipe","recipes"]}`, `{scope:"user",path:["recipe","cards"],exact:true}`)
   proving prefix, exact and scope semantics; `PERSIST_BUSTER === "household-v1"`. NEW
   `lib/queries.test.ts`: key shapes start `["toon","household",id,"<module>"]` / `["toon","<module>"]`.

**Files.** `apps/web/src/lib/{queries,query-client,persist}.ts`, `apps/web/src/lib/{persist,queries}.test.ts`.

**Verify.** `bun run typecheck`; `bun test apps/web/src/lib`.

---

### M0-T10 — `components/ui` primitives (port)

**Goal.** toon-recipe's 24 primitives + barrel, the ONLY primitives (D5).

**Read.** SPEC D5. R/CLAUDE.md "Conventions" (UI primitives), gotchas "`controlClasses` carries
`min-w-0`", "THE DISPLAY FAMILY SHIPS EXACTLY ONE WEIGHT", "`block` beats `line-clamp-N`",
"An idle TanStack mutation reports `error: null`". R/docs/redesign/SPEC.md §5.

**Steps.** `cp R/apps/web/src/components/ui/* apps/web/src/components/ui/` (ActionMenu, Avatar,
Badge, Button, Card, Chip, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, IconButton, Input,
Label, ProgressBar, SectionHeader, Select, Skeleton, Spinner, Stat, Stepper, Switch, Tabs,
Textarea, Toast, index.ts); then `sed -i 's/"ui\./"common./g'` on those files. Nothing else: their
`@/lib/{api,format,cn,i18n}` imports resolve to T06's files (`mediaUrl`, `errorMessage`,
`isApiError`, `initials`, `readableTextColor` all exist).

**Files.** `apps/web/src/components/ui/**`.

**Acceptance.** files differ from R only by the key prefix; typecheck and build green.

**Verify.** `bun run typecheck`; `bun run build`; `! grep -rn "\"ui\.\|'ui\.\|\`ui\." apps/web/src/components/ui`.

---

### M0-T09 — API middleware chain + module mounting (build)

**Goal.** `requireSession`, `requireHouseholdRole`, `requireVerifiedEmail`, `requireModule`
(D8), `mountModules()`, the staticWeb mount (LAST), `verifiedEmailRequired` in health, tests.

**Read.** SPEC D2, D8, §2 rules. R/CLAUDE.md "Conventions" (auth checks only via middleware),
"Architecture" (mount order), gotchas "AN UNCONFIRMED E-MAIL ADDRESS…". Sources:
R/apps/api/src/middleware/{session,group,verifiedEmail}.ts, R/apps/api/src/index.ts (static web
mount), R/apps/api/test/verified-email-gate.test.ts (the shared-db + `runMigrations(db)` harness).

**Work.**
1. `middleware/session.ts` and `middleware/verifiedEmail.ts` from R; imports
   `../services/auth/…` → `../core/services/auth/…`; doc "requireGroupRole" →
   "requireHouseholdRole"; otherwise verbatim.
2. `middleware/household.ts` from R `group.ts`: `requireGroupRole` → `requireHouseholdRole`,
   `GroupRoleOptions` → `HouseholdRoleOptions`, `resolveGroupId` → `resolveHouseholdId`, path
   param `groupId` → `householdId`, `GroupRole` → `HouseholdRole`, `requireGroup{Member,Admin,Owner}`
   → `requireHousehold{Member,Admin,Owner}`; `RESOURCE_PARAMS` = `["inviteId"]` only (module routes
   always carry `:householdId`, D8; recipe's recipe/collection/tag/draft resolvers are dropped);
   server keys `server.group.*` unchanged. The header doc comment loses the dropped resolvers
   and gains this paragraph (§1 decision 9): "Under D8 the household comes from `:householdId`,
   never from a resource row, so this middleware no longer guards cross-household ids. EVERY
   by-id lookup in a module service MUST be scoped by `membership.householdId` (`and(eq(t.id,
   id), eq(t.householdId, membership.householdId))`) and answer 404 `not_found` otherwise; each
   module resource gets a test addressing another household's id. Binding on M2/M3."
   `modules/types.ts` (T05's file — T09 may edit its `householdRouter` doc comment only) gets a
   one-line pointer to that rule.
3. NEW `middleware/module.ts`: `requireModule(id: ModuleId)` — after `requireHouseholdRole`, reads
   `household_modules` for `(membership.householdId, id)`; absent → `new ApiError(404,
   "module_disabled", "server.module.disabled")`.
4. NEW `modules/mount.ts`: `mountModules(app, modules)` — `userRouter` at `/api/<id>`;
   `householdRouter` at `/api/households/:householdId/<id>` behind `requireSession()`,
   `requireHouseholdRole("member")`, `requireModule(id)`. `index.ts`: call it at the marked slot,
   then `if (env.webDistDir !== null) app.use("*", webAppMiddleware(env.webDistDir));` LAST; health
   `features` gains `verifiedEmailRequired: isVerifiedEmailRequired()` (core) merged with the
   modules' features.
5. Tests: NEW `test/middleware.test.ts` with the shared db + `runMigrations(db)`, sessions from
   `createSession`, cookie `toon_session=<id>`: 401 without cookie; 404 `not_found` for an unknown
   household; 403 `forbidden` for a non-member; 403 for a member on an admin route; a fake
   `ApiModule` mounted with `mountModules` on a test app answers 404 `module_disabled` (German
   message by default) until a `household_modules` row exists, then 200; its `userRouter` answers
   at `/api/recipe/...`; the CHAIN ORDER (SPEC §2) is pinned on that mounted module route by two
   more cases — without a cookie it answers 401 `unauthorized` (session before everything), and a
   signed-in NON-member of an existing household that has NO module row gets 403 `forbidden`, not
   404 `module_disabled` (role before module); `requireVerifiedEmail` blocks a POST (403 `email_unverified`) and passes a
   GET with `setVerifiedEmailRequired(true)`, restored to `null` in `afterAll`. Extend
   `test/smoke.test.ts`: health `features.verifiedEmailRequired` is a boolean.

**Files.** `apps/api/src/middleware/{session,household,verifiedEmail,module}.ts`,
`apps/api/src/modules/mount.ts`, `apps/api/src/modules/types.ts` (doc comment only),
`apps/api/src/index.ts`, `apps/api/test/middleware.test.ts`, `apps/api/test/smoke.test.ts`.

**Verify.** `bun run typecheck`; `bun test apps/api/test`;
`grep -q "membership.householdId" apps/api/src/middleware/household.ts`.

---

### M0-T11 — Web shell (core)

**Goal.** The app frame with the empty module-less tab bar, the `WebModule` contract and empty
registries, the router with the app layout and a placeholder Home, `app.tsx`/`main.tsx`.

**Read.** SPEC D5, D6, D9, D10, §2 (WebModule), §5. R/CLAUDE.md "Navigation", gotchas "A page
component must NOT re-apply `mx-auto max-w-content px-gutter pt-4 pb-tabbar`", "NEVER write
`px-4 px-safe`", "A `sticky bottom-*` bar…", "A bottom action bar needs `bottom-tabbar`", "Text next
to an icon in a `flex` `<p>` must be ONE child", "no arrow … is ever a text glyph" (inside the
display-family gotcha), "`apple-mobile-web-app-status-bar-style`" (do not add). R/docs/redesign/SPEC.md
§4.7 and §5. Sources: R/apps/web/src/{app.tsx,main.tsx,router.tsx}, R/apps/web/src/components/layout/*.

**Work.**
1. Verbatim + `"ui.` → `"common.`: `components/layout/{ErrorBoundary,InstallPrompt,Logo,NotFoundPage,OfflineBanner,UpdateBanner}.tsx`.
2. `AppShell.tsx` from R minus `UnverifiedEmailBanner` (M1, needs the session); `PageHeader` kept.
3. `nav-items.ts`: `NavItem` (`to` typed so `<Link to>` compiles with module-contributed paths —
   choose and document the approach), `HOME_NAV_ITEM` (`/`, `home.nav.label`, lucide `House`,
   exact), and functions (not module-level constants over `WEB_MODULES`) computing the tab set:
   inside a module its `navItems` (+ Profil from M1); outside, Home · enabled modules (max two)
   (+ Profil from M1). With no modules and no session in M0 the result is `[HOME_NAV_ITEM]`.
4. `BottomTabBar.tsx` from R reading the computed items. `SideNav.tsx` reduced: brand (Logo +
   `t("home.appName")`), the same items, no GroupSwitcher/avatar/counts (M1). `index.ts` barrel
   without `PhoneHeaderRow` (M1).
5. `modules/types.ts` (`WebModule` per SPEC §2, using `MessageKey`, `NavItem`, `QueryKeyPrefix`,
   plus the §2 extension `persistMutationNamespaces?: readonly (readonly string[])[]` with a doc
   comment: "key paths after `"toon"` whose PAUSED mutations are persisted, e.g. `["finance","tx"]`;
   pair it with `mutationDefaults` (SPEC D9)"), `modules/index.ts`
   (`WEB_MODULES: readonly WebModule[] = []`), `modules/catalogs.ts` (imports only module
   `catalogs/` files). The module catalog registries MUST stay literal-typed so `MessageKey`
   remains a union of literal keys (D10's enforcement): in M0 exactly
   `export const MODULE_CATALOGS_DE = {} as const; export const MODULE_CATALOGS_EN = {} as const;`
   with NO type annotation — never `Record<string, …>`, `NamespaceCatalog` without a prefix,
   `Partial<…>` or any index-signature type, each of which widens `MessageKey` to `string`. A
   comment says how M2/M3 extend it: `{ ...recipeDe, ...financeDe } as const` (the spread of the
   modules' literal catalogs, i.e. the intersection of their literal types).
   `modules/persist.ts`: `buildPersistPolicy(modules: readonly Pick<WebModule,
   "persistQueryAllowList" | "persistMutationNamespaces">[])` returning `{ shouldDehydrateQuery:
   createShouldPersistQuery(modules.flatMap(m => m.persistQueryAllowList)),
   shouldDehydrateMutation: createShouldPersistMutation(modules.flatMap(m =>
   m.persistMutationNamespaces ?? [])) }`. Test `modules/persist.test.ts` with two FAKE manifest
   slices: a paused mutation keyed `["toon","finance","tx","m1"]` is persisted when one slice
   declares `[["finance","tx"]]` and not with `[]`; a query under a declared household prefix is
   persisted, an undeclared one is not.
6. `lib/i18n/catalogs/home.{de,en}.ts` with exactly the keys/values of §1 decision 3;
   `lib/i18n/catalogs/index.ts` merges `...commonDe, ...homeDe, ...MODULE_CATALOGS_DE` (en
   likewise); `lib/i18n/i18n.test.ts` prefixes `["common.", "home."]`, the T06 "M1 restores two
   tests" comment stays (do not re-add the auth-language tests), and add a compile-time guard
   that `MessageKey` is still a literal union, e.g.
   `const literalKeys: string extends MessageKey ? false : true = true;` with
   `expect(literalKeys).toBe(true)` in a test named "MessageKey is a literal union (D10)".
7. `core/features/home/HomePage.tsx`: page root `flex flex-col gap-4` (no shell paddings),
   `PageHeader` with `home.title`, `EmptyState` with `home.empty.*`.
8. `router.tsx`: root (notFound = `NotFoundPage`) → pathless `app` layout (AppShell + Outlet) →
   `/` Home (lazyRouteComponent per R's rule); a module layout route per `WEB_MODULES` entry.
   No auth guards (M1). `app.tsx` from R: no shopping offline import; call each module's
   `mutationDefaults(queryClient)` before render; `dehydrateOptions` = `buildPersistPolicy(WEB_MODULES)`
   (computed once at module scope of `app.tsx` is fine — `app.tsx` is not imported by any
   catalog), replacing R's `shouldPersistQuery`/`shouldPersistMutation`; never a hard-coded `[]`.
   `main.tsx` (replaces the T01 stub) from R with `"ui.` → `"common.`.

**Files.** `apps/web/src/components/layout/**`, `apps/web/src/modules/**`, `apps/web/src/router.tsx`,
`apps/web/src/app.tsx`, `apps/web/src/main.tsx`, `apps/web/src/core/**`,
`apps/web/src/lib/i18n/catalogs/{index,home.de,home.en}.ts`, `apps/web/src/lib/i18n/i18n.test.ts`.

**Verify.** `bun run typecheck`; `bun test apps/web`; `bun run build`;
`(bun run i18n:check 2>&1 || true) | grep -q "1/2 German catalog parity"`;
`grep -q "buildPersistPolicy(WEB_MODULES)" apps/web/src/app.tsx`;
`! grep -q "createShouldPersist[A-Za-z]*(\[\])" apps/web/src/app.tsx`;
`! grep -q "Record<" apps/web/src/modules/catalogs.ts`;
`grep -q "persistMutationNamespaces" apps/web/src/modules/types.ts`.

---

### M0-T12 — Integration (build)

**Goal.** Prove the exit criteria on the merged tree and write CLAUDE.md "Commands".

**Read.** this plan; SPEC §7; R/CLAUDE.md "Verification gates" and gotcha "Verify a phone layout
in a real headless browser" (and "Do NOT match the tab bar by its aria-label").

**Work.**
1. Gates in order with logs: `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`,
   `bun run build`, `bun run i18n:check` — classify every i18n hit (expected: comment quotes and
   ops literals ported verbatim; a parity failure is a bug unless its key is in `NEW_GERMAN`).
2. `DATABASE_URL=file:./data/m0.db bun run db:migrate`; then
   `SESSION_SECRET=… DATABASE_URL=file:./data/m0.db bun run dev` in the background (log);
   `curl -s localhost:3001/api/health` shows `"ok":true` and `"modules":[]`; the same through the
   vite proxy on `:5173`.
3. Headless check: playwright installed in a scratch dir OUTSIDE the repo (background install,
   log with `exit=`), load `http://localhost:5173/` at 390×844 and 1440×900: Home renders,
   the phone tab bar (`nav.fixed`, not by aria-label) shows one item "Start", the sidebar is visible
   at 1440, `documentElement.scrollWidth === clientWidth`, no console errors.
4. `bun run build`, then `WEB_DIST_DIR=./apps/web/dist` API on its own port: `/` serves the shell,
   `/sw.js` has `Cache-Control: no-cache`, `/api/health` still JSON.
5. CLAUDE.md "Commands": the eleven scripts that exist, with one line each (and the env needed
   for `dev`); leave other sections to the workflow's docs step. Minimal integration fixes only,
   each its own commit.

**Files.** `CLAUDE.md` (+ any minimal integration fix, named in its commit).

**Verify.** `bun install --frozen-lockfile`; `bun run typecheck`; `bun test`; `bun run build`;
`test -f apps/web/dist/sw.js`; `grep -q "bun run db:migrate" CLAUDE.md`;
`grep -q "bun run i18n:check" CLAUDE.md`.

## 3. Risks

- **TS18003 / empty `bun test`**: a tsc project with no input or a test run with no file fails —
  T01's stubs exist for exactly that; whoever replaces a stub keeps the project non-empty.
- **The vite alias is an exact specifier.** Never import `@toon/shared/<subpath>` from web code.
- **Circular imports on the web side** (store.ts ↔ api.ts is inherited and safe because use is at
  call time; catalogs ↔ modules is avoided by `modules/catalogs.ts`; nav items are functions).
- **libSQL `file::memory:` is per client.** Tests that go through `app.request` must use the shared
  `db` + `runMigrations(db)`; `createDatabase({url:"file::memory:"})` gives a DIFFERENT database.
- **TanStack Router typing vs module-contributed routes** (T11): `NavItem.to` and module route
  trees must still typecheck once M1/M2 add modules; T11 records its choice.
- **i18n-check from worktrees** resolves the source repos via the git common dir; a relative
  `../toon-recipe` would point into `.worktrees/`.
- **Cold `bun install`** may take minutes; always background + log + `exit=`.
- **`MessageKey` widening** (T11): any index-signature type on the module catalog registry turns
  `MessageKey` into `string` and silently disables D10's typed keys; the literal-union test in
  `i18n.test.ts` and the `@ts-expect-error` on a fake key catch it.
- **Ported tests that reach unported code** (T02, T06): removed with a placeholder comment, never
  skipped silently; the obligations list in §4 brings them back.
- **drizzle-kit** must generate `0000_core.sql` from the schema, never hand-written; DDL is
  verified through `@libsql/client` (bun:sqlite is a newer SQLite).
- **Hono mount params**: `:householdId` from the mount path is visible to sub-app middleware
  (toon-recipe's `/api/groups/:groupId/imports` precedent); M1 must mount module routers before any
  `/api/households/:householdId` catch-all.

## 4. Deviations expected (to be confirmed in "what changed vs plan")

- `apps/web/src/lib/session.tsx` (listed in the M0 goal) is deferred to M1: it is the
  RequireAuth / RequireActiveHousehold / RequireModule layer and needs `/api/auth/me` and
  `/api/households`, which M1 builds; in M0 it would be dead code or would block the empty-shell
  render. Same for `UnverifiedEmailBanner`, `PhoneHeaderRow`, the GroupSwitcher parts of `SideNav`.
- The `/uploads/:filename` route, media thumbnails and `sharp` move to M1 (D4); `seed`,
  `auth:reset-password`, `uploads:gc` to M1/M2.
- None from SPEC §1, so no ADR: `legacy_ids` keeps D12's column `table` (TS property
  `tableName`, §1 decision 7).
- SPEC §2 contract EXTENSION: `WebModule.persistMutationNamespaces?` (§1 decision 8), so D9's
  "assembled from the module manifests" covers the offline outboxes too. The M7 docs step folds
  it into SPEC §2's interface text.
- `ui.*` → `common.*` key rename (D10 compliance, values unchanged); `UiCatalog` → `CommonCatalog`.
- Recipe formatters (`formatMinutes`, `formatServingsLabel`), the fold backfill in `migrate.ts`,
  the recipe SW runtime rules and recipe resource resolvers in `household.ts` leave the core; M2
  re-homes them in the recipe module.
- Three ported test files lose tests that need code M0 does not port (see "Obligations" below):
  shared `i18n.test.ts` loses the `formatDuration` describe block; web `i18n.test.ts` loses the
  two `auth.settings.language.*` tests. Each place carries a comment naming the returning
  milestone.
- Health adds `ok: true` next to recipe's `status: "ok"`.
- `ERROR_CODES`, the server catalog (`server.group.*`, `{groupName}`), `env.ts` and
  `DEFAULT_HOUSEHOLD_NAME = "Meine Rezepte"` are carried verbatim; renames/splits are M1/M2 calls.
- CI has no poppler step and no docker-build job until M2/M6.

### Obligations M0 hands to later milestones (each later plan lists and closes them)

- **M1** restores in `apps/web/src/lib/i18n/i18n.test.ts`, with `auth.de.ts`/`auth.en.ts`, R's
  tests "every locale has a picker label, in every catalog" and "language names are autonyms —
  identical across catalogs" (they guard the binding R gotcha "The language picker's third state
  is `system`"), adds `"auth."` (and `"household."`) to the `prefixes` array, and removes the
  placeholder comment.
- **M2** restores the three `formatDuration` tests (R `packages/shared/test/i18n.test.ts` lines
  137–157) with `packages/shared/src/modules/recipe/duration.ts`, import path rewritten to
  `"../src/modules/recipe/duration.ts"`, and removes the placeholder comment.
- **M2 and M3 — cross-household guard (D8, §1 decision 9).** Every by-id lookup in a module
  service (recipes, collections, tags, import drafts, shopping lists/items, plan entries; finance
  transactions, accounts, categories, plan items, …) filters by `membership.householdId` and
  answers `404 not_found` for an id of another household; each resource gets a test where a
  member of household A addresses `/api/households/A/<module>/<resource>/<id of B>` and gets 404.
  R's resolvers did this implicitly; under D8 nothing else does.
- **M2 and M3** declare `persistMutationNamespaces` next to `mutationDefaults` (recipe's shopping
  outbox, finance's `["finance","tx"]`), and test that a paused mutation of that namespace is
  persisted.

## 5. Out of this milestone

Auth routes and screens, households routes/services/DTOs/invites, settings, Home cards, both
switchers, `GET /api/households/:id` modules, enabling modules, seed data (M1); everything of the
recipe module (M2) and the finance module (M3); design pass, PWA icons/name/shortcuts (M4);
`migrate:legacy` (M5) — note for M5: recipe's `users.email` is already normalized
(`EmailSchema` lowercases and trims), finance's is `email_normalized`; Dockerfile, compose, Caddy,
release/deploy workflows (M6); `docs/API.md`, `docs/modules/*.md`, ADRs (M7).

## 6. What changed vs plan

(Filled in by the workflow after the milestone.)
