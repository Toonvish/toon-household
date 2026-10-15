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
4. `docs/migration.md` — the operator's guide to `migrate:legacy` (inputs, rules, report, cutover order).
5. `docs/adr/` — one record per deviation from SPEC §1 (`NNNN-slug.md`: date, context, decision,
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
plan" in its section 6), **M1 core** (2026-10-14, plan `docs/plans/m1-core.md`, section 8),
**M2 recipe module** (2026-10-14, plan `docs/plans/m2-recipe-module.md`; section 9 is the
integration record, section 10 "what changed vs plan": no deviation from SPEC §1, no ADR),
**M3 finance module** (2026-10-14, plan `docs/plans/m3-finance-module.md`; section 9 is the
integration record with the gate logs, curl walkthrough, headless and offline results; section 10 is
"what changed vs plan"; three ADRs, below) and the **M4 design pass** (2026-10-14, plan
`docs/plans/m4-design-pass.md`; section 9 is the integration record with the gates, the curl and
headless numbers, the four-combination measurement, the print and offline runs and the screenshot
index; section 10 is "what changed vs plan"; no deviation from SPEC §1, no new ADR, ADR 0004 gained one
consequence bullet) and **M5 migration** (2026-10-15, plan `docs/plans/m5-migration.md`; section 9 is the
integration record with the gates, the fixture, seeded-target and dev-DB runs and the plain statement that no
owner copy was available; section 10 is "what changed vs plan"; one ADR, 0005, below). Next: **M6 deploy**,
then M7 harden.

What exists after M5: the three workspaces build, typecheck and test green (`bun test`: 2010 pass in 114 files).
Two modules are built: `API_MODULES` and `WEB_MODULES` are `[recipe, finance]` and `/api/health`
reports `modules: ["recipe","finance"]`. The recipe module is as after M2 (recipes with search and
filters, tags, collections, URL / photo / PDF import, meal plan with cook log, shopping lists with the
offline outbox, cards, uploads with thumbnails, the service-worker rules). The finance module is
toon-finance's ledger on `finance_` tables: transactions with the four viewer-projected kinds
(MINE_SPLIT, THEIRS_SPLIT, FOR_THEM, TRANSFER), categories (21 defaults), tags, the Fixkostenplan with
`plan:run` and the accrual scheduler, balance, settlements (`409 balance_stale`), the offline capture
outbox, `finance_participants` (exactly two slots by user id, D3), the participants settings section,
the enable dialog, the non-participant and module-disabled states, the demo ledger in `seed`, and the
one-off `finance:import-xlsx` importer. Web tabs inside `/finance`: Übersicht, Buchungen, Erfassen
(+ Profil); sidebar-only Fixkosten `/finance/plan` and Kategorien `/finance/categories` (+ the shell's
Gruppen). Every toon-finance test file has a counterpart (map in the m3 plan's section 8). Still no
Docker files (M6), no `docs/API.md` or `docs/modules/*.md` (M7).

What M5 added (migration, plan `m5-migration.md`): `bun run migrate:legacy`, the one-off, dry-run-by-default,
idempotent import of toon-recipe's and toon-finance's databases and the recipe uploads into the household
database (SPEC §6, D12). The CLI is `apps/api/scripts/migrate-legacy.ts`; its library is
`apps/api/scripts/legacy/{types,sources,ledger,copy,report,users,mapping,households,recipe,uploads,finance,
balance,run}.ts`; the operator's guide is `docs/migration.md`. It is not a module hook (`LegacyMigrator` and
`ApiModule.legacyMigration` were deleted from the contract). Users are united by e-mail, households come from
the recipe groups with each finance household merged, made new or skipped (the proposal is printed and
`--mapping` overrides it), every row is recorded in `legacy_ids` in the same batch, the report proves the
finance balance per household to the cent and the second `--apply` writes nothing. The fixtures are
`apps/api/test/fixtures/legacy/` (verbatim legacy migrations, the deterministic `build.ts`, the committed
`recipe.db` and `finance.db`, `uploads/`, `facts.ts`, a README); the tests are `apps/api/test/legacy-*.test.ts`
(174 tests in eight files) plus four `import-order.test.ts` entries. Verified in M5-T10 on the merged tree:
the fixture dry run, apply and second apply, a `--mapping` dry run, a run into a seeded target, `uploads:gc
--dry-run`, and a recipe-only run on a copy of toon-recipe's dev database with the API started on the result.
No owner copy of production data was available (`migration-in/` did not exist): the owner runs
`docs/migration.md` at cutover.

What M4 added (design pass, plan `m4-design-pass.md`): the Home cards as designed (recipe: a seven-day
week strip with the next planned titles and the active shopping list's open-item count; finance: the
balance sentence, this period's spend, a non-participant line); the phone module chip as a real
`ActionMenu` sheet (`renderTrigger` / `current`) and `NavItem.trailing` for the sidebar's recipe count,
the Plan "Neu" pill and the shopping count; a module-neutral `NotFoundPage`; the PWA manifest with the
three shortcuts (Rezept importieren, Neues Rezept, Buchung erfassen), a house icon set generated by
`scripts/icons.ts` and one theme-colour source (`lib/theme-colors.ts`); `PhoneHeaderRow` on every
shell screen (recipe, Settings, Gruppen, Gruppe detail; the recipe detail is exempt) with a guard test
per module and for the core; finance's token-by-token D5 audit plus the module-local
`PendingSyncNote` ("1 Änderung wartet auf Übertragung."); `styles/design-system.test.ts`, the Table D
gate (below); the two M3 findings fixed (A: the survivor of an empty-ledger slot-1 leave is re-seated in
slot 1; B: plan `payerId` and income `personId` must be participants, `422 validation_failed`,
`server.finance.personNotParticipant`). Verified on the final tree by a fresh-DB curl, a headless
Chromium run (424 checks over the 36 exit screenshots and 42 more: render, console, overflow, chrome,
bar bleed), the
four-combination token measurement (56 checks), print-to-PDF at 390 and 1440 (16 checks) and the
offline note on the built app (8 checks). 78 viewport PNGs are committed in
`docs/plans/screenshots/m4/` (index in the plan's section 9). The integration run found and fixed four
defects (each its own commit): the Buchen bar overlapped the tab bar's 1px border, Settings / Gruppen /
Gruppe detail had no phone header row, `print.css` could not reveal the hidden phone panels (an
unlayered `!important` loses to the `@layer base` reset), and `useMediaQuery` flipped the recipe
detail's markup mid-print. The M4 review added one more fix: `AmountInput` reserves `pr-12` and centres
the euro glyph with `flex items-center` (a height-less `absolute my-auto` span had overprinted the
right-aligned digits); `AmountInput.test.ts` guards it from the source and the six affected screenshots
were retaken.

`bun run i18n:check` exits 1 by design; its parity half is OK and its leftover-German half reports
138 hits: 128 German labels or umlaut examples quoted in doc comments (18 of them in finance code:
`AmountText`, `routes.tsx`, the transaction screens, `PendingSyncNote`, `kinds.ts`, `clock.ts`, shared `tags.ts`) and 10
lines of recipe content vocabulary (the ingredient-paste placeholder, `UNIT_SUGGESTIONS`,
`STEP_HEADING_RE`, the seven `html/entities.ts` umlaut entities). All are false positives; classify
each hit, never suppress the check. The files under `features/plan` and `features/cards` are scanned
here (toon-recipe never scanned them); their hits are comment quotes. `apps/api/scripts` is not
scanned, so the importer's German content parsers do not show up.

ADRs (`docs/adr/`, each edits the SPEC text in the same commit):
- `0001-household-copy-without-recipe-counts.md` (D10: `household.detail.meta` and
  `household.danger.warning` lose their recipe count, `household.count.recipes` is not ported, because
  the core cannot count a module's rows; the recipe module supplies its own count, see
  `useHouseholdRecipeCount`).
- `0002-finance-validation-wording-from-the-core.md` (D10: finance's generic Zod validation messages
  render the core's wording, e.g. "Darf höchstens 200 Zeichen lang sein" instead of F's "Höchstens 200
  Zeichen."; finance's field-specific messages keep their text under bound-suffixed keys).
- `0003-finance-tests-on-the-shared-memory-db.md` (D13: toon-finance's gotcha 2, ledger tests on a
  temp file DB, becomes: the shared `file::memory:` DB plus `finance-file-db.test.ts`, which runs the
  ledger's write paths on a temp `file:` database and proves rollback and claim-plus-row atomicity).
- `0004-finance-participant-churn-rules.md` (D3, D13: a participant replacement is refused while the
  household has ANY transaction row, not only rows naming the outgoing user, since every two-person
  row involves both slots; a seated participant leaving the household gets `409 member_has_ledger`
  while the ledger has rows, else the seat is deleted and a slot-2 survivor is re-seated in slot 1
  (M4-T01, finding A); the contract gained `onMemberRemoving`).
- `0005-legacy-migration-ledger-states.md` (D2, D3, SPEC §6 step 4: toon-finance produces ledger states the
  runtime refuses, so the legacy migration, and only it, writes the `finance` module row for a one-participant
  household, re-seats a lone slot-2 participant in slot 1 although the ledger has rows, re-points a plan payer
  who is not a participant to slot 1 and keeps an income naming a non-participant, each with a warning; the
  runtime rules are unchanged).

M3 and M4 deviated from nothing in SPEC §1 beyond ADRs 0001 to 0004 above, M5 beyond ADR 0005; their plan-level choices
(non-participants see nothing of the ledger, `start` and `enableDialog`, table identifiers, "Gruppe"
stays, the recipe exceptions are pinned not converted, the outbox note is module-local) are in the
plans' sections 6 and SPEC §2 / §3 / §5. The two M3 review findings (A, B) were fixed first in M4-T01;
the lows of that review stand corrected in the docs (`isPeriodBooked` has no direct test in either repo,
it is covered by the import/plan collision tests).

## Layout (as built)

Package names are `@toon/shared`, `@toon/api`, `@toon/web`; the root is `toon-household`. Paths per
SPEC §3 with what M0 to M5 actually created:

- `packages/shared/src/` — `index.ts` (the ONLY entry: the vite alias maps exactly `"@toon/shared"`,
  never import a subpath), `core/` (`i18n/` runtime + `catalogs/server.{de,en}.ts`, `schemas/`
  `common|household|user|auth`, `calendar.ts`, `text.ts`), `modules/registry.ts` (`MODULE_IDS`,
  `ModuleIdSchema`, `DEFAULT_ENABLED_MODULES = ["recipe"]`), `modules/recipe/` (`units`,
  `ingredients`, `numbers`, `duration`, `tags`, `shopping`, `barcode`, `qr`, `schemas/{recipe,plan,
  import,shopping,card}.ts`, `index.ts` barrel re-exported from the package entry), `modules/finance/`
  (`money`, `ledger`, `period`, `plan`, `categories`, `tags`, `schemas/{common,transactions,categories,
  tags,plan,balance,settlements,participants}.ts`, `index.ts` barrel; the tag schemas and the 50/200
  pagination are exported as `FinanceTag…` / `FinancePaginationQuery…` because the barrel is flat). Tests
  flat in `packages/shared/test/` under toon-recipe's file names (the recipe schema tests are
  `recipe-schemas.test.ts` plus `core.test.ts`) and `finance-<name>.test.ts` for toon-finance's.
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
  `apps/api/scripts/{migrate,seed,reset-password,uploads-gc,migrate-legacy}.ts` (`migrate-legacy.ts` is the
  CLI, `apps/api/scripts/legacy/` its library, see the gotchas; the fixtures are
  `apps/api/test/fixtures/legacy/`), `apps/api/drizzle/{0000_core,
  0001_recipe}.sql` (both generated by drizzle-kit). Tests in `apps/api/test/` (`core-walkthrough`,
  `modules`, `households`, `auth`, `middleware`, `import-order`, `recipe-module`,
  `recipe-cross-household`, `recipes*`, `tags-kind`, `plan`, `cards`, `shopping*`, `uploads`,
  `import/` with its fixtures in `test/fixtures/import/`, …).
  `modules/finance/` is `index.ts` (the `ApiModule`: `onHouseholdCreated`, `onEnable`, `onMemberRemoving`, `start`,
  `shutdown`, `seedDemo`), `schema.ts` (the 11 `finance_` tables), `middleware.ts`
  (`requireFinanceParticipant`), `setup.ts` (default categories, `ensureFinanceHousehold`), `seed.ts`,
  `lib/clock.ts` (`nowMs`, `setClockForTest`), `routes/{index,participants,transactions,categories,tags,
  plan,balance,settlements}.ts` and `services/{ledger,categories,tags,plan}/` mirroring toon-finance's
  `services/` one to one plus `participants/`, `settings/` and `support.ts`. Finance scripts:
  `apps/api/scripts/plan-run.ts`, `finance-import-xlsx.ts` and `finance-import/{amounts,categorize,dates,
  rent,xlsx-reader}.ts`; the migration is `0002_finance.sql`. Finance tests are
  `apps/api/test/finance-*.test.ts` (`module`, `participants`, `transactions`, `idempotency`, `balance`,
  `settlements`, `categories`, `tags`, `plan`, `import-xlsx`, `cross-household`, `file-db`, `seed`) with
  `test/support/{finance-harness,finance-synthetic-workbook}.ts`.
- `apps/web/src/` — `main.tsx`, `app.tsx`, `route-roots.tsx` (`rootRoute`, `appRoute` without a
  component, `householdScopedRoute`; imports no shell and no registry), `router.tsx` (attaches
  `AppLayout` = `RequireAuth` + `AppShell` with `appRoute.update`, builds the tree: public auth
  routes, `/households`, `/households/$householdId`, `/settings`, `/` Home, and
  `WEB_MODULES.map((m) => m.route)`), `lib/` (`api`, `queries`, `query-client`, `session.tsx`,
  `persist`, `storage`, `nav.tsx`, `permissions.ts`, `share.ts`, `i18n/`, small libs),
  `components/ui/` (toon-recipe's primitives plus barrel; the only primitives), `components/layout/`
  (AppShell, BottomTabBar, SideNav, ModuleSwitcher, PhoneHeaderRow, UnverifiedEmailBanner,
  `nav-items.ts`, `use-nav-items.ts`, `module-switcher-items.ts`), `core/features/{auth,home,
  households,settings}/` (plus `phone-header.test.ts`, the core's phone-header guard),
  `modules/{index,catalogs,persist,types,enabled,layout}.ts(x)`, `styles/` (`theme.css`, `index.css`,
  `fonts.css`, `design-system.test.ts`). `lib/theme-colors.ts` (`THEME_COLORS`) is the one source of the
  two theme colours (`lib/theme.ts`, `index.html`'s pre-paint script, the manifest and `theme.css` `--bg`
  must agree; `theme-colors.test.ts` enforces it). `apps/web/pwa-manifest.ts` (outside `src/`) holds the
  manifest object `vite.config.ts` imports; `public/icons/` and `public/favicon.svg` are the house icon
  set generated by `scripts/icons.ts` (`pwa-manifest.test.ts` reads the manifest).
  `modules/recipe/` is `index.ts` (the `WebModule`), `routes.tsx` (the module's own layout route and
  children, every screen a `lazyRouteComponent`), `HomeCard.tsx` (with `features/plan/components/
  HomeWeekStrip.tsx` and the pure `features/plan/lib/home-week.ts`), `nav-trailing.tsx` (the sidebar's
  recipe count, "Neu" pill and shopping count: `NavItem.trailing`), `phone-header.test.ts` (the guard), `catalogs/` (six namespace files
  `recipes|organise|plan|shopping|import|cards` plus `index.ts`), `lib/{api,queries,format}.ts` (shims:
  `export * from "@/lib/<x>"` plus the module's own fetchers, keys and formatters) and
  `features/{recipes,collections,tags,import,shopping,cards,plan}/` mirroring toon-recipe's
  `features/` (`recipes/print.css` included). Catalogs of the core live in
  `lib/i18n/catalogs/{common,home,auth,household}.{de,en}.ts`. Tests are co-located `*.test.ts(x)`
  under `tsconfig.test.json` (`modules/{recipe,finance}/{manifest,persist}.test.ts` among them). Nothing
  lives under `apps/web/src/features/` (SPEC §3).
  `modules/finance/` is `index.ts` (the `WebModule`, with `settingsSections` and `enableDialog`),
  `routes.tsx` (the module layout route `/finance`, the pathless `participant-gate` route, seven lazy
  screens; `TX_FILTER_PARAMS` and its `validateSearch` live here), `HomeCard.tsx`, `catalogs/` (namespace
  files `common|nav|transactions|categories|plan|balance|settings|participants` plus `index.ts`, every key
  prefixed `finance.`), `lib/{api,queries,format,participants}.ts` (shims over the core lib plus the
  ledger fetchers, keys, formatters and `useFinanceHousehold` / `useOtherParticipant`),
  `components/{AmountText,KindBadge,PeriodLabel,PageHeader,PendingSyncNote}.tsx`, `lib/pending-sync.ts` (which
  paused mutations the note counts) and `features/{transactions,overview,
  plan,categories,participants}/` mirroring toon-finance's `features/` (`participants` is new:
  `FinanceGate`, `NonParticipantState`, `ParticipantsSection`, `EnableFinanceDialog`).
- `scripts/` — `dev.ts`, `typecheck.ts`, `i18n-check.ts`, `icons.ts` (`bun run icons`). `.github/workflows/ci.yml` (verify job with
  a poppler step for `pdf-rasterize.test.ts`; no docker-build until M6; `i18n:check` is a local gate
  because it needs the sibling source repos). `docs/design/recipe-redesign/` is the copied design
  record (D5); `docs/plans/screenshots/m4/` holds the 78 headless viewport PNGs of the M4 close
  (`<screen>-<390|1440>-<light|dark>.png`; the plan's section 9 indexes them).
- Core DB tables (unprefixed): `users`, `oauth_accounts`, `sessions`, `password_reset_tokens`,
  `email_verification_tokens`, `households`, `household_members`, `household_invites`,
  `household_modules`, `legacy_ids` (its column is named `table` per D12; the TS property is
  `tableName`). Recipe tables are all `recipe_*` (`recipe_recipes`, `recipe_tags`,
  `recipe_recipe_tags`, `recipe_cards`, …), `group_id` is `household_id`. Finance tables are all
  `finance_*`: `finance_participants` (replaces toon-finance's `household_members`: PK `(household_id,
  user_id)`, `member_slot` 1 or 2 with a unique index and a CHECK, `display_name`, `joined_at`),
  `finance_settings` (`default_locale`), `finance_categories`, `finance_tags`, `finance_transactions`,
  `finance_transaction_tags`, `finance_fixed_cost_plans`, `finance_fixed_cost_items`,
  `finance_incomes`, `finance_accrual_runs`, `finance_mutation_claims`.

Not yet present (so do not look for them): Dockerfile and compose (M6), `docs/deployment.md` (M6),
`docs/API.md`, `docs/modules/*.md` (M7).

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
  "Rewe" with bought history; finance: two more users, `robin@toon.local` in slot 2 and
  `kim@toon.local` as a household member WITHOUT a slot, both with password `demo1234`, about eight
  transactions covering the four kinds, one settlement, the fixed-cost items and both incomes, the plan
  enabled from two periods ago and one catch-up run).
- `bun run icons`: regenerates the PWA icon PNGs in `apps/web/public/icons/` from `public/favicon.svg`
  with `sharp` (resolved from `@toon/api`'s dependencies; `rsvg-convert` is the fallback). The PNGs are
  committed and CI never runs it; run it only when the mark changes.
- `bun run plan:run [householdId]`: the fixed-cost catch-up by hand (the API already runs it at boot
  and every 6 hours); without an argument it runs every household with finance enabled; a disabled or
  incomplete plan is reported, never a crash.
- `bun run finance:import-xlsx -- <Haushalt.xlsx> [--household <id>] [--dry-run] [--excel-text-quirk]`:
  toon-finance's one-off workbook import. Without `--household` (or with `--dry-run`) it only reads the
  workbook and prints the reconciliation report and never opens the database; writing needs a
  household that already has its two participants. Console output is English; the German content
  parsers sit in `apps/api/scripts/finance-import/` (not scanned by `i18n:check`).
- `bun run uploads:gc [-- --dry-run] [-- --min-age-hours=N]`: deletes files in `UPLOAD_DIR` that no
  row references (the core's avatars and household images plus every module's `uploadReferences`;
  generated `*.thumb.webp` follow their original); files younger than 24 h are always kept.
- `bun run auth:reset-password <email> [--send]`: prints a password-reset link for a locked-out
  account (works without mail; `--send` also mails it when a transport is configured).

Environment switches of the recipe module (`env.ts`): `IMPORT_OCR_ENABLED` (photo import, needs the
`tesseract` binary), `IMPORT_PDF_ENABLED` (unset follows the OCR flag; needs `pdftoppm`),
`IMPORT_ALLOW_PRIVATE_HOSTS=1` (dev only, ignored in production: lets the URL importer fetch a
localhost fixture, otherwise the SSRF guard blocks it), `UPLOAD_DIR`. All default off.

- `bun run migrate:legacy -- [--recipe-db <file>] [--recipe-uploads <dir>] [--finance-db <file>] [--mapping
  <json>] [--apply] [--report <file>]`: the one-off legacy import (guide: `docs/migration.md`). The target is
  `DATABASE_URL` (a local `file:` URL, process environment or the root `.env`) and `UPLOAD_DIR`; relative
  paths resolve against the repo root. Without `--apply` nothing is written, not even the target file (the
  dry run runs against a scratch copy); `--apply` repeats the dry pass and writes only if it is clean; a
  second `--apply` ends with `[migrate:legacy] already migrated: nothing written.` Exit codes: 0 success, 1
  errors found, 2 usage or input error. The fixture run:
  `D=$(mktemp -d); NODE_ENV=development DATABASE_URL=file:$D/target.db UPLOAD_DIR=$D/uploads bun run
  migrate:legacy -- --recipe-db apps/api/test/fixtures/legacy/recipe.db --recipe-uploads
  apps/api/test/fixtures/legacy/uploads --finance-db apps/api/test/fixtures/legacy/finance.db` (add
  `--apply` twice). `bun run` prefixes each output line with `@toon/api migrate:legacy: ` (the `bun
  --filter` wrapper); the `--report` JSON has none.

## Conventions

The conventions are toon-recipe's `CLAUDE.md` "Conventions" plus toon-finance's "Konventionen"
(money is integer cents everywhere; no float touches a user amount), with these household-wide rules
from SPEC and M0 to M3:

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
- Renames from toon-finance (apply them to every later port): `household_members` →
  `finance_participants` (by user id; `HouseholdContext` is `FinanceParticipantContext`, imported as
  `requireFinanceParticipantContext as requireHouseholdContext` so route bodies stay F's),
  `members.service` → `participants.service`, `useHousehold` / `useOtherMember` → `useFinanceHousehold` /
  `useOtherParticipant`, F's unprefixed catalog keys (`transactions.list.title`) → `finance.…`, F's
  URLs `/transactions`, `/new`, `/plan`, `/categories` → `/finance/…` (F's `/` is `/finance`, F's
  `/household` is the core's Gruppen plus the participants section on `/settings`), typed router hooks
  (`Link`, `useNavigate`, `useParams`, `useBlocker`) → `@/lib/nav`. Finance's TS identifiers carry a
  `finance` prefix and ported files import them aliased (see the gotcha below).
- Core helpers a recipe port needs are core, not module code: `@/lib/nav` (`AppLink`,
  `useAppNavigate`, `useRouteParam(s)`, `useNavigationGuard`), `@/lib/permissions` (`hasAtLeast`),
  `@/lib/share` (`shareOrCopy`, `copyToClipboard`); `canModifyOwn` stays with the recipe module.
- Module boundary: the core imports a module only through `modules/index.ts` (and, on the web, its
  catalogs through `modules/catalogs.ts`); a module never imports another module's directory.
- Docs in English, commit messages ending with the harness's `Co-Authored-By` line, no pushes from
  agent sessions. Tests: `apps/api/test/` (never `tests/`), web co-located, `packages/shared/test/`.
- Ported tests that need unported code are removed with a placeholder comment naming the returning
  milestone, never skipped silently.

## Gotchas in use (M0 to M5)

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
- **A seated participant cannot leave while the ledger has rows.** `removeMember` (core) runs every
  build module's `onMemberRemoving(householdId, userId, tx)` before deleting the membership, whether
  or not the module is enabled for the household (rows outlive a disable). Finance's hook
  (`assertParticipantMayLeave`) answers `409 member_has_ledger` (`server.household.memberHasLedger`,
  toon-finance's text) when the leaver holds a slot and the household has ANY `finance_transactions`
  row or an income naming them (same predicate as the `finance_participant_in_use` replacement rule:
  every row involves both slots). Without a seat, leaving is allowed; a seated leaver with an empty ledger
  leaves too and the hook DELETES their seat (a remaining ex-member seat let the other participant
  book against a non-member, after which no admin could replace it), moving the plan payer to the
  remaining participant and, when the leaver held slot 1, RE-SEATING the survivor in slot 1 in the same
  transaction (M4-T01, finding A: `slot1UserId` anchors the balance and must always resolve); the
  household is then a one-seat (solo) ledger until `PUT …/participants`.
- **Plan payer and income person must be participants (M4-T01, finding B).** `PATCH …/finance/plan
  { payerId }` and the income create/update routes answer `422 validation_failed` with a field detail
  on `payerId` / `personId` and `server.finance.personNotParticipant` unless the id is one of the
  household's `finance_participants`; the check lives in the plan SERVICE (toon-finance gotcha 47),
  never in the route.
- **Enabling finance needs two participants (D3).** `onEnable` seats the two users from the enable
  POST's `settings` (`{ participants: [{ userId, memberSlot: 1 }, { userId, memberSlot: 2 }] }`) or, on a
  re-enable without a body, requires the two existing `finance_participants` rows, else `422
  finance_participants_required` and nothing is written (`finance-module.test.ts` pins the refusal). The
  core stores the settings JSON in `household_modules.settings` and finance never reads it back:
  `finance_participants` is the truth, so `DELETE …/modules/finance` then `POST` with no body brings the
  ledger back intact. The web side: a manifest with `enableDialog` makes Home's "Aktivieren" and the
  Manage-modules dialog open that component instead of one direct POST (`EnableFinanceDialog`: viewer
  preselected as Platz 1, Platz 2 chosen from the household's members, a one-member household gets the
  "Lade zuerst jemanden ein" text and no submit).
- **Uploads are signed, not cookie-checked.** `/uploads/:filename` answers 404 for an unsigned,
  forged or expired URL (`lib/uploadUrls.ts`); `<name>.thumb.webp` is built with `sharp` on first
  request and falls back to the original (short cache) when sharp cannot convert.
- **Cross-household guard (D8).** The household comes from `:householdId` only. Every by-id lookup in
  a module service filters by `membership.householdId` and answers `404 not_found` for another
  household's id; `test/recipe-cross-household.test.ts` addresses every recipe by-id route with
  another household's id (cards: another user's card), `test/finance-cross-household.test.ts` does the
  same for every finance by-id route (transaction, category, tag, fixed-cost item, income). A new
  by-id route gets its case in the same commit.
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
  Finance's one rule is `NetworkOnly` for `/api/households/<id>/finance/…` (toon-finance gotcha 11: the
  offline copy of the ledger IS the persisted TanStack cache, the store the paused mutations live in; a
  `NetworkFirst` hit would overwrite the optimistic row with a stale body), placed before the recipe
  `NetworkFirst` rule. `/api` and `/uploads` stay out of the navigation fallback; `skipWaiting` is off. The dev server has no service worker:
  check offline behaviour on the built app (`bun run build`, then `WEB_DIST_DIR=./apps/web/dist bun
  run start`).
- **The route tree is strict, with one hole.** `WEB_MODULES = [recipeModule, financeModule] as const
  satisfies readonly WebModule[]` and neither manifest carries a type annotation (`satisfies
  WebModule<"…">` only), so `router.tsx`'s `WEB_MODULES.map((m) => m.route)` keeps the concrete route
  types and a raw `<Link to="/recipe/nope">` fails `tsc`. The hole: recipe and finance screens navigate
  through `AppLink` /
  `useAppNavigate` (`@/lib/nav`, `to: string`) and `import/lib/navigation.ts`'s template-string
  `go(…)`, which `tsc` does NOT check (toon-recipe's own shape). An unprefixed target (`/plan`
  instead of `/recipe/plan`) compiles and lands on `NotFoundPage`. **The LINKS grep is the check,
  not `tsc`** (it also finds toon-recipe's 46 old targets in the source tree, and nothing in this
  one):
  `! grep -rnE "(\bto[=:] ?|\bgo\(|\bgoTo\()[\"'\`]/(recipes|plan|shopping|import|collections|tags|search|groups)\b|\bto[=:] ?[\"']/[\"']|useUrlRecipeFilters\([\"']/[\"']\)" apps/web/src/modules/recipe`.
  Finance has the same hole and its own grep (`LINKS_FIN`, with `NOROUTER`, `NOCORE` and `NOSHADOW` in
  the finance gotcha below). Run them after every web port; a headless pass that clicks the links is
  the second check.
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
  every module's schema FLAT, which is why finance's identifiers DO carry a `finance` prefix (next
  gotchas). Raw SQL strings and `explain` text follow the SQL names.
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
- **Finance TS identifiers carry a `finance` prefix; ported files import them aliased.** SQL names are
  `finance_*` (index and CHECK names too, e.g. `finance_transactions_household_external_key_uidx`,
  `finance_transactions_amount_not_zero`), the drizzle identifiers are `financeTransactions`,
  `financeCategories`, `financeTags`, `financeParticipants`, … because `db/schema.ts` re-exports flat and
  recipe owns `tags`. A ported service keeps toon-finance's body with `import { financeTransactions as
  transactions } from "../../schema.ts"`. The same trap on the shared side: finance's tag schemas and
  its 50/200 pagination are exported as `FinanceTag…` / `FinancePaginationQuery…`, and consumers alias
  them back (`FinanceTagResponse as TagResponse`); the bare names are recipe's and the core's types,
  `request<T>` compiles with the wrong shape, so a missed alias is silent. `origin` keeps no drizzle
  default (toon-finance gotcha 37). `isUniqueViolation` (core `auth/users.ts`) walks the error's cause
  chain, because drizzle wraps every query error (toon-finance gotcha 50).
- **Participants and the gate (D3, plan m3 decisions 3-5).** Exactly two `finance_participants` rows per
  household, by user id, slots 1 and 2 (unique index plus CHECK). A household member without a slot is a
  non-participant and sees nothing of the ledger: every ledger router (`transactions`, `categories`,
  `tags`, `plan`, `balance`, `settlements`) runs `requireVerifiedEmail()` then `requireFinanceParticipant()`
  for every method, so a non-participant gets `403 finance_not_participant` on reads too (the kinds and
  the balance sign are projections onto a viewer's slot and mean nothing for a third person). The only
  route they reach is `GET …/finance/participants` (`{ items, viewerSlot }`, `viewerSlot: null` for them).
  `PUT …/participants` (admin) replaces the two (validated in the SERVICE, toon-finance gotcha 47; `409
  finance_participant_in_use` when a user leaves the budget and the household has ANY transaction row or an
  income naming them, ADR 0004; the plan payer and income person are checked against the participants,
  see below), `PATCH …/participants/me`
  edits the own display name. `requireFinanceParticipant` is a hoisted function declaration (import
  cycle, see above) and its context lives in a module-local `ContextVariableMap` augmentation. The web
  gate is the pathless `participant-gate` route under `/finance` (`FinanceGate` renders
  `NonParticipantState` instead of the outlet); Home's finance card shows the one-line state and never
  fires the ledger queries for a non-participant (the headless run saw zero 4xx for kim).
  `participants` is in the persist allow-list: a cold offline start must know the viewer's slot.
- **The `start` hook and the clock.** `ApiModule.start` runs once in `index.ts` after `await dbReady`,
  never under `bun test`; finance awaits the boot catch-up of the fixed-cost plan and starts the 6-hour
  accrual tick, `shutdown` stops it. Every finance timestamp and the plan's `start_period` come from the
  module clock `modules/finance/lib/clock.ts` (`nowMs()`, `setClockForTest`), never `Date.now()` and
  never the core `support.ts` `nowMs`: toon-finance's plan tests pin the clock before creating the
  household and expect the plan to start in that period.
- **`settingsSections` are rendered.** `SettingsPage` renders each enabled module's `settingsSections`
  after the core sections (finance: `ParticipantsSection`, owners and admins change the two slots, a
  participant edits their own display name). `EnableFinanceDialog` and `ParticipantsSection` are static
  manifest imports, so they obey the shell-free graph rule above.
- **Finance server catalog (ADR 0002).** The core catalogs `server.{de,en}.ts` carry the finance keys in
  one marked section "finance module (M3)"; the core Zod resolver passes `{bound}`. F's description
  bounds live under `server.zod.field.description.too_small.1` / `…too_big.200`. A new finance
  server string goes to the core catalog; a new web string goes to
  `modules/finance/catalogs/participants.{de,en}.ts` AND `NEW_GERMAN` in `scripts/i18n-check.ts`
  (15 web and 4 server keys are new German). A key diff of every `"server.…"` literal in the ported
  files against the core catalog must stay empty. Content language (category names, plan and settlement
  descriptions written into rows) follows `finance_settings.default_locale`, never the viewer's
  interface language (toon-finance gotcha 41).
- **The finance test harness gives toon-finance's names H semantics (plan m3 decision 18).** In
  toon-finance a one-member household is a valid ledger; here finance needs two participants, so
  `apps/api/test/support/finance-harness.ts` `createHousehold(owner, name)` creates the household, joins
  a hidden partner and enables finance with both as participants, and `joinAsSecondMember` moves the
  partner out of slot 2 for the given member (call it before anything is booked). Ported test bodies
  stay toon-finance's. For H's own tests use `createPlainHousehold`, `addMember`, `enableFinance` (returns
  the `Response`, asserts nothing) and, only for one regression test, `createSoloFinanceHousehold`
  (one participant seeded through the db, unreachable through the API). Ledger HTTP tests run on the
  shared `file::memory:` DB where `withTransaction` degrades; the real-transaction proof is
  `finance-file-db.test.ts` (ADR 0003, deviation from toon-finance gotcha 2).
- **The finance greps** (run after every finance port; each finds toon-finance's own shapes in its tree
  and nothing in this one). `LINKS_FIN`: `! grep -rnE "(\bto[=:] ?|\bgo\(|\bgoTo\()[\"'\`]/(transactions|new|plan|categories|household)\b|\bto[=:] ?[\"']/[\"']" apps/web/src/modules/finance`.
  `NOROUTER` (typed router hooks do not survive in screens): `! grep -rnE "\b(Link|useNavigate|useParams|useBlocker)\b[^;]*from \"@tanstack/react-router\"" apps/web/src/modules/finance/features apps/web/src/modules/finance/components`.
  `NOCORE` (no unprefixed catalog keys): `! grep -rnE "[\"'\`](common|nav|transactions|categories|plan|balance|settings)\.[a-zA-Z]" apps/web/src/modules/finance --include='*.ts' --include='*.tsx' --exclude-dir=catalogs`.
  `NOSHADOW` (no bare `TagResponse`, `TagListResponse`, `UpdateTagRequest`, `PaginationQuery` imports from
  `@toon/shared` in `apps/web/src/modules/finance`, `apps/api/src/modules/finance`, `apps/api/scripts`)
  is the `grep -rnP` in plan m3 section 3. Run them under bash: in zsh quote the `--include` globs, and
  `ls` is an alias in the user's zsh, so `NOSHADOW`'s directory list needs `command ls`.
- **The design-system test is the Table D gate (M4-T08).** `apps/web/src/styles/design-system.test.ts`
  makes the M4 exit greps permanent: the four `theme.css` blocks define the same 39 tokens, no
  `fonts.googleapis`, arbitrary `text-[…]` sizes only where the pinned record says (the 34 inherited
  toon-recipe hits in 17 files; a later cleanup edits the record in the same commit, which is its
  documentation), `bottom-0` only on the tab bar and the recipe hero overlay, no `font-display` beside
  `font-semibold`, no bare `1fr` track in an arbitrary grid template, text arrows only on the four pinned
  catalog lines, `data-app-shell` only on header/nav/aside. A new violation fails `bun test` with file:line
  and the rule; never relax a rule to get green. Plan `m4-design-pass.md` §2 is Table D.
- **Hand-written utilities beat breakpoint variants.** `.px-gutter`, `.bleed-gutter`,
  `.bleed-gutter-inset`, `.pb-tabbar`, `.bottom-tabbar` in `styles/index.css` are emitted after everything
  Tailwind generates, so `lg:mx-0` / `lg:px-8` cannot override them (a media query adds no specificity);
  change the `--gutter` variable (`lg:[--gutter:2rem]` on `<main>`) instead. `-mx-gutter` does NOT exist
  (there is no `--spacing-gutter`; the bars used it for a while and never bled): use `bleed-gutter` or
  `bleed-gutter-inset`. `top-topbar` is dead (the TopBar is gone; a sticky header uses `top-0`, the status-bar
  inset is `<main>`'s). `.bottom-tabbar` adds 1px for the tab bar's own top border: a bar at exactly
  `--tabbar-h` sat under it.
- **`FinanceGate` renders `PendingSyncNote` as a Fragment sibling of the outlet, never inside a wrapper
  `div`.** `<main>` is a flex chain and the "Buchen" bar is `sticky bottom-tabbar`; a wrapper breaks the chain
  and the bar floats mid-screen (`modules/finance/phone-header.test.ts` pins the source shape).
- **`ActionMenu` has `renderTrigger` and `item.current`.** `renderTrigger(props)` replaces the icon button
  with the caller's element (spread `props`; the phone module chip is one); a `current` item is the
  brand-soft row with `aria-current="true"` and a check. Both are optional, so the 20-odd existing call
  sites are unchanged.
- **Every shell screen renders `PhoneHeaderRow` itself** (no global top bar): the recipe screens (guard
  `modules/recipe/phone-header.test.ts`, reading `routes.tsx` for the screen list; the detail is exempt:
  its hero owns the top edge), finance's (its own guard and `PageHeader`), and the core's Home, Settings,
  Gruppen and Gruppe detail (`core/features/phone-header.test.ts`). It is a `<header data-app-shell>`:
  `print.css` hides that tag.
- **Printing a recipe (verified by printing to PDF, M4-T09).** `print.css`'s `[hidden]` override must sit in
  `@layer base`: the shell's `[hidden]{display:none!important}` is layered, and an UNLAYERED `!important`
  rule loses to a layered one regardless of specificity (the old override measured `display: none`).
  `useMediaQuery` holds the last on-screen value while `matchMedia("print")` matches, because the browser
  evaluates media queries against the paper width during a print and a 390px window flipped the detail to
  the desktop markup mid-snapshot (a truncated two-column hybrid, steps 3 to 7 missing). Re-verify with
  `page.emulateMedia({media:"print"})` + `page.pdf()` + `pdftotext` at 390 and 1440 whenever the detail
  screen's markup changes; none of the five gates sees a broken print stylesheet. Observation, not fixed:
  the printed phone detail still carries the servings scaler and "Zur Einkaufsliste" (no
  `data-print="hide"`).
- **Theme colour has one source.** `lib/theme-colors.ts` `THEME_COLORS = { light: "#faf5ee", dark:
  "#17120f" }` (the light and dark `--bg`); `index.html`'s inline pre-paint script keeps the literals (it
  cannot import), `lib/theme.ts` and the manifest import the module. The four colour combinations (OS
  light/dark x no preference/the opposite explicit `toon.theme`) were measured on `/` and `/finance`:
  tokens, `body` background and `<meta name="theme-color">` all follow the resolved scheme (plan §9). The
  built CSS is minified (`#fff`, `#291f180d` for `rgb(41 31 24 / 5%)`), so compare colours as RGBA, not as
  text.
- **The manifest.** `apps/web/pwa-manifest.ts` (a plain `as const` object plus a mutable-typed copy for the
  plugin) holds name/short_name "Haushalt", the German `description`, the four icons and the three
  shortcuts (`/recipe/import`, `/recipe/recipes/new`, `/finance/new`); a shortcut into a module the
  household has not enabled lands on Home with the module-disabled toast. `.webmanifest` is served as
  `application/manifest+json` (toon-recipe's gotcha, checked by curl in M4).
- **Inherited finance gotchas stay binding inside `modules/finance`** (SPEC D13): read toon-finance's
  `CLAUDE.md` before touching the ledger arithmetic (31 `halfForOther(-101)` is `-50`; 32 halve per
  transaction; 33 the plan share is rounded once; 35 booked periods are immutable; 44 and 53
  `lastBookedPeriod`), settlements (36 `expectedBalanceCents` is required, `409 balance_stale` carries the
  current balance), the balance sign (38: the UI never shows a raw sign, `viewerBalanceCents` is the
  viewer's projection), idempotency (9, 10, 46: `mutationId` is minted at the call site and claimed by an
  INSERT on the primary key; a replay answers 200 with the current state), the offline outbox (7-9,
  11), the sticky "Buchen" bar (15: `.bottom-tabbar`, never `bottom-0`) and the import/plan collision
  rule (45, `isPeriodBooked`). Money is integer cents; the ledger-spec numbers are the spec.
- **The offline queue survives a second reload (M3-T12 fix).** TanStack's `onlineManager` starts
  "online" and only changes on a browser event, so an app reloaded while offline believed it was online:
  the restored paused write re-ran, failed and waited in an unpaused retry, which the persist policy
  (paused mutations only) dropped from IndexedDB, and a second reload lost the booking.
  `lib/query-client.ts` `seedOnlineManager()` seeds the manager from `navigator.onLine` once at boot; the
  headless run reloads twice offline and replays exactly once. Since M4 the finance gate shows the
  module-local `PendingSyncNote` (`finance.common.syncPending`, "1 Änderung wartet auf Übertragung.") above
  the outlet while paused `["toon","finance","tx",…]` mutations exist; the shell has no sync badge.
- **Headless runs.** Install Playwright in a scratch directory outside the repo (a `bun add` log ending
  in `exit=$?`), log in with `fetch("/api/auth/login")` from the page, assert `scrollWidth <=
  clientWidth`, and never match the tab bar by its `aria-label` (`SideNav` carries the same one and
  reports a zero rect on a phone): the tab bar is `nav.fixed`, the sidebar `aside[data-app-shell]`.
  Login is rate limited per address in memory, so a script that logs in five times per run gets `429`
  after a few runs: restart the API. `position: fixed` elements have `offsetParent === null`; test
  visibility with `getBoundingClientRect` and computed `display`. A module disabled through the API
  behind the SPA's back is noticed on the first `404 module_disabled` (the query client invalidates
  `["toon","me"]`), not before: re-enable through the Home "Aktivieren" button in a test. The same
  staleness bites test setup: `["toon","me"]` is persisted, so a household created through the API
  AFTER the SPA already visited `/` in that browser context is unknown to the SPA; create it from a
  non-SPA page (`goto("/api/health")`, then `fetch`). The active household is `localStorage`
  `toon.activeHouseholdId` first, then the profile's `activeHouseholdId`: to switch in a test, PATCH
  `/api/auth/me` and set the localStorage key on a non-SPA page before loading `/`; accepting an invite
  also moves the invitee's active household. Reuse a saved `storageState` per user instead of logging in
  per context (and across script runs: a second run that logs in again earns the `429`). For a PHONE
  screenshot use `isMobile: true, hasTouch: true` at 390x844: desktop Chromium reserves the stable
  gutter and draws a 15px strip at the right edge (M4 screenshots use the mobile context). Never
  `pkill -f` a pattern that also matches the shell running it (it killed the session's shell once);
  find the server's pid and kill that.
- **`scrollbar-gutter: stable`** on `<html>` (toon-recipe's) makes `scrollWidth` 375/1425 against
  `clientWidth` 390/1440 under classic scrollbars (a desktop-Chromium context; a mobile context with overlay
  scrollbars measures 390/390); check no-overflow as `scrollWidth <= clientWidth` plus no element's right
  edge beyond `innerWidth` + 0.5, and when the two numbers differ show once, from the script, that
  `documentElement.style.scrollbarGutter = "auto"` makes them equal (M4 plan decision 12). A bar that
  bleeds to the viewport edge ends at 375 beside the gutter and at 390 without it.
- **i18n-check from worktrees** resolves the source repos via the git common dir; it needs
  `toon-recipe` and `toon-finance` next to the main checkout (or `I18N_CHECK_SOURCES`).
- **Long commands** (cold `bun install`, docker build, headless browser) go to the background with one
  log ending in `exit=$?`.
- **`migrate:legacy` reads snapshots and writes only through a redirected, validated path (plan m5
  decisions 3, 5, 6, 16).** `sources.ts` copies each legacy file and its `-wal` (never `-shm`) into a scratch
  directory and opens the copy with a plain `createClient` (not `createDatabase`: its WAL pragma rewrites a
  header) plus `PRAGMA query_only = 1`; a copy of the main file alone loses every page still in the WAL, so
  the operator copies the whole volume (`docs/migration.md`). A schema gate (exit 2) wants recipe at 9
  migrations / `0008_shopping_bought` and finance at 2 / `0001_material_nebula`. Dry run = the full
  pipeline against a scratch copy of the target; `--apply` = that pass, then the real write only if it is
  clean, then a balance re-check. Every row and its `legacy_ids` entry go in the same
  `client.batch(…, "write")` (chunks of 500); a mapped row is never updated again (a one-shot cutover that
  resumes, not a sync).
- **The CLI never imports `src/env.ts`, and its import order is load-bearing.** `env.ts` freezes
  `env.databaseUrl` on first load and `src/db/client.ts` opens that database on import, so importing either
  before the redirect would create and switch to WAL the REAL target during a dry run. `migrate-legacy.ts`
  therefore imports only `node:` builtins and types statically, resolves `DATABASE_URL` and `UPLOAD_DIR`
  itself (`resolveCliEnv`: process environment, then the root `.env` and `.env.local` with env.ts's
  rules, kept in step by hand), points `process.env.DATABASE_URL` at the scratch copy BEFORE its first
  dynamic import, then imports `src/db/client.ts`, then `src/db/migrate.ts` (the order `scripts/migrate.ts`
  and `import-order.test.ts` prove: the finance balance service reaches `modules/index.ts` and the recipe
  routes call `requireSession()` at module scope), and only then `./legacy/*`. A relative `file:` target
  resolves against the repo root computed in the CLI file. The library takes the target `db` and `client` as
  parameters and never uses the shared `db`. `legacy-cli.test.ts` guards the order textually and by
  subprocess (no target file and no `-wal` after a dry run).
- **Subprocess tests of the CLI set `NODE_ENV=development`.** The child inherits `NODE_ENV=test` and
  `env.ts` (and `resolveCliEnv`, which reads no `.env` under test) would then force `file::memory:`; they
  also pass an absolute `DATABASE_URL`, an explicit `UPLOAD_DIR` and a placeholder `SESSION_SECRET`.
  Migration tests use their own temp-file targets and temp upload directories, never the shared
  `file::memory:` db and never `env.uploadDir`.
- **Claimed ids and the verified-only e-mail match (users, households).** `migrateUsers` decides every
  recipe user first, then the finance-only ones, with an in-run `Set` of claimed target ids next to the DB
  lookup: the fixture's gina has toon-finance's id equal to cleo's toon-recipe id and both rows land in one
  batch, so a DB lookup alone would fail the primary key and "fix" the wrong row. A claimed id gets
  `crypto.randomUUID()` and a warning; the same pattern covers household ids (FH3's id equals G2's). Those
  fresh ids are random per pass, so a dry run and the `--apply` after it print different ones. A legacy
  user whose e-mail matches an existing target account is mapped onto it ONLY when that account has
  `email_verified_at` (the boolean alone is not evidence); an unconfirmed one is an error ("unverified
  target account <email> blocks the merge", exit 1). A recipe account without a password (OAuth-only) keeps
  none when a finance row with the same e-mail exists (finance never verified addresses, so its hash would
  be an account takeover); the report notes "finance password not carried". Finance-only users start
  unconfirmed.
- **Ledger states the runtime refuses are written by the migration alone (ADR 0005).** A one-participant
  finance household gets its `finance` module row, a lone slot-2 participant is re-seated in slot 1, a plan
  payer who is not a participant is re-pointed to slot 1 and an income naming a non-participant is kept,
  each a warning, never an error; the migration writes `household_modules` and `finance_participants`
  directly and never calls `initializeHousehold`, `onHouseholdCreated` or `onEnable` (they would seed
  default categories next to the copied ones). The balance invariant is identity-based: the legacy breakdown
  is computed from the perspective of the legacy user who holds slot 1 in the TARGET and compared with
  `getBalance` on the migrated rows (balance, transaction count, amount sum).
- **The legacy fixtures are built, checked and tracked on purpose.** `apps/api/test/fixtures/legacy/
  build.ts` rebuilds `recipe.db`, `finance.db` and `uploads/` deterministically from verbatim copies of the
  two sources' migration SQL and `facts.ts` (argon2id hashes precomputed; Bun's hash is salted);
  `build.ts --check` and `legacy-fixtures.test.ts` compare a logical dump with the committed files. The
  rest of the repo ignores `*.db`; `.gitignore` un-ignores exactly `apps/api/test/fixtures/legacy/*.db`
  (rollback journal, so no `-wal` is ever produced). Never edit the files under `migrations/` or the
  databases by hand; change `facts.ts` or `build.ts` and rebuild.
- **Migration evidence stays out of the tree.** `migration-in/` and `migration-out/` are in `.gitignore`;
  real copies of the owner's data never get committed, and a record of a real run names counts and OK/FAIL
  only, never people or amounts.

## Obligations handed to later milestones

Each later plan lists and closes them (full text: `docs/plans/m4-design-pass.md` §8 and its §9; earlier ones
in `docs/plans/m0-scaffold.md` §4, `docs/plans/m1-core.md` §6 and §8, `docs/plans/m2-recipe-module.md` §8 and
§9, `docs/plans/m3-finance-module.md` §7 to §9, `docs/plans/m5-migration.md` §8). M0, M1, M2, M3, M4 and M5 closed theirs; M4 closed findings A and
B, the recipe phone header and its guard, the ActionMenu chip, the NotFound icon, the sidebar counts and
the Plan "Neu" pill, the Home cards, the manifest shortcuts and icons, theme-colour sync, the finance D5 audit,
the outbox indicator, print-to-PDF, the `scrollWidth` measurement, and the dark/light screenshots with the
four-combination measurement.

- Owner decisions still open, not M4's (plan §7): "Gruppe" vs "Haushalt" in the German copy and
  `DEFAULT_HOUSEHOLD_NAME` (needs an ADR; M4 kept "Gruppe"); converting toon-recipe's pinned exceptions
  (the 34 arbitrary text sizes, the four uppercase labels, the two `←` back links, the `-mx-4` bars in
  `RecipeForm` and `ImportReviewPage`; toon-recipe's `docs/redesign/PR.md` keeps them open); finance print
  styles; a per-household PWA name or icon; a real iOS home-screen install check (needs a device).
- M5 (closed): `migrate:legacy` shipped with its fixtures, the report and the balance invariant, and
  ADR 0005; plan `docs/plans/m5-migration.md` sections 8 to 10. Left for later: the owner's own cutover run
  against copies of the production volumes (`docs/migration.md`; no owner copy existed in M5).
- M6: `docs/deployment.md` "Cutover from toon-edge" links `docs/migration.md` and names the new stack's
  volume and image for the copy-in step (migration.md's step 6 uses `<new-volume>` and `/app/data/local.db`
  as placeholders to check against it); redirects from toon-recipe's old paths (`/recipes/…`, `/plan`, `/shopping`, `/import`) and from
  toon-finance's (`/transactions`, `/new`, `/plan`, `/categories`, `/household`) for bookmarks arriving
  through the old-hostname redirect (with the Caddyfile; note `/plan` exists in both sources); image
  build with `WITH_OCR=1 WITH_PDF=0`.
- M7: `docs/API.md` (recipe and finance sections; note that migrated finance-only accounts start
  unconfirmed), `docs/modules/recipe.md`, `docs/modules/finance.md`;
  the member-leaves veto exists (`ApiModule.onMemberRemoving`; finance refuses a seated participant's
  leaving with `409 member_has_ledger` while the ledger has rows, so no ghost participant can appear;
  an empty-ledger leaver's seat is deleted, a slot-2 survivor is re-seated in slot 1, and an admin seats a
  replacement through `PUT …/participants`); M7 documents it in `docs/API.md` together with
  `member_has_ledger`, `finance_participant_in_use` and `422 server.finance.personNotParticipant`, and may
  extend the veto to other modules; the N-person ledger stays out (D3); switching the whole test
  suite to a temp-file DB (ADR 0003's consequence).
