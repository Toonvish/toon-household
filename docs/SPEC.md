# toon-household — specification

One app for a household, built by merging `toon-recipe` (the recipe manager) and `toon-finance`
(the two-person Haushaltskasse) into a modular monorepo, with a migration of the data both apps
hold today. This document records the decisions taken on 2026-10-13 with the owner, the module
contract, the target layout, the schema mapping, the migration, the deployment and the milestones.
The workflow in `.claude/workflows/build-household.js` builds the app milestone by milestone from
this document.

The two source repositories are read-only inputs and sit next to this one:

| Source | Path | Size | What it is |
| --- | --- | --- | --- |
| toon-recipe | `/home/erics/software/toon-recipe` | ~77k lines, 26 tables | recipes, import (URL/photo/PDF), meal plan, shopping lists with offline outbox, loyalty cards, groups with roles, OAuth, mail, uploads, the 2026-09 design system |
| toon-finance | `/home/erics/software/toon-finance` | ~29k lines, 16 tables | two-person ledger in integer cents, categories, tags, Fixkostenplan, settlements, offline capture, xlsx one-off import |
| toon-edge | `/home/erics/software/toon-edge` | 3 files | the shared Caddy both apps sit behind today; retired by this project |

Both apps share one stack and one architecture: Bun 1.4 workspaces, Bun.serve + Hono, libSQL via
`@libsql/client` + `drizzle-orm/libsql`, React 19 + Vite + TanStack Router (code-based) + TanStack
Query + Tailwind v4, TypeScript 7 strict, a hand-rolled typed i18n catalog layer (de source, en
typed against it), a PWA with a persisted TanStack cache and an offline mutation outbox, one
container serving one origin. The merge is therefore mostly a *port*, not a rewrite. Each source
repo's `CLAUDE.md` holds that app's locked decisions and gotchas; **they remain binding inside the
module that inherits them**, except where §1 says otherwise.

## 1. Fixed decisions

These were taken with the owner and are not re-litigated by any agent. A deviation forced by the
code is the smallest possible one and is recorded in the plan and in `docs/adr/`.

- **D1 — Household = recipe's group model, renamed.** A household has N members with roles
  `owner > admin > member`, a user can belong to several households, and `users.active_household_id`
  persists the active one; the top bar has a household switcher. Invites, member management and
  the "content belongs to the household, not the user" rule come from `toon-recipe` decision 1
  unchanged. The recipe module's one exception (saved cards belong to the user) stays.
  Besides R's e-mail invites, a claim invite (no e-mail, naming a placeholder member) turns that
  placeholder into an account; it is redeemed only by registration (ADR 0006).
- **D2 — Modules.** The app is a core plus modules. Core: auth, users, households, members,
  invites, mail, uploads, i18n runtime, the shell, Home, Settings. Modules: `recipe` and `finance`
  now; more later. A module is a directory with a manifest on both sides of the wire (§2). **Modules
  are enabled per household**: `household_modules(household_id, module_id, enabled_at, settings)`.
  The shell hides a disabled module, its routes redirect to Home, and the API answers
  `404 module_disabled` for that household. `recipe` is enabled by default on a new household;
  `finance` is enabled when its two slots are assigned (D3) (a household migrated from a one-person
  toon-finance ledger keeps its one seat, ADR 0005).
- **D3 — Finance keeps the two-person ledger.** `toon-finance` decision 1 (exactly two people,
  `member_slot ∈ {1,2}`, symmetric `payer_id` + `split_mode`, four viewer-projected kinds, slot 1 as
  the balance anchor) is kept as is. In a household with more than two members, **the finance
  module requires two members to be designated** as finance slot 1 and slot 2
  (`finance_participants(household_id, user_id, member_slot)` with the same unique index and CHECK).
  Every other member sees the finance module as "not a participant" (read-only summary or nothing,
  decided in M3's plan). Changing a slot is an owner/admin action and is refused while the ledger
  has any transaction row, or an income naming the outgoing user (`409 finance_participant_in_use`;
  every two-person row involves both slots, so a row need not name the outgoing user, ADR 0004); a
  seated participant who leaves the household is vetoed the same way (`409 member_has_ledger`) and
  otherwise loses the seat (ADR 0004). The legacy migration re-seats a lone slot-2 participant in
  slot 1 and re-points a plan payer who is not a participant to slot 1 (ADR 0005). The N-person
  generalisation is explicitly out of scope.
- **D4 — Auth = toon-recipe's.** E-mail + password (argon2id via `Bun.password`), Google and GitHub
  OAuth with explicit linking only, the e-mail confirmation gate that follows the configured mailer,
  password reset, the signed `/uploads` URLs. Finance's auth is a strict subset and its users
  migrate with their password hashes (same algorithm, same `Bun.password` format).
  Placeholder accounts without e-mail or password exist (a household member added by name, so the
  finance ledger can name them); they cannot sign in and become accounts only through a claim
  invite redeemed by registration, in place, same id (ADR 0006).
- **D5 — Design = toon-recipe's 2026-09 design system.** Tokens (`theme.css` with its four blocks
  and 39 semantic tokens), the type scale (`--text-control`, `--text-item`, `--text-display-*`,
  `.eyebrow`), Newsreader + Figtree self-hosted in `public/fonts/`, the `components/ui` primitives,
  the 236px sidebar / 1204px content measurements, the bottom tab bar, the `ActionMenu` sheet
  pattern. Finance's screens are restyled onto that system; the new Home, the module switcher and
  the finance-participant settings are designed inside it. `docs/redesign/` of toon-recipe is the
  design record and is copied into `docs/design/recipe-redesign/` for reference.
- **D6 — Navigation = module-scoped tabs + a switcher.** Home (`/`) is a household screen with one
  card per enabled module and the household switcher. A **module switcher** in the top bar (and
  the sidebar head from `lg`) changes the active module; inside a module the phone tab bar shows
  that module's own four tabs, so each module keeps the mobile layout it was designed for:
  recipe: Rezepte `/recipe` · Plan `/recipe/plan` · Einkauf `/recipe/shopping` · Profil `/settings`;
  finance: Übersicht `/finance` · Buchungen `/finance/transactions` · Erfassen `/finance/new` ·
  Profil `/settings`. Profil is shared and is the fourth tab of every module. Each module's
  reachability rule ("everything sidebar-only must be reachable from a tab screen") carries over.
  The nav items stay catalog keys, never labels.
- **D7 — One database, ledger-grade durability.** One libSQL file, one Drizzle schema, one
  migration set. Connection pragmas: WAL + `synchronous = FULL` — toon-finance's choice wins
  because the ledger is in the file now (toon-recipe's `NORMAL` was justified by "a recipe box, not
  a ledger"). Core tables are unprefixed; module tables are prefixed `recipe_` and `finance_`
  (both apps have a `tags` table, which is the reason). The Drizzle schema is split per module
  (`db/schema/core.ts`, `modules/recipe/schema.ts`, `modules/finance/schema.ts`) and re-exported
  from one `db/schema.ts`. Timestamps stay integer unix ms; `recipe_meal_plan_entries.planned_on`
  and finance periods stay `YYYY-MM-DD` / `YYYY-MM` text, as in the sources.
- **D8 — API paths.** Core: `/api/auth`, `/api/households`, `/api/households/:householdId`
  (members, invites, modules). Module routers mount under
  `/api/households/:householdId/<module>/…` (e.g. `/api/households/:id/recipe/recipes`,
  `/api/households/:id/finance/transactions`). User-scoped module routes mount under
  `/api/<module>/…` (`/api/recipe/cards`). Error envelope, codes-as-wire-contract, list envelopes,
  PATCH semantics and the `requireSession()` / `requireHouseholdRole()` / `requireVerifiedEmail()`
  middleware chain are toon-recipe's; a fourth middleware `requireModule("finance")` answers
  `404 module_disabled`. Mount order rules of both sources (invites before `:id`, summary before
  `:transactionId`, imports and shopping before the recipe catch-all, static web last) carry over.
- **D9 — Query keys and offline.** `["toon", "household", <id>, "<module>", …]` for household data,
  `["toon", "<module>", …]` for user data. The persist allow-list (`shouldPersistQuery`) is assembled
  from the module manifests; the offline outbox rules are module-local and unchanged: recipe's
  shopping list is the one feature editable offline (`setMutationDefaults`, `offlineFirst`,
  client-minted `mutationId`), finance's transaction capture likewise (`["toon","finance","tx",…]`
  namespace, `mutation_claims`). `PERSIST_BUSTER` starts at `household-v1`. Service worker: `/api`
  and `/uploads` never cached; the `NetworkOnly` list is the union of both sources' lists.
- **D10 — i18n.** The typed catalog layer, de as the source catalog, en typed as
  `LocaleCatalog<typeof de>`; namespaces prefixed per module (`recipe.*`, `finance.*`, core
  `common.*`, `auth.*`, `household.*`, `home.*`). **Every German UI string of both apps stays
  byte-identical** (toon-recipe's refactor rule); new copy (Home, switcher, participant settings,
  module-disabled states) is the only new German. One recorded exception (ADR 0001): the core
  cannot count recipes, so `household.detail.meta` and `household.danger.warning` drop the recipe
  count and `household.count.recipes` is not ported. A second recorded exception (ADR 0002): finance's generic Zod validation messages render the core's wording; finance's field-specific validation messages keep their text. toon-recipe's `scripts/i18n-check.ts` carries
  over and gains the finance tree; finance's "typecheck is the gate" rule is subsumed. Content
  language (German recipe vocabulary, finance's stored descriptions) is a separate axis and is
  never routed through `t()`.
- **D11 — Deployment: one stack with its own Caddy, a new hostname, toon-edge retired.**
  `docker-compose.yml` has the shape toon-recipe had before toon-edge (commit `a369217^`: `app` +
  `caddy`, bridge network `toon`, volumes `toon-data`, `caddy-data`, `caddy-config`, Caddy
  `2.11.4-alpine` pinned), with the Caddyfile's hardening and `fwd` snippets taken verbatim from
  toon-edge and the recipe import timeouts kept. One `TOON_HOSTNAME` (e.g. `haushalt.<domain>`),
  `TOON_TLS_ISSUER` acme/internal as before. The Caddyfile may serve the two old hostnames as
  `redir https://{$TOON_HOSTNAME}{uri} permanent` blocks when `RECIPE_HOSTNAME` /
  `FINANCE_HOSTNAME` are set, so old bookmarks land on the new app; they are optional and removed
  after cutover. The image is published to `ghcr.io/toonvish/toon-household` by `release.yml`
  (`WITH_OCR=1 WITH_PDF=0` as toon-recipe does), deployed by `deploy.yml` + `docker/toon-deploy.sh`
  with a forced-command SSH key, as toon-recipe does. The old stacks are stopped at cutover, their
  volumes kept until the owner deletes them (`docs/deployment.md` "Cutover from toon-edge").
- **D12 — Migration = one idempotent CLI, dry-run by default.** `bun run migrate:legacy` reads the
  two old libSQL files and the recipe uploads directory and writes into the household DB (§6).
  Users are matched by `email_normalized`; every recipe group becomes a household; a finance
  household merges into the recipe group whose members include every finance member that has an
  account (placeholders do not count; they join the household as members, and a finance household
  without any account member needs `--mapping`, ADR 0006), else it becomes a household of its own; a `--mapping <file>` overrides the proposal; the CLI prints the
  full proposal and a report, and writes nothing without `--apply`. It is re-runnable: every
  written row carries a `legacy_source` + `legacy_id` pair in `legacy_ids(table, legacy_source,
  legacy_id, new_id)` and a second run skips what is already mapped.
- **D13 — Locked decisions of both sources carry over inside their module**, with these named
  changes only: finance's auth (replaced by D4), finance's `households` table (becomes the core
  `households` + `finance_participants` + `finance_settings`, D3/D7), finance's `synchronous`
  (now the whole DB's, D7), recipe's `groups` naming (→ households, D1), both apps' API prefixes
  (D8), query-key roots (D9), table names (D7), finance's chrome (D5), both nav tables (D6), the
  compose/Caddy shape (D11). Everything else in the two `CLAUDE.md` files — the OCR flags, the
  shopping-list merge rule, the fold columns, the Fixkostenplan rounding, `expectedBalanceCents`,
  the verified-e-mail gate, the service-worker rules, the four theme blocks, the sticky-bar flex
  chain — is binding for the module that inherits it.
  One recorded exception: finance's tests run on the shared memory DB and prove real
  transactions on a temp file DB instead of running the whole suite on one (ADR 0003).
- **D14 — Repository.** `github.com/Toonvish/toon-household`, public, fresh history (no subtree
  merge; the sources stay as they are), Bun workspaces with the same three workspaces
  (`packages/shared`, `apps/api`, `apps/web`) and module directories inside each (§3).
- **D15 — Docs in English**, UI copy German-first as before. toon-finance's German docs
  (`spec.md`, `ledger-spec.md`, `reference-architecture.md`) are not translated wholesale; the
  parts a module needs are ported into `docs/modules/finance.md` in English, and the originals are
  referenced by path.

## 2. Module contract

A module is a directory in each workspace plus one manifest per side. Nothing outside a module's
directories knows its tables, routes or screens except through the manifest.

```ts
// packages/shared/src/modules/registry.ts
export const MODULE_IDS = ["recipe", "finance"] as const
export type ModuleId = (typeof MODULE_IDS)[number]

// apps/api/src/modules/<id>/index.ts
export interface ApiModule {
  id: ModuleId
  householdRouter?: Hono          // mounted at /api/households/:householdId/<id>, after requireModule(id)
  userRouter?: Hono               // mounted at /api/<id> (user-scoped, e.g. recipe cards)
  schema: Record<string, Table>   // drizzle tables, all prefixed `<id>_`
  healthFeatures?(): Record<string, boolean>   // merged into /api/health features
  onHouseholdCreated?(householdId, tx): Promise<void>   // e.g. finance seeds its 21 categories
  onEnable?(householdId, settings, tx): Promise<void>   // e.g. finance validates its two participants;
                                              // `settings` is the body of the enable POST ({ settings? }), null without one
  onMemberRemoving?(householdId, userId, tx): Promise<void>   // runs in removeMember before the row is deleted; may veto
                                              // by throwing (finance: 409 member_has_ledger, D13)
  afterMigrate?(database): Promise<void>      // runs after every migrate() in runMigrations (db:migrate, seed, tests);
                                              // idempotent, no transaction; e.g. recipe's folded-column backfill
  start?(): Promise<void>                     // once at boot in index.ts, after `await dbReady`, never under test;
                                              // e.g. finance's boot catch-up and 6-hour accrual tick; a rejection is logged
  shutdown?(): Promise<void>                  // SIGTERM/SIGINT in index.ts; e.g. recipe stops its OCR worker,
                                              // finance stops the accrual tick
  seedDemo?(database, { householdId, userId, demoPassword }): Promise<void>   // the module's part of `bun run seed`,
                                              // idempotent; every login it creates uses `demoPassword`
                                              // (SEED_PASSWORD, else demo1234; plan m3b decision 17)
  uploadReferences?(database): Promise<string[]>   // every stored upload value the module's rows hold;
                                              // uploads:gc keeps a file iff the core or any module references it
}

// apps/web/src/modules/<id>/index.ts
export interface WebModule {
  id: ModuleId
  nameKey: CatalogKey             // "module.recipe.name"
  icon: LucideIcon
  basePath: `/${ModuleId}`
  route: AnyRoute                 // the module's OWN layout route at basePath (routes.tsx: component
                                  // moduleLayoutComponent(id), getParentRoute: () => householdScopedRoute,
                                  // children via addChildren; the first child is the module home)
  navItems: NavItem[]             // exactly three; the shell appends Profil. NavItem = { to, labelKey, icon,
                                  // trailing? } — `trailing` (added in M4) is a sidebar-only slot
  secondaryNavItems: NavItem[]    // sidebar-only; each must be reachable from a tab screen
  homeCard: ComponentType         // the card on Home
  persistQueryAllowList: QueryKeyPrefix[]
  mutationDefaults?(queryClient): void   // offline outbox registration, called before the persister restores
  persistMutationNamespaces?: string[][]   // key paths after "toon" whose paused mutations are persisted, e.g. ["finance","tx"]; pairs with mutationDefaults (D9; added in M0)
  catalogs: { de: NamespaceCatalog; en: LocaleCatalog<...> }
  settingsSections?: ComponentType[]     // rendered on /settings for each enabled module, after the core sections
                                         // (finance: the participants section)
  enableDialog?: ComponentType<{ open: boolean; onClose: () => void }>   // "Aktivieren" on Home / Manage modules opens
                                         // it instead of one direct POST; it calls enableModule(householdId, id, settings)
                                         // (finance: pick the two participants, D3)
}
```

Rules:

- The core imports a module only through `apps/*/src/modules/index.ts`, which lists the manifests.
  A module never imports from another module's directory (toon-finance's `WEB-TX`/`WEB-SALDO` rule,
  generalised). Shared logic goes to `packages/shared/src/core` or stays inside the module's own
  `packages/shared/src/modules/<id>`.
- Hooks added after M0 (recorded here because the contract is this section): `afterMigrate`,
  `shutdown`, `seedDemo` and `uploadReferences` on the API side (M2) and `start` (M3), `persistMutationNamespaces`
  (M0), the module-owned `route` (M2; it replaced `routes: AnyRoute[]`, which could not reach its layout parent
  without importing `router.tsx`) and `enableDialog` (M3) on the web side. `settingsSections` was declared in M0
  and is rendered by `SettingsPage` since M3. The core reads `API_MODULES` /
  `WEB_MODULES` inside functions only, because several services sit in an import cycle with the
  registry (`session.ts` → `auth/users.ts` → `households/modules.ts` → `modules/index.ts` → a
  manifest → its routers → `session.ts`; `import-order.test.ts` loads each real entry point first in
  a fresh process).
- `NavItem.trailing?: ComponentType<{ isActive: boolean }>` (M4) is a SIDEBAR-ONLY slot: `SideNav`
  renders it at the end of the item's row (`ml-auto`), the phone tab bar ignores it. It carries what
  toon-recipe drew in its sidebar and the core cannot compute because it cannot count a module's rows
  (ADR 0001): the recipe manifest gives Rezepte the household's recipe count, Plan the "Neu" pill and
  Einkauf the summed open items of the shopping lists (nothing while any list's count is unknown, never
  a flashing `0`); finance declares none. The components live in the module's `nav-trailing.tsx`, a
  static manifest import, so they obey the shell-free graph rule below.
- Module routers do NOT apply `requireSession()` or `requireHouseholdRole("member")`: `mountModules`
  already ran them (plus `requireModule(id)`) for a `householdRouter`. A module router adds
  `requireVerifiedEmail()` itself and `requireHouseholdRole("admin")` on a route that needs it; a
  `userRouter` runs `requireSession()` itself and is not behind `requireModule` (a user-owned row,
  e.g. a recipe card, follows its owner, not a household). A module may narrow access further with its
  own middleware: finance's `requireFinanceParticipant()` (every ledger router, every method) answers a
  household member without one of the two slots `403 finance_not_participant`, and carries the participant
  in a module-local `ContextVariableMap` augmentation, so the core's `AppVariables` stays module-free.
  The only finance route a non-participant reaches is `GET …/finance/participants`.
- A module's web manifest must keep its static import graph free of the shell and the registry:
  `modules/<id>/index.ts`, `routes.tsx`, `HomeCard.tsx` and the catalogs import neither `@/modules`
  nor `@/components/layout`, and every screen in `routes.tsx` is a `lazyRouteComponent`. Otherwise
  the registry re-enters a manifest that is still evaluating (a TDZ `ReferenceError` the moment a
  test imports the manifest first). The shell-free roots of the route tree live in
  `apps/web/src/route-roots.tsx`; `AppLayout` (`RequireAuth` + the shell) is attached to `appRoute`
  in `router.tsx` with `appRoute.update`.
- `requireModule(id)` runs after `requireHouseholdRole("member")` and reads
  `household_modules`; the web shell reads `household.modules` from `GET /api/households/:id`
  (and from `/api/auth/me`, which is persisted).
- A `household_modules` row IS the enabled state. `POST` / `DELETE
  /api/households/:householdId/modules/:moduleId` (owner/admin, verified e-mail) upsert or delete
  it; disabling keeps the module's own data, so enabling again brings it back. The build module's
  `onEnable` runs before the row is written and may refuse by throwing an `ApiError`. Every new
  household gets a row per `DEFAULT_ENABLED_MODULES` (`recipe`) through `initializeHousehold`, and
  each build module's `onHouseholdCreated` runs after it.
- A module's drizzle migration is a normal file in `apps/api/drizzle/`; the module prefix is the
  namespace. There is one migration journal.
- `/api/health` reports `modules: ["recipe", "finance"]` (the build's modules) and the merged
  `features` map; the UI treats an unknown module in the household's enabled set as disabled.

## 3. Target repository layout

```
package.json             workspaces apps/*, packages/*; scripts: dev, build, start, test, typecheck,
                         i18n:check, db:generate, db:migrate, db:studio, seed, migrate:legacy,
                         auth:reset-password, uploads:gc, plan:run, finance:import-xlsx
scripts/                 dev.ts, typecheck.ts, i18n-check.ts (both from toon-recipe, extended)
packages/shared/src/
  core/                  i18n runtime + server catalogs, schemas for auth/households/modules, calendar.ts,
                         text.ts (foldText, FOLD_PAIRS), http url schema, the list envelope
  modules/registry.ts
  modules/recipe/        units, ingredients, numbers, duration, tags, shopping.ts, barcode.ts, qr.ts,
                         schemas/{recipe,plan,import,shopping,card}.ts, index.ts barrel
  modules/finance/       money.ts, ledger.ts, period.ts, plan.ts, categories.ts, tags.ts,
                         schemas/{common,transactions,categories,tags,plan,balance,settlements,participants}.ts,
                         index.ts barrel (finance tag schemas and pagination are exported as Finance…)
apps/api/src/
  index.ts               wiring: health, uploads, /api/auth, /api/households, module mounts, staticWeb LAST
  env.ts  db/{client,migrate,schema.ts,schema/core.ts}
  lib/  middleware/{session,household,verifiedEmail,module,staticWeb,originGuard,securityHeaders}.ts
                         (originGuard: the CSRF defence on unsafe /api/* methods, trusts WEB_ORIGIN, mounted
                         after cors() and before the routers; securityHeaders: the CSP hashed over the built
                         index.html, nosniff, frame denial, no HSTS; plan m3b decisions 15 and 16)
  core/routes/{auth,households,members,invites,modules}.ts  core/services/{auth,households,mail,media}/
                         (members/invites/modules export register…Routes(router) onto the one
                         householdRoutes instance, invite-token routes first; /uploads is inline in index.ts)
  modules/index.ts
  modules/recipe/{index.ts,schema.ts,migrate.ts,seed.ts,routes/,services/}
                         routes: recipes (+ tags, collections), imports, shopping, cards, plan; services/ mirrors
                         toon-recipe's services/ (recipes, import, ocr, plan, shopping, cards)
  modules/finance/{index.ts,schema.ts,middleware.ts,setup.ts,seed.ts,lib/clock.ts,routes/,services/}
                         routes: participants, transactions, categories, tags, plan, balance, settlements;
                         services/ mirrors toon-finance's (ledger, categories, tags, plan) plus participants/
                         (replaces household_members, D3), settings/ (finance_settings) and support.ts; tables
                         are `finance_*` and their TS identifiers carry a `finance` prefix
apps/api/scripts/        migrate, seed, reset-password, uploads-gc, plan-run, finance-import-xlsx.ts + finance-import/,
                         migrate-legacy.ts (the CLI), legacy/{types,sources,ledger,copy,report,users,mapping,
                         households,recipe,uploads,finance,claims,balance,run}.ts (the library; not a module hook, §6;
                         claims.ts creates or reuses the claim invite of each migrated placeholder, ADR 0006)
                         (seed and uploads-gc only call the manifests' seedDemo / uploadReferences hooks)
apps/api/test/           all api tests (test/, never tests/)
apps/api/drizzle/        one journal
apps/web/src/
  route-roots.tsx        rootRoute, appRoute (no component), householdScopedRoute: the shell-free roots a module's
                         routes.tsx imports as its parent (no @/modules, no layout import)
  router.tsx             attaches AppLayout to appRoute, then app layout → household-scoped layout → Home,
                         Settings, and each manifest's `route` (WEB_MODULES.map((m) => m.route))
  lib/                   api.ts (the ONLY fetch), queries.ts, session.tsx (RequireAuth, RequireActiveHousehold,
                         RequireModule), persist.ts, pwa.ts, unsavedWork.ts, nav.tsx, permissions.ts,
                         share.ts, i18n/
  components/ui/         toon-recipe's primitives, the ONLY primitives
  components/layout/     AppShell, BottomTabBar, SideNav, ModuleSwitcher, HouseholdSwitcher, nav-items.ts
  core/features/{auth,home,households,settings}/
  modules/index.ts       (+ catalogs.ts, persist.ts, enabled.ts: moduleGuard, layout.tsx: moduleLayoutComponent)
  modules/recipe/{index.ts,routes.tsx,HomeCard.tsx,features/,catalogs/,lib/}
                         lib/{api,queries,format}.ts are shims: `export * from "@/lib/<x>"` plus the module's own
                         fetchers, query keys/options and formatters (the core lib stays module-free)
  modules/finance/{index.ts,routes.tsx,HomeCard.tsx,features/,components/,catalogs/,lib/}
                         features/{transactions,overview,plan,categories,participants}/ (participants is new:
                         FinanceGate, NonParticipantState, ParticipantsSection, EnableFinanceDialog,
                         PlaceholderForm, ClaimLinkDialog); components/{AmountText,KindBadge,PeriodLabel,
                         PageHeader,PendingSyncNote}; lib/ shims like recipe's plus quick-add.tsx (the Erfassen
                         sheet's provider, module-local, no FAB: D6 stands)
  styles/{index.css,theme.css}   toon-recipe's, unchanged except new tokens in all four blocks
  public/fonts/          Newsreader + Figtree woff2 + licences
docker/                  Caddyfile, entrypoint.sh, env.example, toon-deploy.sh
docker-compose.yml  Dockerfile  .github/workflows/{ci,release,deploy}.yml
docs/                    SPEC.md (this), API.md, deployment.md, i18n.md, migration.md, modules/{recipe,finance}.md,
                         design/recipe-redesign/ (copied record), plans/, adr/
```

## 4. Schema mapping

Core (from toon-recipe unless noted):

| New table | From | Notes |
| --- | --- | --- |
| `users` | recipe `users` ∪ finance `users` | matched by `email_normalized`; `active_group_id` → `active_household_id`; finance-only users get `email_verified_at = NULL` (read-only until confirmed, the same honest rule toon-recipe applies to pre-flow accounts); a finance placeholder (no e-mail, no password) becomes a placeholder user with a NULL e-mail, never matched by e-mail (ADR 0006) |
| `oauth_accounts`, `sessions`, `password_reset_tokens`, `email_verification_tokens` | recipe | sessions are **not** migrated (everyone logs in again) |
| `households` | recipe `groups` (+ finance `households` that do not merge) | `name`, `created_by`, timestamps; finance `default_locale` → `finance_settings` |
| `household_members` | recipe `group_members` (+ finance `household_members`) | role; finance members join as `member` unless they created the household |
| `household_invites` | recipe `group_invites` (+ one claim invite per migrated placeholder) | finance `invites` are not migrated (a finance invite is a seat, which D3 models differently), except a still-pending claim invite of a migrated placeholder; a placeholder without one gets a fresh claim invite (ADR 0006) |
| `household_modules` | new | `recipe` enabled for every migrated group; `finance` enabled where a finance household merged or became one |
| `legacy_ids` | new | `(table, legacy_source, legacy_id) → new_id`, the idempotency ledger of the migration |

Recipe module: every recipe table keeps its columns and gains the prefix; `group_id` → `household_id`.
`recipes`, `recipe_ingredients`, `recipe_steps`, `tags` → `recipe_tags`, `recipe_tags` →
`recipe_recipe_tags`, `collections`, `collection_recipes`, `meal_plan_entries`, `recipe_cook_log`,
`import_drafts`, `shopping_lists`, `shopping_list_items`, `shopping_list_catalog`,
`shopping_bought_items`, `shopping_list_recipes`, `shopping_mutations`, `cards` — all `recipe_*`.
Uploads are copied file by file (originals and `.thumb.webp` derivatives); signed URLs are minted at
read time, so no stored URL needs rewriting beyond the `normalizeStoredUploadUrl` path prefix.

Finance module: `household_id` → the merged household's id; `member_slot` keeps its meaning.
`household_members` → `finance_participants` (slot 1/2 by user id); `households.default_locale` +
the plan's `start_period` etc. → `finance_settings`; `categories`, `tags`, `transaction_tags`,
`transactions`, `mutation_claims`, `fixed_cost_items`, `incomes`, `fixed_cost_plans`,
`accrual_runs` → `finance_*`. `transactions.external_key` uniqueness stays
`(household_id, external_key)`.

## 5. Shell, Home and navigation

- **Home** (`/`): the household name, the household switcher, one `homeCard` per enabled module, a
  "Module verwalten" link for owners/admins. An empty household shows the enable-module cards. The
  cards as built (M4): recipe is the module name, a compact read-only week strip (seven day cells with
  today marked and up to three dots per planned day, plus the next planned titles; `HomeWeekStrip`, not
  the planner's `WeekStrip`) and the active shopping list with its open-item count (the first list in
  the order `/recipe/shopping` shows; a plain "Einkauf" button when there is none); finance is the
  module name, the viewer-projected balance sentence (`viewerBalanceCents`, never a raw sign) with its
  amount, this period's spend, and Finanzen / Erfassen links, or for a household member without a slot
  the one line naming the two participants. Cards reuse existing catalog keys only; recipe titles and
  list names are content, never `t()`, and never truncated.
- **Module switcher**: an `ActionMenu` sheet (its `renderTrigger` is the labelled chip, the active
  module is its `current` row with a check mark) from the module chip in the screen's `PhoneHeaderRow`
  on phones; a segmented group at the head of the sidebar from `lg`. There is no global top bar: every
  shell screen renders its own `PhoneHeaderRow` (household chip, module chip, at most one action), the
  recipe detail excepted (its hero owns the top edge). The active module is the URL prefix; Home and
  Settings are module-less.
- **Tab bar**: `NAV_ITEMS` is computed from the active module's `navItems` + the shared Profil
  item; outside a module (Home, Settings) it shows Home · the enabled modules (max two) · Profil.
- **Settings** (`/settings`): recipe's profile/language/theme/e-mail cards, the households card
  (`GroupsCard` renamed), and each enabled module's `settingsSections` — finance's is the
  participant assignment (D3).
- **Offline outbox note** (finance, M4): while paused finance writes are queued (mutation key prefix
  `["toon","finance","tx"]`), the finance gate shows one slim `role="status"` line above the screen,
  "1 Änderung wartet auf Übertragung." / "{count} Änderungen warten auf Übertragung."; nothing at
  zero. It is module-local on purpose: the core cannot know a module's mutation namespaces, and
  recipe's shopping list shows its own count. The shell has no global sync badge.
- **Module disabled**: a module route for a household without that module redirects to Home with a
  toast; a persisted PWA with a stale bundle gets `404 module_disabled` from the API and renders the
  same state.
- Every reachability rule of both sources holds: finance's `FixedCostCard` on `/finance`,
  recipe's library `+` sheet, `CardsCard` on `/recipe/shopping`, the filter links to collections
  and tags.

## 6. Migration CLI

`apps/api/scripts/migrate-legacy.ts`, run as `bun run migrate:legacy -- --recipe-db <file>
--recipe-uploads <dir> --finance-db <file> [--mapping <json>] [--apply] [--report <file>]`. At least one of
`--recipe-db` and `--finance-db` is required. The legacy migrators are not part of the module contract (§2):
the two legacy schemas are historical inputs of two specific apps, so the library sits in
`apps/api/scripts/legacy/` and stays out of the server's import graph. The operator's guide is
`docs/migration.md`; the plan with the decisions is `docs/plans/m5-migration.md`.

The target is `DATABASE_URL` (a local `file:` URL, from the process environment or the root `.env`; a
remote one is refused) and the upload target is `UPLOAD_DIR` (default `./data/uploads`); relative paths,
inputs included, resolve against the repository root. Exit codes: `0` success, `1` the run found errors
(balance, failed insert, upload conflict, an unconfirmed target account), `2` usage, mapping or input
error, detected before anything is written.

1. **Load** both legacy DBs read-only (`@libsql/client` over `file:` URLs; never `bun:sqlite`). The
   inputs are never opened in place: each file and its `-wal` (never `-shm`) is copied into a scratch
   directory and the copy is opened with `PRAGMA query_only = 1`, so the operator's files are
   byte-identical after any run. A schema gate refuses (exit 2) a database that is not at the last
   migration of its source (recipe: 9, finance: 3, the last being F's `0002_placeholder_members`,
   ADR 0006).
2. **Users**: union by `email_normalized`. A collision keeps the recipe row's id and password hash
   (recipe has OAuth links and the verified timestamp; finance's hash is only used when recipe has
   none, i.e. the user existed only in finance). A recipe account without a password (OAuth-only)
   stays without one: finance never verified addresses, so carrying its hash would let whoever
   registered that address in finance sign into the OAuth account. Report every collision. A legacy
   id already taken in the target or by an earlier user of the same run gets a fresh UUID. A legacy
   user whose e-mail matches an account already in the target is mapped onto it only when that
   account is confirmed (`email_verified_at` set); an unconfirmed one is an error (D4: no
   auto-linking). A finance user without a password hash is a placeholder (its e-mail must be NULL
   too, else an error) and migrates as its own placeholder user with a NULL e-mail, never grouped
   or matched by e-mail; household matching (step 3) counts only the members with an account, a
   placeholder joins the target household as `member`, and a finance household whose members are
   all placeholders is the `no-account-members` error unless `--mapping` names its target (ADR 0006).
3. **Households**: every recipe group → household (same id). For every finance household H with
   members {a, b}: if exactly one recipe group G contains both a and b, H merges into G; if several,
   the one with the most recipes (then the oldest, then the lowest id); if none, H becomes a new
   household with a and b as members (the creator as owner). A group takes at most one finance
   household (a second one becomes new, `group-taken`); a finance household without members is
   skipped (`no-members`). The proposal is printed as a table and can be overridden by
   `--mapping` (`{"finance": {"<H.id>": "<G.id>" | "new"}}`, legacy ids; validated before anything is
   written).
4. **Modules**: `recipe` enabled on every household that came from a group; `finance` enabled on
   every household that received a finance household, with `finance_participants` from
   `member_slot`; a one-member finance household keeps one seat, in slot 1 (ADR 0005). The migration
   writes these rows directly and does not call `onHouseholdCreated` or `onEnable`. A plan payer who
   is not a participant is re-pointed to slot 1 and an income naming a non-participant is kept, each
   with a warning (ADR 0005).
5. **Rows**: module migrators copy tables in dependency order with `legacy_ids` lookups, chunked in
   transactions of 500 rows, idempotent on `(table, legacy_source, legacy_id)`; the ledger entry is
   written in the same batch as its row and a mapped row is never updated afterwards. Uploads are copied
   with `cp`-like semantics (skip existing, verify size; a different size is an error, never an
   overwrite). R's password-reset and e-mail verification tokens are copied; sessions, finance
   invites (except claim invites: each migrated placeholder gets exactly one pending claim invite,
   its still-pending legacy one or a fresh one, ADR 0006) and finance reset tokens are not (§9).
6. **Report**: counts per table, collisions, merge decisions, skipped rows with reasons, and the
   finance balance per household before and after (the ledger invariant: the migrated balance equals
   the legacy balance to the cent, or the run fails; checked from the perspective of the legacy user
   who holds slot 1 in the target, with the transaction count and the amount sum). A section
   `== Placeholders and claim invites ==` lists each placeholder, its target household and slot and
   its claim invite state; the claim link appears only in an `--apply` run's real pass (stdout and
   the `--report` JSON), which makes that report a credential (ADR 0006).
7. Dry-run is the default; it runs the whole pipeline against a scratch copy of the target (uploads are
   only counted), so its report is real and nothing is written, not even the database file. `--apply`
   repeats that pass first, writes only when it is clean, and re-checks the balances after the real
   pass. A second `--apply` run against the same inputs writes nothing and reports "already migrated".

Cutover order (`docs/deployment.md`): stop both old stacks (`docker compose down` without `-v`),
copy `toon-recipe_toon-data` and `toon-finance_toon-data` out of their volumes, run the dry-run,
read the report, run `--apply` into the new stack's volume, start the new stack, verify both sites
redirect and the new site serves, then remove the old stacks and toon-edge.

## 7. Verification gates

All must be clean before anything is called done:

```bash
bun install
bun run typecheck     # packages/shared, apps/api, apps/web (three web tsconfigs, as in toon-recipe)
bun test              # api + shared + web unit tests; the migration has fixture-based tests
bun run build         # vite build + PWA
bun run i18n:check    # parity + leftover-German, read its output not its exit code
```

Plus, for persistence or auth: `bun run db:migrate` and `bun run seed` against a fresh `file:` DB and
the curl walkthrough; for the migration: `bun run migrate:legacy` against the fixture DBs in
`apps/api/test/fixtures/legacy/` (small anonymised copies of both schemas with the collision and
merge cases, rebuilt by `build.ts` and checked with `build.ts --check`) and against real copies of the owner's data; for the Dockerfile, compose or
`staticWeb`: build the image to a log file and run the stack with `TOON_TLS_ISSUER=internal`.
Phone layouts (390px) and desktop (1440px) are verified in a headless browser installed in a scratch
directory outside the repo, as toon-recipe's CLAUDE.md describes.

## 8. Milestones

| # | Name | Goal | Exit |
| --- | --- | --- | --- |
| M0 | scaffold | The monorepo skeleton: package.json, the three workspaces, tsconfigs, scripts, `styles/`, `public/fonts/`, `components/ui`, the i18n runtime, env, db client with D7 pragmas, migrate, health, staticWeb, empty module registry on both sides, CLAUDE.md, CI. Everything copied from toon-recipe is copied verbatim where D13 allows. | the five gates green on an app that boots, serves `/api/health` with `modules: []` and renders an empty shell |
| M1 | core | Auth (D4), households (D1: tables, routes, services, invites, switcher, settings cards), `household_modules` + `requireModule` + the manifests (§2), Home and the module switcher shell (§5) with no module yet, the persist/outbox plumbing assembled from manifests (D9). | gates green; a user can register, create a household, invite, switch; `/api/households/:id` reports modules; Home renders the empty state |
| M2 | recipe module | Port every recipe feature into `modules/recipe` (§3) with the prefixed tables and the new paths: recipes, tags, collections, import (URL/photo/PDF, flags, OCR subprocesses), meal plan + cook log, shopping lists with the offline outbox, cards, uploads + thumbnails. All recipe tests ported and green. | gates green; every toon-recipe `test/` file has a counterpart; the recipe tabs work at 390px and 1440px; the SW rules are in place |
| M3 | finance module | Port finance into `modules/finance` with `finance_participants` (D3), restyled onto D5: transactions, categories, tags, Fixkostenplan + `plan:run`, balance, settlements, offline capture; the participant settings section; `module_disabled` and non-participant states. | gates green; every toon-finance `test/` file has a counterpart; `halfForOther`, the plan rounding and `balance_stale` tests pass unchanged; screens verified at 390/1440 |
| M3b | finance-sync | Follow-up port of toon-finance `cbdec67..1715207` (the checkout M3 was ported from was seven commits behind production): placeholder members and claim invites (nullable `users.email`/`password_hash`, `household_invites.claims_user_id`, claim redeemed only by `register`), the security- and redesign-review fixes, the "Erfassen" sheet and the typography alignment (behaviour and copy; D5 keeps the tokens), the migration's finance gate at 3 migrations and the placeholder rule (a placeholder user migrates as a placeholder plus one pending claim invite, ADR 0006). Deploy tooling from those commits goes to M6. | gates green; every toon-finance test file at `1715207` has a counterpart; the dry run against the owner's real backups exits 0 with the balance OK; a second `--apply` writes nothing; the changed screens verified at 390/1440 |
| M4 | design pass | Home cards with real data, the switcher, the module-less tab bar, finance screens checked token by token against D5 (no arbitrary `text-[…px]`, the four theme blocks complete, `.eyebrow`, sticky bars with `bottom-tabbar`), print.css, the PWA manifest/icons for the household app, dark/light in all four combinations. | screenshots at 390/1440 in `docs/plans/screenshots/m4/`; `scrollWidth === clientWidth` on every screen; no `fonts.googleapis` |
| M5 | migration | `migrate:legacy` (§6) with its fixtures, the `legacy_ids` ledger, the report, the balance invariant, `docs/migration.md`. | dry-run and apply against the fixtures and against copies of the owner's data produce the report; a second apply writes nothing; the balance invariant holds |
| M6 | deploy | Dockerfile (OCR args), compose with Caddy (D11), Caddyfile, env.example, entrypoint, toon-deploy.sh, ci/release/deploy workflows, `docs/deployment.md` with the cutover from toon-edge and the old-hostname redirects. | image builds from a log file with exit 0; the local stack serves the PWA under `TOON_TLS_ISSUER=internal`; `caddy validate` passes with and without the old hostnames set |
| M7 | harden | Review findings, CLAUDE.md as built, `docs/API.md`, `docs/modules/*.md`, ADRs for every deviation, `docs/open-work.md`. | gates green on the final tree; CLAUDE.md describes what exists |

Milestones are sequential. Inside a milestone, tasks run in dependency waves on separate branches
when they touch disjoint files (M2 and M3 are mostly file moves that parallelise well), and
sequentially on main otherwise.

## 9. Out of scope

The N-person ledger (D3), path-prefix routing (toon-edge's warning stands), React Native, a second
web server, migrating sessions or finance invites (claim invites of placeholders excepted, ADR 0006),
translating the finance specs wholesale, keeping toon-edge, new recipe or finance features that
neither source has today.
