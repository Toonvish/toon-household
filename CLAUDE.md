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
   `docs/deployment.md` — the operator's guide to the stack (fresh install, operations, the cutover from
   toon-edge, variants, the local stack test).
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
owner copy was available; section 10 is "what changed vs plan" and lists the two review fixes; one ADR, 0005, below) and
**M3b finance-sync** (2026-10-15, plan `docs/plans/m3b-finance-sync.md`, the follow-up port of toon-finance
`cbdec67..1715207` plus the placeholder migration; section 9 is the integration record with the gates, the
fresh-DB curl walkthrough, the owner-data counts, the headless run and the 92 screenshots in
`docs/plans/screenshots/m3b/`; section 10 is "what changed vs plan" with the F gotcha map; ADR 0006, and ADR 0007 added by the post-review sync,
below) and **M6 deploy** (2026-10-15, plan `docs/plans/m6-deploy.md`; section 9 is the integration record with the
gates, the image builds with their exit codes, the four `caddy validate` combinations, the local stack, the 54 Table R
curls, the headless run, the cutover rehearsal from the image and the one defect it found; section 10 is "what changed vs
plan"; one ADR, 0008, below). Next: **M7 harden**.

What exists after M6: the three workspaces build, typecheck and test green (`bun test`: 2418 pass in 136 files).
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
Gruppen). Every toon-finance test file has a counterpart (map in the m3 plan's section 8, the M3b addendum in its
section 9.3 for the four files that changed up to `1715207`). Still no `docs/API.md` or `docs/modules/*.md` (M7).

What M6 added (deploy, plan `m6-deploy.md`): the app ships as ONE image and ONE compose stack with its own Caddy
(SPEC D11), in toon-recipe's pre-toon-edge shape. `Dockerfile` (toon-recipe's, with a build-time guard that fails
when the web bundle contains `localhost:3001`; `WITH_OCR` / `WITH_PDF` build args, the published image is
`WITH_OCR=1 WITH_PDF=0`), `.dockerignore`, `docker/entrypoint.sh`, `docker-compose.yml` (project `name:
toon-household`; services `app` with `cap_drop: [ALL]` and `no-new-privileges`, and `caddy` pinned to
`2.11.4-alpine`; volumes `toon-data`, `caddy-data`, `caddy-config`; network `toon`), `docker/Caddyfile` (toon-edge's
`(hardening)` and `(fwd)` snippets verbatim, the app site with the recipe import timeouts, the two optional
old-hostname sites with Table R, the plain-http block with the local CA download), `docker/env.example` (English),
`docker/toon-deploy.sh` (forced command `toon-household-deploy`: `deploy [latest|sha256:…]`, `sync-config`,
`status`), `.github/workflows/{release,deploy}.yml` and the `docker-build` job in `ci.yml`, `.env.local-stack`,
`docs/deployment.md` (fresh install, operations, "Cutover from toon-edge" steps 0 to 12, variants, the local stack
test) and ADR 0008. Every artefact has a test that pins its load-bearing lines and runs in CI without Docker
(`apps/api/test/deploy-{dockerfile,compose,caddyfile,script,workflows}.test.ts`, `deployment-doc.test.ts`,
`apps/web/src/legacy-redirects.test.ts`, which resolves every Table R target against the real route tree). Verified
on the merged tree (plan section 9): both image builds `exit=0`, uid 1000, no `localhost:3001` in the bundle; the
local stack healthy in 7 s under the project `toon-household-local`; `caddy validate` through compose in four
combinations (old hostnames set, unset, set-but-empty, `acme`); all 54 Table R requests `301` to the expected target
and `/sw.js` 200 on both old hosts; a headless Chromium run on the stack (no console error, the retiring worker
registered, activated, unregistered itself and reloaded the window onto the new app); the cutover from the image
(dry run, apply, second apply, the doc's copy-in into `toon-household_toon-data`, the stack started as the production
project, login and balances) on the legacy fixtures. The one defect it found: the first boot's fixed-cost plan catch-up
adds `Fixkostenanteil` rows, so a migrated household's balance is the report's plus those rows (the two docs now say so).
Not run (the owner's): the real cutover, the first `release.yml` / `deploy.yml` run, arm64.

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
(180 tests in nine files, the ninth being `legacy-migration-doc.test.ts`, which guards the cutover guide's step 6) plus four `import-order.test.ts` entries. Verified in M5-T10 on the merged tree:
the fixture dry run, apply and second apply, a `--mapping` dry run, a run into a seeded target, `uploads:gc
--dry-run`, and a recipe-only run on a copy of toon-recipe's dev database with the API started on the result.
No owner copy of production data was available (`migration-in/` did not exist): the owner runs
`docs/migration.md` at cutover.

What M3b added (finance-sync, plan `m3b-finance-sync.md`): toon-finance's seven commits after the M3 port
(`cbdec67..1715207`, what production runs) and the owner's decision that the placeholder user is migrated as a
placeholder with a NULL e-mail plus a claim invite (ADR 0006, the one change to SPEC §1; ADR 0007 records the D13 adaptations of F's leave rule, CSP and origin guard). Core: a placeholder is a
`users` row with `email IS NULL AND password_hash IS NULL` (`0003_placeholder_members`, `isPlaceholderUser`),
added by an admin (`POST …/members`), renamed (`PATCH …/members/:userId/placeholder`), removed through the
normal `removeMember` plus the module veto, and turned into an account by a claim invite
(`household_invites.claims_user_id`, `CreateInviteRequest.claimsUserId`) that only `POST /api/auth/register`
redeems, in place, same user id; the web has the "ohne Konto" member row, `PlaceholderRenameDialog`,
`ClaimInviteDialog` and the claim variants of `InvitePage` and `RegisterPage`. Finance: a placeholder may hold
slot 2 (`server.finance.placeholderSlotOne` for slot 1), `PATCH …/finance/participants/:userId`, the placeholder
form in `EnableFinanceDialog` and `ParticipantsSection`, `ClaimLinkDialog`, `InviteSecondPerson`; the Erfassen
sheet (`lib/quick-add.tsx`, `QuickAddDialog`, the `n` key; no FAB, D6 stands), the transaction list grouped by
day (`lib/group-by-day.ts`) and F's row fixes; F's API fixes (the plan names only participants, period bounds,
LIKE escaping and tag bounds, household-scoped idempotency reads, the accrual audit row stores the error name
only). Security from `1715207`: `middleware/originGuard.ts`, `middleware/securityHeaders.ts` (CSP), a JSON
content-type check in `readJson`, the LAST `X-Forwarded-For` hop, per-user rate limits on e-mail invites (10/h)
and household creation (5/h), a production refusal of the `change-me…` `SESSION_SECRET`, `foreign_keys = ON`,
bounds on password length and control characters, a 401 in the web app purging the persisted cache, `bun run
seed` refusing production without `ALLOW_SEED=1` and its own `SEED_PASSWORD`, SHA-pinned CI actions. Migration:
`migrate:legacy` gates the finance input at F's three migrations, migrates a placeholder as its own placeholder
user and gives it exactly one pending claim invite (`scripts/legacy/claims.ts`), reports it in a new section
`== Placeholders and claim invites ==` and proves it claimable by register on the fixtures
(`legacy-placeholders.test.ts`). Verified on the merged tree: the gates, a fresh-DB curl walkthrough, the dry
run, `--apply` and the second `--apply` on copies of the owner's backups (counts only, nothing from them in the
tree), a headless Chromium run (354 checks at `localhost` and `127.0.0.1`, no console error, no CSP violation)
and 92 PNGs. The integration run found one defect (`af71df1`: a production build baked the dev fallback
`http://localhost:3001`, which the CSP's `connect-src 'self'` would block on any other origin; the fallback is
now `import.meta.env.PROD ? "" : "http://localhost:3001"`).

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
146 hits: 136 German labels or umlaut examples quoted in doc comments (26 of them in finance code, the eight
added by M3b being comment quotes in the placeholder, sheet and list code:
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
- `0006-placeholder-members-and-claim-invites.md` (D1, D4, D12, SPEC §4, §6 items 1/2/5/6, §9: a placeholder
  member has no e-mail and no password and cannot sign in; a claim invite, without an e-mail and redeemed only
  by registration, turns it into an account in place; the legacy migration moves toon-finance's placeholder as
  a placeholder user plus one pending claim invite, gates the finance input at three migrations, matches
  households on account members only and answers an all-placeholder finance household with
  `no-account-members`; the apply report holds live claim links and is a credential).
- `0007-finance-sync-security-and-leave-adaptations.md` (D13: three adaptations of toon-finance `1715207` that
  survived the M3b review: F's leave rule, gotcha 69 `anchorCannotLeave`, is replaced by ADR 0004's rule; the CSP
  adds the recipe module's needs (`'wasm-unsafe-eval'`, `img-src 'self' data: blob: https:`, `media-src` and
  `object-src` with `blob:`, CORP `same-site`) and still presumes a build with `PUBLIC_API_URL=""`; the origin
  guard trusts the `WEB_ORIGIN` entries before F's `Sec-Fetch-Site` rule).
- `0008-old-hostnames-map-paths-and-retire-workers.md` (D11: the optional old-hostname Caddy sites do not redirect
  everything to `{uri}`; each maps its source's own paths to the new ones, Table R of the m6 plan, so `/plan` is the
  meal plan on the recipe host and the Fixkostenplan on the finance host, and answers `/sw.js` with a 200
  self-retiring worker, because a redirect there is a failed update that would keep an installed old PWA alive
  forever; everything else keeps D11's `{uri}` rule).

M3 and M4 deviated from nothing in SPEC §1 beyond ADRs 0001 to 0004 above, M5 beyond ADR 0005, M3b beyond ADRs 0006 and 0007, M6 beyond ADR 0008
(plus SPEC §2's `seedDemo` context gaining `demoPassword`, no ADR: §2 is the contract); their plan-level choices
(non-participants see nothing of the ledger, `start` and `enableDialog`, table identifiers, "Gruppe"
stays, the recipe exceptions are pinned not converted, the outbox note is module-local) are in the
plans' sections 6 and SPEC §2 / §3 / §5. The two M3 review findings (A, B) were fixed first in M4-T01;
the lows of that review stand corrected in the docs (`isPeriodBooked` has no direct test in either repo,
it is covered by the import/plan collision tests).

## Layout (as built)

Package names are `@toon/shared`, `@toon/api`, `@toon/web`; the root is `toon-household`. Paths per
SPEC §3 with what M0 to M6 and M3b actually created:

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
  `middleware/{session,household,module,verifiedEmail,staticWeb,originGuard,securityHeaders}.ts`, `modules/{index,types,mount}.ts`,
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
  `apps/api/test/fixtures/legacy/`; `legacy/claims.ts` is the placeholders' claim-invite step),
  `apps/api/drizzle/{0000_core,0001_recipe,0003_placeholder_members}.sql` (generated by drizzle-kit; `0003` has
  three generator defects corrected by hand, ADR 0006). Tests in `apps/api/test/` (`core-walkthrough`,
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
  `settlements`, `categories`, `tags`, `plan`, `import-xlsx`, `cross-household`, `file-db`, `seed`, `security`) with
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
  paused mutations the note counts), `lib/quick-add.tsx` (the Erfassen sheet's provider, `useQuickAdd`,
  `useQuickAddHostedHere`, the `n` shortcut) and `features/{transactions,overview,
  plan,categories,participants}/` mirroring toon-finance's `features/` (`participants` is new:
  `FinanceGate`, `NonParticipantState`, `ParticipantsSection`, `EnableFinanceDialog`, `PlaceholderForm`,
  `ClaimLinkDialog`; `transactions` gained `QuickAddDialog.tsx`, `lib/useCreateForm.ts` (the one form hook
  both frames share), `lib/group-by-day.ts` and `components/InviteSecondPerson.tsx`).
  The core web gained `core/features/households/components/{PlaceholderRenameDialog,ClaimInviteDialog}.tsx`,
  `core/features/auth/lib/invite-mode.ts` (which variant `InvitePage` renders) and `lib/session-purge.test.ts`.
- `scripts/` — `dev.ts`, `typecheck.ts`, `i18n-check.ts`, `icons.ts` (`bun run icons`). `.github/workflows/ci.yml` (verify job with
  a poppler step for `pdf-rasterize.test.ts`, SHA-pinned actions, and the `docker-build` job on pull requests
  that builds the image `release.yml` would publish, `WITH_OCR=1 WITH_PDF=0`, without pushing; `i18n:check` is a
  local gate because it needs the sibling source repos), `.github/workflows/release.yml` (push to `main` and `v*`
  tags: typecheck and test, then the multi-arch image to `ghcr.io/toonvish/toon-household`) and `deploy.yml`
  (gated by the repository variable `DEPLOY_ENABLED`, one SSH forced command).
- Deployment files at the repo root: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.local-stack` (the
  committed local-test values) and `docker/{Caddyfile,entrypoint.sh,env.example,toon-deploy.sh}`;
  `docs/deployment.md` (the operator's guide) and the ADR 0008 text. Nothing of it is built by `bun run build`. `docs/design/recipe-redesign/` is the copied design
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

Not yet present (so do not look for them): `docs/API.md`, `docs/modules/*.md` (M7).

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
- `bun run seed`: idempotent demo data on `DATABASE_URL` (migrates first; needs `SESSION_SECRET`). One password
  for every login of every module: `SEED_PASSWORD` when set, else `demo1234`; with `NODE_ENV=production` it
  refuses (exit 1, before the database is opened) unless `ALLOW_SEED=1` and a `SEED_PASSWORD` of 10+ characters
  are set. The script resolves the password once and hands it to each module in the `seedDemo` context
  (`{ householdId, userId, demoPassword }`), so no module keeps its own constant. The demo data:
  user `demo@toon.local` / `demo1234`, the household "Familie" with the default module rows, then each
  build module's `seedDemo` (recipe: tags, three recipes, a plan week, cook log, the shopping list
  "Rewe" with bought history; finance: two more users, `robin@toon.local` in slot 2 and
  `kim@toon.local` as a household member WITHOUT a slot, both with the seed password, about eight
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
- **The local stack test** (the whole image, compose file, Caddyfile and redirects on this machine; guide:
  `docs/deployment.md` "Local stack test"; never in `/opt/toon-household`). It is the compose project
  `toon-household-local`:
  `docker build -t toon-household:local . > build.log 2>&1; echo "exit=$?" >> build.log` (read `exit=0`; add
  `--build-arg WITH_OCR=1 --build-arg WITH_PDF=0` for the published variant), then
  `docker compose --env-file .env.local-stack up -d` (ports 80 and 443 must be free), wait for the app container
  to be `healthy`, `curl --resolve haushalt.test:80:127.0.0.1 http://haushalt.test/toon-root-ca.crt -o root.crt`,
  then `curl --cacert root.crt --resolve haushalt.test:443:127.0.0.1 https://haushalt.test/api/health`; the old
  hostnames are `rezepte.test` and `finanzen.test` (no `/etc/hosts` edit: `--resolve` for curl,
  `--host-resolver-rules` for Chromium, plus `--ignore-certificate-errors` for a service worker to register).
  Tear down with `docker compose -p toon-household-local --env-file .env.local-stack down -v`.
- **`caddy validate`** only through compose, so the stack's `.env` is interpolated as `up` does: `docker compose
  --env-file <env> run --rm --no-deps --entrypoint caddy caddy validate --config /etc/caddy/Caddyfile --adapter
  caddyfile` (no `caddy` binary on the host; never a raw `docker run -e RECIPE_HOSTNAME=`, see the gotcha).
- **Scripts inside the running container:** `docker compose exec app bun apps/api/scripts/<script>.ts`
  (`seed.ts` refuses production without `-e ALLOW_SEED=1 -e SEED_PASSWORD=<10+ chars>`, `reset-password.ts <email>`,
  `uploads-gc.ts`, `plan-run.ts`, `migrate-legacy.ts` via `docker run --entrypoint bun` as in the cutover guide).

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

## Gotchas in use (M0 to M6, M3b)

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
  household's `finance_participants`; the check lives in the plan SERVICE (toon-finance gotcha 48),
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
  default (toon-finance gotcha 38). `isUniqueViolation` (core `auth/users.ts`) walks the error's cause
  chain, because drizzle wraps every query error (toon-finance gotcha 51).
- **Participants and the gate (D3, plan m3 decisions 3-5).** Exactly two `finance_participants` rows per
  household, by user id, slots 1 and 2 (unique index plus CHECK). A household member without a slot is a
  non-participant and sees nothing of the ledger: every ledger router (`transactions`, `categories`,
  `tags`, `plan`, `balance`, `settlements`) runs `requireVerifiedEmail()` then `requireFinanceParticipant()`
  for every method, so a non-participant gets `403 finance_not_participant` on reads too (the kinds and
  the balance sign are projections onto a viewer's slot and mean nothing for a third person). The only
  route they reach is `GET …/finance/participants` (`{ items, viewerSlot }`, `viewerSlot: null` for them).
  `PUT …/participants` (admin) replaces the two (validated in the SERVICE, toon-finance gotcha 48; `409
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
  (15 web and 4 server keys are new German from M3, a fifth server key from M4, and M3b added two
  server and five core web keys, see the core-neutral copy gotcha below). A key diff of every `"server.…"` literal in the ported
  files against the core catalog must stay empty. Content language (category names, plan and settlement
  descriptions written into rows) follows `finance_settings.default_locale`, never the viewer's
  interface language (toon-finance gotcha 42).
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
  `CLAUDE.md` before touching the ledger arithmetic (32 `halfForOther(-101)` is `-50`; 33 halve per
  transaction; 34 the plan share is rounded once; 36 booked periods are immutable; 45 and 54
  `lastBookedPeriod`), settlements (37 `expectedBalanceCents` is required, `409 balance_stale` carries the
  current balance), the balance sign (39: the UI never shows a raw sign, `viewerBalanceCents` is the
  viewer's projection), idempotency (9, 10, 47: `mutationId` is minted at the call site and claimed by an
  INSERT on the primary key; a replay answers 200 with the current state; 73: the read paths filter on the
  household), the offline outbox (7-9, 11), the sticky "Buchen" bar (15: `.bottom-tabbar`, never `bottom-0`) and
  the import/plan collision rule (46, `isPeriodBooked`). The numbers are F's numbering at `1715207`, see the
  gotcha "F gotcha numbers" below. Money is integer cents; the ledger-spec numbers are the spec.
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
  log ending in `exit=$?`. A `docker build` is judged by `$?` written to its log, never through a pipe
  (`docker build ... | tail` reports tail's status); the repo-root `build.log` is ignored by `*.log` and removed
  after the check.
- **`migrate:legacy` reads snapshots and writes only through a redirected, validated path (plan m5
  decisions 3, 5, 6, 16).** `sources.ts` copies each legacy file and its `-wal` (never `-shm`) into a scratch
  directory and opens the copy with a plain `createClient` (not `createDatabase`: its WAL pragma rewrites a
  header) plus `PRAGMA query_only = 1`; a copy of the main file alone loses every page still in the WAL, so
  the operator copies the whole volume (`docs/migration.md`). A schema gate (exit 2) wants recipe at 9
  migrations / `0008_shopping_bought` and finance at 3 / `0002_placeholder_members` (M3b, ADR 0006). Dry run = the full
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
  target account <email> blocks the merge", exit 1). The rule holds on a resumed run too: a recipe user arriving after a finance-only `--apply` meets the finance-created (unconfirmed) account and is refused the same way (review fix `b31d3fe`). A recipe account without a password (OAuth-only) keeps
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
- **Placeholders and claim invites (ADR 0006, plan m3b decisions 1-6).** A placeholder is a core user row with
  `email IS NULL AND password_hash IS NULL`: `isPlaceholderUser` (`core/services/auth/users.ts`) is the one
  predicate, `password_hash` alone is not enough here (an OAuth-only account has a NULL hash). It has no OAuth
  link, no session, no avatar and cannot sign in; `toUserDto` answers 401 for one, so a session naming it is a
  bug, and every reader of `users.email` narrows it (`requireAccountEmail`; mail and auth code never see a NULL).
  `claimPlaceholderUser` is ONE conditional `UPDATE … WHERE id = ? AND password_hash IS NULL AND email IS NULL
  RETURNING id` (F gotcha 72: never check-then-write; zero rows is `409 member_has_account`, a unique violation
  `409 email_taken`; `placeholders.test.ts` races two claims). A claim invite is redeemed ONLY by `POST
  /api/auth/register { inviteToken }` (the user keeps the placeholder's id, so every payer, income person,
  membership and seat stays valid); `POST …/invites/accept` answers `409 invite_claim_requires_register` unless
  the caller IS the claimed user. Creating a claim invite is admin+ (F: either member) and revokes the older
  pending one for the same placeholder; a spent claim token is `404 invite_invalid`, no longer a capability (F
  gotcha 55). The claimed account is unconfirmed, so the verified-e-mail gate keeps it read-only until the
  address is confirmed. Placeholders never hold finance slot 1, and one alone in slot 1 after ADR 0004's re-seat
  is an accepted dead state until an admin seats two people. Deleting a household deletes its placeholder users.
- **The origin guard trusts `WEB_ORIGIN` (plan m3b decision 15, F gotcha 66).** `middleware/originGuard.ts`
  runs on `/api/*` for unsafe methods before the routers: an `Origin` that is an entry of `WEB_ORIGIN`
  (`env.webOrigins`) passes (the dev setup calls the API from `:5173`, the same SITE, which F's rule would
  refuse); otherwise `Sec-Fetch-Site: cross-site|same-site`, `Origin: null` and an `Origin` host other than the
  request host answer `403` with `server.error.originMismatch`; no `Origin` (curl, tests) passes; only the host
  is compared (TLS ends at the Caddy). It sits after `cors()` (a preflight keeps its headers) and before
  `mountModules`, and `readJson` in `core/routes/auth.ts` wants `Content-Type: application/json`. A second
  origin that legitimately calls the API must be listed in `WEB_ORIGIN`, comma-separated.
- **The CSP and the baked API URL (plan m3b decision 16, F gotchas 67 and 50, ADR 0007).** `middleware/securityHeaders.ts`
  hashes every inline `<script>` of the built `index.html` at boot (the pre-paint theme script) and sends, on
  every response: `script-src 'self' 'wasm-unsafe-eval' <hashes>` (zxing-wasm for the card scanner), `style-src
  'self'`, `img-src 'self' data: blob: https:` (import previews are `blob:` and `data:`, a recipe may keep an
  external hero image), `media-src 'self' blob:`, `font-src`, `connect-src 'self'`, `frame-ancestors 'none'`,
  `X-Frame-Options: DENY`, `nosniff`; no HSTS (the Caddy owns it, D11) and no `Permissions-Policy` (it would
  block the camera). Those are the two recipe exceptions to F's CSP. **`connect-src 'self'` presumes a build with
  `PUBLIC_API_URL=""`:** an absolute value is baked into the bundle and, served from any other origin, has every
  API call and every `/uploads` image blocked, while a run at `localhost:3001` hides it. Build the served app with
  the variable EMPTY (`PUBLIC_API_URL= bun run build`; `.env.example` keeps the absolute value for `bun run dev`
  only); a production build with the variable unset is relative too (`lib/api.ts`, `import.meta.env.PROD`), and
  the image check is `! grep -rl 'localhost:3001' apps/web/dist/assets`. A browser-visible CSP break shows up only
  in the container and only in a browser (`bun test` never sees it): check a served build at a second origin
  (`127.0.0.1:3001`) with the console open.
- **Core hardening from `1715207` (F gotchas 18 and 74).** `clientIp` reads the LAST `X-Forwarded-For` entry
  (what the trusted proxy appends; keep `header_up X-Forwarded-For {remote_host}` in the Caddyfile), e-mail
  invites are rate limited per user (10/h; a claim invite without an address is not) and `POST /api/households`
  too (5/h, so a headless script that creates households must restart the API between passes), a production API
  refuses the `change-me…` `SESSION_SECRET`, `db/client.ts` also sends `foreign_keys = ON` and creates the data
  directory `0o700` (D7 stays WAL + FULL), passwords are capped at 200 characters before argon2, display and
  household names refuse control characters, and a 401 in the web app purges the persisted cache like a logout.
- **The Erfassen sheet is module-local and has no FAB (plan m3b decisions 9 and 10, F gotchas 62, 63, 65).**
  D6 stands: Erfassen stays tab 3 at `/finance/new`. `FinanceGate` mounts the sheet for participants only (static
  imports, so a cold offline start has it); openers are the `n` key on every finance screen and the list's own
  button. `/finance/new` claims the host (`useQuickAddHostedHere`), so the sheet never opens over it. Both frames
  share ONE form hook (`useCreateForm`) and H's one create mutation with its client-minted `mutationId` and the
  `["toon","finance","tx"]` outbox namespace; each frame holds its own state. "Is the sheet open" is not "has
  the sheet unsaved work" (`useUnsavedWork(form.isDirty)`). The shell has no "+" button and no FAB: a second one
  above the tab bar would duplicate the Erfassen tab.
- **Claim links are credentials (plan m3b decision 14).** Whoever holds a claim link becomes that person. The
  migration's `--apply` report and stdout carry live links (`<first WEB_ORIGIN>/invite/<token>`; never a dry
  run) and must stay outside any repository (`docs/migration.md`); the claim-link dialogs show the link to an
  admin and copy it (`shareOrCopy` / `copyToClipboard`); a record of a real run names counts only.
- **The claim test cleans the shared DB (plan m3b decision 18).** `legacy-placeholders.test.ts` runs a real
  `apply` of a FINANCE-ONLY input into the shared `file::memory:` DB (it must: `app.request` sees only that
  DB) and registers with the migrated claim token. To keep later files order-independent it asserts first that
  no fixture e-mail exists, records the counts of `users`, `households`, `household_invites` and `legacy_ids`,
  and in `afterAll` deletes every household and user the run wrote (ids from `legacy_ids`, households first so
  the cascade takes the finance rows) and asserts the counts are back. The merge path is proven on the legacy
  harness's temp DBs, not there.
- **Core copy stays module-neutral (plan m3b decision 8).** F wrote its placeholder copy for its finance
  screen. In H the core Gruppe screens and the auth pages say "Gruppe" and never "Buchungen", "Platz" or
  "Haushalt": F's module-neutral strings are in the core catalogs byte-identical, F's finance-flavoured ones live
  only in `finance.settings.household.*` (the participants section), and five core strings are NEW German
  (`auth.register.claimHint`, `auth.invite.claimSubtitle`, `household.placeholder.removeConfirm`,
  `household.claim.hint`, `household.claim.linkHint`), listed in `NEW_GERMAN` with two new server keys
  (`server.household.placeholderRole`, `server.finance.placeholderSlotOne`). The new-German totals are now: 15
  finance web keys (M3), 5 core web keys (M3b), 6 finance server keys (4 from M3, `personNotParticipant` from M4,
  `placeholderSlotOne` from M3b), 1 core household server key (M3b) and the zod and home/household keys of M1/M2.
  A person's name is content and never goes through `t()`.
- **F gotcha numbers are F's numbering at `1715207`.** Between `cbdec67` and `1715207` toon-finance inserted a
  gotcha 19 (the docker network alias): F's 1-18 kept their numbers, its old 19-55 are now 20-56 and 57-74 are
  new. Every citation in H's code and in this file names the new number; the pair-by-title map is in the m3b plan's
  section 10, and a historical plan or ADR keeps the number of its date (the m3 plan says
  "gotcha 47" where the new number is 48). When F moves on again, map by the bold title, never by a blanket +1.

- **The Dockerfile refuses a bundle with the dev API URL (M6).** The web-build stage sets `PUBLIC_API_URL=""` (set
  and empty) and its `RUN` ends in `! grep -rqF 'localhost:3001' apps/web/dist`, so an image whose bundle carries
  `lib/api.ts`'s dev fallback cannot be built: the API's CSP says `connect-src 'self'`, and an absolute
  `http://localhost:3001` would block every API call and upload image on the real hostname (toon-finance gotcha 50).
  The same grep runs on the built image in the integration task. Bun 1.4's isolated linker needs THREE
  `node_modules` copies into the runtime stage (`/app/node_modules`, `apps/api/node_modules`,
  `packages/shared/node_modules`; `apps/web` is absent on purpose): copying only the root builds, starts and dies
  on the first import with "Cannot find module '@libsql/client'". The runtime user is `bun` (uid 1000), the process
  needs no capability (`cap_drop: [ALL]`, `no-new-privileges`), and a volume PRE-FILLED by a root container (the
  migration's copy-in) keeps root ownership, which is why `docs/migration.md` step 6 ends in `chown -R 1000:1000
  /data`.
- **Caddy treats an empty `{$VAR}` as set (M6, plan m6 decision 7).** `{$VAR:default}` falls back only when the
  variable is UNSET; a set-but-empty `RECIPE_HOSTNAME` leaves a site block without an address and `caddy adapt` fails
  with "server block without any key is global configuration, and if used, it must be first". The Caddyfile's
  `http://old-recipe-hostname.unset.invalid` and `http://old-finance-hostname.unset.invalid` defaults therefore cover
  the unset case only; set-but-empty is covered by compose's `${RECIPE_HOSTNAME:-http://…unset.invalid}` defaults,
  which always hand the Caddy container a non-empty value. The empty case is proven through compose
  (`docker compose --env-file <empty> config` shows the defaults, then `run … caddy validate`), and a raw `docker
  run -e RECIPE_HOSTNAME=` failing is expected, never a reason to change the Caddyfile. One global `cert_issuer
  {$TOON_TLS_ISSUER:acme}` serves every site, so the old-hostname sites need no `tls` block of their own (a `tls`
  block on the `.invalid` placeholder would be a config error); the app's own site keeps its explicit one.
- **The old-hostname blocks use `handle`, never a bare `redir` (ADR 0008).** Caddy sorts `redir` before `handle`, so a
  bare `redir` would swallow `/sw.js`; every route of an old-host block is a `handle`, and `/sw.js` answers 200 with the
  retiring worker (`(retire_old_worker)`: deletes the caches, claims, unregisters itself, reloads every window, which
  then hits the 301). A 301 is cached by browsers, so a Table R row must be right before go-live
  (`legacy-redirects.test.ts` resolves every target against the route tree, the integration task curls every row).
  The worker leaves IndexedDB alone: the cutover guide tells everybody to open both old apps online once first.
  `apps/api/test/deploy-caddyfile.test.ts` pins the two verbatim snippets by digest (`(hardening)`, `(fwd)`): the
  `header_up X-Forwarded-For {remote_host}` overwrite is what makes the API's LAST-hop read safe, and a
  `trusted_proxies` line would re-open the rate-limit bypass.
- **A single-file bind mount pins the old inode (M6).** `docker-compose.yml` mounts `./docker/Caddyfile` as one file;
  replacing it (`curl -o`, `mv`) leaves the running Caddy on the old config, and `deploy` never recreates caddy.
  `toon-household-deploy sync-config` downloads the compose file AND the Caddyfile, validates both
  (`config -q`, `caddy validate` through compose), restores the `*.bak` copies on any failure and restarts the caddy
  container when the Caddyfile changed. `toon-deploy.sh` is the forced command of ONE ssh key (`toon-household-deploy`;
  verbs `deploy [latest|sha256:<64 hex>]`, `sync-config`, `status`; `set -f`), distinct from the old
  `toon-deploy` and `toon-finance-deploy` so the new key can be installed before the old ones are removed.
- **A freshly published GHCR package is private (M6).** `release.yml` pushes on `main` and `v*` tags (typecheck and test
  first, `provenance: false`, SHA-pinned actions, `WITH_OCR=1 WITH_PDF=0`); the package stays private until the owner
  makes it public or the server runs `docker login`, and `deploy.yml` runs only when the repository VARIABLE
  `DEPLOY_ENABLED` is `true` (a job-level `if` cannot read secrets). Both workflows are verified by their YAML tests
  only: the first push to `main` is their first real run.
- **The local stack is the compose project `toon-household-local`, never the production name (M6, plan m6 decision 5).**
  The compose file says `name: toon-household`, so without a project name of its own a local `up` would use
  `toon-household_toon-data` and a local `down -v` (or a `down -v` run from a checkout on the server) would delete the
  production data volume. `.env.local-stack` sets `COMPOSE_PROJECT_NAME=toon-household-local` (it beats the file's
  `name:`; `-p` beats both), every local command in `docs/deployment.md` also spells `-p toon-household-local`
  (`deployment-doc.test.ts` pins that every `down -v` sits on such a line), and the production `.env` never sets the
  variable. Only the cutover REHEARSAL deliberately uses `-p toon-household` (the project the server's step 7 runs),
  on a machine shown to have no `toon-household_*` volume; a volume made by `docker volume create` before compose
  has no compose label, so `down -v` leaves it and it is removed by name. Compose only WARNS that such a volume "was
  not created by Docker Compose"; the stack uses it. Check the machine with
  `docker volume ls -q | grep -E '^toon-household(-local)?_'` (empty when nothing is left).
- **The first boot catches the fixed-cost plan up, so a migrated balance moves (M6).** `ApiModule.start` runs
  `plan:run` once at boot; an enabled plan whose periods since the old finance app last ran are unbooked gets
  `Fixkostenanteil MM/YYYY` rows (origin `fixed_plan`) created at that boot. After a cutover the balance equals the
  report's plus those rows; the balance without them must match (the legacy fixtures: 119486 ct in the report, 222286
  ct after the boot, two rows of 51400 ct).

## Obligations handed to later milestones

Each later plan lists and closes them (full text: `docs/plans/m4-design-pass.md` §8 and its §9; earlier ones
in `docs/plans/m0-scaffold.md` §4, `docs/plans/m1-core.md` §6 and §8, `docs/plans/m2-recipe-module.md` §8 and
§9, `docs/plans/m3-finance-module.md` §7 to §9, `docs/plans/m5-migration.md` §8, `docs/plans/m3b-finance-sync.md` §7 and §8). M0, M1, M2, M3, M4, M5, M3b and M6 closed theirs (M6's: `docs/plans/m6-deploy.md` §8 and §9); M4 closed findings A and
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
- M3b (closed): the finance port up to `1715207`, ADRs 0006 and 0007 and the placeholder migration; plan
  `docs/plans/m3b-finance-sync.md` sections 8 to 10. Left for later: the owner's cutover run with the claim link
  handed over privately (`docs/migration.md`).
- M6 (closed): the image, the compose stack with its own Caddy, the Table R redirects and the retiring worker (ADR
  0008), `toon-household-deploy`, the workflows, `docs/deployment.md` with the cutover section and the local stack
  test, `docs/migration.md` step 6 and 8 checked against the real image (uid 1000, `/app/data/local.db`,
  `toon-household_toon-data`), the toon-finance `97ab955` / `590697f` / `1715207` items (`cap_drop`,
  `no-new-privileges`, the `PUBLIC_API_URL=""` guard, `release.yml` and `deploy.yml` as specified in plan m3b §7.2)
  and `WITH_OCR=1 WITH_PDF=0`; plan `docs/plans/m6-deploy.md` sections 9 and 10. Left for the owner, outside any
  workflow: the real cutover on the server (`docs/deployment.md`, steps 0 to 12, DNS first), the first
  `release.yml` and `deploy.yml` runs after the first push to `main`, making the GHCR package public (or a `docker
  login` on the server), the repository variable `DEPLOY_ENABLED`, the OAuth callback URLs at the providers, arm64
  (never built locally), dropping the two old-hostname variables after the bookmarks have moved, and the final
  deletion of the old volumes. The M7 documentation of the deploy surface, where it touches the API, stays in M7.
- M7: `docs/API.md` (recipe and finance sections; note that migrated finance-only accounts start
  unconfirmed), `docs/modules/recipe.md`, `docs/modules/finance.md`;
  the member-leaves veto exists (`ApiModule.onMemberRemoving`; finance refuses a seated participant's
  leaving with `409 member_has_ledger` while the ledger has rows, so no ghost participant can appear;
  an empty-ledger leaver's seat is deleted, a slot-2 survivor is re-seated in slot 1, and an admin seats a
  replacement through `PUT …/participants`); M7 documents it in `docs/API.md` together with
  `member_has_ledger`, `finance_participant_in_use` and `422 server.finance.personNotParticipant`, plus the
  M3b surface (`POST …/members` for a placeholder, `PATCH …/members/:userId/placeholder`, the claim invite and its
  two `409` codes `member_has_account` and `invite_claim_requires_register`, `PATCH …/finance/participants/:userId`,
  the origin guard with `WEB_ORIGIN`, the CSP), and may
  extend the veto to other modules; the N-person ledger stays out (D3); switching the whole test
  suite to a temp-file DB (ADR 0003's consequence).
