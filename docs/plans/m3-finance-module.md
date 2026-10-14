# M3 — finance module: plan

**Status: PLANNED (2026-10-14, rev. 2).** Section 9 (integration record) is written by M3-T12;
section 10 ("what changed vs plan") at close. Rev. 2 (plan review): decision 18 (the finance
harness makes F's one-member `createHousehold` finance-ready; the one "Solo" test gets a seeded
one-participant ledger), `server.tag.nameTaken` added to decision 9 / T01, ADR 0002 for the
generic Zod wording (the test-DB ADR is now 0003), T03 split into T03 (schema, hooks,
participants service, harness) and T03b (middleware, routes), the `start` hook and package
scripts moved to T06, Table A/D rows for the renamed tag/pagination types and the importer's
dynamic schema imports, `plan-run` joins `household_modules`, the module clock for every setup
timestamp, the `NOSHADOW` and server-key checks.

Milestone M3 of `docs/SPEC.md` §8, written by the planner of the `build-household` workflow. Paths:
`H` = `/home/erics/software/toon-household` (this repo), `F` = `/home/erics/software/toon-finance`,
`R` = `/home/erics/software/toon-recipe` (both READ-ONLY: `cat`, `grep`, `git log`, `cp` FROM them
only; never run `bun install`, `bun test` or any script inside them).

## 1. Context

State of `H` at plan time (`c31f479`, M2 closed): `bun run typecheck` OK; `bun test` 1391 pass in 69
files (re-run by the planner, 14 s); `bun run i18n:check` parity OK, leftover half 120 classified
false positives. One module (`recipe`) on both sides; `API_MODULES = [recipeModule]`,
`WEB_MODULES = [recipeModule] as const satisfies readonly WebModule[]`, `MODULE_IDS = ["recipe",
"finance"]`, `DEFAULT_ENABLED_MODULES = ["recipe"]`. What M3 builds on, by seam:

- shared: `packages/shared/src/index.ts` re-exports `core/index.ts`, `modules/registry.ts`,
  `modules/recipe/index.ts` FLAT. `core/schemas/common.ts` holds `ERROR_CODES` (no finance code
  yet), `IdSchema`, `IsoDateSchema`, `listResponse`, `PaginationQuerySchema` (24/100 — recipe's),
  `ApiErrorSchema`, `MailDeliverySchema`, `HealthResponseSchema`. `core/i18n/catalogs/server.{de,en}.ts`
  are the ONLY server catalogs (`ServerKey` = their keys); the core Zod resolver
  (`core/i18n/zod.ts`) passes `{bound}` (finance's passed `{minimum}`/`{maximum}`) and has no
  `.required` suffix; its candidates are `server.zod.field.<field>.<code>.<bound>` →
  `…field.<field>.<code>` → `server.zod.<code>.<facet>` → `server.zod.<code>` → fallback.
- api: `modules/types.ts` (`ApiModule`: `householdRouter`, `userRouter`, `schema`,
  `healthFeatures`, `onHouseholdCreated(householdId, tx)`, `onEnable(householdId, settings, tx)`,
  `legacyMigration`, `afterMigrate`, `shutdown`, `seedDemo`, `uploadReferences`); `modules/mount.ts`
  runs `requireSession()` → `requireHouseholdRole("member")` → `requireModule(id)` before a
  `householdRouter`; `core/services/households/modules.ts` `enableModule(db, householdId, moduleId,
  settings, modules = API_MODULES)` calls `onEnable(householdId, settings ?? null, tx)` BEFORE the
  `household_modules` upsert; the route `POST /api/households/:id/modules/:moduleId` accepts
  `{ settings?: object }`; web `lib/api.ts` `enableModule(householdId, moduleId, settings?)` exists.
  `core/services/households/support.ts` (`DbLike`, `Tx`, `withTransaction` that degrades on
  `file::memory:`, `transactionsSupported`, `nowMs`). `core/services/auth/users.ts`
  `isUniqueViolation` checks only the TOP error (F gotcha 50 says that is a bug: drizzle wraps
  every query error). `lib/{errors,http,locale,types}.ts` match F's (ApiError statics identical,
  `toIso` identical). `index.ts`: health, `/uploads`, `mountModules`, `/api/auth`, `/api/households`,
  SIGTERM/SIGINT → `module.shutdown?.()`, `await dbReady`, static web last. `db/schema.ts`
  re-exports `schema/core.ts` + `modules/recipe/schema.ts` FLAT. Migrations `0000_core`,
  `0001_recipe`. Under `bun test` env.ts forces `DATABASE_URL=file::memory:`.
- api tests that used `finance` as "a module this build lacks": `modules.test.ts` (b)–(f),
  `core-walkthrough.test.ts` (A enables finance with no participants), `middleware.test.ts:189`
  (inserts a `household_modules` row directly — unaffected), `smoke.test.ts` (`modules:
  ["recipe"]`), `recipe-module.test.ts:79` (`API_MODULES` ids `["recipe"]`), `smoke.test.ts` "all
  ten core tables" (filters only `recipe\_%`). With a real finance `onEnable` and finance tables
  all of these break; T03 rewrites them.
- web: `modules/types.ts` (`WebModule`: `route`, `navItems`, `secondaryNavItems`, `homeCard`,
  `persistQueryAllowList`, `persistMutationNamespaces`, `mutationDefaults`, `catalogs`,
  `settingsSections` — declared but NOT rendered by `core/features/settings/SettingsPage.tsx`
  yet); `modules/{index,catalogs,persist,enabled,layout}.ts(x)`; `route-roots.tsx`
  (`householdScopedRoute`, `pick`); `lib/nav.tsx` (`AppLink`, `useAppNavigate`, `useRouteParam`,
  `useNavigationGuard`); `lib/{api,queries,format,validation,navigation,unsavedWork,viewport,
  query-client,session}.ts(x)` (recipe-derived core; `formatDate(iso)` has no locale param);
  `components/ui/` (R's primitives — F's are the same family: same file names, F's prop
  interfaces are a subset; F's theme tokens and CSS utilities all exist in H's
  `styles/{theme,index}.css`, checked by the planner); `components/layout/PhoneHeaderRow`
  (household + module chips on phones); `core/features/home/{ModuleCards,ManageModulesDialog,
  lib/queries}.tsx?` (enable = one direct POST, no settings). `vite.config.ts` SW rules: auth,
  recipe NetworkOnly rules, one recipe NetworkFirst, `/uploads/` CacheFirst.
  `scripts/i18n-check.ts`: `NEW_GERMAN`, `ALLOW_LIST`, `PORTED_ROOTS` (`apps/api/scripts` is NOT
  scanned).

What F holds that M3 ports (counted 2026-10-14): shared 6 logic files + 7 domain schema files
(`auth`, `health`, `households` are core and NOT ported) + 7 test files + 1 fixture; api
`services/{ledger(7),categories(2),tags(1),plan(4)}`, `routes/{transactions,categories,tags,plan,
balance,settlements}.ts`, `lib/clock.ts`, `scripts/{plan-run,import-xlsx}.ts` +
`scripts/import/*.ts` (5), 12 test files + `support/{harness,synthetic-workbook}.ts`; web
`features/{transactions(15 incl. lib + test),overview(8),plan(7),categories(4)}`,
`components/money/*` (3), the finance halves of `lib/{api,queries,format,persist}.ts`, 7 catalog
namespaces, the finance SW rule. Not ported (core in H, D4/D13): F's auth, users, sessions,
households/invites routes and services, mail, `lib/{cookies,validation}`, `middleware/*`, the
auth/settings/household web features, F's shell.

**Goal** (SPEC §8 M3; D2, D3, D5–D10, D13, §2–§5): toon-finance as `modules/finance` on the three
workspaces — transactions with the four viewer-projected kinds, categories, tags, the
Fixkostenplan + `plan:run` + the accrual scheduler, balance, settlements, the offline capture
outbox — on `finance_` tables with `finance_participants` (exactly two slots by user id, same
unique index and CHECK) and `finance_settings`; the participant settings section, the enable
flow, the non-participant and module-disabled states; finance's screens on R's design system
(D5); every F test file ported. The two-person ledger is not generalised (D3).

**Exit criteria**: gates green; every F test file has a passing counterpart (map in §8),
including `halfForOther(-101) === -50`, the single-rounding plan share, "a SECOND retroactive
correction", `isPeriodBooked` (import/plan period collision) and `409 balance_stale`; a household
with three members assigns two finance participants and the third sees the non-participant state
(API test + headless); the finance screens render at 390 px and 1440 px in dark and light with
no console errors and `scrollWidth <= clientWidth`; `i18n:check` shows only classified hits.

### Decisions this plan takes (binding for the tasks below)

1. **Target layout** (SPEC §3).
   - shared: `packages/shared/src/modules/finance/{money,ledger,period,plan,categories,tags}.ts`,
     `packages/shared/src/modules/finance/schemas/{common,transactions,categories,tags,plan,balance,
     settlements,participants}.ts`, barrel `packages/shared/src/modules/finance/index.ts`,
     re-exported from `packages/shared/src/index.ts`. Tests flat in `packages/shared/test/` as
     `finance-<F name>.test.ts` (H already has `tags.test.ts`, `i18n.test.ts`); the fixture keeps
     its path `packages/shared/test/fixtures/haushalt-xlsx.ts`.
   - api: `apps/api/src/modules/finance/{index.ts,schema.ts,middleware.ts,setup.ts,seed.ts}`,
     `lib/clock.ts`, `services/support.ts`, `services/{ledger,categories,tags,plan}/**` mirroring F's
     `services/` one-to-one, `services/participants/participants.service.ts` (replaces F's
     `households/members.service.ts`, same exported names), `services/settings/settings.service.ts`
     (replaces F's `households/households.service.ts#loadHouseholdRow`), `routes/{index,
     participants,transactions,categories,tags,plan,balance,settlements}.ts`. Scripts:
     `apps/api/scripts/plan-run.ts`, `apps/api/scripts/finance-import-xlsx.ts`,
     `apps/api/scripts/finance-import/{amounts,categorize,dates,rent,xlsx-reader}.ts`. Tests in
     `apps/api/test/finance-*.test.ts` (H already has `plan.test.ts`, `households.test.ts`);
     helpers `apps/api/test/support/finance-harness.ts`, `…/finance-synthetic-workbook.ts`.
   - web: `apps/web/src/modules/finance/{index.ts,routes.tsx,HomeCard.tsx}`,
     `catalogs/*.{de,en}.ts` + `catalogs/index.ts`, `lib/{api,queries,format,participants}.ts`,
     `components/{AmountText,KindBadge,PeriodLabel,PageHeader}.tsx`,
     `features/{transactions,overview,plan,categories}/**` mirroring F's `features/` one-to-one,
     `features/participants/**` (new). Nothing under `apps/web/src/features/`.
2. **Tables** (D3, D7, §4). SQL names `finance_<F name>`; `finance_participants` replaces F's
   `household_members`; `finance_settings` holds F's `households.default_locale`; F's
   `fixed_cost_plans` stays a table of its own (`finance_fixed_cost_plans`: `enabled`, `payer_id`,
   `start_period`, `last_booked_period` — the plan services port unchanged; SPEC §4 lists it under
   `finance_*` too). `household_id` references core `households.id` (cascade, as in F); user
   references keep F's `onDelete` (`restrict` for payer/person/participant, `set null` for
   `created_by`). **TS identifiers carry a `finance` prefix** (handed on by M2: `db/schema.ts`
   re-exports flat and recipe owns `tags`, `TagRow`, …): Table C. Ported files keep their bodies by
   importing with aliases (`import { financeTransactions as transactions } from "../../schema.ts"`).
   Index and CHECK names gain the prefix (`finance_transactions_household_external_key_uidx`,
   `finance_transactions_amount_not_zero`). `origin` keeps NO drizzle default (F gotcha 37).
   - `finance_participants(household_id FK cascade, user_id FK restrict, member_slot integer not null,
     display_name text not null, joined_at integer not null)`, PK `(household_id, user_id)`,
     `finance_participants_slot_uidx` unique `(household_id, member_slot)`,
     `finance_participants_user_idx` on `user_id`, CHECK `finance_participants_slot_range`
     `member_slot in (1, 2)` — F's `household_members` constraints, by user id (D3).
   - `finance_settings(household_id PK FK cascade, default_locale text enum de|en not null default
     'de', created_at, updated_at)`.
3. **Non-participants see nothing of the ledger** (D3 leaves "read-only summary or nothing" to this
   plan). Every ledger router (`transactions`, `categories`, `tags`, `plan`, `balance`,
   `settlements`) runs `requireVerifiedEmail()` then `requireFinanceParticipant()` for EVERY method:
   a household member without a slot gets `403 finance_not_participant` on reads too. Reasons: the
   four kinds and the balance sign are projections onto a viewer's slot (F decision 1) and have no
   meaning for a third person; a two-person budget is private to the two (a household can include
   children or a flatmate); no N-person projection is built (D3). The only finance routes a
   non-participant reaches are `GET …/finance/participants` (who the two are). The web shows a
   `NonParticipantState` on every finance screen and a one-line Home card naming the two.
4. **Participants API and the enable flow** (D3, §2 `onEnable`).
   - `GET /api/households/:id/finance/participants` (any member) → `200 { items:
     FinanceParticipantResponse[], viewerSlot: 1 | 2 | null }`, items ordered by slot;
     `FinanceParticipantResponse = { userId, memberSlot, displayName, name, email, joinedAt }` (F's
     `MemberResponse` shape, so F's screens port by a type rename).
   - `PUT /api/households/:id/finance/participants` (`requireVerifiedEmail()`,
     `requireHouseholdRole("admin")`) body `{ participants: [{ userId, memberSlot }, { userId,
     memberSlot }] }` → 200 like GET. Validation in the SERVICE (F gotcha 47: a Zod refine cannot
     carry a code): exactly two entries, slots exactly {1, 2}, two different users, both members of
     the household, else `422 finance_participants_required` (key
     `server.finance.participantsRequired`, or `server.finance.participantNotMember` for a
     non-member). A user who leaves their slot (present before, absent after) while
     `finance_transactions.payer_id` or `finance_incomes.person_id` names them in this household →
     `409 finance_participant_in_use` (`server.finance.participantInUse`), nothing written. Swapping
     the same two users between slots is allowed (the ledger stores payer ids; every projection is
     computed at read time). When the plan's `payer_id` is an outgoing user (who has no rows, else
     409), it is set to the incoming user of the same slot. A kept user keeps `display_name` and
     `joined_at`; a new one gets `display_name = users.name` (trimmed, ≤ 80) and `joined_at = now`.
   - `PATCH /api/households/:id/finance/participants/me` (`requireVerifiedEmail()`,
     `requireFinanceParticipant()`) body `{ displayName }` → 200 the participant (F's
     `updateMemberDisplayName`).
   - `onEnable(householdId, settings, tx)`: if `settings` parses as `FinanceEnableSettingsSchema`
     (`{ participants: […] }`), apply the PUT rules above (same service function) inside `tx`;
     otherwise require two existing participant rows (a re-enable keeps its data, D2) or throw
     `422 finance_participants_required`. Then `ensureFinanceHousehold(tx, householdId)`: the 21
     default categories if the household has none (households created before M3), the
     `finance_settings` row, the `finance_fixed_cost_plans` row (`enabled: false`, `payer_id` = slot
     1, `start_period` = current period) if missing. The core stores the settings JSON in
     `household_modules.settings`; finance never reads it back (`finance_participants` is the
     truth).
   - `onHouseholdCreated(householdId, tx)`: the 21 categories (F `defaultCategorySeeds()`) and the
     `finance_settings` row with `default_locale` = the creator's `users.locale` if `de`/`en`, else
     `env.defaultLocale` — on EVERY new household (SPEC §2), finance enabled or not.
   - **Clock.** `onFinanceHouseholdCreated`, `onFinanceEnable`, `ensureFinanceHousehold` and
     `assignParticipants` take every timestamp (`created_at`, `updated_at`, `joined_at`) and the plan
     row's `start_period` (`currentPeriod(nowMs())`, as F `households.service.ts#createHousehold`
     does) from the MODULE's `modules/finance/lib/clock.ts` `nowMs()` — never `Date.now()` or the
     core `support.ts` `nowMs`. F's plan tests call `setClockForTest(JAN)` before `createHousehold`
     and expect the plan to start in that period; the harness enables finance inside
     `createHousehold` (decision 18), so the pinned clock reaches the plan row exactly as in F.
   - Web: the core's "Aktivieren" (Home `ModuleCards`, `ManageModulesDialog`) opens a module-provided
     dialog when the manifest declares `enableDialog` (new optional `WebModule` field, a §2
     extension); finance's `EnableFinanceDialog` lists the household members (core
     `householdMembersQuery`), preselects the viewer as slot 1, asks for slot 2, and calls
     `enableModule(householdId, "finance", { participants })`; a household with one member gets the
     "invite someone first" text and no submit. `/settings` renders each enabled module's
     `settingsSections` (core change); finance's `ParticipantsSection` shows the two slots, lets
     owners/admins change them (PUT) and lets a participant edit their own display name (PATCH me).
5. **Middleware and context** (D8, §2). `modules/finance/middleware.ts` exports
   `function requireFinanceParticipant(): MiddlewareHandler<AppEnv>` (a hoisted function
   declaration — H gotcha "API import cycle") that reads `finance_participants` for
   `(membership.householdId, user.id)` and `c.set("financeParticipant", { householdId, userId,
   memberSlot })`, else throws `403 finance_not_participant`; and
   `requireFinanceParticipantContext(c)` returning that object (F's `HouseholdContext` shape) or
   throwing the same 403. The context variable is typed by module-local augmentation (`declare
   module "hono" { interface ContextVariableMap { financeParticipant: FinanceParticipantContext } }`)
   — the core `AppVariables` gains nothing. Ported route handlers keep their bodies by importing
   `requireFinanceParticipantContext as requireHouseholdContext` (Table A). Routers never apply
   `requireSession()`/`requireHouseholdRole("member")` (the mount chain did, H gotcha).
6. **API mount** (D8). `modules/finance/routes/index.ts`: `financeHouseholdRouter = new
   Hono<AppEnv>().route("/participants", participantRoutes).route("/transactions",
   transactionRoutes).route("/categories", categoryRoutes).route("/tags", tagRoutes)
   .route("/plan", planRoutes).route("/balance", balanceRoutes).route("/settlements",
   settlementRoutes)` (F's `/summary` before `/:transactionId` stays inside `transactions.ts`). No
   `userRouter`. Paths `/api/households/:householdId/finance/{participants,transactions,…}`.
7. **Contract extensions** (recorded like M2's; T12 updates SPEC §2 prose): `ApiModule.start?():
   Promise<void>` — called by `index.ts` after `await dbReady`, once per module, never under test,
   a rejection logged in English and the boot continues; finance's `start` awaits the boot catch-up
   and starts the 6-hour accrual tick (F `services/plan/scheduler.ts`), `shutdown` stops it.
   `WebModule.enableDialog?: ComponentType<{ open: boolean; onClose: () => void }>` (decision 4).
8. **Shared contract merge** (D10, §2). Finance's `schemas/{auth,health,households}.ts` are not
   ported (core). From F's `schemas/common.ts` only the finance-specific exports move
   (`PeriodSchema`, `PeriodValue`, `CentsSchema`, `PositiveCentsSchema`, `BooleanQuerySchema`,
   `MemberSlotSchema`, `MemberSlot`, and F's 50/200 pagination as `FinancePaginationQuerySchema` /
   `FinancePaginationQuery`); `IdSchema`, `IsoDateSchema`, `listResponse`, `ApiErrorSchema`,
   `ValidationIssueSchema`, `MailDeliverySchema`, `ERROR_CODES` come from the core. Export names
   that would collide in the flat barrel are renamed (TS2308 otherwise): `TagResponseSchema`,
   `TagResponse`, `TagListResponseSchema`, `TagListResponse`, `UpdateTagRequestSchema`,
   `UpdateTagRequest` → `FinanceTag…`/`FinanceUpdateTag…`; consumers import them aliased
   (`FinanceTagResponse as TagResponse`) so bodies stay F's. Core `ERROR_CODES` gains F's
   finance-only codes `transaction_amount_zero`, `transaction_generated`, `balance_stale`,
   `settlement_amount_invalid`, `category_in_use`, `category_system`, `category_slug_taken`,
   `plan_disabled`, `plan_incomplete`, `plan_period_locked`, `plan_period_out_of_range` and the new
   `finance_not_participant`, `finance_participants_required`, `finance_participant_in_use`
   (F's `household_full`, `household_required`, `member_has_ledger`, `password_required` are not
   ported: no H code path throws them; `network_error` stays client-minted in `lib/api.ts`).
9. **Server catalog** (D10). The core server catalogs gain F's finance-only keys unchanged in key
   AND value, in one marked section "finance module (M3)": `server.balance.stale`,
   `server.category.{inUse,slugTaken,system}`, the 21 `server.category.name.*`,
   `server.content.{planAdjustmentDescription,planBookingDescription,settlementDescription}`,
   `server.household.needsSecondMember`, `server.plan.{disabled,incomeOverlap,incomplete,
   periodLocked,periodOutOfRange}`, `server.settlement.amountInvalid`, `server.tag.nameTaken`
   (de "Diesen Tag gibt es bereits." / en "This tag already exists.", thrown by F
   `tags.service.ts:185`; recipe's `server.recipes.tagNameTaken` "Diesen Tag gibt es schon" is a
   different string and is never substituted), `server.transaction.{amountZero,generated,notFound}`, `server.validation.{amountNotZero,
   amountPositive,periodFormat,periodRange}`, `server.zod.field.amountCents.invalid_type`; F's
   `server.zod.field.description.too_small` → `server.zod.field.description.too_small.1` and
   `…description.too_big` → `server.zod.field.description.too_big.<N>` where N is F's transaction
   description max (read it in F `schemas/transactions.ts`; the bound suffix keeps them off
   recipe's and the household's `description` fields, whose maxima are 500/1000/5000), with the
   placeholder `{maximum}` → `{bound}` (rendered text identical; the core resolver passes `bound`).
   Plus four NEW keys (decision 11). NOT ported: F's values for keys the core already has (the core
   = R's wording wins, D4/D13), `server.auth.*`, `server.mail.*`, `server.household.{full,
   memberHasLedger,noAccess,required}`, `server.content.householdDefaultName`, the generic
   `server.zod.{invalid_enum,invalid_format.email,invalid_format.uuid,invalid_type.required}` and
   `server.zod.field.password.too_small` (they would change recipe/core messages or are
   unreachable under the core resolver). Dropping F's generic Zod wording changes German UI text
   (finance validation messages without a field-specific key render the core's wording, e.g. F
   "Höchstens 200 Zeichen." → core "Darf höchstens 200 Zeichen lang sein"), so it is a D10
   exception recorded as **ADR 0002** (`docs/adr/0002-finance-validation-wording-from-the-core.md`,
   written by T01 with the D10 sentence, decision 19). A key diff of every `"server.…"` literal in
   the F files M3 ports against H's core catalog finds exactly the keys listed here (planner-run;
   T01's verify repeats it).
10. **Web data layer = module shims over the core lib** (M2 decision 9).
    `modules/finance/lib/api.ts` = `export * from "@/lib/api";` + F `lib/api.ts` lines 532–880
    (transactions … settlements fetchers) with Table D paths + three participant fetchers;
    `lib/queries.ts` = `export * from "@/lib/queries";` + local `queryKeys = { ...coreQueryKeys,
    <F finance keys, Table F> }`, F's finance query options and `invalidate` entries,
    `invalidateAfterLedgerMutation`, `invalidateAfterPlanMutation` (F lines 83–128 finance part,
    197–290, 293–369); `lib/format.ts` = `export * from "@/lib/format";` + F's whole `format.ts`
    body (its local `formatDate`/`formatDateTime` — locale param, `"–"` fallback, `Date` input —
    shadow the core's inside the module). `lib/participants.ts` replaces F `lib/session.tsx`'s
    `useHousehold`/`useOtherMember`.
11. **Catalogs** (D10). F web namespaces `common`, `nav`, `transactions`, `categories`, `plan`,
    `balance` → `modules/finance/catalogs/<ns>.{de,en}.ts` with every key prefixed `finance.`
    (`transactions.list.title` → `finance.transactions.list.title`), values byte-identical; from F
    `settings` only `settings.household.{title,manage,members,you,joinedAt,displayName,invite}` →
    `finance.settings.household.*`; F `auth` is not ported. NEW German (the only new copy; every key
    listed in `NEW_GERMAN`), file `catalogs/participants.{de,en}.ts`:

    | key | de | en |
    | --- | --- | --- |
    | `finance.module.name` | Finanzen | Finances |
    | `finance.participants.title` | Finanzen: Teilnehmende | Finances: participants |
    | `finance.participants.description` | Die Haushaltskasse rechnet zwischen genau zwei Personen ab. Platz 1 ist der Bezugspunkt des Saldos. | The household budget settles between exactly two people. Slot 1 anchors the balance. |
    | `finance.participants.slot1` | Platz 1 | Slot 1 |
    | `finance.participants.slot2` | Platz 2 | Slot 2 |
    | `finance.participants.save` | Teilnehmende speichern | Save participants |
    | `finance.participants.saved` | Teilnehmende gespeichert | Participants saved |
    | `finance.participants.sameMember` | Bitte zwei verschiedene Personen wählen. | Please choose two different people. |
    | `finance.participants.adminOnly` | Nur Inhaber und Admins können die Teilnehmenden ändern. | Only owners and admins can change the participants. |
    | `finance.participants.needsTwoMembers` | Für die Haushaltskasse braucht der Haushalt mindestens zwei Mitglieder. Lade zuerst jemanden ein. | The household budget needs at least two members. Invite someone first. |
    | `finance.participants.enableTitle` | Finanzen aktivieren | Enable finances |
    | `finance.participants.notParticipantTitle` | Du nimmst an der Haushaltskasse nicht teil | You are not part of the household budget |
    | `finance.participants.notParticipantBody` | Die Haushaltskasse dieses Haushalts führen {first} und {second}. | {first} and {second} keep this household's budget. |
    | `finance.participants.notParticipantAdminHint` | Inhaber und Admins können die Teilnehmenden in den Einstellungen ändern. | Owners and admins can change the participants in Settings. |
    | `finance.participants.toSettings` | Zu den Einstellungen | Go to Settings |

    Server (core catalog, T01): `server.finance.notParticipant` "Du nimmst an der Haushaltskasse
    dieses Haushalts nicht teil." / "You are not part of this household's budget.";
    `server.finance.participantsRequired` "Für die Haushaltskasse müssen zwei verschiedene
    Mitglieder als Platz 1 und Platz 2 gewählt sein." / "The household budget needs two different
    members as slot 1 and slot 2."; `server.finance.participantNotMember` "Diese Person ist kein
    Mitglied des Haushalts." / "This person is not a member of the household.";
    `server.finance.participantInUse` "Diese Person hat bereits Einträge in der Haushaltskasse und
    kann ihren Platz nicht abgeben." / "This person already has entries in the household budget
    and cannot give up their slot.". A later task that truly needs another string adds it to
    `participants.{de,en}.ts` AND `NEW_GERMAN` with a reason; the Home card reuses
    `finance.balance.*` / `finance.nav.create`.
12. **Query keys and persistence** (D9). Table F. Manifest `persistQueryAllowList` = household
    `["finance", s]` for s ∈ {`transactions`, `transaction`, `transaction-summary`, `categories`,
    `tags`, `plan`, `balance`, `participants`} (F's `PERSISTED_HOUSEHOLD_SEGMENTS` + `participants`,
    without which a cold offline start cannot tell the viewer's slot); `persistMutationNamespaces:
    [["finance","tx"]]`; `mutationDefaults: registerTransactionMutationDefaults` (F's module-scope
    call is deleted). Plan, category and participant mutations are never persisted (F gotcha 9).
13. **Web URLs and navigation** (D6). Base `/finance`. F `/` → `/finance` (Übersicht, exact),
    `/transactions` → `/finance/transactions`, `/transactions/$transactionId[/edit]` →
    `/finance/transactions/$transactionId[/edit]`, `/new` → `/finance/new`, `/plan` →
    `/finance/plan`, `/categories` → `/finance/categories`; F `/household` (Haushalt) is the core's
    `/households` item the shell appends. Tabs Übersicht · Buchungen · Erfassen (+ Profil);
    secondary Fixkosten, Kategorien (+ the shell's Gruppen). F's reachability rules hold:
    `FixedCostCard` on `/finance` → `/finance/plan`; `SpendByCategoryCard` footer and
    `CategorySheet` → `/finance/categories`. Erfassen stays a tab, not a FAB (F "Navigation").
    Route tree: `financeLayoutRoute` (`path: "/finance"`, `component:
    moduleLayoutComponent("finance")`, parent `householdScopedRoute`) → pathless
    `financeGateRoute` (`id: "participant-gate"`, `component: lazyRouteComponent(() =>
    import("./features/participants/FinanceGate"))`) → the seven screens, each a
    `lazyRouteComponent(() => import(…), "<NamedExport>")`; `TX_FILTER_PARAMS` (F `router.tsx:56`)
    and its `validateSearch` move to `modules/finance/routes.tsx`. Finance screens navigate through
    `AppLink`/`useAppNavigate`/`useRouteParam`/`useNavigationGuard` (`@/lib/nav`, string-typed, as
    recipe does), so `tsc` does not check their targets: the `LINKS_FIN` grep (§3) and T12's headless
    clicks do.
14. **Design** (D5). Finance screens use only `@/components/ui` (H's) and the module's own
    `AmountText`/`KindBadge`/`PeriodLabel`; restyle rules Table R. The token-by-token pass, the
    final Home cards and print stay M4.
15. **Tests run on the shared memory DB; real transactions are proven on a file DB** (deviation
    from F gotcha 2, ADR 0003, T09). H forces `file::memory:` for every test file in the one `bun
    test` process (core, recipe); switching the whole suite to a temp file would make every
    recipe/core `withTransaction` real for the first time (lock behaviour of libSQL's second
    connection untested) — out of M3's scope. Finance's `services/support.ts` `withTransaction(db,
    work)` uses a real transaction for every database EXCEPT the shared memory client under test, so
    `test/finance-file-db.test.ts` runs the ledger's write paths against a temp `file:` database
    (`createDatabase` + `runMigrations`) and proves rollback and the claim-plus-row atomicity.
16. **`isUniqueViolation` walks the cause chain** (F gotcha 50, binding for finance; T03 replaces
    the core function with F's version — strictly more detections, the regex is the same — and
    adds F's `households.test.ts` "sees through the wrapper" case).
17. **The xlsx importer is ported** as a one-off CLI (`bun run finance:import-xlsx -- <file>
    --household <id> [--dry-run] [--excel-text-quirk]`), because F's `import-haushalt.test.ts` must
    have a counterpart and the parsers carry ledger knowledge (F gotchas 40, 46, 48, 55). Its
    content-language parsers live under `apps/api/scripts/`, which `i18n:check` does not scan.
18. **The finance test harness makes F's one-member households finance-ready** (D3, decision 4).
    F's API tests build most households with `createHousehold(owner, name)` and no second member
    (counted 2026-10-14: `idempotency` 11 of 11, `categories` 5/5, `tags` 4/4, `transactions` 7/9,
    `plan` 4/15 — "GET /plan/preview 409s before any items/incomes exist", "POST /plan/run 409s
    while the plan is disabled", "a second income row with the same validFrom is 409 conflict",
    "PATCH /plan rejects a startPeriod that would overlap" —, `balance` 1/2 —
    "includeAggregates=false excludes rows tagged sammelbuchung" —, `settlements` 1/5 —
    "amountCents <= 0 is rejected"). In F that is a valid ledger; in H finance cannot be enabled
    with fewer than two participants, `POST /api/households` enables only recipe, and every ledger
    route sits behind `requireModule("finance")` and `requireFinanceParticipant()` — so a literal
    port answers `404 module_disabled`. The harness `apps/api/test/support/finance-harness.ts`
    (T03) therefore gives F's names H semantics, and ported test BODIES stay F's:
    - `createHousehold(owner, name)` → `POST /api/households` (the core hook seeds the 21
      categories and `finance_settings`), then a hidden partner `await createUser("Partner")` joins
      through the core invite + accept, then `POST /api/households/:id/modules/finance` with
      `{ settings: { participants: [{ userId: owner.id, memberSlot: 1 }, { userId: partner.id,
      memberSlot: 2 }] } }`, expecting 200 (this creates the plan row from the module clock,
      decision 4). Returns the household id, like F's. The hidden partner never acts and changes
      no F assertion: every solo F test books only as the owner (`MINE_SPLIT`, `FOR_THEM`, rows
      inserted through the db with `payerId: owner.id`), and every projection depends on payer and
      slot, which are the owner's in both apps (planner-checked case by case for the cases above).
    - `joinAsSecondMember(owner, householdId, member)` → `member` joins through the core invite +
      accept, then `assignParticipants(db, householdId, [{ userId: owner.id, memberSlot: 1 }, {
      userId: member.id, memberSlot: 2 }])` (the T03 service, called directly) moves the hidden
      partner out of slot 2 (it stays a plain household member). Every F call site calls it right
      after `createHousehold`, before any booking, so the in-use rule never fires; its doc comment
      says it must be called before the household books anything.
    - For H's own tests: `createPlainHousehold(user, name)` (POST only, finance NOT enabled),
      `addMember(owner, householdId, member)` (invite + accept only), `enableFinance(owner,
      householdId, slot1, slot2)` (POSTs the module with the participants body, returns the
      `Response`, asserts nothing).
    - `createSoloFinanceHousehold(user, name)` → `createPlainHousehold`, then DIRECT db inserts of
      one `finance_participants` row (`user`, slot 1, `displayName: user.name`, `joinedAt: nowMs()`
      from the module clock) and the `household_modules` row (`moduleId: "finance"`), then
      `ensureFinanceHousehold(db, householdId)`. One participant is unreachable through H's API; this
      helper exists only for F's regression test "?kind=THEIRS_SPLIT/TRANSFER match nothing while the
      household has only one member" (`transactions.test.ts:143`), whose premise is that
      `otherMemberId` is null and the kind filter must not fall back to the viewer. That test is
      kept (not dropped, not bent): title → "?kind=THEIRS_SPLIT/TRANSFER match nothing while the
      ledger has only one participant", setup `const householdId = await
      createSoloFinanceHousehold(solo, "Allein");`, F's comment plus one line "H: one participant
      cannot be reached through the API (onEnable needs two, M3 decision 4); the harness seeds it
      directly so this filter regression stays pinned.", assertions unchanged. It is the only test
      that uses the helper.
19. **ADR 0002 — finance's generic validation wording comes from the core** (D10). T01 writes
    `docs/adr/0002-finance-validation-wording-from-the-core.md` in ADR 0001's format — Context: D10
    keeps every German UI string byte-identical; H has ONE Zod resolver and ONE server catalog (the
    core's, R's wording, `{bound}` placeholder); F's generic keys `server.zod.{fallback,
    invalid_type,invalid_type.required,too_small.string,too_small.number,too_big.string,
    too_big.number,invalid_format.uuid,invalid_enum}` cannot coexist with the core's under the same
    keys without changing recipe's and the core's messages. Decision: those F keys are not ported;
    a finance validation issue without a field-specific key renders the core's text for its code
    (examples: "Höchstens {maximum} Zeichen." → "Darf höchstens {bound} Zeichen lang sein",
    "Mindestens {minimum}." → "Muss mindestens {bound} sein", "Dieses Feld ist erforderlich." →
    "Ungültiger Wert", "Ungültige Kennung." → "Ungültiges Format"); finance's field-specific
    messages keep their text (`server.zod.field.amountCents.invalid_type`,
    `…description.too_small.1`, `…description.too_big.200` with `{bound}`). Consequences: finance
    form errors from the server read in the core's voice; the finance screens' own client-side
    messages (catalog `finance.*`) are untouched; `finance-i18n.test.ts` pins the fallback to the
    core key. In the same commit SPEC D10 gains, after the ADR 0001 sentence: "A second recorded
    exception (ADR 0002): finance's generic Zod validation messages render the core's wording;
    finance's field-specific validation messages keep their text."

## 2. Rewrite tables (F → H)

Every port task applies the rows that occur in its files, in code AND comments. A German string
never changes except where a row says so.

**A — API specifiers.** Services move F `apps/api/src/services/<x>/*.ts` → H
`apps/api/src/modules/finance/services/<x>/*.ts` (two levels deeper); routes F
`apps/api/src/routes/<r>.ts` → H `apps/api/src/modules/finance/routes/<r>.ts`.

| F specifier (in a moved file) | H specifier |
| --- | --- |
| services: `"../../db/client.ts"`, `"../../lib/errors.ts"`, `"../../lib/http.ts"`, `"../../env.ts"` | `"../../../../db/client.ts"`, `"../../../../lib/errors.ts"`, `"../../../../lib/http.ts"`, `"../../../../env.ts"` |
| services: `"../../db/schema.ts"` | finance tables/types from `"../../schema.ts"` with Table C aliases; core tables (`users`, `households`) from `"../../../../db/schema.ts"` |
| services: `"../../lib/clock.ts"`, `"../support.ts"` | unchanged (the module's own `lib/clock.ts`, `services/support.ts`, T03) |
| services: `"../auth/users.service.ts"` (`isUniqueViolation`) | `"../../../../core/services/auth/users.ts"` |
| services: `"../households/members.service.ts"` | `"../participants/participants.service.ts"` (same names `otherMemberId`, `requireOtherMemberId`, `slot1UserId`) |
| services: `"../households/households.service.ts"` (`loadHouseholdRow`) | `"../settings/settings.service.ts"` (same name, returns `{ householdId, defaultLocale }`) |
| services: between moved files (`"./x.ts"`, `"../ledger/…"`, `"../categories/…"`, `"../tags/…"`, `"../plan/…"`) | unchanged |
| routes: `"../db/client.ts"`, `"../lib/http.ts"`, `"../lib/locale.ts"`, `"../lib/types.ts"` (`AppEnv`, `requireUser`) | `"../../../db/client.ts"`, `"../../../lib/http.ts"`, `"../../../lib/locale.ts"`, `"../../../lib/types.ts"` |
| routes: `requireHousehold as requireHouseholdContext` from `"../lib/types.ts"` | `import { requireFinanceParticipant, requireFinanceParticipantContext as requireHouseholdContext } from "../middleware.ts";` |
| routes: `onValidationError` from `"../lib/validation.ts"` | `"../../../core/services/households/validation.ts"` |
| routes: `requireHousehold` from `"../middleware/household.ts"`, `requireSession` from `"../middleware/session.ts"` | deleted; `import { requireVerifiedEmail } from "../../../middleware/verifiedEmail.ts";` |
| routes: `xRoutes.use("*", requireSession());` + `xRoutes.use("*", requireHousehold());` | `xRoutes.use("*", requireVerifiedEmail());` + `xRoutes.use("*", requireFinanceParticipant());` |
| routes: `"../services/<x>/…"` | unchanged |
| any string `` `/api/households/${…}/<seg>…` `` or comment `/api/households/:householdId/<seg>` (seg ∈ transactions, categories, tags, plan, balance, settlements) | `` `/api/households/${…}/finance/<seg>…` ``, `/api/households/:householdId/finance/<seg>` |
| `PaginationQuerySchema` / `PaginationQuery` imported from `@toon/shared` | `FinancePaginationQuerySchema as PaginationQuerySchema` / `FinancePaginationQuery as PaginationQuery` |
| `TagResponse`, `TagListResponse`, `UpdateTagRequestSchema` (… the six renamed names) from `@toon/shared` | `FinanceTagResponse as TagResponse`, … (aliased import, body unchanged) |
| `MemberResponse` from `@toon/shared` | `FinanceParticipantResponse` (aliased: `FinanceParticipantResponse as MemberResponse`) |
| tests: `"../src/db/schema.ts"` finance tables | `"../src/modules/finance/schema.ts"` with Table C aliases (`users`, `sessions`, `households` stay `"../src/db/schema.ts"`) |
| tests: `"../src/lib/clock.ts"` | `"../src/modules/finance/lib/clock.ts"` |
| tests: `"../src/services/<x>/…"` | `"../src/modules/finance/services/<x>/…"` (members/households.service per the rows above) |
| tests: `"./support/harness.ts"`, `"./support/synthetic-workbook.ts"` | `"./support/finance-harness.ts"`, `"./support/finance-synthetic-workbook.ts"` |
| tests: `createHousehold` from `"./support/harness.ts"` (every call, solo or not) | the harness's `createHousehold` from `"./support/finance-harness.ts"` — finance-ready, hidden partner in slot 2 (decision 18); the call line and the test body stay F's |
| tests: a file-local `joinAsSecondMember(owner, householdId, member)` (invite + accept) | deleted; imported from the harness (same signature; it seats `member` in slot 2 in place of the hidden partner, decision 18) |
| tests: `transactions.test.ts` "?kind=THEIRS_SPLIT/TRANSFER match nothing while the household has only one member" | title "?kind=THEIRS_SPLIT/TRANSFER match nothing while the ledger has only one participant"; `createHousehold(solo, "Allein")` → `createSoloFinanceHousehold(solo, "Allein")`; one comment line; assertions unchanged (decision 18) |
| tests: URLs `/api/households/${…}/(transactions\|categories\|tags\|plan\|balance\|settlements)` | `/api/households/${…}/finance/\1` |
| tests: `../../../packages/shared/test/fixtures/haushalt-xlsx.ts` | unchanged (same path in H) |
| scripts: `"../src/db/client.ts"`, `"../src/db/migrate.ts"` | unchanged |
| scripts: `"../src/services/<x>/…"`, `"../src/services/support.ts"`, `"./import/<f>.ts"` | `"../src/modules/finance/services/<x>/…"`, `"../src/modules/finance/services/support.ts"`, `"./finance-import/<f>.ts"` |
| `import-xlsx.ts:570`: `const { transactions } = await import("../src/db/schema.ts");` | `const { financeTransactions: transactions } = await import("../src/modules/finance/schema.ts");` |
| `import-xlsx.ts:648`: `const { fixedCostItems, incomes, fixedCostPlans } = await import("../src/db/schema.ts");` | `const { financeFixedCostItems: fixedCostItems, financeIncomes: incomes, financeFixedCostPlans: fixedCostPlans } = await import("../src/modules/finance/schema.ts");` |
| `import-xlsx.ts:571`/`649`: `await import("../src/services/households/members.service.ts")` | `await import("../src/modules/finance/services/participants/participants.service.ts")` (same names `slot1UserId`, `requireOtherMemberId`) |
| `plan-run.ts`: the two `households` selects | per T06 step 4: `households` inner join `householdModules` on `householdId` with `moduleId = "finance"` (both from `"../src/db/schema.ts"`, the core tables), selecting `{ id: households.id, name: households.name }`; the per-row log lines unchanged |

**B — shared.** F `packages/shared/src/{money,ledger,period,plan,categories,tags}.ts` → H
`packages/shared/src/modules/finance/<same>.ts` verbatim. F `schemas/{transactions,categories,tags,
plan,balance,settlements}.ts` → H `packages/shared/src/modules/finance/schemas/<same>.ts`; their
`"./common.ts"` imports split: `IdSchema`, `IsoDateSchema`, `listResponse` from
`"../../../core/schemas/common.ts"`; `PeriodSchema`, `CentsSchema`, `PositiveCentsSchema`,
`BooleanQuerySchema`, `MemberSlotSchema`, `PaginationQuerySchema` (renamed
`FinancePaginationQuerySchema`) stay `"./common.ts"`; `"../tags.ts"` unchanged; `"../i18n/zod.ts"`
→ `"../../../core/i18n/zod.ts"`. Renamed exports per decision 8. Tests: `"../src/<f>.ts"` →
`"../src/modules/finance/<f>.ts"`; `"../src/index.ts"` unchanged (aliased renamed names);
`"../src/i18n/<f>.ts"` → `"../src/core/i18n/<f>.ts"`; `"../src/i18n/catalogs/index.ts"` →
`"../src/core/i18n/catalogs/index.ts"`.

**C — tables** (SQL name / TS export / alias used in ported files):

| F SQL | H SQL | H TS export | alias in ported files |
| --- | --- | --- | --- |
| `categories` | `finance_categories` | `financeCategories` | `categories` |
| `tags` | `finance_tags` | `financeTags` | `tags` |
| `transaction_tags` | `finance_transaction_tags` | `financeTransactionTags` | `transactionTags` |
| `transactions` | `finance_transactions` | `financeTransactions` | `transactions` |
| `mutation_claims` | `finance_mutation_claims` | `financeMutationClaims` | `mutationClaims` |
| `fixed_cost_items` | `finance_fixed_cost_items` | `financeFixedCostItems` | `fixedCostItems` |
| `incomes` | `finance_incomes` | `financeIncomes` | `incomes` |
| `fixed_cost_plans` | `finance_fixed_cost_plans` | `financeFixedCostPlans` | `fixedCostPlans` |
| `accrual_runs` | `finance_accrual_runs` | `financeAccrualRuns` | `accrualRuns` |
| `household_members` (slots) | `finance_participants` | `financeParticipants` | — (new code) |
| `households.default_locale` | `finance_settings` | `financeSettings` | — (new code) |

Row types `XRow`/`NewXRow` → `FinanceXRow`/`NewFinanceXRow` (`CategoryRow` → `FinanceCategoryRow`,
`TagRow`, `TransactionRow`, `MutationClaimRow`, `FixedCostItemRow`, `IncomeRow`,
`FixedCostPlanRow`, `AccrualRunRow`, plus `FinanceParticipantRow`, `FinanceSettingsRow`); ported
files alias them back (`type FinanceTagRow as TagRow`). Index/CHECK names: `finance_` + F's name
(`categories_household_slug_uidx` → `finance_categories_household_slug_uidx`). Relations: F's
finance-side relations renamed `finance…Relations`, pointing at core `households`/`users`; no
reverse side on core tables (M2 decision 2). `financeTables` = an object of the 11 tables (the
manifest's `schema`).

**D — web moves and specifiers.** F `apps/web/src/features/<f>/P` (f ∈ transactions, overview,
plan, categories) → H `apps/web/src/modules/finance/features/<f>/P`; F
`apps/web/src/components/money/<X>.tsx` → H `apps/web/src/modules/finance/components/<X>.tsx`.

| F | H |
| --- | --- |
| `@/features/<f>/…` | `@/modules/finance/features/<f>/…` |
| `@/components/money/<X>` | `@/modules/finance/components/<X>` |
| `PageHeader` from `@/components/layout/AppShell` | `PageHeader` from `@/modules/finance/components/PageHeader` (same props) |
| `@/lib/api`, `@/lib/queries`, `@/lib/format` | `@/modules/finance/lib/api`, `@/modules/finance/lib/queries`, `@/modules/finance/lib/format` |
| `@/lib/i18n/I18nProvider.tsx` (`useT`, `useLocale`, `MessageKey`) | `@/lib/i18n` |
| `useHousehold`, `useOtherMember` from `@/lib/session` | `useFinanceHousehold`, `useOtherParticipant` from `@/modules/finance/lib/participants` (same return shapes) |
| `useRequiredHouseholdId`, `useCurrentUser` from `@/lib/session` | unchanged |
| `useSession()` used for the household / slot | `useFinanceHousehold()`; any other `useSession` use unchanged |
| `householdMembersQuery(…)` | `financeParticipantsQuery(…)` |
| `MemberResponse` | `FinanceParticipantResponse` |
| `TagListResponse`, `TagResponse`, `UpdateTagRequest` imported from `@toon/shared` (F `lib/api.ts:57,58,70`) | `FinanceTagListResponse as TagListResponse`, `FinanceTagResponse as TagResponse`, `FinanceUpdateTagRequest as UpdateTagRequest` (aliased; in H the bare names are RECIPE's types — `TagResponseSchema = z.object({ tag })` — and `request<T>` would compile with the wrong shape, so a missed alias is silent; the `NOSHADOW` grep catches it) |
| `PaginationQuery` imported from `@toon/shared` (F `lib/api.ts:46`, `lib/queries.ts:18`, `features/plan/lib/queries.ts:10`) | `FinancePaginationQuery as PaginationQuery` (the bare name is the core's 24/100 type; finance's is 50/200) |
| `Link` from `@tanstack/react-router` (JSX `<Link …>`/`</Link>`) | `AppLink` from `@/lib/nav` (`<AppLink …>`/`</AppLink>`, same `to`/`params`/`search`/`className`) |
| `const navigate = useNavigate();` … `void navigate({ to, params })` | `const navigate = useAppNavigate();` … `navigate({ to, params })` |
| `TransactionFilters.tsx`: `useNavigate({ from: "/transactions" })` + `navigate({ search: next as never, replace: true })` | `useAppNavigate()` + `navigate({ to: "/finance/transactions", search: next as NavigateOptions["search"], replace: true })` (`NavigateOptions` from `@/lib/nav`) |
| `useParams({ strict: false }) as { transactionId: string }` | `const transactionId = useRouteParam("transactionId") ?? "";` |
| `EditTransactionPage.tsx`: local `useUnsavedChangesGuard(dirty)` (`useUnsavedWork` + `useBlocker({ condition: dirty })`) | delete it and its `useUnsavedWork`/`useBlocker` imports; `const blocker = useNavigationGuard(dirty);` (`@/lib/nav`, registers `useUnsavedWork` itself); `blocker.status === "blocked"` → `blocker.blocked`, `blocker.reset?.()` → `blocker.reset()`, `blocker.proceed?.()` → `blocker.proceed()` |
| fetcher paths `` `/api/households/${householdId}/<seg>…` `` (seg ∈ transactions, categories, tags, plan, balance, settlements) | `` `/api/households/${householdId}/finance/<seg>…` `` |
| `offline.ts`: trailing `registerTransactionMutationDefaults();` side effect, `client: QueryClient = appQueryClient`, `import { queryClient as appQueryClient } from "@/lib/query-client"` | deleted / `client: QueryClient` (no default) / deleted (the manifest passes the client, D9) |
| `lazyPage({...})` titles | not ported (routes are `lazyRouteComponent`) |

**E — catalog keys.** Every string or template literal that STARTS with `transactions.`,
`categories.`, `plan.`, `balance.`, `common.`, `nav.` or `settings.household.` gains the prefix
`finance.` (`"common.edit"` → `"finance.common.edit"`, `` `transactions.kind.${k}` `` →
`` `finance.transactions.kind.${k}` ``). Values never change. `MessageKey` is a literal union, so a
missed or wrong key fails `tsc` — except a finance `"common.x"` that happens to exist in the core
`common.*` namespace; the `NOCORE` grep (§3) catches those.

**F — query and mutation keys.** `[ROOT, "household", householdId, <seg>, …]` →
`[ROOT, "household", householdId, "finance", <seg>, …]` for seg ∈ `transactions`, `transaction`,
`transaction-summary`, `categories`, `tags`, `plan`, `plan-preview`, `plan-runs`, `balance`,
`balance-history`, `settlements`; NEW `queryKeys.financeParticipants(householdId)` =
`[ROOT, "household", householdId, "finance", "participants"]` (replaces F's `householdMembers`);
`["toon", "tx", op]` → `["toon", "finance", "tx", op]` (`TX_MUTATION_KEYS`). F's core keys (`me`,
`households`, `household`, `householdDetail`, `householdInvites`, `invitePreview`, `sessions`,
`health`) come from the core spread, never redefined.

**G — link targets** (`to=`, `to:`, `navigate({ to })` in finance files): `"/"` (finance overview)
→ `"/finance"`; `"/transactions"` → `"/finance/transactions"`; `"/transactions/$transactionId"`
→ `"/finance/transactions/$transactionId"`; `"/transactions/$transactionId/edit"` →
`"/finance/transactions/$transactionId/edit"`; `"/new"` → `"/finance/new"`; `"/plan"` →
`"/finance/plan"`; `"/categories"` → `"/finance/categories"`; `"/household"` → `"/settings"` (the
participant section; with the gate a second participant always exists); `"/settings"` unchanged.

**R — restyle onto D5** (screens; the M4 pass does the token audit):

| F | H |
| --- | --- |
| `<PageHeader …>` | the module `PageHeader` (T04): on phones it renders `<PhoneHeaderRow action={actions-if-single} />` first (R's screens show the household + module chips), then `h1.font-display.text-display-2xl.leading-[1.05].font-medium.text-fg.lg:text-display-3xl.lg:leading-[1.1]`, description `mt-1 text-sm text-fg-muted`; desktop actions on the right |
| `text-lg font-semibold` heading (`TransactionDetailPage`) | `font-display text-display-md font-medium` |
| `text-3xl font-semibold tabular-nums` / `text-2xl font-semibold tabular-nums` amounts (`MonthSummaryCard`, `FixedCostCard`) | `font-display text-display-2xl font-medium tabular-nums` / `font-display text-display-xl font-medium tabular-nums` |
| small uppercase group labels (`text-xs font-semibold tracking-wide … uppercase`, `TransactionList` day headers) | `eyebrow text-fg-faint` (keep the sticky/positioning classes) |
| `text-[0.65rem]` (the one arbitrary size) | `text-xs` |
| `text-2xl text-fg-subtle` currency suffix in `AmountInput` | `text-display-lg text-fg-subtle` |
| page roots | repeat nothing of `<main>` (`mx-auto max-w-* px-gutter pt-4 pb-tabbar` is the shell's, F gotcha 15); sticky bars keep `.bottom-tabbar`, never `bottom-0`, and the unbroken flex chain (`/finance/new`'s "Buchen" bar) |
| F primitive props | H's primitives accept every F prop (planner-checked); H's `Button` variants are a superset |

## 3. Task list and waves

List order is the structured-output order; the orchestrator takes up to three ready tasks per wave
in that order. Waves shown for `maxParallel = 3`; deps are what is binding.

| Wave | Task | Tier | Title | Deps |
| --- | --- | --- | --- | --- |
| 1 | M3-T01 | port | Shared finance module + core contract/catalog additions + ADR 0002 + shared tests | — |
| 1 | M3-T02 | port | Web finance catalogs, new copy, SW rule, i18n plumbing | — |
| 2 | M3-T03 | core | API foundation: schema, migration, setup hooks, participants service, harness, core tests | T01 |
| 2 | M3-T04 | port | Web data layer: lib shims, participants hooks, money components, PageHeader, feature libs, outbox | T01, T02 |
| 3 | M3-T03b | build | API participants: middleware, participants routes, router composition, stubs | T03 |
| 3 | M3-T07 | port | Web transactions screens | T04 |
| 3 | M3-T08 | port | Web overview, plan and categories screens | T04 |
| 4 | M3-T05 | port | API ledger: transactions, idempotency, balance, settlements, categories, tags + tests | T03b |
| 4 | M3-T10 | build | Web participants: gate, non-participant state, settings section, enable dialog, Home card | T04 |
| 5 | M3-T06 | port | API Fixkostenplan, scheduler + `start`, `plan:run`, xlsx importer + tests | T05 |
| 5 | M3-T11 | core | Web wiring: route tree, manifest, registry, enable dialog + settings sections in the core, tests | T07, T08, T10 |
| 6 | M3-T09 | build | API seed, cross-household sweep, file-DB transaction test, ADR 0003 | T05, T06 |
| 7 | M3-T12 | build | Integration: gates, fresh DB, curl, headless 390/1440 dark+light, offline replay, docs | all |

File ownership is disjoint inside every wave. Shared files and their single owner:
`packages/shared/src/index.ts`, `packages/shared/src/core/schemas/common.ts`,
`packages/shared/src/core/i18n/catalogs/server.{de,en}.ts`,
`docs/adr/0002-finance-validation-wording-from-the-core.md` — T01;
`apps/web/src/modules/catalogs.ts`, `apps/web/src/lib/i18n/i18n.test.ts`, `apps/web/vite.config.ts`,
`scripts/i18n-check.ts` — T02 (later T09 adds one `ALLOW_LIST` row, T10 only if it adds copy);
`apps/api/src/{db/schema.ts,modules/index.ts}`, `apps/api/src/core/services/auth/users.ts`,
`apps/api/drizzle/**`, `apps/api/test/{smoke,modules,core-walkthrough,recipe-module,
finance-module}.test.ts`, `apps/api/test/support/finance-harness.ts`, the finance services T03
creates — T03; `apps/api/src/modules/finance/{middleware.ts,routes/**}`,
`apps/api/test/finance-participants.test.ts` — T03b (T05 replaces five route stubs and restores the
`// M3-T05:` placeholder, T06 replaces `routes/plan.ts`); `apps/api/src/{index.ts,modules/types.ts}`,
every `package.json` (scripts only; `bun.lock` unchanged, no new dependency is planned) — T06;
`apps/api/src/modules/finance/index.ts` — created by T03, edited by T03b (`householdRouter`), T06
(`start`, `shutdown`) then T09 (`seedDemo`), serial through deps;
`apps/web/src/modules/finance/catalogs/participants.{de,en}.ts` — T02 (T10 may append);
`apps/web/src/{modules/index.ts,modules/types.ts,core/features/home/ModuleCards.tsx,
core/features/home/ManageModulesDialog.tsx,core/features/settings/SettingsPage.tsx}` — T11;
`docs/SPEC.md` — T01 (the D10 sentence), T09 (the D13 sentence), T12 (§2/§3 prose), serial through
deps; `CLAUDE.md`, this plan's §9 — T12; `docs/adr/0003-*.md` — T09.

**`LINKS_FIN` — the unprefixed-link-target check** (decision 13, Table G), run by T04, T07, T08,
T10, T11, T12 (it finds F's targets in F's tree and nothing in a correctly rewritten one):

```sh
cd /home/erics/software/toon-household && ! grep -rnE "(\bto[=:] ?|\bgo\(|\bgoTo\()[\"'\`]/(transactions|new|plan|categories|household)\b|\bto[=:] ?[\"']/[\"']" apps/web/src/modules/finance
```

**`NOROUTER`** (typed router hooks must not survive in finance screens, decision 13):

```sh
cd /home/erics/software/toon-household && ! grep -rnE "\b(Link|useNavigate|useParams|useBlocker)\b[^;]*from \"@tanstack/react-router\"" apps/web/src/modules/finance/features apps/web/src/modules/finance/components
```

**`NOCORE`** (finance files never use F's unprefixed keys, Table E; catalogs excluded):

```sh
cd /home/erics/software/toon-household && ! grep -rnE "[\"'\`](common|nav|transactions|categories|plan|balance|settings)\.[a-zA-Z]" apps/web/src/modules/finance --include=*.ts --include=*.tsx --exclude-dir=catalogs
```

**`NOSHADOW`** (a finance file never imports the bare tag/pagination names, which in H resolve to
recipe's or the core's types without any error; Tables A, D; run by T04, T05, T06, T12):

```sh
cd /home/erics/software/toon-household && d=$(ls -d apps/web/src/modules/finance apps/api/src/modules/finance apps/api/scripts 2>/dev/null; true) && ! grep -rnP '^\s*(type )?(TagListResponse|TagResponse|UpdateTagRequest|PaginationQuery)(Schema)?,?\s*$|^import (type )?\{[^}]*(?<!as )(?<![A-Za-z])(TagListResponse|TagResponse|UpdateTagRequest|PaginationQuery)(Schema)?(?![A-Za-z])[^}]*\} from "@toon/shared"' $d
```

(Planner-tested: it finds F's ten un-aliased imports in F's tree and nothing in an aliased line.
Only existing directories are searched, so a missing one never turns grep's exit 2 into a pass.)

**`SERVERKEYS`** (every `"server.…"` literal of the F files M3 ports exists in H's core catalog;
run by T01, T05, T06):

```sh
cd /home/erics/software/toon-household && bash -c 'F=/home/erics/software/toon-finance; for k in $(grep -rhoE "\"server\.[a-zA-Z_.]+\"" $F/apps/api/src/services/{ledger,categories,tags,plan} $F/apps/api/src/routes/{transactions,categories,tags,plan,balance,settlements}.ts $F/packages/shared/src/schemas/{transactions,categories,tags,plan,balance,settlements,common}.ts | sort -u); do grep -qF "  $k:" packages/shared/src/core/i18n/catalogs/server.de.ts || { echo "missing $k"; exit 1; }; done'
```

**Parity count** (a ported test file has at least F's number of cases): for a pair `F/x` → `H/y`,
`test $(grep -cE '^\s*(test|it)(\.each)?\(' H/y) -ge $(grep -cE '^\s*(test|it)(\.each)?\(' F/x)`.

Every brief also implies: read `H/docs/SPEC.md` §1–§5, `H/CLAUDE.md` (Conventions, Gotchas in
use), `F/CLAUDE.md` (decisions 1–8 and the gotchas the brief names), this plan §1–§2, and the source
files named. Copy with `cp` from F, then edit with the table rows; code shape, comments and German
strings stay unless a row says otherwise. Commit with a body naming the SPEC decision and the F
files served, ending with the workflow's `Co-Authored-By` line; no pushes. A ported test that needs
code of a later task is removed with ONE comment naming the returning task (`// M3-T06: … returns
with the plan routes.`), never skipped; the later task restores it. `apps/api/tsconfig.json`
includes `test/**` only: never create `apps/api/tests/`.

## 4. Tasks

### M3-T01 — Shared finance module + core contract/catalog additions + ADR 0002 (port)

**Goal.** F's pure ledger logic and wire contract under `packages/shared/src/modules/finance/`,
re-exported flat from the package entry without a name collision; the finance error codes and
server catalog keys in the core; the participants contract; every F shared test ported.

**Read.** SPEC D3, D10, D13, §3; decisions 1, 4, 8, 9, 11, 19; Table B; `H/docs/adr/0001-*.md` (format); F/CLAUDE.md "Geld ist
ganzzahliger Cent", decisions 1–3, gotchas 31–35, 39, 47; F `docs/spec.md` §3.2 (`ERROR_CODES`),
§6.10–§6.11; sources `F/packages/shared/src/{money,ledger,period,plan,categories,tags,index}.ts`,
`F/packages/shared/src/schemas/*.ts`, `F/packages/shared/src/i18n/catalogs/server.{de,en}.ts`,
`F/packages/shared/test/*`; `H/packages/shared/src/{index.ts,core/**,modules/recipe/index.ts}`,
`H/packages/shared/test/{i18n,core}.test.ts`.

**Work.**
1. `cp` the six logic files to `packages/shared/src/modules/finance/` unchanged.
2. Schemas per Table B. `schemas/common.ts` keeps ONLY decision 8's finance-specific exports (with
   F's doc comments, including the "no NonZeroCentsSchema" note), `PaginationQuerySchema` →
   `FinancePaginationQuerySchema` (type `FinancePaginationQuery`), `refineKey` from
   `"../../../core/i18n/zod.ts"`. `schemas/tags.ts`: the six renames of decision 8. Every file that
   used `PaginationQuerySchema` (`transactions.ts`) uses `FinancePaginationQuerySchema`.
3. NEW `schemas/participants.ts`: `FinanceDisplayNameSchema = z.string().trim().min(1).max(80)` (F
   `DisplayNameSchema`); `FinanceParticipantResponseSchema = z.object({ userId: IdSchema, memberSlot:
   MemberSlotSchema, displayName: z.string(), name: z.string(), email: z.string(), joinedAt:
   IsoDateSchema })`; `FinanceParticipantListResponseSchema = z.object({ items:
   z.array(FinanceParticipantResponseSchema), viewerSlot: MemberSlotSchema.nullable() })`;
   `FinanceParticipantAssignmentSchema = z.array(z.object({ userId: IdSchema, memberSlot:
   MemberSlotSchema })).length(2)`; `UpdateFinanceParticipantsRequestSchema = z.object({
   participants: FinanceParticipantAssignmentSchema })`; `FinanceEnableSettingsSchema =
   UpdateFinanceParticipantsRequestSchema`; `UpdateFinanceDisplayNameRequestSchema = z.object({
   displayName: FinanceDisplayNameSchema })`; inferred types for each. Doc comment: distinctness and
   membership are service checks (F gotcha 47), never refinements.
4. Barrel `modules/finance/index.ts` (`export *` from the six logic files and the eight schema
   files); `packages/shared/src/index.ts` adds `export * from "./modules/finance/index.ts";` and its
   header names the finance module.
5. `core/schemas/common.ts`: append decision 8's 14 codes to `ERROR_CODES` with one-line doc
   comments (F `docs/spec.md` §3.2 for the eleven, decision 3/4 for the three new).
6. `core/i18n/catalogs/server.de.ts` / `server.en.ts`: one section "finance module (M3)" with the
   keys of decision 9 — values `cp`-exact from F's catalogs (both locales), the two description keys
   renamed with their bound and `{maximum}` → `{bound}` — plus the four new keys of decision 11.
   The section MUST contain `server.tag.nameTaken` ("Diesen Tag gibt es bereits." / "This tag
   already exists.", `cp`-exact from F `server.{de,en}.ts`): T05 ports F's `tags.service.ts`
   verbatim, H's `ErrorText` is typed `ServerKey`, and T05 cannot touch the catalog. The
   `SERVERKEYS` check (§3) must pass after this step.
8. ADR 0002 (decision 19): write `docs/adr/0002-finance-validation-wording-from-the-core.md` with
   the context, decision and consequences decision 19 spells out (ADR 0001's headings: title line
   "# 0002: Finance validation wording from the core (amends D10)", `Date: 2026-10-14`, `## Context`,
   `## Decision`, `## Consequences`), and add decision 19's sentence to SPEC D10 right after the ADR
   0001 sentence — same commit, touching nothing else in `docs/SPEC.md`.
7. Tests (Table B specifiers): `finance-money`, `finance-ledger`, `finance-period`, `finance-plan`,
   `finance-tags` (unchanged bodies); `finance-schemas` (F `schemas.test.ts`: the `ERROR_CODES`
   test asserts the finance codes are contained and there are no duplicates — drop F's exact
   `length === 30` and its `household_full` expectation with a comment naming decision 8;
   `PaginationQuerySchema` cases use `FinancePaginationQuerySchema` aliased; the
   `HealthResponseSchema` case is core-covered — replace it by a `FinanceParticipantAssignmentSchema`
   case (two entries parse, one entry fails), naming the reason); `finance-i18n` (F `i18n.test.ts`:
   keep the server-catalog cases — `resolveWireKey("de","server.error.notFound")` resolves to the
   CORE value, read it from H's catalog —, the de/en key-parity case, the `refineKey`
   (`server.validation.periodFormat`) case unchanged; the generic locale/interpolate/translator
   cases are covered by H's `i18n.test.ts` (one comment says so); "without a field-specific key,
   falls back to code.facet" expects the core's `server.zod.invalid_format`; "too_small carries its
   bound" uses `path: ["description"], minimum: 1` → `server.zod.field.description.too_small.1`;
   add a case: `server.zod.field.description.too_big.<N>` renders the bound).
   `cp` `F/packages/shared/test/fixtures/haushalt-xlsx.ts` to the same H path.

**Files.** `packages/shared/src/modules/finance/{money,ledger,period,plan,categories,tags,index}.ts`,
`packages/shared/src/modules/finance/schemas/{common,transactions,categories,tags,plan,balance,
settlements,participants}.ts`, `packages/shared/src/index.ts`, `packages/shared/src/core/schemas/
common.ts`, `packages/shared/src/core/i18n/catalogs/server.{de,en}.ts`,
`packages/shared/test/finance-{money,ledger,period,plan,tags,schemas,i18n}.test.ts`,
`packages/shared/test/fixtures/haushalt-xlsx.ts`,
`docs/adr/0002-finance-validation-wording-from-the-core.md`, `docs/SPEC.md` (D10 sentence only).

**Acceptance.** The six logic files `diff` identical to F's; every server key the ported F code
names exists (`SERVERKEYS`), including `server.tag.nameTaken` with F's wording; ADR 0002 exists and
SPEC D10 names it; `@toon/shared` exports `halfForOther`,
`computePlanForPeriod`, `FinanceTagResponseSchema`, `FinanceParticipantListResponseSchema`; no
TS2308; the server catalogs' de/en key sets are equal; `halfForOther(-101) === -50` and the
single-rounding plan share pass; every F shared test case has a counterpart (parity counts).

**Verify.** `cd H && bun run typecheck`; `cd H && bun test packages/shared`;
`cd H && for f in money ledger period plan categories tags; do diff -q /home/erics/software/toon-finance/packages/shared/src/$f.ts packages/shared/src/modules/finance/$f.ts || exit 1; done`;
`cd H && grep -q "halfForOther(-101)" packages/shared/test/finance-money.test.ts`;
`cd H && grep -q '"finance_participant_in_use"' packages/shared/src/core/schemas/common.ts`;
`cd H && grep -qF '"server.tag.nameTaken": "Diesen Tag gibt es bereits."' packages/shared/src/core/i18n/catalogs/server.de.ts && grep -qF '"server.tag.nameTaken": "This tag already exists."' packages/shared/src/core/i18n/catalogs/server.en.ts`;
`SERVERKEYS`;
`cd H && test -f docs/adr/0002-finance-validation-wording-from-the-core.md && grep -q 'ADR 0002' docs/SPEC.md`;
parity counts for money, ledger, period, plan, tags (F `packages/shared/test/<x>.test.ts` → H
`finance-<x>.test.ts`); `cd H && bun test`.

---

### M3-T02 — Web finance catalogs, new copy, SW rule, i18n plumbing (port)

**Goal.** Every finance UI string in `modules/finance/catalogs/` under `finance.*`, registered
literal-typed for `MessageKey`; the new German of decision 11 listed in `NEW_GERMAN`; the finance
service-worker rule.

**Read.** SPEC D9, D10; decisions 11, 12; Table E; H/CLAUDE.md gotchas "`MessageKey` must stay a
literal union", "Service worker"; F/CLAUDE.md decision 5, gotchas 11, 12, 26; F `docs/spec.md` §6.1,
§6.3–§6.9; sources `F/apps/web/src/lib/i18n/catalogs/{common,nav,transactions,categories,plan,
balance,settings}.{de,en}.ts`, `F/apps/web/vite.config.ts` (rule list); H
`apps/web/src/modules/recipe/catalogs/{plan.de.ts,index.ts}` (file pattern), `apps/web/src/modules/
catalogs.ts`, `apps/web/src/lib/i18n/i18n.test.ts`, `apps/web/vite.config.ts`, `scripts/i18n-check.ts`.

**Work.**
1. For ns ∈ common, nav, transactions, categories, plan, balance: `cp` F's `<ns>.{de,en}.ts` to
   `apps/web/src/modules/finance/catalogs/`, prefix every key with `finance.` (values, plural
   objects, comments untouched), rename the export (`commonDe` → `financeCommonDe`, …), and type
   it like R's module catalogs (`… as const satisfies NamespaceCatalog<"finance">`; en typed
   `LocaleCatalog<typeof financeCommonDe>` as F does).
2. `settings.{de,en}.ts`: only the seven `settings.household.*` keys of decision 11 →
   `finance.settings.household.*` (`financeSettingsDe`/`En`).
3. NEW `participants.{de,en}.ts` with decision 11's 15 web keys (exact German and English from the
   table).
4. `catalogs/index.ts`: `financeDe`/`financeEn` = literal spreads of the eight namespaces, `as
   const`, no annotation. `modules/catalogs.ts`: `MODULE_CATALOGS_DE = { ...recipeDe, ...financeDe }
   as const` (same for EN), header updated.
5. `lib/i18n/i18n.test.ts`: `"finance."` in `prefixes`.
6. `scripts/i18n-check.ts`: `NEW_GERMAN` gains the 15 web keys and the four `server.finance.*` keys
   (comment: "M3 new copy — finance participants, enable flow, non-participant state").
7. `vite.config.ts`: `{ urlPattern: /\/api\/households\/[^/]+\/finance\//, handler: "NetworkOnly" }`
   placed with the NetworkOnly block, BEFORE the recipe NetworkFirst rule, with F gotcha 11's
   reason in a comment (a cached ledger body would overwrite an optimistic booking).

**Files.** `apps/web/src/modules/finance/catalogs/{common,nav,transactions,categories,plan,balance,
settings,participants}.{de,en}.ts`, `apps/web/src/modules/finance/catalogs/index.ts`,
`apps/web/src/modules/catalogs.ts`, `apps/web/src/lib/i18n/i18n.test.ts`, `scripts/i18n-check.ts`,
`apps/web/vite.config.ts`.

**Acceptance.** `MessageKey` contains `finance.transactions.*`; the literal-union test and the
`@ts-expect-error` in `i18n.test.ts` still hold; de/en parity per namespace; `i18n:check` parity
half OK (new keys in `NEW_GERMAN`); the build's `sw.js` has the finance NetworkOnly rule before the
NetworkFirst one.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/lib/i18n`;
`cd H && bun run build`;
`cd H && f=$(grep -n 'urlPattern' apps/web/vite.config.ts | grep finance | head -1 | cut -d: -f1) && n=$(grep -n 'handler: "NetworkFirst"' apps/web/vite.config.ts | head -1 | cut -d: -f1) && test -n "$f" && test "$f" -lt "$n"`;
`cd H && mkdir -p data && { bun run i18n:check > data/m3-t02-i18n.log 2>&1; true; } && sed -n '/1\/2 German catalog parity/{n;p;}' data/m3-t02-i18n.log | grep -qx '\[i18n:check\] OK'`;
`cd H && grep -q '"finance.participants.notParticipantTitle"' scripts/i18n-check.ts`.

---

### M3-T03 — API foundation: schema, setup hooks, participants service, harness (core)

**Goal.** The finance module exists on the API side without HTTP routes of its own: prefixed schema
and generated migration, the manifest in `API_MODULES` with `onHouseholdCreated` / `onEnable`
(decision 4), the participants SERVICE those hooks need, the module's clock and `withTransaction`,
the cause-chain `isUniqueViolation`, the finance test harness (decision 18), the core tests adapted.
Routes and middleware are T03b; the `start` hook and package scripts are T06.

**Read.** SPEC D2, D3, D7, D13, §2, §4; decisions 2, 4, 15, 16, 18; Tables A, C; F/CLAUDE.md
decisions 1–3, gotchas 1, 2, 4, 10, 37, 41, 45, 47, 50; F `docs/spec.md` §2.4, §2.6–§2.13;
H/CLAUDE.md gotchas "Migrations are generated", "`file::memory:` is per client", "A
`household_modules` row is the enabled state", "API import cycle", "Recipe tables and indexes are
prefixed"; sources `F/apps/api/src/db/schema.ts` (categories → accrual_runs + relations),
`F/apps/api/src/services/households/{households,members}.service.ts` (`createHousehold` lines
38–85: the clock, the category seed, the plan row), `F/apps/api/src/services/categories/defaults.ts`,
`F/apps/api/src/services/support.ts`, `F/apps/api/src/lib/clock.ts`,
`F/apps/api/src/services/auth/users.service.ts` (`isUniqueViolation`),
`F/apps/api/test/{support/harness.ts,households.test.ts,smoke.test.ts}`; H `apps/api/src/{db/schema.ts,
modules/*.ts,modules/recipe/{index,schema}.ts,core/services/households/{modules,support}.ts,
core/routes/modules.ts}`, `apps/api/test/{modules,core-walkthrough,smoke,recipe-module,
recipe-cross-household,import-order}.test.ts`.

**Work.**
1. `modules/finance/schema.ts`: F's nine tables + `financeParticipants` + `financeSettings` per
   decision 2 and Table C (import `households`, `users` from `../../db/schema/core.ts`, never from
   `db/schema.ts`); row types; finance-side relations; `financeTables`. `db/schema.ts`: `export *
   from "../modules/finance/schema.ts";` (header updated). `cd apps/api && bunx drizzle-kit generate
   --name finance` → `drizzle/0002_finance.sql` + meta; never hand-edited.
2. `modules/finance/lib/clock.ts` = F's `lib/clock.ts` verbatim. `services/support.ts`: re-export
   `type DbLike`, `type Tx` from the core support; `withTransaction(db: Database, work)` = real
   `db.transaction` unless `db === sharedDb && !transactionsSupported` (decision 15; doc comment
   cites F gotcha 2 and ADR 0003).
3. `services/categories/defaults.ts` = F's (Table A specifiers). `services/settings/
   settings.service.ts`: `loadHouseholdRow(db, householdId): Promise<{ householdId; defaultLocale:
   Locale }>` from `finance_settings` (fallback `env.defaultLocale` when the row is missing) and
   `ensureFinanceSettings(db, householdId, locale)`. `services/participants/participants.service.ts`:
   `otherMemberId`, `requireOtherMemberId`, `slot1UserId` (F's bodies over `financeParticipants`,
   same errors and keys), `listParticipants(db, householdId)` (joined with `users`, ordered by
   slot, F `toMemberResponse` shape), `getParticipant`, `participantSlotOf(db, householdId,
   userId)`, `assignParticipants(db, householdId, assignment)` (decision 4 rules: validation with
   the explicit codes, the in-use check, plan payer reassignment, upsert keeping kept users' rows;
   unique violations through `isUniqueViolation` answer 409 `finance_participant_in_use`, never a
   500), `updateParticipantDisplayName` (F `updateMemberDisplayName`). Every timestamp from the
   module clock (decision 4 "Clock").
4. `modules/finance/setup.ts`: `seedDefaultCategories(tx, householdId)` (F `createHousehold`'s
   insert, only when the household has no category), `onFinanceHouseholdCreated`, `onFinanceEnable`,
   `ensureFinanceHousehold` (decision 4). `import { nowMs } from "./lib/clock.ts"` is the ONLY
   time source; the plan row's `start_period` = `currentPeriod(nowMs())` (whatever F's
   `createHousehold` uses for `currentPeriod`, same import).
5. `modules/finance/index.ts`: `financeModule: ApiModule = { id: "finance", schema: financeTables,
   onHouseholdCreated, onEnable }` (no `householdRouter` yet — `ApiModule.householdRouter` is
   optional; a comment lists what T03b, T06, T09 add); `modules/index.ts`: `[recipeModule,
   financeModule]`.
6. `core/services/auth/users.ts`: `isUniqueViolation` = F's cause-chain version (decision 16; keep
   H's regex).
7. `apps/api/test/support/finance-harness.ts` exactly per decision 18: `createUser(name)` (H users
   row with `emailVerified: true`, session row, cookie — the `recipe-cross-household.test.ts`
   pattern; returns `{ id, email, name, cookie }`; also export `type TestUser`), `call(path,
   options)` (`app.request`, lazy import of `../../src/index.ts`), `body<T>(response)`,
   `createHousehold`, `joinAsSecondMember`, `createPlainHousehold`, `addMember`, `enableFinance`,
   `createSoloFinanceHousehold`. A file header states decision 18 in three lines (why every F
   `createHousehold` is finance-ready, what the hidden partner is, that the solo helper is for one
   test only).
8. Core test edits (each keeps its intent):
   - `recipe-module.test.ts:79`: `toEqual(["recipe"])` → `toEqual(["recipe", "finance"])` (the
     registry now holds both; the rest of that test is recipe's and unchanged).
   - `smoke.test.ts`: health `modules: ["recipe", "finance"]`; "migrations create all ten core
     tables" also excludes `finance\_%` (`and name not like 'finance\\_%' escape '\\'` next to the
     recipe filter; comment: module tables are checked by `recipe-module.test.ts` and
     `finance-module.test.ts`).
   - `modules.test.ts` and `core-walkthrough.test.ts`: every enable of `finance` that must succeed
     sends a valid participants body (insert a second member through the core invite flow or
     `household_members` where the test has one owner); (c)'s JSON-text assertions compare the
     participants settings; NEW `modules.test.ts` (g): `POST …/modules/finance` with no body on a
     one-member household → 422 `finance_participants_required`, and NO `household_modules` row and
     NO `finance_participants` row (the "refused enable writes nothing" obligation).
9. NEW `apps/api/test/finance-module.test.ts`: (a) `sqlite_master` lists the 11 `finance_*` tables
   and no unprefixed `transactions`/`categories`/`incomes`; (b) registering a user (POST
   `/api/auth/register`) gives its household 21 `finance_categories` (one `fixkosten` system row)
   and a `finance_settings` row, finance NOT enabled; (c) deleting a household cascades its finance
   rows; (d) the slot CHECK and the `(household_id, member_slot)` unique index reject a
   third/duplicate slot through `@libsql/client`; (e) `isUniqueViolation` sees through drizzle's
   wrapper (F `households.test.ts` case); (f) `/api/health` lists `finance`; (g) under
   `setClockForTest(<2026-01-15 Berlin noon>)` (restored with `setClockForTest(null)` in
   `afterEach`), the harness's `createHousehold` yields finance enabled, participants owner → 1 and
   partner → 2, a plan row `enabled: false`, `payer_id` = owner, `start_period: "2026-01"`; (h)
   `joinAsSecondMember` then seats the member in slot 2 and the hidden partner holds no slot;
   (i) `assignParticipants` on the service: same user twice, one entry, a non-member → 422 with the
   decision-4 codes; replacing a user named as payer by a `finance_transactions` row (inserted
   through the db) → 409 `finance_participant_in_use` and nothing changed; without such a row → ok
   and the plan payer follows the slot; a kept user keeps `display_name` and `joined_at`; (j)
   disable (core `DELETE …/modules/finance`) then re-enable WITHOUT a body → 200 and the same
   participants (data kept, D2); (k) `createSoloFinanceHousehold` yields one participant row and
   an enabled module.

**Files.** `apps/api/src/modules/finance/{index,schema,setup}.ts`,
`apps/api/src/modules/finance/lib/clock.ts`, `apps/api/src/modules/finance/services/support.ts`,
`apps/api/src/modules/finance/services/{categories/defaults,settings/settings.service,
participants/participants.service}.ts`, `apps/api/src/modules/index.ts`, `apps/api/src/db/schema.ts`,
`apps/api/src/core/services/auth/users.ts`, `apps/api/drizzle/0002_finance.sql`,
`apps/api/drizzle/meta/{0002_snapshot.json,_journal.json}`, `apps/api/test/support/finance-harness.ts`,
`apps/api/test/{finance-module,smoke,modules,core-walkthrough,recipe-module}.test.ts`.

**Acceptance.** `db:generate` finds no drift; `0002_finance.sql` creates exactly the 11 prefixed
tables; a fresh `file:` DB migrates and seeds; `/api/health` lists both modules; a one-member
household cannot enable finance and the refusal writes nothing; the harness's `createHousehold`
gives a finance-ready household whose plan starts in the pinned clock's period; the core reaches
finance only through `modules/index.ts` (and `db/schema.ts`); the full `bun test` is green
(including `recipe-module.test.ts` and `smoke.test.ts`); `import-order.test.ts` still green.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/finance-module.test.ts apps/api/test/modules.test.ts apps/api/test/core-walkthrough.test.ts apps/api/test/smoke.test.ts apps/api/test/recipe-module.test.ts apps/api/test/import-order.test.ts`;
`cd H && bun test`;
`cd H/apps/api && bunx drizzle-kit generate --name m3_drift_check 2>&1 | grep -q 'No schema changes'`;
`cd H && grep -q 'CREATE TABLE `finance_participants`' apps/api/drizzle/0002_finance.sql`;
`cd H && rm -f data/m3-t03.db* && DATABASE_URL=file:$PWD/data/m3-t03.db bun run db:migrate`;
`cd H && DATABASE_URL=file:$PWD/data/m3-t03.db SESSION_SECRET=0123456789abcdef0123456789abcdef bun run seed`;
`cd H && ! grep -rn 'modules/finance' apps/api/src/core apps/api/src/db/migrate.ts apps/api/src/db/client.ts`;
`cd H && ! grep -nE 'Date\.now\(\)|core/services/households/support' apps/api/src/modules/finance/setup.ts`;
`cd H && grep -q 'createSoloFinanceHousehold' apps/api/test/support/finance-harness.ts`.

---

### M3-T03b — API participants: middleware, routes, router composition (build)

**Goal.** The finance HTTP surface that exists before the ledger: `requireFinanceParticipant`
(decision 5), the participants routes (decision 4: GET, PUT, PATCH `/me`), the ledger router stubs
and the composed `financeHouseholdRouter` (decision 6) on the manifest, with the HTTP tests of the
participant rules (decision 3).

**Read.** SPEC D3, D8, §2; decisions 3–6; Table A (route rows); H/CLAUDE.md gotchas "Middleware chain
order", "API import cycle"; sources `F/apps/api/src/middleware/household.ts`,
`F/apps/api/src/routes/households.ts` (the member/display-name handlers), `F/apps/api/test/
households.test.ts`; H `apps/api/src/modules/finance/**` (T03), `apps/api/src/{modules/mount.ts,
middleware/{household,verifiedEmail}.ts,lib/types.ts}`, `apps/api/src/modules/recipe/routes/index.ts`
(composition pattern), `apps/api/test/support/finance-harness.ts`.

**Work.**
1. `modules/finance/middleware.ts` (decision 5, incl. the `ContextVariableMap` augmentation; both
   exports are hoisted function declarations).
2. `routes/participants.ts` (decision 4: GET for any member; PUT with `requireVerifiedEmail()` +
   `requireHouseholdRole("admin")`; PATCH `/me` with `requireVerifiedEmail()` +
   `requireFinanceParticipant()`), calling T03's service; `routes/{transactions,categories,tags,
   plan,balance,settlements}.ts` as STUBS (`export const transactionRoutes = new Hono<AppEnv>();`
   …, one comment naming T05/T06); `routes/index.ts` (decision 6).
3. `modules/finance/index.ts`: add `householdRouter: financeHouseholdRouter`.
4. NEW `apps/api/test/finance-participants.test.ts` (F `households.test.ts` counterpart, harness
   helpers `createPlainHousehold`, `addMember`, `enableFinance`): (a) a three-member household
   (owner, B, C), finance enabled with owner + B; GET participants as C → `viewerSlot: null` and
   both names, as B → `viewerSlot: 2`; `requireFinanceParticipant()` mounted on a test Hono app
   behind the real mount chain answers C 403 `finance_not_participant` and B 200 with the context;
   one `// M3-T05: C on GET …/finance/balance → 403, B → 200 returns with the ledger routes.`
   placeholder; (b) a member's PUT → 403, an admin's PUT swapping the slots → 200 and GET shows the
   swap; (c) replacing B by C while a `finance_transactions` row names B as payer → 409
   `finance_participant_in_use`, GET unchanged; (d) invalid bodies (same user twice, a non-member,
   one entry) → 422; (e) PATCH `/me` renames the caller's display name; C → 403; (f) a user with an
   unverified e-mail gets the core verified-email refusal on PUT (assert the code
   `middleware/verifiedEmail.ts` throws); (g) with finance disabled, GET participants → 404
   `module_disabled`; a non-member → 403 from the mount chain.

**Files.** `apps/api/src/modules/finance/middleware.ts`,
`apps/api/src/modules/finance/routes/{index,participants,transactions,categories,tags,plan,balance,
settlements}.ts`, `apps/api/src/modules/finance/index.ts`, `apps/api/test/finance-participants.test.ts`.

**Acceptance.** `/api/households/:id/finance/participants` answers per decision 4; a household
member without a slot gets 403 `finance_not_participant` from the middleware; routers never apply
`requireSession()`/`requireHouseholdRole("member")`; `import-order.test.ts` green (no TDZ).

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/finance-participants.test.ts apps/api/test/finance-module.test.ts apps/api/test/import-order.test.ts`;
`cd H && bun test`;
`cd H && grep -nE '^export function requireFinanceParticipant(Context)?\(' apps/api/src/modules/finance/middleware.ts | wc -l | grep -qx 2`;
`cd H && ! grep -rnE 'requireSession|requireHouseholdRole\("member"\)' apps/api/src/modules/finance/routes`;
`cd H && grep -q 'M3-T05:' apps/api/test/finance-participants.test.ts`.

---

### M3-T04 — Web data layer (port)

**Goal.** The finance module's fetchers, query keys/options, invalidation fan-out, formatters,
participant hooks, money components, `PageHeader`, the four feature `lib/queries.ts`, the
transaction kinds and the offline outbox, with F's web lib tests.

**Read.** SPEC D5, D9, §2, §3; decisions 8, 10, 12, 13; Tables D (incl. the renamed tag and pagination type rows), E, F, R (PageHeader row); F/CLAUDE.md
gotchas 7–10, 13, 16, 24, 26, 31, 38, 51, 52; sources `F/apps/web/src/lib/{api,queries,format,
session}.ts(x)` (line ranges in decision 10), `F/apps/web/src/lib/{queries,format}.test.ts`,
`F/apps/web/src/components/money/*`, `F/apps/web/src/components/layout/AppShell.tsx` (`PageHeader`),
`F/apps/web/src/features/{transactions,overview,plan,categories}/lib/*`; H
`apps/web/src/modules/recipe/lib/{api,queries,format}.ts` (shim pattern), `apps/web/src/lib/{api,
queries,format,session}.ts(x)`, `apps/web/src/components/layout/PhoneHeaderRow.tsx`,
`R/docs/redesign/SPEC.md` (type scale).

**Work.**
1. `modules/finance/lib/api.ts` (decision 10; Table D paths). Add `fetchFinanceParticipants(
   householdId)` (GET), `updateFinanceParticipants(householdId, body)` (PUT),
   `updateMyFinanceDisplayName(householdId, body)` (PATCH `/me`), typed with T01's schemas. A local
   `financeApi` object replaces F's `api.transactions…settlements` groups if anything uses them.
2. `modules/finance/lib/queries.ts` (decision 10, Table F) incl. `financeParticipantsQuery(
   householdId)` (`networkMode: "offlineFirst"`, `STALE_TIME.detail`) and
   `invalidate.financeParticipants`; `invalidateAfterLedgerMutation` keeps F's full fan-out
   (gotcha 51).
3. `modules/finance/lib/format.ts` (decision 10); `getLocale` from `@/lib/i18n/store.ts`.
4. `modules/finance/lib/participants.ts`: `useFinanceHousehold(): { householdId: string | null;
   household: HouseholdWithRole | null; memberSlot: MemberSlot | null; isLoading: boolean }`
   (household from `useActiveHousehold()`, slot from `financeParticipantsQuery(...).data
   .viewerSlot`), `useOtherParticipant(): { member: FinanceParticipantResponse | null; isLoading:
   boolean }` (F `useOtherMember` body over the participants query). Not a `.tsx`, no JSX.
5. `components/{AmountText,KindBadge,PeriodLabel}.tsx` = F `components/money/*` (Table D/E).
   `components/PageHeader.tsx` per Table R (imports `PhoneHeaderRow` from
   `@/components/layout/PhoneHeaderRow` — screens are lazy, so this is outside the manifest graph;
   a header comment says the manifest, `HomeCard` and the settings section must never import it).
6. `features/transactions/lib/{kinds,queries,offline}.ts`, `features/overview/lib/queries.ts`,
   `features/plan/lib/queries.ts`, `features/categories/lib/queries.ts` = F's with Tables D/E/F
   (`householdMembersQuery` → `financeParticipantsQuery`, `MemberResponse` →
   `FinanceParticipantResponse`, `useHousehold` → `useFinanceHousehold`); `offline.ts` per Table D's
   last-but-one row (exported `registerTransactionMutationDefaults(client)`, no side effect).
7. Tests: `lib/queries.test.ts` (F `lib/queries.test.ts`, keys per Table F), `lib/format.test.ts`
   (F `lib/format.test.ts`), `features/transactions/lib/offline.test.ts` (F's; it calls
   `registerTransactionMutationDefaults(client)` on its own `QueryClient`).

**Files.** `apps/web/src/modules/finance/lib/{api,queries,format,participants}.ts`,
`apps/web/src/modules/finance/lib/{queries,format}.test.ts`,
`apps/web/src/modules/finance/components/{AmountText,KindBadge,PeriodLabel,PageHeader}.tsx`,
`apps/web/src/modules/finance/features/transactions/lib/{kinds,queries,offline,offline.test}.ts`,
`apps/web/src/modules/finance/features/{overview,plan,categories}/lib/queries.ts`.

**Acceptance.** Typecheck green; the three web tests pass with F's case counts; no `fetch` outside
`@/lib/api` (the shim adds none); every finance key starts `["toon","household",id,"finance"]` or
`["toon","finance","tx"]`; no module-scope `setMutationDefaults` call.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/modules/finance`;
`cd H && ! grep -rnE '(^|[^A-Za-z])fetch\(' apps/web/src/modules/finance`;
`cd H && ! grep -nE '^registerTransactionMutationDefaults\(' apps/web/src/modules/finance/features/transactions/lib/offline.ts`;
`cd H && ! grep -rnE '"tx",' apps/web/src/modules/finance --include=*.ts | grep -v '"finance", "tx"'`;
parity counts for `lib/queries.test.ts`, `lib/format.test.ts`, `features/transactions/lib/offline.test.ts`;
`LINKS_FIN`; `NOCORE`; `NOSHADOW`.

---

### M3-T05 — API ledger port (port)

**Goal.** Transactions (four kinds, summary, idempotency), balance, settlements, categories, tags
on the finance tables under `/api/households/:id/finance/…`, with F's tests.

**Read.** SPEC D3, D8, D13; decisions 3, 5, 6, 8; Tables A, C; F/CLAUDE.md decisions 1, 2, "Geld ist
ganzzahliger Cent", conventions (PATCH semantics, generated rows), gotchas 10, 31, 32, 36–39, 41,
46, 47, 50–52; decision 18 (the harness); F `docs/spec.md` §3.6, §3.8–§3.10; sources
`F/apps/api/src/services/{ledger/*,categories/categories.service,tags/tags.service}.ts`,
`F/apps/api/src/routes/{transactions,balance,settlements,categories,tags}.ts`,
`F/apps/api/test/{transactions,idempotency,balance,settlements,categories,tags}.test.ts`; H
`apps/api/src/modules/finance/**` (T03, T03b), `apps/api/test/support/finance-harness.ts`.

**Work.**
1. `cp` the nine service files to `apps/api/src/modules/finance/services/<same subpath>`; Table A
   specifiers; Table C aliased imports. No logic edit.
2. Replace the five route stubs with F's routers (Table A route rows: middleware swap, aliased
   context getter, Location strings). `/summary` stays above `/:transactionId`.
3. Tests `apps/api/test/finance-{transactions,idempotency,balance,settlements,categories,tags}.test.ts`
   = F's with Table A test rows: `createUser`, `call`, `body`, `createHousehold`, `type TestUser`
   and `joinAsSecondMember` come from `"./support/finance-harness.ts"`; each file-local
   `joinAsSecondMember` is deleted; URLs gain `/finance`; db asserts go through the aliased finance
   tables. EVERY `createHousehold(…)` call line stays as F wrote it — the harness's version is
   finance-ready (decision 18), so the solo setups (`idempotency` 11, `categories` 5, `tags` 4,
   `transactions` 7, `balance` "includeAggregates=false…", `settlements` "amountCents <= 0 is
   rejected") need no added partner and no added enable, and their assertions stay unchanged. The
   ONE exception is `transactions.test.ts` "?kind=THEIRS_SPLIT/TRANSFER match nothing while the
   household has only one member": apply its Table A row exactly (title "?kind=THEIRS_SPLIT/TRANSFER
   match nothing while the ledger has only one participant", `createSoloFinanceHousehold(solo,
   "Allein")`, the one comment line of decision 18). No F test is dropped, skipped or given a
   different expectation; if one fails, the cause is a port error, not the test (report it
   verbatim).
4. Restore the `// M3-T05:` placeholder in `finance-participants.test.ts` (owned by T03b, merged
   before this task): C's `GET …/finance/balance` → 403 `finance_not_participant`; B's → 200.

**Files.** `apps/api/src/modules/finance/services/ledger/{aggregateExclusion,balance.service,dateRange,
idempotency,settlements.service,summary.service,transactions.service}.ts`,
`apps/api/src/modules/finance/services/categories/categories.service.ts`,
`apps/api/src/modules/finance/services/tags/tags.service.ts`,
`apps/api/src/modules/finance/routes/{transactions,balance,settlements,categories,tags}.ts`,
`apps/api/test/finance-{transactions,idempotency,balance,settlements,categories,tags}.test.ts`,
`apps/api/test/finance-participants.test.ts` (placeholder only).

**Acceptance.** Every service file differs from F's only in import lines (`diff` shows import
lines only; `tags.service.ts` keeps `server.tag.nameTaken`, present since T01); every F test title
exists in its H file except the one Solo title renamed per Table A; `409 balance_stale` with the current value; `halfForOther` per-row rounding through
the API; generated rows 409 `transaction_generated`; replayed `mutationId` applied once; parity
counts per file.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/finance-transactions.test.ts apps/api/test/finance-idempotency.test.ts apps/api/test/finance-balance.test.ts apps/api/test/finance-settlements.test.ts apps/api/test/finance-categories.test.ts apps/api/test/finance-tags.test.ts apps/api/test/finance-participants.test.ts`;
`cd H && bun test`;
`cd H && grep -q 'balance_stale' apps/api/test/finance-settlements.test.ts`;
`cd H && ! grep -rnE 'requireSession|requireHouseholdRole\("member"\)' apps/api/src/modules/finance/routes`;
`cd H && grep -q 'createSoloFinanceHousehold(solo, "Allein")' apps/api/test/finance-transactions.test.ts && grep -q 'match nothing while the ledger has only one participant' apps/api/test/finance-transactions.test.ts`;
`cd H && ! grep -n 'M3-T05:' apps/api/test/finance-participants.test.ts`;
`cd H && grep -q 'server.tag.nameTaken' apps/api/src/modules/finance/services/tags/tags.service.ts`;
`NOSHADOW`; `SERVERKEYS`;
parity counts for the six test files (F `apps/api/test/<x>.test.ts` → H `finance-<x>.test.ts`).

---

### M3-T06 — API Fixkostenplan, scheduler, `plan:run`, xlsx importer (port)

**Goal.** The plan services and routes, the catch-up/recalculate logic, the accrual scheduler as
the module's `start`/`shutdown`, `bun run plan:run`, the one-off xlsx importer, with F's plan and
import tests.

**Read.** SPEC D3, D13, §2, §3; decisions 4 ("Clock"), 7, 17, 18; Tables A, C; F/CLAUDE.md decision 3, gotchas 33–35,
40–46, 48, 53, 55; F `docs/spec.md` §3.7, §7.4, §7.6; F `docs/ledger-spec.md` §6–§8; sources
`F/apps/api/src/services/plan/*`, `F/apps/api/src/routes/plan.ts`, `F/apps/api/scripts/{plan-run,
import-xlsx}.ts`, `F/apps/api/scripts/import/*`, `F/apps/api/test/{plan,import-haushalt}.test.ts`,
`F/apps/api/test/support/synthetic-workbook.ts`; H `apps/api/src/{index.ts,modules/types.ts}`,
`package.json`, `apps/api/package.json`.

**Work.**
1. `cp` `services/plan/{accrual.service,period-scan,plan.service,scheduler}.ts` (Table A, C).
   `scheduler.ts` only: export `async function financeHouseholdIds(db: DbLike): Promise<string[]>` =
   ids of households with a `household_modules` row `module_id = 'finance'` (core
   `householdModules`) — replaces F's `select id from households`; `runForEveryHousehold` iterates
   it. Everything else verbatim (6-hour interval, `unref`, English logs).
2. Replace the `routes/plan.ts` stub with F's router (Table A).
3. The `start` contract (decision 7). `modules/types.ts`: `start?(): Promise<void>` with the
   decision-7 doc comment. `apps/api/src/index.ts`: inside the existing `!env.isTest` block, after
   `await dbReady`, exactly `for (const module of API_MODULES) { try { await module.start?.(); }
   catch (error) { console.error(\`[api] start of module ${module.id} failed:\`, error); } }`.
   `modules/finance/index.ts`: `start: async () => { await runBootCatchUp(); startAccrualScheduler(); }`,
   `shutdown: async () => { stopAccrualScheduler(); }`.
4. `apps/api/scripts/plan-run.ts` = F's with ONE change: both selects become
   `db.select({ id: households.id, name: households.name }).from(households).innerJoin(householdModules,
   and(eq(householdModules.householdId, households.id), eq(householdModules.moduleId, "finance")))`
   (the targeted one adds `eq(households.id, targetId)` to the `where`; `householdModules` and
   `households` from `"../src/db/schema.ts"`, `and` from `drizzle-orm`). Empty result with a target →
   `[plan-run] no household ${targetId} with finance enabled` (exit 1); without one → F's
   `[plan-run] no households to run` (exit 0). The per-household log lines print `row.name` exactly as
   F does. `financeHouseholdIds` (step 1) is the scheduler's; `plan-run` needs the names and does
   not use it.
5. `apps/api/scripts/finance-import-xlsx.ts` + `apps/api/scripts/finance-import/{amounts,
   categorize,dates,rent,xlsx-reader}.ts` = F's with Table A's script rows, among them the two
   dynamic schema imports (lines 570 and 648) rewritten to aliased destructuring from
   `"../src/modules/finance/schema.ts"`, `members.service.ts` → `participants/participants.service.ts`,
   `../src/services/support.ts` → `../src/modules/finance/services/support.ts`; usage line says
   `bun run finance:import-xlsx -- <path> [--household <id>] [--dry-run] [--excel-text-quirk]`.
   `apps/api/tsconfig.json` includes `scripts/**`, so `tsc` checks all of it.
6. Package scripts: root `"plan:run": "bun --filter @toon/api plan:run --"`,
   `"finance:import-xlsx": "bun --filter @toon/api finance:import-xlsx --"`; api `"plan:run": "bun
   scripts/plan-run.ts"`, `"finance:import-xlsx": "bun scripts/finance-import-xlsx.ts"`.
7. Tests: `apps/api/test/finance-plan.test.ts` (F `plan.test.ts`, Table A; keeps "a SECOND
   retroactive correction", the import/plan period collision that pins `isPeriodBooked`,
   `setClockForTest` restored in `afterEach`). F's four solo plan tests ("GET /plan/preview 409s
   before any items/incomes exist", "POST /plan/run 409s while the plan is disabled", "a second
   income row with the same validFrom is 409 conflict, not a 500", "PATCH /plan rejects a
   startPeriod that would overlap an already-occupied period") keep title, setup line and
   assertions: the harness's `createHousehold` is finance-ready (decision 18) — no items and no
   incomes, plan disabled, plan row started in the period of the clock set before the call
   (decision 4 "Clock") — exactly F's precondition. Every other `joinAsSecondMember` comes from the
   harness. `apps/api/test/finance-import-xlsx.test.ts` (F
   `import-haushalt.test.ts`; imports `../scripts/finance-import/*`, `../scripts/finance-import-
   xlsx.ts`; `createHousehold` and `joinAsSecondMember` from the harness, call lines unchanged),
   `apps/api/test/support/finance-synthetic-workbook.ts` (F `support/synthetic-workbook.ts`).

**Files.** `apps/api/src/modules/finance/services/plan/{accrual.service,period-scan,plan.service,
scheduler}.ts`, `apps/api/src/modules/finance/routes/plan.ts`, `apps/api/src/modules/finance/index.ts`,
`apps/api/scripts/{plan-run,finance-import-xlsx}.ts`, `apps/api/scripts/finance-import/{amounts,
categorize,dates,rent,xlsx-reader}.ts`, `apps/api/test/finance-{plan,import-xlsx}.test.ts`,
`apps/api/test/support/finance-synthetic-workbook.ts`, `apps/api/src/{index.ts,modules/types.ts}`,
`package.json`, `apps/api/package.json`.

**Acceptance.** F's plan tests pass unchanged in substance, incl. the second retroactive correction,
`isPeriodBooked` and the four solo cases; `plan:run` runs on a fresh migrated DB (no household has
finance: "no households to run", exit 0); the import test's write path is household-scoped; the
API still boots (`start` runs once outside tests); parity counts.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/finance-plan.test.ts apps/api/test/finance-import-xlsx.test.ts`;
`cd H && bun test`;
`cd H && grep -q 'SECOND retroactive correction' apps/api/test/finance-plan.test.ts`;
`cd H && grep -q 'isPeriodBooked\|import/plan period collision' apps/api/test/finance-plan.test.ts`;
`cd H && rm -f data/m3-t06.db* && DATABASE_URL=file:$PWD/data/m3-t06.db bun run db:migrate && DATABASE_URL=file:$PWD/data/m3-t06.db SESSION_SECRET=0123456789abcdef0123456789abcdef bun run plan:run`;
`cd H && ! grep -n 'await import("../src/db/schema.ts")' apps/api/scripts/finance-import-xlsx.ts`;
`cd H && grep -q 'householdModules' apps/api/scripts/plan-run.ts && grep -q 'row.name' apps/api/scripts/plan-run.ts`;
`cd H && grep -q 'module.start' apps/api/src/index.ts`;
`NOSHADOW`; `SERVERKEYS`;
parity counts F `plan.test.ts` → `finance-plan.test.ts`, F `import-haushalt.test.ts` →
`finance-import-xlsx.test.ts`.

---

### M3-T07 — Web transactions screens (port)

**Goal.** Buchungen, Erfassen, Bearbeiten and the detail screen under `modules/finance/features/
transactions/`, restyled per Table R, on the H router helpers.

**Read.** SPEC D5, D6, D9; decisions 13, 14; Tables D, E, G, R; F/CLAUDE.md "Navigation" (Erfassen is
a tab), gotchas 7–10, 14–17, 26, 31, 38, 52; F `docs/spec.md` §4.4, §4.5, §4.10;
`R/docs/redesign/SPEC.md` (type scale, `.eyebrow`, sticky bars); sources
`F/apps/web/src/features/transactions/{TransactionsPage,NewTransactionPage,EditTransactionPage,
TransactionDetailPage}.tsx`, `F/apps/web/src/features/transactions/components/*.tsx`; H
`apps/web/src/lib/nav.tsx`, `apps/web/src/modules/finance/{lib,components}/*` (T04).

**Work.** `cp` the 12 files; apply Tables D, E, G, R. Named exports stay (`export function
TransactionsPage`). `NewTransactionPage`'s "Buchen" bar keeps `.bottom-tabbar` and the flex chain.
No new German.

**Files.** `apps/web/src/modules/finance/features/transactions/{TransactionsPage,NewTransactionPage,
EditTransactionPage,TransactionDetailPage}.tsx`,
`apps/web/src/modules/finance/features/transactions/components/{AmountInput,CategorySheet,KindPicker,
TagInput,TransactionFilters,TransactionFormFields,TransactionList,TransactionRow}.tsx`.

**Acceptance.** Typecheck green; no typed router hook, unprefixed link or unprefixed key left; no
`text-[` arbitrary size; `bottom-tabbar` on the sticky bar.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web`;
`LINKS_FIN`; `NOROUTER`; `NOCORE`;
`cd H && ! grep -rn 'text-\[' apps/web/src/modules/finance/features/transactions`;
`cd H && grep -q 'bottom-tabbar' apps/web/src/modules/finance/features/transactions/NewTransactionPage.tsx`;
`cd H && ! grep -rnE '\buse(Household|OtherMember)\(' apps/web/src/modules/finance/features/transactions`.

---

### M3-T08 — Web overview, plan and categories screens (port)

**Goal.** Übersicht (balance hero, settle dialog, month summary, spend by category, recent,
FixedCostCard), Fixkosten (items, incomes, periods, recalculate) and Kategorien, restyled per
Table R.

**Read.** As T07 plus F/CLAUDE.md gotchas 33, 35, 36, 38, 43; F `docs/spec.md` §4.3, §4.6, §4.7;
sources `F/apps/web/src/features/overview/{OverviewPage.tsx,components/*}`,
`F/apps/web/src/features/plan/{PlanPage.tsx,components/*}`,
`F/apps/web/src/features/categories/{CategoriesPage.tsx,components/*}`.

**Work.** `cp` the 16 files; Tables D, E, G, R. `FixedCostCard` links `/finance/plan`,
`SpendByCategoryCard`'s footer links `/finance/categories` (reachability, decision 13).
`SettleDialog` keeps `expectedBalanceCents` and the `balance_stale` path (F gotcha 36);
`PlanSummary` renders the payer share as the complement, never a second rounding (F gotcha 33).

**Files.** `apps/web/src/modules/finance/features/overview/{OverviewPage.tsx,components/{BalanceHero,
FixedCostCard,MonthSummaryCard,RecentTransactionsCard,SettleDialog,SpendByCategoryCard}.tsx}`,
`apps/web/src/modules/finance/features/plan/{PlanPage.tsx,components/{FixedCostItemList,IncomeList,
PlanPeriodList,PlanSummary,RecalculateDialog}.tsx}`,
`apps/web/src/modules/finance/features/categories/{CategoriesPage.tsx,components/{CategoryRow,
DeleteCategoryDialog}.tsx}`.

**Acceptance.** As T07; `FixedCostCard.tsx` contains `/finance/plan`, `SpendByCategoryCard.tsx`
contains `/finance/categories`.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web`; `LINKS_FIN`; `NOROUTER`; `NOCORE`;
`cd H && ! grep -rn 'text-\[' apps/web/src/modules/finance/features/{overview,plan,categories}`;
`cd H && grep -q '/finance/plan' apps/web/src/modules/finance/features/overview/components/FixedCostCard.tsx`;
`cd H && grep -q '/finance/categories' apps/web/src/modules/finance/features/overview/components/SpendByCategoryCard.tsx`.

---

### M3-T09 — API seed, cross-household sweep, file-DB transaction test, ADR 0003 (build)

**Goal.** Demo data for finance (two participants and a non-participant), the D8 sweep over every
finance by-id route, the real-transaction proof of decision 15 and its ADR.

**Read.** SPEC D3, D7, D8, D12 (seed idempotency), D13; decisions 3, 4, 15; H/CLAUDE.md gotchas
"Cross-household guard (D8)", "`file::memory:` is per client"; F/CLAUDE.md gotchas 2, 10, 36;
`H/apps/api/test/recipe-cross-household.test.ts` (shape, the coverage test against declared
`:param` routes); `H/apps/api/src/modules/recipe/seed.ts`, `H/apps/api/scripts/seed.ts`;
`H/docs/adr/0001-*.md` (format); `H/apps/api/src/db/{client,migrate}.ts` (`createDatabase`,
`runMigrations(db)`).

**Work.**
1. `modules/finance/seed.ts` `seedFinanceDemo(db, { householdId, userId })`, idempotent (skip when
   the household already has a `finance_transactions` row): ensure users `robin@toon.local`
   ("Robin") and `kim@toon.local` ("Kim"), password `demo1234` (argon2id), verified, members of the
   household (role `member`); `enableModule(db, householdId, "finance", { participants: [demo → 1,
   robin → 2] })`; through the services: ~8 transactions covering the four kinds (German content
   descriptions, e.g. "Wocheneinkauf", "Tankstelle", "Kino"), one settlement, fixed-cost items
   (Miete 95 000 ct, Strom 8 000 ct) from the current year's January, incomes for both, plan enabled
   from two periods ago, one `runCatchUp`. Kim stays a non-participant (the exit criterion's third
   member). Manifest `seedDemo`. `scripts/i18n-check.ts` `ALLOW_LIST` gains
   `apps/api/src/modules/finance/seed.ts` (content language).
2. `apps/api/test/finance-cross-household.test.ts`: two households each with finance and one of
   everything (transaction, custom category, tag, fixed-cost item, income); with U's cookie, every
   by-id route under `/finance` with V's ids → 404 `not_found` (GET/PATCH/DELETE transaction, PATCH/
   DELETE category, DELETE with `reassignTo` = V's category, PATCH/DELETE tag, PATCH/DELETE item and
   income, a transaction create with V's `categoryId`, a PUT participants naming V's user → 422);
   nothing of V's changes; a coverage test lists every `:param` route the finance routers declare
   and fails when one has no probe. Any leak found is fixed in the service with the household filter
   (each fix named in the commit).
3. `apps/api/test/finance-file-db.test.ts` (decision 15): a temp `file:` DB (`createDatabase`,
   `runMigrations(fileDb)`, removed in `afterAll`), users/household/participants inserted directly;
   (a) finance `withTransaction(fileDb, …)` that throws after an insert leaves no row; (b)
   `createSettlement(fileDb, …)` with a `mutationId` twice → one row and one claim; (c) a failing
   `createTransaction` (a tag insert forced to violate a constraint) leaves neither the transaction
   nor its claim; (d) `withTransaction(db, …)` on the shared memory client still degrades (documents
   the boundary).
4. `docs/adr/0003-finance-tests-on-the-shared-memory-db.md` (date, context: F gotcha 2 vs H's
   process-wide `file::memory:`; decision 15; consequences: the file-DB test is the ledger's
   transaction proof; switching the whole suite to a temp file is a later, separate decision) and
   the one-sentence addition to SPEC D13 naming the ADR, same commit.

**Files.** `apps/api/src/modules/finance/{seed,index}.ts`, `scripts/i18n-check.ts`,
`apps/api/test/finance-{cross-household,file-db}.test.ts`, service files a leak fix requires,
`docs/adr/0003-finance-tests-on-the-shared-memory-db.md`, `docs/SPEC.md` (D13 sentence only).

**Acceptance.** `seed` twice on a fresh DB: second run adds nothing; demo, robin, kim can log in;
kim gets 403 on the ledger; the sweep covers every declared `:param` route; the file-DB test proves
rollback.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/finance-cross-household.test.ts apps/api/test/finance-file-db.test.ts`;
`cd H && bun test`;
`cd H && rm -f data/m3-t09.db* && DATABASE_URL=file:$PWD/data/m3-t09.db SESSION_SECRET=0123456789abcdef0123456789abcdef bun run seed && DATABASE_URL=file:$PWD/data/m3-t09.db SESSION_SECRET=0123456789abcdef0123456789abcdef bun run seed`;
`cd H && DATABASE_URL=file:$PWD/data/m3-t09.db SESSION_SECRET=0123456789abcdef0123456789abcdef bun run plan:run`;
`cd H && test -f docs/adr/0003-finance-tests-on-the-shared-memory-db.md && grep -q '0003' docs/SPEC.md`.

---

### M3-T10 — Web participants features and the Home card (build)

**Goal.** The participant gate, the non-participant state, the settings section, the enable
dialog and the finance Home card (decisions 3, 4, 11).

**Read.** SPEC D3, D5, §2, §5; decisions 3, 4, 11, 13, 14; H/CLAUDE.md "A module owns its layout
route and its static import graph stays shell-free"; `R/docs/redesign/SPEC.md`; H
`apps/web/src/core/features/home/{ModuleCards,ManageModulesDialog,lib/queries}.tsx?`,
`apps/web/src/core/features/settings/SettingsPage.tsx` (card pattern), `apps/web/src/modules/recipe/
HomeCard.tsx`, `apps/web/src/lib/{session,permissions,queries}.ts(x)` (`householdMembersQuery`,
`useCanMutate`, `hasAtLeast`), `apps/web/src/modules/finance/{lib,components}/*` (T04).

**Work.**
1. `features/participants/lib/queries.ts`: `useFinanceParticipants(householdId)`,
   `useUpdateFinanceParticipants()` (PUT; invalidates participants + `invalidateAfterLedgerMutation`;
   toast `finance.participants.saved`; error → `errorMessage`), `useUpdateMyFinanceDisplayName()`,
   `useEnableFinance()` (core `enableModule(householdId, "finance", { participants })` from
   `@/lib/api`; on success the core module invalidations — `invalidate.me`, `invalidate.households`,
   `queryKeys.household(id)` — and the toast `home.modules.enabledToast`). `lib/assignment.ts` +
   `assignment.test.ts`: pure helpers (`initialAssignment(members, viewerId, current)`,
   `assignmentError(a)` → `"finance.participants.sameMember"` | null).
2. `FinanceGate.tsx` (default export, lazy): loading → `LoadingBlock`; `memberSlot === null` →
   `NonParticipantState`; else `<Outlet />`.
3. `NonParticipantState.tsx`: `PageHeader` with `finance.module.name`, a `Card` with
   `notParticipantTitle`, `notParticipantBody` (`{first}`/`{second}` = the participants' display
   names), for admins `notParticipantAdminHint` + `AppLink` to `/settings` (`toSettings`).
4. `ParticipantsSection.tsx` (a `settingsSections` entry; static import from the manifest, so NO
   `@/components/layout`, NO `@/modules`, NO `PageHeader`): `Card` + `CardHeader` (`title`,
   `description`); two `Select`s (`slot1`, `slot2`) over the household members for owners/admins
   (`adminOnly` hint otherwise, read-only names), `save`; for a participant the display-name `Input`
   (`finance.settings.household.displayName`) + save; writes gated by `useCanMutate()`.
5. `EnableFinanceDialog.tsx` (`{ open, onClose }`, same static-graph rule): `Dialog` titled
   `enableTitle` with `description`; members < 2 → `needsTwoMembers` and no submit; else the two
   selects (viewer preselected for slot 1) and the core `home.modules.enable` button.
6. `modules/finance/HomeCard.tsx` (same static-graph rule): participant → `finance.balance.title`
   with `owesYou`/`youOwe`/`settled` (viewer projection exactly as `BalanceHero` does; never a raw
   sign, F gotcha 38), `finance.balance.month.total` of the current period (transaction summary),
   `AppLink`s to `/finance` and `/finance/new` (`finance.nav.create`); non-participant →
   `notParticipantBody`; uses only `@/components/ui`, module `lib/*`, `AmountText`.
7. Any genuinely new string → `catalogs/participants.{de,en}.ts` + `NEW_GERMAN` with a reason.

**Files.** `apps/web/src/modules/finance/features/participants/{FinanceGate,NonParticipantState,
ParticipantsSection,EnableFinanceDialog}.tsx`,
`apps/web/src/modules/finance/features/participants/lib/{queries,assignment,assignment.test}.ts`,
`apps/web/src/modules/finance/HomeCard.tsx`; only if new copy:
`apps/web/src/modules/finance/catalogs/participants.{de,en}.ts`, `scripts/i18n-check.ts`.

**Acceptance.** Typecheck green; `assignment.test.ts` passes; `HomeCard.tsx`,
`ParticipantsSection.tsx`, `EnableFinanceDialog.tsx` and `lib/*` import neither `@/modules` nor
`@/components/layout` nor `PageHeader`.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/modules/finance`;
`cd H && ! grep -nE 'from "@/modules"|@/components/layout|components/PageHeader' apps/web/src/modules/finance/HomeCard.tsx apps/web/src/modules/finance/features/participants/ParticipantsSection.tsx apps/web/src/modules/finance/features/participants/EnableFinanceDialog.tsx apps/web/src/modules/finance/features/participants/lib/queries.ts`;
`LINKS_FIN`; `NOROUTER`; `NOCORE`.

---

### M3-T11 — Web wiring (core)

**Goal.** The finance module made real in the shell: the route tree with the participant gate,
the manifest, registration in `WEB_MODULES`, the core using `enableDialog` and `settingsSections`,
the manifest and persist tests.

**Read.** SPEC D2, D5, D6, D9, §2, §5; decisions 4, 7, 12, 13; H/CLAUDE.md gotchas "No module-level
constants over `WEB_MODULES`", "Persist policy comes from the manifests", "The route tree is strict,
with one hole", "A module owns its layout route…"; F/CLAUDE.md "Navigation", gotcha 9; sources
`F/apps/web/src/router.tsx` (lines 50–60 helpers, 150–260 routes), `F/apps/web/src/lib/persist.test.ts`,
`F/apps/web/src/components/layout/nav-items.ts`; H `apps/web/src/modules/recipe/{index.ts,routes.tsx,
manifest.test.ts,persist.test.ts}`, `apps/web/src/modules/{index,types,layout,persist}.ts(x)`,
`apps/web/src/route-roots.tsx`, `apps/web/src/core/features/{home/ModuleCards.tsx,home/
ManageModulesDialog.tsx,settings/SettingsPage.tsx}`.

**Work.**
1. `modules/finance/routes.tsx` (decision 13): `financeLayoutRoute`, the pathless
   `financeGateRoute`, children `/` (overview), `transactions` (`validateSearch: pick(search,
   TX_FILTER_PARAMS)`), `transactions/$transactionId`, `transactions/$transactionId/edit`, `new`,
   `plan`, `categories`, each `lazyRouteComponent(() => import(…), "<Name>")`; export
   `financeRouteTree`. Imports only `@tanstack/react-router`, `@/route-roots`, `@/modules/layout`.
2. `modules/finance/index.ts`: `financeModule = { id: "finance", nameKey: "finance.module.name",
   icon: Wallet, basePath: "/finance", route: financeRouteTree, navItems: [ { to: "/finance",
   labelKey: "finance.nav.overview", icon: Wallet, exact: true }, { to: "/finance/transactions",
   labelKey: "finance.nav.transactions", icon: List, exact: false }, { to: "/finance/new",
   labelKey: "finance.nav.create", icon: PlusCircle, exact: false } ], secondaryNavItems: [ { to:
   "/finance/plan", labelKey: "finance.nav.plan", icon: Repeat, exact: false }, { to:
   "/finance/categories", labelKey: "finance.nav.categories", icon: Tags, exact: false } ],
   homeCard: FinanceHomeCard, persistQueryAllowList: <decision 12>, persistMutationNamespaces:
   [["finance","tx"]], mutationDefaults: registerTransactionMutationDefaults, catalogs: { de:
   financeDe, en: financeEn }, settingsSections: [ParticipantsSection], enableDialog:
   EnableFinanceDialog } satisfies WebModule<"finance">` (no annotation). `modules/index.ts`:
   `[recipeModule, financeModule] as const satisfies readonly WebModule[]` (header updated).
3. `modules/types.ts`: `enableDialog?` (decision 7 doc). `ModuleCards.tsx` and
   `ManageModulesDialog.tsx`: when the module has `enableDialog`, "Aktivieren" / the switch ON opens
   it (local `useState` of the module id) instead of calling `enable.mutate`; disable unchanged.
4. `SettingsPage.tsx`: after the households card, render `settingsSections` of every build module
   enabled for the active household (`WEB_MODULES` read inside the component; `isModuleEnabled`).
5. Tests — both new files import `./index` FIRST, never `@/modules` before it:
   `modules/finance/manifest.test.ts` (three tabs + Profil at `/finance/transactions`; secondary
   Fixkosten, Kategorien, then Gruppen; the route tree contains `/finance/plan`,
   `/finance/categories`, `/finance/new`, `/finance/transactions/$transactionId/edit`;
   `mutationDefaults` registers the three `TX_MUTATION_KEYS`; `// @ts-expect-error` on `const bad:
   LinkProps["to"] = "/finance/does-not-exist";`); `modules/finance/persist.test.ts` (F
   `lib/persist.test.ts`'s finance cases through `buildPersistPolicy([financeModule])` with Table F
   keys: transactions incl. filtered lists, transaction, summary, categories, tags, plan, balance,
   participants persisted; `plan-preview`, `plan-runs`, `balance-history`, `settlements` not; a
   PAUSED `["toon","finance","tx","create"]` persisted, a settled one and a plan mutation not).
   Core tests whose fakes break on the new optional field are adjusted minimally.
6. Fix any core `<Link to>` the strict tree now rejects (listed in the commit).

**Files.** `apps/web/src/modules/finance/{index.ts,routes.tsx,manifest.test.ts,persist.test.ts}`,
`apps/web/src/modules/{index,types}.ts`, `apps/web/src/core/features/home/{ModuleCards,
ManageModulesDialog}.tsx`, `apps/web/src/core/features/settings/SettingsPage.tsx`, test fakes under
`apps/web/src/{components/layout,modules}/*.test.ts(x)` if needed.

**Acceptance.** `WEB_MODULES` holds both manifests, the tree stays strict; the finance tests pass
when run alone (no TDZ); `bun run build` emits a chunk per finance screen and the gate; the
manifest's static graph is shell-free.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/web/src/modules/finance/manifest.test.ts`;
`cd H && bun test apps/web/src/modules/finance/persist.test.ts`;
`cd H && bun test apps/web`; `cd H && bun test`; `cd H && bun run build`;
`cd H && grep -q 'financeModule' apps/web/src/modules/index.ts`;
`cd H && ! grep -nE 'from "@/modules"|@/components/layout' apps/web/src/modules/finance/index.ts apps/web/src/modules/finance/routes.tsx apps/web/src/modules/finance/HomeCard.tsx`;
`cd H && test ! -d apps/web/src/features`; `LINKS_FIN`; `NOROUTER`; `NOCORE`.

---

### M3-T12 — Integration (build)

**Goal.** Prove the exit criteria on the merged tree, then sync the docs.

**Read.** SPEC §5, §7, §8 (M3 exit); this plan §1, §5–§8; H/CLAUDE.md "Headless runs",
"`scrollbar-gutter: stable`", "Service worker", "Long commands"; M2 plan §9 (how the headless and
offline runs were done); F/CLAUDE.md "Navigation", gotchas 15, 30, 36.

**Work.**
1. Gates, each to `data/m3-t12-<gate>.log` ending `exit=$?`: `bun install --frozen-lockfile`,
   `bun run typecheck`, `bun test`, `bun run build`, `bun run i18n:check` (classify every leftover
   hit; expected: comment quotes, recipe content vocabulary, finance seed is allow-listed; a real
   German literal in finance code is a bug). Parity half OK.
2. Fresh `data/m3.db`: `db:migrate`, `seed` twice, `plan:run`. Curl walkthrough with cookie jars
   (demo, robin, kim): health (`modules: ["recipe","finance"]`); participants GET (kim:
   `viewerSlot: null`); kim on balance → 403 `finance_not_participant`; demo creates each kind
   (MINE_SPLIT, THEIRS_SPLIT, FOR_THEM, TRANSFER), the same `mutationId` twice → one row; summary;
   balance for demo and robin (negated); settlement with a stale `expectedBalanceCents` → 409
   `balance_stale`, then the right one → 201; plan GET/preview/run; category create/rename/delete
   with `reassignTo`; tag rename; PUT participants replacing robin by kim → 409
   `finance_participant_in_use`; `DELETE …/modules/finance` → 404 `module_disabled` on a finance
   route → re-enable without a body → 200, data intact.
3. Headless (Playwright in a scratch dir outside the repo, chromium, logs ending `exit=$?`; log in
   via `fetch("/api/auth/login")`; mind the login rate limit) at 390×844 and 1440×900, each in
   `colorScheme: "light"` and `"dark"`: Home (finance card), `/finance`, `/finance/transactions`,
   `/finance/transactions/$id`, `…/edit`, `/finance/new`, `/finance/plan`, `/finance/categories`,
   `/settings` (participants section) — rendered, no console errors, `scrollWidth <= clientWidth`,
   `body` background differs between light and dark. Tab bar (`nav.fixed`) at 390 inside `/finance`
   = Übersicht, Buchungen, Erfassen, Profil; sidebar at 1440 = the same + Fixkosten, Kategorien,
   Gruppen. Reachability at 390: FixedCostCard → `/finance/plan`; SpendByCategoryCard footer →
   `/finance/categories`. The "Buchen" bar on `/finance/new` at 390 sits above the tab bar
   (bounding boxes do not overlap) and books a row. As kim: every finance screen shows "Du nimmst an
   der Haushaltskasse nicht teil" naming Demo and Robin; Home's finance card shows the same line.
   Enable flow: a fresh two-member household enables finance through Home's "Aktivieren" dialog.
   Disabled module: disable finance, load `/finance` → Home with the module-disabled toast,
   re-enable via Home.
4. Offline capture on the built app (`bun run build`, `WEB_DIST_DIR=./apps/web/dist bun run start`,
   SW active): `/finance/new` offline, book a row (queued), reload offline (still queued), back
   online → replayed once (API shows exactly one row with that description).
5. Docs: `CLAUDE.md` (Status: M3 done; Layout: finance directories; Commands: `plan:run`,
   `finance:import-xlsx`; Gotchas in use: the M3 ones — finance TS prefix + aliased imports,
   participants and the gate, `start` hook, `enableDialog`, `settingsSections` rendered, finance SW
   rule, ADRs 0002 and 0003, the finance harness (decision 18), `LINKS_FIN`/`NOROUTER`/`NOCORE`/
   `NOSHADOW` greps; Obligations), `docs/SPEC.md` §2 (`start`,
   `enableDialog`) and §3 (finance layout) prose only, this plan §9 (gates, i18n classes, curl,
   headless, offline). A fix found here is its own commit naming the failing check.

**Files.** `CLAUDE.md`, `docs/SPEC.md` (§2, §3), `docs/plans/m3-finance-module.md`, and any file a
failing check requires (each fix its own commit).

**Acceptance.** Every exit criterion of §1 with evidence in §9; no `M3:` placeholder left;
CLAUDE.md names no file that does not exist.

**Verify.** `cd H && bun install --frozen-lockfile`; `cd H && bun run typecheck`; `cd H && bun test`;
`cd H && bun run build`;
`cd H && mkdir -p data && { bun run i18n:check > data/m3-t12-i18n.log 2>&1; true; } && sed -n '/1\/2 German catalog parity/{n;p;}' data/m3-t12-i18n.log | grep -qx '\[i18n:check\] OK'`;
`cd H && grep -q '## 9. Integration record' docs/plans/m3-finance-module.md`;
`cd H && grep -q 'M3 finance' CLAUDE.md`; `LINKS_FIN`; `NOROUTER`; `NOCORE`; `NOSHADOW`;
`cd H && ! grep -rn --exclude-dir=node_modules --exclude-dir=dist 'M3:' apps packages scripts --include='*.ts' --include='*.tsx'`.

## 5. Risks

1. **Flat shared barrel collisions.** A finance export colliding with a core or recipe name is a
   TS2308 error. The planner's export join found only the six tag-schema names plus F's core-copy
   names (`auth`, `health`, `households`, common duplicates), all handled by decision 8; T01's
   typecheck is the proof.
2. **Generic Zod messages change for finance.** The core resolver and wording (R's) apply to
   finance's generic validation messages (e.g. "Darf höchstens 200 Zeichen lang sein" instead of F's
   "Höchstens 200 Zeichen."); field-specific finance messages are kept through bound-suffixed keys.
   A D10 exception, recorded as ADR 0002 by T01 (decision 19).
3. **Import cycles.** The finance manifest's routers call `requireVerifiedEmail()` /
   `requireFinanceParticipant()` at module scope inside the `session.ts` → … → `modules/index.ts`
   cycle; `requireFinanceParticipant` must be a function declaration; `import-order.test.ts` runs in
   T03, T03b and T12. Web: `HomeCard`, `ParticipantsSection`, `EnableFinanceDialog` are static manifest
   imports and must stay shell-free (T10/T11 greps); `PageHeader` imports the shell and is used only
   by lazy screens and the lazy gate.
4. **Core tests that used finance as a phantom module** break once `onEnable` refuses (T03 rewrites
   them, keeping their intent, and adds the refusal test).
5. **Test DB semantics** (decision 15, ADR 0003): ledger HTTP tests run without real transactions;
   the file-DB test is the only rollback proof. If libSQL's second connection misbehaves on the
   temp file DB, T09 records the exact failure in the ADR and the test asserts the strongest
   property that holds.
6. **Participant churn vs core membership.** Removing a household member who is a finance
   participant is a core action that does not consult finance: the slot row stays (FK `restrict`
   only blocks deleting the USER), the ledger keeps working, and the leaver loses access through
   `requireHouseholdRole`. A core→module "member leaving" hook is out of M3 (§7).
7. **Typed router hooks in F screens** must all become `@/lib/nav` helpers; `NOROUTER` and
   `LINKS_FIN` are the checks, T12's clicks the backstop (string-typed links compile wrong).
8. **Port size.** T05 (20 files), T06 (21), T08 (16) are mechanical with exact tables; the API
   foundation is split into T03 (core, ~20 files: schema, migration, hooks, the participants service,
   harness, core-test edits) and T03b (build, 11 files: middleware, routes, stubs, HTTP tests) so
   that one failure does not hold every API task; the `start` hook and package scripts ride with T06,
   whose scripts use them.
9. **Seed side effects.** `seedFinanceDemo` creates two more demo users; the M2 recipe walkthrough
   and the headless scripts that count members may need their expectations updated (T12 records it).
10. **Offline capture on a stale participant cache.** A persisted `participants` query could let a
   removed participant queue writes offline; the replay then gets 403 and the outbox drops it
   (`shouldRetry` never retries a 4xx) — acceptable and documented in T12.
11. **The hidden partner.** The harness's finance-ready `createHousehold` (decision 18) adds a
   second participant that F's solo tests did not have. The planner checked every solo case: none
   books as, filters by, or counts the partner. If a ported assertion still differs, T05/T06
   report it verbatim; the fix goes into the harness (never into the test's expectation), and §10
   records it.

## 6. Deviations expected (to be confirmed in "what changed vs plan")

From SPEC §1 / D13 (each with an ADR):

- **ADR 0002** (T01) — D10 exception: finance's generic Zod validation messages render the core's
  wording; finance's field-specific messages keep their text (decisions 9, 19).
- **ADR 0003** (T09) — F gotcha 2 (ledger tests on a temp FILE DB) is replaced inside H by the shared
  `file::memory:` DB plus `finance-file-db.test.ts` (decision 15).

Plan-level choices (no ADR; SPEC §2/§3 prose updated by T12):

- Non-participants see nothing of the ledger; every ledger route answers them 403
  `finance_not_participant` (decision 3; D3 left the choice to this plan).
- `finance_fixed_cost_plans` stays a table; `finance_settings` holds only `default_locale`
  (decision 2). `finance_participants` carries `display_name` and `joined_at` (F's per-household
  name).
- `ApiModule.start` and `WebModule.enableDialog` are contract extensions (decision 7);
  `SettingsPage` now renders `settingsSections`.
- Finance TS identifiers are `finance`-prefixed and ported files import them aliased (decision 2).
- Six tag-schema exports and F's pagination schema are renamed `Finance…` (decision 8).
- F's finance error codes join the core `ERROR_CODES`; three new codes (decision 8). Two field
  messages keep their text under bound-suffixed keys with `{bound}` (decision 9; the generic
  wording is ADR 0002 above).
- F's test `createHousehold` means "finance-ready household with a hidden partner" in H; F's one
  Solo filter test runs on a directly seeded one-participant ledger under a renamed title
  (decision 18).
- `isUniqueViolation` (core) walks the cause chain (decision 16).
- Finance screens navigate through string-typed `@/lib/nav` helpers, not typed `Link` (decision 13).
- `/household` links → `/settings`; Haushalt is the shell's Gruppen item.
- The xlsx importer is ported as `finance:import-xlsx` (decision 17).
- Finance's module name is new copy ("Finanzen"); 15 web + 4 server strings are new German
  (decision 11).
- The demo seed adds `robin@toon.local` (slot 2) and `kim@toon.local` (non-participant).

## 7. Out of this milestone

The N-person ledger (D3); a core→module hook when a member leaves (risk 6); finance in Home's
module-less tab set beyond what the shell already does; the token-by-token D5 audit of the finance
screens, final Home cards, "Gruppe" vs "Haushalt" copy (M4); `migrate:legacy` and the finance part
of it incl. the balance invariant (M5); redirects from F's old paths (`/transactions`, `/new`,
`/plan`, `/categories`) for bookmarks arriving through the old-hostname redirect (M6, with the
Caddyfile); `docs/modules/finance.md`, `docs/API.md` (M7); switching the whole test suite to a
temp-file DB (ADR 0003 consequence).

## 8. Obligations

**Closed by M3** (handed on by M2, CLAUDE.md "Obligations"): finance TS identifiers prefixed (T03);
finance `onEnable` refuses a household without two participants, with the "refused enable writes
nothing" test (T03); cross-household sweep for every finance by-id route (T09); finance SW rule,
NetworkOnly before NetworkFirst (T02); `persistMutationNamespaces` next to `mutationDefaults` with
a paused-mutation persistence test (T11); the `LINKS` grep adapted to finance (`LINKS_FIN`, every
web task); finance `afterMigrate` — not needed (no data fix a SQL migration cannot express).

**F test file → H counterpart.** shared: `money`, `ledger`, `period`, `plan`, `tags`, `schemas`,
`i18n` → `packages/shared/test/finance-<same>.test.ts` (T01; `i18n`'s generic runtime cases are
covered by H's `i18n.test.ts`, said in the file), fixture `fixtures/haushalt-xlsx.ts` (T01). api:
`transactions`, `idempotency`, `balance`, `settlements`, `categories`, `tags` →
`finance-<same>.test.ts` (T05; every case kept, solo setups through the finance-ready harness
`createHousehold`, the one Solo filter test renamed "…while the ledger has only one participant"
and seeded by `createSoloFinanceHousehold`, decision 18); `plan` → `finance-plan.test.ts`, `import-haushalt` →
`finance-import-xlsx.test.ts`, `support/synthetic-workbook.ts` →
`support/finance-synthetic-workbook.ts` (T06); `households` → `finance-participants.test.ts` +
`finance-module.test.ts` (T03b and T03: the two-slot DB rule, `isUniqueViolation`, seeding); `smoke` → H
`smoke.test.ts` (health, envelope, static, `.env.example` empty `PUBLIC_API_URL` already pinned
there or added by T03) + `finance-module.test.ts` (schema, cascade, slot CHECK) + the temp-file-DB
case → `finance-file-db.test.ts` (T09, ADR 0003); `auth`, `invites` → H core `auth.test.ts`,
`households.test.ts`, `core-walkthrough.test.ts` (D4: finance's auth and seat-invites are replaced;
the "no third member" rule becomes "a third member is a non-participant", `finance-participants`
(a)); `support/harness.ts` → `support/finance-harness.ts` (T03, decision 18). web: `lib/format.test`,
`lib/queries.test`, `features/transactions/lib/offline.test` → `modules/finance/…` (T04);
`lib/persist.test` → `modules/finance/persist.test.ts` (T11) + H core `lib/persist.test.ts`;
`lib/i18n/i18n.test`, `lib/unsavedWork.test`, `lib/validation.test` → H core tests of the same
names (identical in substance; finance catalogs walked by `i18n.test.ts` through the `finance.`
prefix, T02).

**Handed on.** M4: token-by-token D5 audit of finance screens, final Home cards, dark/light in all
four combinations with screenshots. M5: `migrate:legacy` maps F's tables to Table C's names,
`household_members` → `finance_participants` (with `display_name`), `households.default_locale` →
`finance_settings`, `fixed_cost_plans` → `finance_fixed_cost_plans`, and proves the balance
invariant. M6: old-path redirects for F bookmarks. M7: `docs/modules/finance.md`, `docs/API.md`
finance section, the member-leaves hook decision (risk 6).

## 9. Integration record

Written by M3-T12 on the merged tree (`main`, 2026-10-14). Logs live under `data/` (git-ignored):
`m3-t12-{install,typecheck,test,build,i18n}.log`, `m3-t12-db.log`, `m3-t12-curl.log`,
`m3-t12-headless.log`, `m3-t12-offline.log`, `m3-t12-offline-recipe.log`; every one ends in
`exit=$?`. The scripts (curl walkthrough, Playwright 1.64 with the cached Chromium 1248) live in the
session scratch directory outside the repo; the API ran as `WEB_DIST_DIR=./apps/web/dist bun run
start` on `:3001` against a fresh `data/m3.db` (the built app, service worker active), so one
server served the curl, headless and offline runs.

### 9.1 Fixes found by the integration run (each its own commit)

| Failing check | Cause | Commit |
| --- | --- | --- |
| Offline replay, second reload while offline: a finance booking queued offline replayed after ONE reload but was gone after TWO (persisted blob after the second reload: no mutation; rows after going online: 0) | TanStack's `onlineManager` starts "online" and changes only on a browser `online` / `offline` event. A page reloaded while offline therefore believed it was online: the restored paused mutation re-ran, failed and waited in an unpaused in-memory retry, and the persist policy (paused mutations only, F gotcha 9, SPEC D9) wrote the blob again without it. `seedOnlineManager()` in `lib/query-client.ts` seeds the manager from `navigator.onLine` once at boot, with two unit tests. Trace of the persisted blob every 500 ms after the reload: `----------------` before, `QQQQQQQQQQQQQQQQ` after. The recipe shopping outbox shares the path: the M2 offline script re-run on the fixed build is still 11 of 11 | `1f314e4` |
| `grep 'M3:'` over `apps packages scripts` (acceptance: no placeholder left, and no comment still describing finance as future work) | `modules/finance/index.ts` said the ledger routers were "empty stubs until M3-T05/T06", `router.tsx` "M3 adds /finance/…", `modules/catalogs.ts` "M3 registers finance". The grep itself found nothing (no `M3:` marker survived); the three comments were reworded | `55b4ee2` |

No other product defect was found; the harness scripts needed corrections (9.9), none of them a
product change.

### 9.2 Gates (final tree)

| Gate | Result |
| --- | --- |
| `bun install --frozen-lockfile` | exit 0 (`Checked 436 installs across 625 packages (no changes)`) |
| `bun run typecheck` | `[typecheck] OK`, exit 0 (shared, api, three web projects) |
| `bun test` | 1728 pass, 0 fail, 9604 expect() calls, 95 files, exit 0 (1726 before the two `seedOnlineManager` tests) |
| `bun run build` | exit 0 (Vite build plus `dist/sw.js` and workbox) |
| `bun run i18n:check` | exit 1 by design; **parity half `[i18n:check] OK`**; leftover half 137 hits, classified in 9.4 |
| `LINKS_FIN`, `NOROUTER`, `NOCORE`, `NOSHADOW` (section 3) | all four: no match (`! grep …` succeeds) |
| `SERVERKEYS` (every `"server.…"` literal of the ported F files exists in the core catalog) | no key missing |
| `grep 'M3:'` over `apps packages scripts` (`*.ts`, `*.tsx`) | no match; `apps/web/src/features` does not exist |

### 9.3 Exit criterion: every F test file has a passing counterpart

Checked mechanically against `/home/erics/software/toon-finance` (read-only): the number of
`test(` / `it(` cases per mapped file is equal or higher in H for every pair of section 8:

| F file | H counterpart | cases F / H |
| --- | --- | --- |
| shared `money`, `ledger`, `period`, `plan`, `tags`, `schemas` | `finance-<same>.test.ts` | 15/15, 17/17, 17/17, 11/11, 3/3, 24/24 |
| shared `i18n` | `finance-i18n.test.ts` + `i18n.test.ts` | 21/31 |
| api `transactions`, `idempotency`, `balance`, `settlements`, `categories`, `tags`, `plan` | `finance-<same>.test.ts` | 9/9, 10/10, 2/2, 5/5, 5/5, 4/4, 15/15 |
| api `import-haushalt` | `finance-import-xlsx.test.ts` | 43/43 |
| api `households`, `smoke`, `auth`, `invites` | `finance-participants` + `finance-module` + core `households`, `smoke`, `auth`, `finance-file-db` | 8/46, 10/30, 12/40, 12/24 (H counts include the core's own cases) |
| web `format`, `queries`, `offline` | `modules/finance/…` | 7/7, 3/3, 5/5 |
| web `persist`, `i18n`, `unsavedWork`, `validation` | `modules/finance/persist.test.ts` + core `persist`, core `i18n`, `unsavedWork`, `validation` | 13/42, 13/17, 5/5, 6/6 |

The named cases exist and pass: `halfForOther(-101)` is `-50` (`finance-money.test.ts:24`), "a SECOND
retroactive correction of the same period books a second, distinct adjustment"
(`finance-plan.test.ts:462`), the import/plan period collision ("imported rent and the live plan
never collide", "a period covered by an IMPORT row is never given a plan adjustment";
`isPeriodBooked` is exercised through them, F has no direct test of it either) and `409
balance_stale` (`finance-settlements.test.ts:30`, and live in 9.5).

### 9.4 `i18n:check` leftover hits, all classified (137)

| Class | Count | Where |
| --- | --- | --- |
| Comment quotes of German labels or umlaut examples, recipe and core (as in M2) | 110 | unchanged from M2's 120 minus its 10 content-vocabulary lines |
| Comment quotes of German labels or toon-finance doc quotes, NEW in finance code | 17 | `AmountText.tsx` (2, a quoted CLAUDE.md sentence), `routes.tsx`, `index.ts`, `overview/lib/queries.ts`, `TransactionDetailPage`, `EditTransactionPage`, `CategorySheet`, `TransactionFormFields`, `TransactionFilters`, `TransactionList`, `TransactionsPage`, `NewTransactionPage` (2), `lib/kinds.ts` (an example sentence "…teilt 12,50 €…"), api `lib/clock.ts` (`[API-DOMÄNE]` tag), shared `tags.ts` ("überwiesen") |
| Content vocabulary (German recipe language, never through `t()`) | 10 | `IngredientsEditor.tsx:290`, `ParsedRecipeEditor.tsx:84`, `draftEdit.ts:459`, `html/entities.ts:23-29` |
| Real German UI literal in code | 0 | every hit outside the content class starts with `*`, `//`, `/**` or `{/*` (checked mechanically: 127 comment lines, 10 code lines, all 10 in recipe) |

The check was not suppressed or edited by T12; `scripts/i18n-check.ts` is unchanged. Finance's seed
content (`seed.ts`) and the xlsx importer's parsers are German on purpose and are not scanned
(`apps/api/scripts` is outside `PORTED_ROOTS`; the seed is allow-listed).

### 9.5 Fresh-DB walkthrough (`data/m3.db`)

`bun run db:migrate` exit 0 (`0000_core`, `0001_recipe`, `0002_finance`); `bun run seed` exit 0 (the
recipe data, then `[seed] finance enabled: demo = Person 1, Robin = Person 2, Kim stays a
non-participant`, `8 transactions and 1 settlement`, `Fixkostenplan from 2026-08: 3 period(s)
booked`); `bun run seed` again exit 0 (`finance ledger already present`, every recipe "already
present": idempotent); `bun run plan:run` exit 0 (`booked 0 period(s), skipped 0, 0 ct total`: the
seed's catch-up already booked everything). Curl with three cookie jars (final run,
`data/m3-t12-curl.log`, exit 0; a second POST of every transaction with the same `mutationId`):

- `GET /api/health`: `modules: ["recipe","finance"]`, features unchanged. Login 200 for demo, robin,
  kim; `GET /api/auth/me` lists `modules: ["recipe","finance"]` for "Familie" (owner demo).
- Participants: demo `viewerSlot` 1, robin 2, **kim `null`**, all three see the same two items
  ordered by slot. Kim on `balance`, `transactions`, `plan`, `categories`, `tags`, `settlements`:
  **403 `finance_not_participant`** (every method of every ledger router, plan decision 3).
- Demo creates MINE_SPLIT 1001, THEIRS_SPLIT 801, FOR_THEM 500, TRANSFER 2000: first POST **201**, the
  same body and `mutationId` again **200**, and the list holds **exactly one row per description**
  (`total` 4 for the run's tag). Projections: `payerShareCents` 501 / `otherShareCents` 500 for the odd
  cent of 1001 (the payer keeps it), `splitMode` `SPLIT_EQUAL`, `OTHER_ONLY`, `SETTLEMENT`;
  `kind=` filters return the matching row for demo and, for robin, the crossed projection (robin's
  MINE_SPLIT is demo's THEIRS_SPLIT row; FOR_THEM and TRANSFER match nothing for robin). `amountCents: 0`:
  422 `transaction_amount_zero`.
- Summary 200 (`totalExpenseCents` 181097 after the run, 3 months, 7 categories). Balance: demo
  `viewerBalanceCents` 127036, **robin −127036** (same `balanceCents`, negated for slot 2).
- Settlement with `expectedBalanceCents` 127037: **409 `balance_stale`** with
  `details.currentBalanceCents` 127036; with 127036: **201**, `splitMode` `SETTLEMENT`, balance after 0.
- Plan: GET (`enabled: true`, `startPeriod` 2026-08, `lastBookedPeriod` 2026-10, 2 items, 2 incomes,
  `pendingPeriods: []`), preview 2026-10 (cost 103000, income 560000), `POST /plan/run` 200 with nothing to
  book.
- Categories: create two (201), rename (200), delete with a booking attached and no `reassignTo`:
  **409 `category_in_use`**, with `reassignTo`: **204** and the row moved; deleting `fixkosten`: 409
  `category_system`. Tag rename 200 (`usageCount` 1).
- `PUT …/finance/participants` replacing robin by kim: **409 `finance_participant_in_use`**, participants
  unchanged.
- Module switch: `DELETE …/modules/finance` 204; `GET …/finance/balance` **404
  `module_disabled`**; `POST …/modules/finance` with **no body 200**, `transactions` total unchanged
  (19 before and after) and the two participants intact (data kept, D2).

### 9.6 Headless (Playwright 1.64, Chromium 1248, de-DE, scratch directory outside the repo; one login per user, `storageState` reused)

`data/m3-t12-headless.log`, **137 of 137 checks pass**, exit 0, on the final build:

- **Nine screens at 390x844 and 1440x900, each in `colorScheme` light and dark** (demo): Home (finance
  card), `/finance`, `/finance/transactions`, `/finance/transactions/$id`, `…/edit`, `/finance/new`,
  `/finance/plan`, `/finance/categories`, `/settings` ("Finanzen: Teilnehmende"). Every one rendered
  (no "Diese Seite gibt es nicht", the expected text present), **`scrollWidth <= clientWidth`**
  (375 <= 390 and 1425 <= 1440 because of `scrollbar-gutter: stable`), and **no console errors** in any
  of the four combinations. `body` background differs: `rgb(250, 245, 238)` light against `rgb(23, 18,
  15)` dark at both widths.
- Navigation chrome: at 390 the tab bar (`nav.fixed`) inside `/finance` is exactly **Übersicht,
  Buchungen, Erfassen, Profil** (no Fixkosten, Kategorien or Gruppen) and the sidebar is `display:
  none`; clicking each tab lands on its own path. At 1440 the sidebar (`aside[data-app-shell]`, width
  236) carries Übersicht, Buchungen, Erfassen, Profil, then Fixkosten, Kategorien, Gruppen, the tab
  bar is hidden, and each item lands on `/finance/transactions`, `/finance/new`, `/finance/plan`,
  `/finance/categories`, `/finance`, `/households`. No unprefixed finance `href` on `/finance`.
- Reachability at 390 (F "Navigation"): FixedCostCard → `/finance/plan`; the SpendByCategoryCard footer
  ("Kategorien verwalten") → `/finance/categories`.
- **"Buchen" bar above the tab bar** at 390 on `/finance/new` (button bottom 772 px <= tab bar top 783
  px, F gotcha 15); typing 12,34 and a description and tapping Buchen shows the "Gebucht." toast and
  the API holds exactly one row with amount 1234.
- **Kim (household member, not a participant)** at 390 and 1440: `/finance`, `/finance/transactions`,
  `/finance/new`, `/finance/plan`, `/finance/categories` all show "Du nimmst an der Haushaltskasse nicht
  teil" naming "Demo Koch" and "Robin", no overflow; Home's finance card shows "Die Haushaltskasse
  dieses Haushalts führen Demo Koch und Robin." and no balance. A separate probe of kim's six pages
  recorded **no 4xx response** except the pre-login `/api/auth/me` 401 (the gate never fires a ledger
  query for a non-participant).
- **Enable flow** (fresh households created through the API): a one-member household's "Aktivieren" dialog says
  "Lade zuerst jemanden ein" and offers no submit; a household with demo and kim opens "Finanzen
  aktivieren" with Platz 1 preselected as the viewer, Platz 2 = Kim, "Aktivieren" enables finance
  (participants API: demo slot 1, Kim slot 2) and `/finance` renders.
- **Disabled module**: after `DELETE …/modules/finance`, loading `/finance` redirects to Home with the
  toast "Dieses Modul ist für diesen Haushalt nicht aktiviert." (the SPA notices on the first `404
  module_disabled`, by design); Home's "Aktivieren" opens the dialog, confirming re-enables it
  (household lists `["recipe","finance"]`) and `/finance/transactions` shows the ledger with its data.

### 9.7 Offline replay on the built app

`bun run build`, `WEB_DIST_DIR=./apps/web/dist bun run start`, service worker active and controlling
the page after one reload (`data/m3-t12-offline.log`, **13 of 13 pass**, exit 0, on the build that
contains the 9.1 fix): `/finance/new` online, `context.setOffline(true)`, 7,77 EUR and a description,
Buchen: the toast "Gespeichert. Wird übertragen, sobald du online bist." appears and the form clears at
once; after the persister throttle the booking is a **paused mutation in the IndexedDB cache**; reload
while offline: the page renders from the service worker and the booking is **still in the persisted
cache** (trace `QQQQQQQQQQQQQQQQ` over 8 s); a **second** reload offline: still there; `setOffline(false)`:
the API shows **exactly one row** with that description (amount 777), still one row after settling, the
paused mutation has left the persisted cache, and no console errors other than the browser's own
offline network lines (3 ignored). Before the 9.1 fix the same script failed three checks (blob without
the mutation after reload, rows 0 after replay). The M2 recipe offline script (11 checks) was re-run
against the same build, with its household pointed at "Familie" because the seed now leaves several
households: 11 of 11 pass (`data/m3-t12-offline-recipe.log`). Risk 10 (a stale participant cache queuing
writes for a removed participant) is unchanged: the replay would get 403 and `shouldRetry` never retries
a 4xx, so the outbox drops it; not exercised.

### 9.8 Observations recorded, not fixed (M4 and later)

- The finance UI has no "N changes waiting" indicator: `finance.common.syncPending` is in the catalog
  but nothing renders it (toon-finance's shell did; H's shell has no sync badge). The only feedback for a
  queued write is the toast above. Handed to M4 (CLAUDE.md obligations).
- Risk 9 (seed side effects) came true as expected: the demo household has three members, so the
  headless counts of M2 ("1 Mitglied") read "3 Mitglieder" now; nothing else in the M2 checks depended
  on it.
- The browser logs "Failed to load resource … 404" for the expected `module_disabled` answer; the
  headless check allows exactly that line in that block and no other.

### 9.9 Corrections to the run scripts themselves (not product changes)

A first curl run was started twice against one database because a `pkill -f` matched the shell and
killed it, so the first log mixed two runs; the final log is from a fresh `data/m3.db`, one run. The
headless script needed: `getByPlaceholder` for the Betrag and Beschreibung inputs (a `getByLabel("Betrag")`
also matches the Erstattung switch), the sidebar's "Gruppen" click moved to the end (it leaves the finance
layout), and household switching done through a non-SPA page: `["toon","me"]` is persisted, so a household
created through the API after the SPA visited `/` is unknown to it, and `localStorage` `toon.activeHouseholdId`
wins over the profile's `activeHouseholdId` (an accepted invite also moves the invitee's household; three
earlier headless runs failed on a stale active household left by the run before). Both lessons are
in CLAUDE.md "Headless runs". `ls` is an alias in the user's zsh, which made `NOSHADOW`'s directory list
a one-word string; the checks were run under bash.

### 9.10 Exit criteria (section 1) against the evidence

| Criterion | Evidence |
| --- | --- |
| Gates green | 9.2 (install, typecheck, test 1728 pass, build exit 0; i18n parity OK) |
| Every F test file has a passing counterpart (map in section 8), incl. `halfForOther(-101) === -50`, the single-rounding plan share, "a SECOND retroactive correction", `isPeriodBooked`, `409 balance_stale` | 9.3 (equal or higher case counts per file; the named cases located), 9.5 (`balance_stale` live) |
| A household with three members assigns two participants and the third sees the non-participant state (API test + headless) | 9.5 (kim: `viewerSlot` null, 403 `finance_not_participant` on six routes) and 9.6 (kim's five screens and Home card); the API tests are `finance-participants.test.ts` and `finance-module.test.ts` |
| Finance screens render at 390 and 1440 in dark and light with no console errors and `scrollWidth <= clientWidth` | 9.6 (nine screens x two widths x two schemes) |
| `i18n:check` shows only classified hits | 9.4 (127 comment quotes + 10 recipe content lines, 0 real) |
| Tab bar and sidebar per F "Navigation", reachability, "Buchen" bar above the tab bar | 9.6 |
| Enable flow, `module_disabled` and non-participant states | 9.5, 9.6 |
| Offline capture queued, kept over reloads, replayed once | 9.7 (13 of 13) |
| `LINKS_FIN`, `NOROUTER`, `NOCORE`, `NOSHADOW` on the merged tree | 9.2 |
| No `M3:` placeholder left | 9.2, 9.1 |
