# M7 — harden: plan

**Status: PLANNED (2026-10-15).** Base commit `46e830b` (M6 closed). Section 9 (integration record) and
section 10 (what changed vs plan) are written by M7-T10.

M7 closes what M0 to M6 left open, documents the app as built, and proves the final tree. SPEC §8:
"Review findings, CLAUDE.md as built, `docs/API.md`, `docs/modules/*.md`, ADRs for every deviation,
`docs/open-work.md`." Exit: gates green on the final tree; CLAUDE.md describes what exists and names no
file that does not; every deviation from SPEC §1 has an ADR; `docs/open-work.md` lists what is deferred.

## 1. Context

### 1.1 State of the tree at plan time (`46e830b`, measured by the planner on 2026-10-15)

- `bun run typecheck` OK (five projects). `bun test`: **2418 pass, 0 fail, 136 files, 24.5 s**.
  `bun run build` exit 0. `bun run i18n:check`: parity OK, leftover-German **146** hits (the 146 classified
  in m3b plan §9.3: comment quotes and recipe content vocabulary; exit 1 by design).
  `bun apps/api/test/fixtures/legacy/build.ts --check`: "committed fixtures match a fresh build."
- No `TODO`/`FIXME`/`XXX`/`HACK` marker in `apps/`, `packages/`, `scripts/`.
- The served API has **130** distinct `METHOD path` routes (`app.routes` of `apps/api/src/index.ts`,
  method `ALL` excluded): 34 core routes (auth 17, households 7, members 5, invites 3, modules 2) plus
  `GET /api/health` and `GET /uploads/:filename`, 61 recipe routes (56 under
  `/api/households/:householdId/recipe/`, 5 under `/api/recipe/cards`), 33 finance routes under
  `/api/households/:householdId/finance/`.
- toon-recipe's `docs/API.md` (at `48736d2`) documents 94 table rows; after the path rewrite of Table P
  (section 2.2) every one of the 61 recipe routes has a row, and the only R row with no served route is
  `GET /uploads/:filename.thumb.webp` (a documented variant of `GET /uploads/:filename`).
- `CLAUDE.md` is 1047 lines; its "Gotchas in use" section holds **69** bold-titled bullets (Table G).
  It still carries milestone history ("What M3b/M4/M5/M6 added") and a "Not yet present" line naming
  `docs/API.md` and `docs/modules/*.md`.
- `docs/adr/` holds 0001 to 0008. SPEC §2 already carries `persistMutationNamespaces` in its interface text
  (the M0 obligation "the M7 docs step folds it into SPEC §2" is closed; nothing to do).

### 1.2 Open findings and obligations inventory (every item maps to a task or to `docs/open-work.md`)

| # | Item | Source | Disposition |
| --- | --- | --- | --- |
| O1 | The printed PHONE recipe detail still shows the servings scaler and "Zur Einkaufsliste" (no `data-print="hide"`; the desktop branch hides both) | m4 plan §9.8, CLAUDE.md "Printing a recipe" | **T01** fixes; T10 proves by print-to-PDF |
| O2 | Switching the whole test suite to a temp-file DB (ADR 0003's consequence; restores toon-finance gotcha 2) | ADR 0003, m3 plan §10, CLAUDE.md M7 obligation | **T02** (go/no-go rule, decision 7) |
| O3 | `docs/API.md` with recipe and finance sections: `onMemberRemoving`, `member_has_ledger`, `finance_participant_in_use`, `422 server.finance.personNotParticipant`, placeholders (`POST …/members`, `PATCH …/members/:userId/placeholder`), the claim invite and its codes `member_has_account` and `invite_claim_requires_register`, `PATCH …/finance/participants/:userId`, the origin guard with `WEB_ORIGIN`, the CSP, "migrated finance-only accounts start unconfirmed" | ADR 0004, m3/m3b/m4/m5 plans §8, CLAUDE.md M7 obligation | **T03** (core), **T04** (recipe), **T05** (finance) |
| O4 | `docs/modules/recipe.md`, `docs/modules/finance.md` (D15: finance's German docs ported in the parts the module needs, originals referenced by path) | SPEC §8, D15 | **T06**, **T07** |
| O5 | "may extend the member-leaves veto to other modules" | ADR 0004, CLAUDE.md | **T08** records in `docs/open-work.md`: recipe has nothing to veto (content belongs to the household, cards to the user) |
| O6 | SPEC §1 text the tree contradicts without an ADR: D1 "the top bar has a household switcher" and D6 "A module switcher in the top bar" vs SPEC §5 "There is no global top bar" (M4, `PhoneHeaderRow`); D9 "`/api` and `/uploads` never cached" vs `apps/web/vite.config.ts` (`NetworkFirst` cache `toon-api-recipes`, `CacheFirst` cache `toon-uploads`, toon-recipe's own rules that D13 keeps binding; only the navigation fallback denies both) | planner's audit of D1 to D15 | **T08** writes the ADRs and audits the rest |
| O7 | `docs/plans/m3-finance-module.md` line 3 still reads "with two open server-side defects" (fixed in M4-T01) | m3 plan | **T08** appends the closure note |
| O8 | `docs/open-work.md`: owner actions (cutover, first release/deploy run, GHCR visibility, `DEPLOY_ENABLED`, OAuth callbacks, arm64, dropping the old hostnames, deleting old volumes, iOS install check), owner decisions ("Gruppe" vs "Haushalt", R's pinned design exceptions, finance print styles, per-household PWA name/icon), N-person ledger out (D3), observations recorded not fixed (m5 §10: `@toon/api migrate:legacy:` prefix, random re-keyed ids per pass, the 24 h `uploads:gc` grace; m3b §9.6: focus after "Buchen" matches F; i18n:check's by-design exit 1) | CLAUDE.md "Obligations", plans §7/§8/§10 | **T08** |
| O9 | `CLAUDE.md` as built; nothing named that does not exist | SPEC §8 | **T09** with `apps/api/test/docs-paths.test.ts` |
| O10 | Gates, evidence runs, the record | SPEC §7 | **T10** |

### 1.3 Decisions this plan takes (binding for the tasks)

1. **CLAUDE.md becomes the core-and-cross-cutting guide; module knowledge moves to the module docs.**
   `docs/modules/recipe.md` and `docs/modules/finance.md` own their module's decisions and gotchas;
   CLAUDE.md names them in its read order ("read before touching `modules/<id>`") and keeps a one-line
   pointer per moved gotcha. Milestone history ("What M_x added", the per-milestone obligation lists) leaves
   CLAUDE.md: the plans hold it, and the Status section is one paragraph naming each milestone with its
   plan file. Owner and deferred items live in `docs/open-work.md`. Target: CLAUDE.md at most 600 lines.
2. **No gotcha is lost (Table G).** Each of the 69 bold titles of `git show 46e830b:CLAUDE.md` "Gotchas
   in use" survives verbatim in its first 40 characters (whitespace-normalised) in CLAUDE.md or in a module
   doc, per Table G. A title made obsolete by M7 (G2 if T02 switches the suite) is kept in a short
   "Retired gotchas" list in CLAUDE.md with one line saying what replaced it. T09's verify checks all 69.
3. **`docs/API.md` keeps toon-recipe's table format, with FULL paths.** Every endpoint is one row
   `| METHOD | \`/full/path\` | Auth | Request | Response | Status |`; no `…/` abbreviation, no relative path.
   Auth vocabulary: `public`, `session`, `household:member|admin|owner`, plus `+module:<id>` (behind
   `requireModule`), `+verified` (behind `requireVerifiedEmail`), `+finance:participant` (behind
   `requireFinanceParticipant`). Section order: Conventions, Error codes, Middleware chain and mount order,
   Security (origin guard, CSP, rate limits, proxy), Health, Unconfirmed accounts, Auth, Households,
   Members and placeholders, Invites and claim invites, Modules, Uploads and signed URLs, Core tables,
   `## Recipe module`, `## Finance module`. Request/response names are the `@toon/shared` exports, with
   finance's `Finance…` export names where the flat barrel renamed them.
4. **`apps/api/test/api-doc.test.ts` keeps the doc honest (T03 writes it; T04 and T05 each add one module
   id).** It parses the rows of decision 3 and compares them with `app.routes` of `apps/api/src/index.ts`
   (method `ALL` excluded): (a) every served route outside the module prefixes is documented; (b) every
   served route under a module prefix is documented once that module id is in
   `REQUIRED_MODULE_SECTIONS` (`[]` in T03, `["recipe"]` after T04, `["recipe","finance"]` after T05);
   (c) every documented row is served, except `DOC_ONLY = ["GET /uploads/:filename.thumb.webp"]`;
   (d) every value of `ERROR_CODES` (`packages/shared/src/core/schemas/common.ts`) appears in docs/API.md
   as an inline-code span; (e) no row is documented twice. Module prefixes:
   `/api/households/:householdId/recipe`, `/api/recipe/`, `/api/households/:householdId/finance`.
5. **`apps/api/test/docs-paths.test.ts` keeps every repo path in the living docs real (T09).** It scans
   CLAUDE.md, docs/API.md, docs/modules/recipe.md, docs/modules/finance.md and docs/open-work.md (never the
   plans, ADRs or SPEC, which are dated records) for inline-code spans that are repo-relative paths: they
   start with `apps/`, `packages/`, `scripts/`, `docs/`, `docker/`, `.github/`, or are one of the root files
   (`Dockerfile`, `.dockerignore`, `docker-compose.yml`, `package.json`, `bun.lock`, `.bun-version`,
   `.env.example`, `.env.local-stack`, `README.md`, `CLAUDE.md`, `tsconfig.json`, `bunfig.toml`). It drops a
   trailing `:<line>` and `#anchor`, expands one level of `{a,b}` braces, resolves a span containing `*`
   with `Bun.Glob` (at least one match), skips spans containing `<`, `…` or `$`, and asserts each path exists
   (a trailing `/` means a directory). `ALLOW_MISSING` lists, with a reason each, the spans that name a path
   on purpose as absent (e.g. `apps/api/tests/` "never create it", `apps/web/src/features/` "nothing lives
   there"). CLAUDE.md therefore writes every file it names repo-relative from the root.
6. **Module doc outline (T06, T07), fixed:** (1) What the module owns: SQL tables with their drizzle
   identifiers, the API routers with their files and mount points, the manifest hooks it implements, the
   shared package directory, scripts, web routes/tabs/secondary items/screens, catalog namespaces,
   service-worker rules, persist allow-list and outbox namespaces, env switches; (2) Locked decisions of the
   source, each with its status in H; (3) H's own decisions for the module (plan decisions, ADRs);
   (4) Gotchas: (a) the module gotchas moved from CLAUDE.md (Table G), titles verbatim, bodies updated to
   repo-relative paths, (b) the inherited-gotcha table (decision 8); (5) Verification (the module's greps,
   test files, manual checks); (6) Source references by absolute path and commit. English throughout (D15);
   German UI strings quoted byte-identical where cited.
7. **Temp-file test DB: go/no-go (T02).** Port toon-finance's `defaultTestDatabaseUrl()` into H's
   `env.ts` (`TEST_DATABASE_URL ?? <fresh temp file per process>`). GO when the full suite is green three
   runs in a row and the median wall time is at most 3x the 24.5 s baseline; then ADR 0009 supersedes ADR
   0003 and SPEC D13's ADR 0003 sentence is replaced. NO-GO otherwise: the code changes are reverted, ADR
   0003 stays and gains one consequence bullet "M7 measured: <timings, failing tests>", and T08 lists the
   switch in `docs/open-work.md`. A real defect the switch exposes (a statement on the outer `db` inside a
   `withTransaction`, a race that now surfaces `SQLITE_BUSY`) is fixed in T02 with a regression test when
   the fix is local to one service; otherwise it is a NO-GO reason. T02's commit subject starts
   `M7-T02 GO:` or `M7-T02 NO-GO:`; T08 and T10 read it with `git log --grep "M7-T02"`.
8. **Inherited-gotcha tables (T06, T07).** Recipe: one row per bold bullet of toon-recipe's CLAUDE.md
   "## Gotchas that will bite you" at `48736d2`, numbered `R1` to `R83` in order of appearance:
   `| R<n> | <first 40+ characters of the title, verbatim> | <status> | <H location or rule> |`.
   Finance: one row per numbered gotcha of toon-finance's CLAUDE.md at `1715207`, `F1` to `F74` by F's own
   number: `| F<n> | <English title> | <status> | <H location or rule> |`. Status vocabulary: `module`
   (binding inside the module; the H path), `core` (applies app-wide; CLAUDE.md carries it), `adapted`
   (binding with a named H change: the ADR or plan decision), `superseded` (replaced; name the ADR/D),
   `obsolete` (does not apply to H's shape; one-line reason, e.g. F19 the toon-edge network alias, R's
   "THERE IS NO CADDYFILE IN THIS REPO ANY MORE"). The source's locked decisions get the same treatment in
   section 2 of the doc (`RD<n>`, `FD<n>`).
9. **ADR numbering.** `0009` is reserved for T02's GO. T08 numbers its ADRs from the next free number
   (`ls docs/adr`), one commit per ADR with the SPEC §1 text edited in the same commit.
10. **The print fix is minimal (T01).** Only the phone ingredients panel's action row (the `ServingsScaler`
    plus the "Zur Einkaufsliste" button, `RecipeDetailPage.tsx` around line 640) gets `data-print="hide"`,
    exactly as the desktop branch already hides its scaler and button; the scaled note and the ingredient
    list stay printed. No change to `print.css`.
11. **Commit trailer.** Commits end with the trailer the session's harness prescribes (CLAUDE.md
    "Conventions"); the computed workflow text's trailer is used only when the harness gives none.

## 2. Tables

### 2.1 Table G — where each CLAUDE.md gotcha lands (title prefixes from `git show 46e830b:CLAUDE.md`)

| G | Title (first words) | Lands in |
| --- | --- | --- |
| 1 | D7 pragmas. | CLAUDE.md |
| 2 | `file::memory:` is per client. | CLAUDE.md (Retired gotchas if T02 GO) |
| 3 | Migrations are generated. | CLAUDE.md |
| 4 | Middleware chain order is load-bearing. | CLAUDE.md |
| 5 | A `household_modules` row is the enabled state. | CLAUDE.md |
| 6 | `HouseholdWithRole` has `modules: string[]` … | CLAUDE.md |
| 7 | A seated participant cannot leave while the ledger has rows. | finance.md (CLAUDE.md keeps a pointer under the core `removeMember` hook) |
| 8 | Plan payer and income person must be participants … | finance.md |
| 9 | Enabling finance needs two participants (D3). | finance.md |
| 10 | Uploads are signed, not cookie-checked. | CLAUDE.md |
| 11 | Cross-household guard (D8). | CLAUDE.md |
| 12 | `MessageKey` must stay a literal union (D10). | CLAUDE.md |
| 13 | No module-level constants over `WEB_MODULES` | CLAUDE.md |
| 14 | Persist policy comes from the manifests (D9). | CLAUDE.md |
| 15 | Service worker. | CLAUDE.md |
| 16 | The route tree is strict, with one hole. | CLAUDE.md (the LINKS greps themselves move to the module docs) |
| 17 | A module owns its layout route … | CLAUDE.md |
| 18 | API import cycle … | CLAUDE.md |
| 19 | Recipe tables and indexes are prefixed … | recipe.md |
| 20 | Fold columns and the backfill. | recipe.md |
| 21 | Import route tests use real sessions. | recipe.md |
| 22 | Import query keys are rooted at `"toon"` … | recipe.md |
| 23 | The library's recipe count is the module's own query … | recipe.md |
| 24 | The shopping list outbox is wired through the manifest. | recipe.md |
| 25 | Inherited recipe gotchas stay binding inside `modules/recipe` | recipe.md |
| 26 | Finance TS identifiers carry a `finance` prefix … | finance.md |
| 27 | Participants and the gate … | finance.md |
| 28 | The `start` hook and the clock. | finance.md |
| 29 | `settingsSections` are rendered. | finance.md |
| 30 | Finance server catalog (ADR 0002). | finance.md |
| 31 | The finance test harness gives toon-finance's names H semantics … | finance.md |
| 32 | The finance greps | finance.md |
| 33 | The design-system test is the Table D gate … | CLAUDE.md |
| 34 | Hand-written utilities beat breakpoint variants. | CLAUDE.md |
| 35 | `FinanceGate` renders `PendingSyncNote` … | finance.md |
| 36 | `ActionMenu` has `renderTrigger` and `item.current`. | CLAUDE.md |
| 37 | Every shell screen renders `PhoneHeaderRow` itself | CLAUDE.md |
| 38 | Printing a recipe … | recipe.md |
| 39 | Theme colour has one source. | CLAUDE.md |
| 40 | The manifest. | CLAUDE.md |
| 41 | Inherited finance gotchas stay binding inside `modules/finance` | finance.md |
| 42 | The offline queue survives a second reload … | CLAUDE.md (core `lib/query-client.ts`) |
| 43 | Headless runs. | CLAUDE.md |
| 44 | `scrollbar-gutter: stable` | CLAUDE.md |
| 45 | i18n-check from worktrees | CLAUDE.md |
| 46 | Long commands | CLAUDE.md |
| 47–53 | the seven `migrate:legacy` gotchas (snapshots, CLI import order, subprocess tests, claimed ids, ledger states, fixtures, evidence) | CLAUDE.md |
| 54 | Placeholders and claim invites … | CLAUDE.md |
| 55 | The origin guard trusts `WEB_ORIGIN` … | CLAUDE.md |
| 56 | The CSP and the baked API URL … | CLAUDE.md |
| 57 | Core hardening from `1715207` … | CLAUDE.md |
| 58 | The Erfassen sheet is module-local and has no FAB … | finance.md |
| 59 | Claim links are credentials … | CLAUDE.md |
| 60 | The claim test cleans the shared DB … | CLAUDE.md |
| 61 | Core copy stays module-neutral … | CLAUDE.md |
| 62 | F gotcha numbers are F's numbering at `1715207`. | finance.md |
| 63–68 | the six M6 deploy gotchas (Dockerfile guard, Caddy empty var, `handle` not `redir`, bind-mount inode, private GHCR package, local stack project name) | CLAUDE.md |
| 69 | The first boot catches the fixed-cost plan up … | CLAUDE.md (cross-cutting: migration + deploy) |

### 2.2 Table P — rewrites for the recipe section of docs/API.md (T04)

Source: `/home/erics/software/toon-recipe/docs/API.md` at `48736d2`. Apply in this order, in table rows
AND prose; German strings, `server.group.*` keys and error codes never change.

| R text | H text |
| --- | --- |
| `/api/groups/:groupId/` (a path under a group: recipes, tags, collections, imports, shopping-lists, plan) | `/api/households/:householdId/recipe/` |
| `…/` at the start of a path cell (the shopping-list and plan tables) | `/api/households/:householdId/recipe/` |
| `/api/cards` | `/api/recipe/cards` |
| `apps/api/src/routes/<r>.ts` | `apps/api/src/modules/recipe/routes/<r>.ts` |
| `apps/api/src/services/<x>/` or `services/<x>/` (recipes, import, ocr, plan, shopping, cards) | `apps/api/src/modules/recipe/services/<x>/` |
| `packages/shared/src/schemas/<s>.ts` (recipe, plan, import, shopping, card) | `packages/shared/src/modules/recipe/schemas/<s>.ts` |
| `packages/shared/src/<f>.ts` (units, ingredients, numbers, duration, tags, shopping, barcode, qr) | `packages/shared/src/modules/recipe/<f>.ts` |
| `packages/shared/src/text.ts` | `packages/shared/src/core/text.ts` |
| `apps/web/src/features/<f>/` | `apps/web/src/modules/recipe/features/<f>/` |
| Auth `group:member` / `group:admin` / `group:owner` | `household:member+module:recipe` / `household:admin+module:recipe` / `household:owner+module:recipe` (append `+verified` on rows the "Unconfirmed accounts" list of R gates: every POST/PATCH/PUT/DELETE under recipes, tags, collections, imports, shopping-lists) |
| "Mounted at `/api/groups/:groupId`" | "Mounted at `/api/households/:householdId/recipe` by `mountModules` (`apps/api/src/modules/mount.ts`), behind `requireSession()` → `requireHouseholdRole("member")` → `requireModule("recipe")`" |
| "Mounted at `/api/cards`" … "no `requireGroupRole`" | "Mounted at `/api/recipe/cards` (the module's `userRouter`, NOT behind `requireModule`) …" "no `requireHouseholdRole`" |
| identifiers `groupId`, `requireGroupRole`, `active_group_id`, `GroupRole` | `householdId`, `requireHouseholdRole`, `active_household_id`, `HouseholdRole` |
| prose "group" meaning the owning group | "household" (not "group heading", "version group", `groupBy`) |
| query keys `["toon","group",id,…]` | `["toon","household",id,"recipe",…]` |
| R table names (`recipes`, `recipe_ingredients`, `tags`, `recipe_tags`, `collections`, …) in the Tables section | the `recipe_` SQL names of m2 plan §2 Table A and decision 2 / Table C (`recipe_recipes`, `recipe_recipe_ingredients`, `recipe_tags`, `recipe_recipe_tags`, …); `group_id` → `household_id` |

R sections copied: "Recipes", "Imports", "Shopping lists", "Meal plan", "Saved cards" (R lines 219-568),
the `features.ocrImport` / `features.pdfImport` rows of "Health" (as "### Health features"), the recipe
bullets of "Unconfirmed accounts are read-only" (as "### Unconfirmed accounts in the recipe module"), and
the recipe tables of "Tables" (as "### Tables"). R's Health, Auth, Groups and Uploads sections are T03's.

### 2.3 ADR candidates found by the planner (T08 writes them; the audit may add more)

| Candidate | SPEC §1 text | Built | ADR changes the text to |
| --- | --- | --- | --- |
| A1 | D1 "the top bar has a household switcher"; D6 "A **module switcher** in the top bar (and the sidebar head from `lg`)" | no global top bar; every shell screen renders `PhoneHeaderRow` (household chip, module chip, at most one action), the recipe detail excepted; the sidebar head from `lg` (SPEC §5, M4-T02/T07/T09, `core/features/phone-header.test.ts`) | "each shell screen's header row (`PhoneHeaderRow`) carries the household switcher chip and the module switcher chip on phones; the sidebar head carries both from `lg`" |
| A2 | D9 "Service worker: `/api` and `/uploads` never cached; the `NetworkOnly` list is the union of both sources' lists" | `/api` and `/uploads` are denied by the navigation fallback only; runtime caching keeps toon-recipe's rules (D13): `NetworkFirst` `toon-api-recipes` for recipes, tags, collections; `CacheFirst` `toon-uploads`; every other API path `NetworkOnly` (auth, imports, shopping-lists, plan, cards, finance) | "`/api` and `/uploads` never served by the navigation fallback; runtime rules are the union of both sources' (`NetworkOnly` first, recipe's `NetworkFirst` read cache and `CacheFirst` uploads as toon-recipe has them)" |
| A3 (check) | D10 "new copy (Home, switcher, participant settings, module-disabled states) is the only new German" | M3b added five core web keys and two server keys of new German for placeholders and claim invites (ADR 0006 records them, D10's list does not) | T08 decides: a one-line amendment of D10 by a new ADR naming ADR 0006's copy, or a no-ADR finding with its reason in plan §10 |

## 3. Task list and waves

| Id | Title | Tier | Deps | Files owned |
| --- | --- | --- | --- | --- |
| M7-T01 | Recipe print: hide the phone detail's scaler row | build | – | `RecipeDetailPage.tsx`, `print-css.test.ts` |
| M7-T02 | Whole test suite on a temp-file DB (ADR 0003's consequence) | core | – | `apps/api/src/env.ts`, the two `support.ts`, `finance-file-db.test.ts`, `db-pragmas.test.ts`, ADR 0003/0009, SPEC D13 |
| M7-T03 | docs/API.md: conventions, core endpoints, security, error codes + `api-doc.test.ts` | build | – | `docs/API.md`, `apps/api/test/api-doc.test.ts` |
| M7-T04 | docs/API.md recipe section (port of R's API.md) | port | T03 | `docs/API.md`, `apps/api/test/api-doc.test.ts` |
| M7-T05 | docs/API.md finance section (F spec §3 in English) | build | T04 | `docs/API.md`, `apps/api/test/api-doc.test.ts` |
| M7-T06 | docs/modules/recipe.md | build | – | `docs/modules/recipe.md` |
| M7-T07 | docs/modules/finance.md | build | – | `docs/modules/finance.md` |
| M7-T08 | ADR audit of D1-D15, docs/open-work.md, stale plan status | build | T01, T02 | `docs/adr/00NN-*.md` (new), `docs/SPEC.md`, `docs/open-work.md`, `docs/plans/m3-finance-module.md` |
| M7-T09 | CLAUDE.md as built + `docs-paths.test.ts` | core | T05, T06, T07, T08 | `CLAUDE.md`, `apps/api/test/docs-paths.test.ts` (and path fixes in the docs of T03-T08) |
| M7-T10 | Integration: gates, evidence, print-to-PDF, record | build | all | `docs/plans/m7-harden.md`, `CLAUDE.md` (status line, counts) |

Waves (the scheduler takes `ready.slice(0, MAX_PARALLEL = 3)` over this array order): wave 1 T01, T02,
T03; wave 2 T04, T06, T07; wave 3 T05, T08; wave 4 T09; wave 5 T10. No two tasks of one wave share a
file in any order the scheduler can produce: `docs/API.md` and `api-doc.test.ts` are a chain (T03 → T04 →
T05); `docs/SPEC.md` is T02 then T08; CLAUDE.md is T09 then T10; the module docs are written once (T06,
T07) and touched again only by T09's path fixes.

Shared gate commands (every task runs those its brief lists, from the repo root):

```bash
bun run typecheck
bun test
bun run build
bun test apps/api/test/api-doc.test.ts          # from T03 on
bun test apps/api/test/docs-paths.test.ts       # from T09 on
```

## 4. Tasks

### M7-T01 — Recipe print: hide the phone detail's scaler row (build)

**Goal.** Close O1: printing a recipe from a phone shows ingredients and steps, never the servings scaler
or "Zur Einkaufsliste".

**Read.** CLAUDE.md gotcha "Printing a recipe (verified by printing to PDF, M4-T09)"; m4 plan §9.8 (the
observation) and decision 14; `apps/web/src/modules/recipe/features/recipes/print.css`;
`RecipeDetailPage.tsx` (desktop branch lines ~520-560 hide the scaler and button with `data-print="hide"`;
phone branch ~620-670 does not); toon-recipe CLAUDE.md gotcha "`features/recipes/print.css` is invisible to
all five gates"; `apps/web/src/styles/design-system.test.ts` (`data-print` is pinned there; do not relax).

**Do.** In the phone branch, put `data-print="hide"` on the `<div className="flex items-center gap-2.5">`
that wraps `<ServingsScaler … size="md" />` and the `recipe.recipes.detail.addToShoppingList` button
(decision 10). Extend `print-css.test.ts` with a describe "phone detail hides its action row in print" that
reads `RecipeDetailPage.tsx` and asserts (a) every `<ServingsScaler` occurrence sits inside an element
carrying `data-print="hide"` within the same JSX block (search backwards from the occurrence to the nearest
opening tag that contains `data-print="hide"` before any closing `</div>` of a sibling; a simple
implementation: for each occurrence, the last `data-print="hide"` before it is closer than the last
`hidden={activeTab` before it), (b) the same for each `t("recipe.recipes.detail.addToShoppingList")`.
No other markup change; the scaled note stays visible in print.

**Acceptance.** Both branches hide scaler and button in print; the new test fails on `46e830b`'s file and
passes now; design-system test unchanged and green. The real print check (pdftotext at 390 and 1440) is
T10's.

**Verify.** `bun test apps/web/src/modules/recipe/features/recipes`, `bun test apps/web/src/styles`,
`bun run typecheck`, `bun run build`.

### M7-T02 — Whole test suite on a temp-file DB (core)

**Goal.** Close O2 (ADR 0003's consequence): `bun test` runs on a fresh temp `file:` database per process,
so every `withTransaction` in the core, recipe and finance runs a REAL transaction under test, as
toon-finance's gotcha 2 requires. Decision 7 is the go/no-go rule.

**Read.** ADR 0003; SPEC D7, D13; toon-finance CLAUDE.md gotchas 1 and 2 and
`/home/erics/software/toon-finance/apps/api/src/env.ts` (`defaultTestDatabaseUrl`, lines ~210-235);
H `apps/api/src/env.ts` (lines ~20-25 and ~320-326: `source.DATABASE_URL = source.TEST_DATABASE_URL ??
"file::memory:"`); `apps/api/src/db/client.ts` (pragmas incl. `busy_timeout = 5000`, `foreign_keys = ON`);
`apps/api/src/core/services/households/support.ts` (`transactionsSupported`, `withTransaction`) and
`apps/api/src/modules/finance/services/support.ts`; `apps/api/test/finance-file-db.test.ts` (case (d)
"the shared memory client still degrades"); `apps/api/test/db-pragmas.test.ts`;
`apps/api/src/modules/recipe/services/import/db.ts` (`setImportDbForTests`, a file-backed import DB that
stays as is); CLAUDE.md gotchas "`file::memory:` is per client", "D7 pragmas", "Subprocess tests of the
CLI set `NODE_ENV=development`".

**Do.**
1. Baseline: `bun test` three times, record pass count and wall time (planner: 2418 pass, 24.5 s).
2. Port F's helper into H `env.ts`: under `NODE_ENV=test`, `DATABASE_URL = TEST_DATABASE_URL ??
   file:<os.tmpdir()>/toon-household-test-<uuid>.db`; register a synchronous `process.on("exit")` that
   removes that file and its `-wal`/`-shm` (errors ignored; H's addition if F has none). Update the env.ts
   comment that says tests use `file::memory:`.
3. Keep `transactionsSupported` (an explicit `TEST_DATABASE_URL=file::memory:` still degrades); update its
   doc comments in both `support.ts` files.
4. Rewrite `finance-file-db.test.ts` case (d) to prove the property the suite now has: on the SHARED
   client a throw inside `withTransaction` rolls the insert back (keep (a)-(c) as they are). Adjust
   `db-pragmas.test.ts` only if it asserted the shared client is memory.
5. Run the suite three times. A failure that is a real defect (outer `db` used inside a transaction,
   `SQLITE_BUSY` from two concurrent transactions in a race test) gets a local fix in the service plus a
   regression test, named in the commit body. A test that only encoded the degraded behaviour is updated
   with a comment.
6. GO (green 3x, median wall time <= 73.5 s): write `docs/adr/0009-test-suite-on-a-temp-file-db.md`
   (date, context, decision, consequences; it supersedes 0003 and restores F gotcha 2), add "Superseded by
   ADR 0009" under ADR 0003's title, and replace SPEC D13's sentence "One recorded exception: finance's
   tests run on the shared memory DB … (ADR 0003)." with "ADR 0003 (finance tests on the shared memory
   DB) is superseded by ADR 0009: the whole suite runs on a temp file DB, as toon-finance's gotcha 2
   wants." Commit `M7-T02 GO: …`.
   NO-GO: revert steps 2-5, add the consequence bullet "M7 measured: …" (timings, failing tests) to ADR
   0003, commit `M7-T02 NO-GO: …`.

**Acceptance.** GO: `bun test` green with the same or more passing tests, three consecutive runs, timings
in the commit body; ADR 0009 and the SPEC D13 edit in the same commit. NO-GO: the tree is the base tree
plus the ADR 0003 bullet. Either way `bun run typecheck` green.

**Verify.** `bun run typecheck`, `bun test`, `bun test apps/api/test/finance-file-db.test.ts
apps/api/test/db-pragmas.test.ts`, `test -f docs/adr/0009-test-suite-on-a-temp-file-db.md || grep -q "M7
measured" docs/adr/0003-finance-tests-on-the-shared-memory-db.md`.

### M7-T03 — docs/API.md: conventions, core endpoints, security, error codes + guard test (build)

**Goal.** O3, core part: the authoritative contract of the core API, in English, and the test of decision 4.

**Read.** Decisions 3 and 4. toon-recipe `docs/API.md` sections Conventions, Health, "Unconfirmed accounts
are read-only", Auth (incl. password reset, e-mail verification), Groups, "Uploads and signed URLs",
Tables (core rows); toon-finance `docs/spec.md` §3.1 (conventions), §3.2 (`ERROR_CODES`), §3.4 (auth: claim
registration), §3.5 (households: placeholders, claim invites; German, translate). H sources:
`apps/api/src/index.ts` (mount order), `apps/api/src/modules/mount.ts`, `apps/api/src/core/routes/{auth,
households,members,invites,modules}.ts`, `apps/api/src/middleware/{session,household,module,verifiedEmail,
originGuard,securityHeaders,staticWeb}.ts`, `apps/api/src/core/services/auth/rateLimit.ts`,
`apps/api/src/lib/{errors,uploadUrls,http}.ts`, `packages/shared/src/core/schemas/{common,household,user,
auth}.ts`, `apps/api/src/db/schema/core.ts`. ADRs 0004 (veto, `member_has_ledger`), 0006 (placeholders,
claim invites), 0007 (CSP, origin guard). CLAUDE.md gotchas "Middleware chain order is load-bearing", "A
`household_modules` row is the enabled state", "Uploads are signed", "Placeholders and claim invites", "The
origin guard trusts `WEB_ORIGIN`", "The CSP and the baked API URL", "Core hardening from `1715207`",
"Enabling finance needs two participants". m5 plan §8 (migrated finance-only accounts start unconfirmed).

**Do.** Write `docs/API.md` with the section order of decision 3, every core route as a full-path row
(34 core routes + `GET /api/health` + `GET /uploads/:filename`; the thumb variant row is allowed),
including: the error envelope and "branch on `code`"; the complete `ERROR_CODES` table (code, HTTP
status, raised by core/recipe/finance, meaning); the middleware chain `requireSession` →
`requireHouseholdRole("member")` → `requireModule` and the mount order (health, `/uploads`, module routers,
`/api/auth`, `/api/households`, static web last; invite-token routes before `/:householdId`); security
(origin guard: unsafe methods, `WEB_ORIGIN` entries first, `Sec-Fetch-Site`, `Origin: null`, host compare,
403 `origin_mismatch` code as in `ERROR_CODES`; the CSP header verbatim from `securityHeaders.ts`; JSON
content-type check; rate limits with their windows from `rateLimit.ts`; `TRUST_PROXY` and the LAST
`X-Forwarded-For` hop); health (`modules`, `features` incl. `verifiedEmailRequired`; module features are
listed in their sections); unconfirmed accounts (core-gated routes; module lists live in module sections);
auth (register with `inviteToken` redeeming a claim invite in place; migrated finance-only accounts start
unconfirmed); households; members (`POST …/members` adds a placeholder, `PATCH
…/members/:userId/placeholder`, `DELETE` runs every build module's `onMemberRemoving` veto, finance
answers `409 member_has_ledger`); invites (claim invites `claimsUserId`, admin+, older pending one
revoked, `409 invite_claim_requires_register`, `409 member_has_account`, spent token `404
invite_invalid`); modules (`POST`/`DELETE …/modules/:moduleId`, `{ settings? }` body, finance's two
participants and `422 finance_participants_required`, `404 module_disabled`); uploads and signed URLs;
core tables. End with `## Recipe module` and `## Finance module`, each holding only the line
`<!-- M7-T04 fills this section -->` / `<!-- M7-T05 fills this section -->`.
Write `apps/api/test/api-doc.test.ts` per decision 4 (import `app` from `../src/index.ts` as
`smoke.test.ts` does; `REQUIRED_MODULE_SECTIONS: string[] = []`).

**Acceptance.** The test passes with all five assertions; every `ERROR_CODES` value appears; no
`/api/groups`, `:groupId` or `group:` auth level in the doc; English prose; status codes taken from the
route code, not invented.

**Verify.** `bun test apps/api/test/api-doc.test.ts`, `bun run typecheck`, `test -s docs/API.md`,
`! grep -nE "/api/groups|:groupId|group:member" docs/API.md`.

### M7-T04 — docs/API.md recipe section (port)

**Goal.** O3, recipe part: toon-recipe's contract under H's paths, verbatim otherwise.

**Read.** Decision 3; Table P (section 2.2) — every rewrite is listed there; toon-recipe
`docs/API.md` lines 50-72 (Health features rows), 73-102 (Unconfirmed accounts, recipe bullets), 219-568
(Recipes, Imports, Shopping lists, Meal plan, Saved cards), 610-658 (Tables, recipe rows); m2 plan §2
Table A and decision 2 / Table C (SQL table names); `apps/api/test/api-doc.test.ts`.

**Do.** Replace the line `<!-- M7-T04 fills this section -->` under `## Recipe module` with the copied
sections, demoted one heading level (`##` → `###`), Table P applied, in R's order: Health features,
Unconfirmed accounts in the recipe module, Recipes, Imports, Shopping lists, Meal plan, Saved cards,
Tables. Change `REQUIRED_MODULE_SECTIONS` in `api-doc.test.ts` to `["recipe"]`. Run the test; a failing
row is a missed Table P rewrite: fix the row's path, nothing else. Do not add or reword content.

**Acceptance.** `api-doc.test.ts` green with `["recipe"]`; every one of the 61 recipe routes is a row; no
`/api/groups`, `:groupId`, `/api/cards`, `…/`, `group:member`, `requireGroupRole` left in the section.

**Verify.** `bun test apps/api/test/api-doc.test.ts`, `! grep -n "M7-T04 fills" docs/API.md`,
`! grep -nE "/api/groups|:groupId|requireGroupRole|group:(member|admin|owner)" docs/API.md`,
`! grep -nF '| `…/' docs/API.md`,
`! grep -nE "\`/api/cards" docs/API.md`.

### M7-T05 — docs/API.md finance section (build)

**Goal.** O3, finance part: toon-finance's API contract (German, `docs/spec.md` §3) in English under H's
paths, with every H change.

**Read.** Decisions 3 and 4; toon-finance `docs/spec.md` §3.1 (conventions: `mutationId`, replay 200),
§3.6 Transaktionen, §3.7 Fixkostenplan, §3.8 Saldo, §3.9 Ausgleichszahlungen, §3.10 Kategorien und Tags,
and `docs/ledger-spec.md` §2.2 (kinds) and §5 (balance); H `apps/api/src/modules/finance/routes/*.ts`,
`middleware.ts`, `services/participants/`, `services/plan/plan.service.ts`;
`packages/shared/src/modules/finance/schemas/*.ts` and `index.ts` (export names, `Finance…` aliases);
`apps/api/src/modules/finance/schema.ts` (11 tables); ADRs 0002, 0004, 0005, 0006, 0007; CLAUDE.md
gotchas G7, G8, G9, G26, G27, G28 (Table G); m3 plan §2 (F → H rewrite tables) and decisions 3-5.

**Do.** Replace `<!-- M7-T05 fills this section -->` under `## Finance module` with: mount and access
(`/api/households/:householdId/finance`, the chain plus `requireVerifiedEmail()` and
`requireFinanceParticipant()` on every ledger router and method, `403 finance_not_participant`,
`404 module_disabled`); conventions (integer cents, periods `YYYY-MM`, `mutationId` minted by the client and
claimed by an INSERT, replay answers 200 with the current state, idempotency reads filter on the
household, content language from `finance_settings.default_locale`); then one `###` per router in the
route-file order participants, transactions (register `/summary` before `/:transactionId`), categories,
tags, plan (items, incomes, preview, run, recalculate, runs), balance (sign convention: the response's
`viewerBalanceCents` is the viewer's projection, the UI never shows a raw sign), settlements
(`expectedBalanceCents` required, `409 balance_stale` carries the current balance); participants:
`GET` (`{ items, viewerSlot }`, `viewerSlot: null` for a non-participant, the only route they reach),
`PUT` (admin, two seats, `409 finance_participant_in_use` while ANY transaction row or an income naming the
outgoing user exists, ADR 0004; a placeholder only in slot 2, `server.finance.placeholderSlotOne`), `PATCH
…/participants/me`, `PATCH …/participants/:userId` (placeholder seat display name, M3b); plan payer and
income person must be participants (`422 validation_failed`, field detail, `server.finance.
personNotParticipant`); the member-leaves veto cross-referenced to the core Members section; the finance
tables (11, SQL names, PKs, the `member_slot` CHECK and unique index). Change `REQUIRED_MODULE_SECTIONS` to
`["recipe","finance"]`.

**Acceptance.** `api-doc.test.ts` green with both modules; all 33 finance routes documented; every
status code and error code taken from the route/service code; English prose; German UI strings quoted
byte-identical if quoted at all.

**Verify.** `bun test apps/api/test/api-doc.test.ts`, `! grep -n "M7-T05 fills" docs/API.md`,
`grep -q finance_participant_in_use docs/API.md`, `grep -q balance_stale docs/API.md`,
`grep -q personNotParticipant docs/API.md`, `grep -q member_has_ledger docs/API.md`.

### M7-T06 — docs/modules/recipe.md (build)

**Goal.** O4, recipe: what the module owns, its decisions and every gotcha, in one English document.

**Read.** Decisions 6 and 8; Table G rows 19-25 and 38 (the bodies in the current `CLAUDE.md`);
toon-recipe `CLAUDE.md` at `48736d2` ("Locked decisions", "Navigation", "Conventions", "Gotchas that will
bite you"); SPEC §2, §3, D1, D5, D6, D9, D13; m2 plan §1 decisions, §2 rewrite tables, §10; m4 plan §2
(Table D) and §10; ADR 0001; H `apps/api/src/modules/recipe/` (`index.ts`, `schema.ts`, `migrate.ts`,
`seed.ts`, `routes/`, `services/`), `apps/web/src/modules/recipe/` (`index.ts`, `routes.tsx`,
`HomeCard.tsx`, `nav-trailing.tsx`, `catalogs/`, `lib/`, `features/`), `packages/shared/src/modules/recipe/`,
`apps/web/vite.config.ts` (the recipe SW rules), `apps/api/src/env.ts` (the recipe switches).

**Do.** Write `docs/modules/recipe.md` per decision 6: tables (17 `recipe_` SQL names with drizzle
identifiers), routers and hooks (`householdRouter`, `userRouter`, `afterMigrate`, `shutdown`, `seedDemo`,
`uploadReferences`, `healthFeatures`), web (URL scheme under `/recipe`, tabs Rezepte/Plan/Einkauf + Profil,
secondary Sammlungen and Tags, `RECIPE_FILTER_PARAMS` etc. in `routes.tsx`), persist allow-list and the
`["recipe","shopping"]` outbox, SW rules, env switches; R's locked decisions as `RD1…` rows with status;
H's decisions (URL scheme, TS identifiers unprefixed, fold columns NOT NULL without default, import keys
rooted at `"toon"`, cards user-scoped, ADR 0001 count); section 4a with the eight Table G titles verbatim
and bodies using repo-relative paths; section 4b the `R1`-`R83` table of decision 8 (core-wide items, e.g.
the D7 pragmas, i18n axes, mail, auth gate, staticWeb, get status `core`; deploy-shaped ones status
`superseded` by D11/ADR 0008 or `obsolete`); verification (the recipe LINKS grep from the current
CLAUDE.md gotcha "The route tree is strict", the recipe test files, print-to-PDF and camera notes);
references.

**Acceptance.** All 83 R titles present (verify), the eight moved titles present, every H path named
exists (T09's test will enforce it), English.

**Verify.**
`bun -e 'const fs=require("fs");const n=x=>x.replace(/\s+/g," ");const s=fs.readFileSync("/home/erics/software/toon-recipe/CLAUDE.md","utf8");const g=s.slice(s.indexOf("## Gotchas that will bite you"),s.indexOf("## Verification gates"));const t=[...g.matchAll(/^- \*\*([\s\S]+?)\*\*/gm)].map(m=>n(m[1]).slice(0,40));const d=n(fs.readFileSync("docs/modules/recipe.md","utf8"));const miss=t.filter(x=>!d.includes(x));console.log(t.length+" titles, "+miss.length+" missing");if(t.length!==83||miss.length){console.log(miss.join("\n"));process.exit(1)}'`,
`bun -e 'const fs=require("fs");const n=x=>x.replace(/\s+/g," ");const d=n(fs.readFileSync("docs/modules/recipe.md","utf8"));const t=["Recipe tables and indexes are prefixed,","Fold columns and the backfill.","Import route tests use real sessions.","Import query keys are rooted at","recipe count is the module","The shopping list outbox is wired throug","Inherited recipe gotchas stay binding in","Printing a recipe (verified by printing"];const miss=t.filter(x=>!d.includes(x));if(miss.length){console.log(miss);process.exit(1)}'`,
`bash -c 'for n in $(seq 1 83); do grep -q "^| R$n |" docs/modules/recipe.md || { echo "missing R$n"; exit 1; }; done'`.

### M7-T07 — docs/modules/finance.md (build)

**Goal.** O4, finance: the module document, porting into English the parts of toon-finance's German
docs the module needs (D15), the originals referenced by path.

**Read.** Decisions 6 and 8; Table G rows 7-9, 26-32, 35, 41, 58, 62 (bodies in the current CLAUDE.md);
toon-finance `CLAUDE.md` at `1715207` ("Gesperrte Entscheidungen", "Navigation", "Konventionen", "Gotchas,
die dich beißen werden" 1-74); toon-finance `docs/spec.md` §1.2, §2 (schema), §4 (screens), §6 (copy
inventory, referenced only), `docs/ledger-spec.md` §2-§5 (English already); SPEC D2, D3, D5, D6, D9,
D13; m3 plan §1 decisions, §2 rewrite tables, §10; m3b plan §1.4 decisions and §10.2 (the F gotcha map);
m4 plan §10; ADRs 0002-0007; H `apps/api/src/modules/finance/`, `apps/web/src/modules/finance/`,
`packages/shared/src/modules/finance/`, `apps/api/scripts/{plan-run.ts,finance-import-xlsx.ts,
finance-import/}`.

**Do.** Write `docs/modules/finance.md` per decision 6: the 11 `finance_` tables with drizzle identifiers,
the participants model (two slots by user id, placeholders only in slot 2, the non-participant), routers
and hooks (`onHouseholdCreated`, `onEnable`, `onMemberRemoving`, `start`, `shutdown`, `seedDemo`), web
(tabs Übersicht/Buchungen/Erfassen + Profil, sidebar-only Fixkosten and Kategorien, the gate route, the
Erfassen sheet, `PendingSyncNote`), outbox `["finance","tx"]`, the one SW rule, scripts (`plan:run`,
`finance:import-xlsx`); a "Ledger rules" section in English (the four kinds as a viewer projection, the
balance sign convention, `halfForOther(-101) = -50`, per-transaction halving, the plan share rounded once,
the historical catch-up, booked periods immutable, `lastBookedPeriod`, settlements with
`expectedBalanceCents`), each citing `docs/ledger-spec.md §…` and the F gotcha number; F's locked
decisions as `FD1…` rows; H's decisions (D3 participants, the gate, `start`/clock, ADRs 0002-0007);
section 4a the fourteen Table G titles verbatim; section 4b the `F1`-`F74` table (decision 8; e.g. F2 is
`superseded` by ADR 0003 or `adapted` by ADR 0009 per T02's outcome as merged at the time: write
"ADR 0003 (M7-T02 may supersede it, see CLAUDE.md)" and let T09 settle the wording; F19 `obsolete`; F69
`superseded` by ADR 0004/0007); verification (the four finance greps LINKS_FIN, NOROUTER, NOCORE,
NOSHADOW verbatim from the current CLAUDE.md and m3 plan §3, the finance test files); references.

**Acceptance.** Rows `F1`…`F74` all present; the fourteen moved titles present; English; ledger numbers
match `docs/ledger-spec.md`.

**Verify.**
`bash -c 'for n in $(seq 1 74); do grep -q "^| F$n |" docs/modules/finance.md || { echo "missing F$n"; exit 1; }; done'`,
`bun -e 'const fs=require("fs");const n=x=>x.replace(/\s+/g," ");const d=n(fs.readFileSync("docs/modules/finance.md","utf8"));const t=["A seated participant cannot leave while","Plan payer and income person must be par","Enabling finance needs two participants","Finance TS identifiers carry a","Participants and the gate (D3, plan m3 d","hook and the clock.","are rendered.","Finance server catalog (ADR 0002).","The finance test harness gives toon-fina","The finance greps","renders `PendingSyncNote`","Inherited finance gotchas stay binding i","The Erfassen sheet is module-local and h","F gotcha numbers are F"];const miss=t.filter(x=>!d.includes(x));if(miss.length){console.log(miss);process.exit(1)}'`.

### M7-T08 — ADR audit, docs/open-work.md, stale plan status (build)

**Goal.** O5-O8: every surviving deviation from SPEC §1 has an ADR; every deferred item is written down.

**Read.** SPEC §1 D1-D15 and §5; section 2.3 (A1-A3); every ADR 0001-0008 (and 0009 if T02 went GO:
`git log --grep "M7-T02"`); the "what changed vs plan" sections: m0 §6, m1 §8, m2 §10, m3 §10, m3b §10, m4
§10, m5 §10, m6 §10; CLAUDE.md "Obligations handed to later milestones"; `apps/web/vite.config.ts`;
`apps/web/src/components/layout/PhoneHeaderRow.tsx` and `core/features/phone-header.test.ts`;
toon-recipe `docs/open-work.md` (the shape: decision, what it does, where it lives).

**Do.**
1. Audit D1-D15 sentence by sentence against the tree. For A1 and A2 (verified by the planner) and for
   any further contradiction without an ADR, write one ADR each (decision 9 numbering; date, context,
   decision, consequences) and edit the SPEC §1 text in the same commit. Decide A3 and record the reason.
   A sentence that is merely more precise elsewhere (SPEC §2-§6) is not a deviation.
2. SPEC §3: add `docs/API.md`, `docs/modules/{recipe,finance}.md`, `docs/open-work.md`,
   `apps/api/test/api-doc.test.ts` and `docs-paths.test.ts` to the layout (no other §3 change).
3. `docs/plans/m3-finance-module.md` line 3: append "Both were fixed in M4-T01 (m4 plan §4, ADR 0004)."
4. Write `docs/open-work.md`: an intro (what this file is; CLAUDE.md and SPEC are the rules), then
   sections **Owner actions** (each: what, why only the owner, the guide section: `docs/deployment.md`
   steps 0-12, first `release.yml`/`deploy.yml` run, GHCR visibility, `DEPLOY_ENABLED`, OAuth callback URLs,
   arm64, dropping `RECIPE_HOSTNAME`/`FINANCE_HOSTNAME`, deleting the old volumes, the real
   `migrate:legacy` cutover with claim links handed over privately, a device iOS install check),
   **Owner decisions** ("Gruppe" vs "Haushalt" and `DEFAULT_HOUSEHOLD_NAME` (needs an ADR), toon-recipe's
   pinned design exceptions (34 arbitrary sizes, four uppercase labels, two `←` links, the `-mx-4` bars),
   finance print styles, a per-household PWA name/icon), **Deferred by design** (the N-person ledger, D3;
   a shell-wide sync badge; extending the member-leaves veto: recipe has nothing to veto; the one-seat
   ledger after a slot-1 placeholder dead state, ADR 0006), **Recorded observations** (m5 §10 three items,
   m3b §9.6 focus after "Buchen", `i18n:check`'s by-design exit 1 with 146 classified hits, the temp-file
   DB if T02 went NO-GO with its numbers), each with its source plan section and how to verify when done.
   No item without a source.

**Acceptance.** `ls docs/adr` shows the new ADRs; SPEC no longer says "the top bar has a household
switcher" nor "`/uploads` never cached"; open-work lists every O5/O8 item; the m3 plan line is closed.

**Verify.** `test -s docs/open-work.md`, `! grep -n "the top bar has a household switcher" docs/SPEC.md`,
`! grep -nF 'and `/uploads` never cached' docs/SPEC.md`, `grep -q "Haushalt" docs/open-work.md`,
`grep -q "DEPLOY_ENABLED" docs/open-work.md`, `grep -q "fixed in M4-T01" docs/plans/m3-finance-module.md`,
`bun run typecheck`, `bun test apps/api/test/deployment-doc.test.ts apps/api/test/legacy-migration-doc.test.ts`.

### M7-T09 — CLAUDE.md as built + docs-paths test (core)

**Goal.** O9: CLAUDE.md describes the tree as it is, names no file that does not exist, and loses no
gotcha.

**Read.** Decisions 1, 2, 5; Table G; the current `CLAUDE.md`; SPEC §1-§3; the docs written by T03-T08;
`git log --oneline 46e830b..HEAD`; the tree (`git ls-files`).

**Do.**
1. Write `apps/api/test/docs-paths.test.ts` per decision 5. Run it against the current docs first and fix
   every broken path it reports in docs/API.md, the module docs and open-work.md (path fixes only).
2. Rewrite CLAUDE.md: header; Read order (SPEC; CLAUDE; `docs/modules/<id>.md` before touching a module;
   the source CLAUDE.md files read-only, D13; `docs/API.md`; `docs/migration.md`; `docs/deployment.md`;
   `docs/open-work.md`; `docs/adr/`; `docs/plans/`); Fixed decisions; Building it (the workflow); Status
   (one paragraph: M0-M7 done with plan files; the gate numbers T10 fills); Layout as built (repo-relative
   paths throughout, condensed from the current text, plus `docs/API.md`, `docs/modules/`,
   `docs/open-work.md`, the two new tests); Commands (as now, with the local stack, `caddy validate`,
   container scripts and `migrate:legacy`); Conventions (as now); Gotchas (Table G "CLAUDE.md" rows,
   titles verbatim; a "Module gotchas" index naming each moved title and its doc; "Retired gotchas" for
   G2 if T02 went GO); "Open work" = one paragraph pointing at `docs/open-work.md`. No "What M_x added", no
   "Not yet present", no per-milestone obligation lists. At most 600 lines.
3. Where T07's F2 row deferred to T09, settle it to T02's outcome.

**Acceptance.** All 69 Table G titles present across CLAUDE.md and the module docs; `docs-paths.test.ts`
and `api-doc.test.ts` green; CLAUDE.md <= 600 lines and mentions `docs/open-work.md`,
`docs/modules/recipe.md`, `docs/modules/finance.md`, `docs/API.md`.

**Verify.** `bun test apps/api/test/docs-paths.test.ts apps/api/test/api-doc.test.ts`,
`bun -e 'const fs=require("fs");const cp=require("child_process");const n=x=>x.replace(/\s+/g," ");const old=cp.execSync("git show 46e830b:CLAUDE.md").toString();const g=old.slice(old.indexOf("## Gotchas in use"),old.indexOf("## Obligations"));const t=[...g.matchAll(/^- \*\*([\s\S]+?)\*\*/gm)].map(m=>n(m[1]).slice(0,40));const docs=["CLAUDE.md","docs/modules/recipe.md","docs/modules/finance.md"].map(f=>n(fs.readFileSync(f,"utf8"))).join("\n");const miss=t.filter(x=>!docs.includes(x));console.log(t.length+" titles, "+miss.length+" missing");if(t.length!==69||miss.length){console.log(miss.join("\n"));process.exit(1)}'`,
`test $(wc -l < CLAUDE.md) -le 600`, `! grep -n "Not yet present" CLAUDE.md`,
`grep -q "docs/open-work.md" CLAUDE.md`, `bun run typecheck`, `bun test`.

### M7-T10 — Integration: gates, evidence, print-to-PDF, record (build)

**Goal.** O10: prove the final tree and write the record; close M7.

**Read.** SPEC §7; CLAUDE.md (as rewritten) "Headless runs", "Printing a recipe" (now in
docs/modules/recipe.md), "Long commands"; this plan's sections 1-8; `git log --oneline 46e830b..HEAD`.

**Do.** On merged `main`:
1. Gates: `bun install --frozen-lockfile`; `bun run typecheck`; `bun test` twice (counts, wall time; compare
   with T02's numbers); `PUBLIC_API_URL= bun run build` and `! grep -rl 'localhost:3001' apps/web/dist/assets`;
   `bun run i18n:check` (read it: parity OK, classify every leftover hit, compare with the 146 of 1.1);
   `bun run db:generate` reports no schema change; `bun apps/api/test/fixtures/legacy/build.ts --check`;
   the five greps (recipe LINKS, LINKS_FIN, NOROUTER, NOCORE, NOSHADOW) from the module docs.
2. Fresh DB walkthrough against the built app (`DATABASE_URL=file:./data/m7.db`, `bun run db:migrate`,
   `bun run seed`, `WEB_DIST_DIR=./apps/web/dist bun run start`): curl one documented row of every
   docs/API.md section (health; login as demo, robin, kim; me; households; members; modules; a recipe list;
   a shopping list; finance balance as demo and `403 finance_not_participant` as kim; a transaction with a
   `mutationId` and its replay 200; a settlement with a stale `expectedBalanceCents` → `409 balance_stale`;
   `404 module_disabled` after a disable and re-enable; a foreign `Origin` → 403; the CSP header present).
   Each response matches the doc's status code; a mismatch is a doc or code defect fixed in its own commit.
3. `migrate:legacy` on the fixtures: dry run, `--apply`, second `--apply` (`already migrated: nothing
   written.`), per CLAUDE.md's fixture command.
4. Headless (Playwright in a scratch directory outside the repo, log ending `exit=$?`): print-to-PDF of a
   seeded recipe detail at 390 (mobile context) and 1440 with `page.emulateMedia({media:"print"})` +
   `page.pdf()` + `pdftotext`: ingredients and every step present at both widths, and at 390 neither the
   scaler's servings label nor "Zur Einkaufsliste" (O1). A smoke pass at 390 and 1440 over `/`, `/recipe`,
   `/finance`, `/settings`: no console error, `scrollWidth <= clientWidth`.
5. Docker only if a Docker-relevant file changed: `git diff --quiet 46e830b HEAD -- Dockerfile .dockerignore
   docker package.json bun.lock apps/api/package.json apps/web/package.json packages/shared/package.json
   bunfig.toml` exits 1 → build the image to a log ending `exit=$?` and run it as a lone container to
   `/api/health` 200; else record "not needed".
6. Write this plan's section 9 (integration record: commands, counts, every check with its result, the
   i18n classification, defects found with their commits) and section 10 (what changed vs plan: T02 GO or
   NO-GO, the ADRs T08 wrote, deviations from SPEC §1 beyond them: expected none), set the status line to
   DONE, and update CLAUDE.md's Status paragraph (M7 done, test count and file count).

**Acceptance.** All gates green (i18n:check read and classified); every walkthrough row matches the doc;
the print check passes at both widths; the record is complete; `docs-paths.test.ts` still green after the
CLAUDE.md status edit.

**Verify.** `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, `bun run build`,
`bun apps/api/test/fixtures/legacy/build.ts --check`, `bun test apps/api/test/docs-paths.test.ts
apps/api/test/api-doc.test.ts`, `grep -q "Status: DONE" docs/plans/m7-harden.md`.

## 5. Risks

1. **T02 surfaces `SQLITE_BUSY` in the race tests** (placeholders' concurrent claims, idempotency replays):
   two real transactions on one file contend where the memory DB serialised them. `busy_timeout = 5000`
   should absorb it; if a pragma is not applied to the second connection libSQL opens for
   `client.transaction()`, that is a production defect too (concurrent requests), worth fixing in T02. The
   NO-GO path keeps M7 green either way.
2. **T02 slows CI.** `synchronous = FULL` fsyncs every commit; `/tmp` on the CI runner is disk. The 3x cap
   bounds it; the measured numbers go into ADR 0009 or ADR 0003.
3. **The API doc drifts from the code at write time.** The guard test catches missing and stale routes and
   codes, not wrong status lists; T10's curl walkthrough samples every section.
4. **T04 is a Haiku port of a long document.** Table P is complete for the paths (the planner diffed R's 94
   rows against the 61 served recipe routes: after the rewrite every route has a row); the test makes a
   missed rewrite fail loudly.
5. **The module-doc gotcha tables are long (83 + 74 rows).** The verify commands check presence by title or
   number; a wrong status is a review matter. T09 cross-checks the moved titles.
6. **CLAUDE.md loses knowledge in the rewrite.** Decision 2 and T09's 69-title check; the bodies of moved
   gotchas live on verbatim in the module docs.
7. **docs-paths false positives** (a span that is a path pattern, not a path). The test's skip rules and
   `ALLOW_MISSING` with reasons; never weaken it to pass.
8. **Headless login rate limit** (CLAUDE.md "Headless runs"): reuse `storageState`, restart the API between
   passes.

## 6. Deviations expected (to be confirmed in "what changed vs plan")

- ADR 0009 (if T02 GO): D13's ADR 0003 sentence replaced; toon-finance gotcha 2 restored.
- ADRs from T08: A1 (D1, D6: no global top bar) and A2 (D9: runtime caching wording) as the next free
  numbers; A3 decided by T08.
- No code deviation from SPEC §1 is expected; T01 is a print fix inside the recipe module.

## 7. Out of this milestone

- Everything in `docs/open-work.md` "Owner actions" and "Owner decisions" (the real cutover, pushes, the
  first workflow runs, DNS, the copy decisions, the pinned design exceptions, finance print styles).
- New features, new modules, the N-person ledger (D3).
- Translating toon-finance's German docs wholesale (D15: only what the module needs).
- Rewriting historical plans or ADRs (dated records; only the m3 status line gets its closure note).
- Changing the Dockerfile, compose file, Caddyfile or workflows (M6's; untouched unless T10 finds a defect).

## 8. Obligations

After M7 nothing is handed to a later milestone: what remains is the owner's and is listed in
`docs/open-work.md`.

## 9. Integration record

(M7-T10)

## 10. What changed vs plan

(M7-T10)
