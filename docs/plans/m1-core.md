# M1 — core: plan

Milestone M1 of `docs/SPEC.md` §8. Written 2026-10-13 by the planner of the `build-household`
workflow; revised the same day after plan review (grep verifies that matched existing lines,
the T07 helper imports, T08 split, T09 deps, the module-guard check). Paths: `H` = `/home/erics/software/toon-household` (this repo), `R` =
`/home/erics/software/toon-recipe`, `F` = `/home/erics/software/toon-finance` (both READ-ONLY;
never run `bun install`, `bun test` or any script inside them).

## 1. Context

State of `H` at plan time (`a5ee321`, M0 closed): the three workspaces build, `bun run typecheck`
is OK, `bun test` passes 214 tests in 16 files, `bun run i18n:check` parity half OK (leftover half:
11 comment-quote hits). There are no modules (`API_MODULES` / `WEB_MODULES` empty), no auth routes
or screens, no `/uploads` route, no household routes, no `lib/session.tsx`. What M0 already
ported and M1 builds on:

- shared: `core/schemas/{common,user,household}.ts` (`user.ts` is R's with `activeHouseholdId` and
  `RegisterRequestSchema.householdName`; `household.ts` holds ONLY `HouseholdRoleSchema`,
  `InvitableRoleSchema`, `ROLE_RANK`, `roleAtLeast`), `modules/registry.ts` (`MODULE_IDS`,
  `ModuleId`, `isModuleId`), the server catalog (complete copy of R's, incl. `server.group.*`).
- api: `db/schema/core.ts` (all core tables incl. `household_modules(household_id, module_id,
  enabled_at, settings)` with PK (household_id, module_id)), `lib/*` (cookies, errors, http, locale,
  oauth, timingSafe, types with `Membership`, uploadUrls), `middleware/{session,household,module,
  verifiedEmail,staticWeb}.ts`, `modules/{index,types,mount}.ts`,
  `core/services/auth/{sessions,users,verifiedEmail}.ts` (`users.ts` has `createOwnedHousehold`,
  `setActiveHousehold`, `DEFAULT_HOUSEHOLD_NAME = "Meine Rezepte"`), `core/services/mail/*`.
- web: `components/ui/*` (26 files), `components/layout/{AppShell,BottomTabBar,SideNav,nav-items,
  use-nav-items,…}`, `core/features/home/HomePage.tsx` (placeholder), `lib/{api,queries,
  query-client,persist,storage,navigation,…}.ts`, `lib/i18n/catalogs/{common,home}.{de,en}.ts`,
  `modules/{index,catalogs,persist,types}.ts`, `router.tsx` (root → pathless `app` → `/` + one
  layout per module), `app.tsx` (mutationDefaults + `buildPersistPolicy(WEB_MODULES)` +
  `PERSIST_BUSTER = "household-v1"` already wired).

Goal (SPEC §8 M1; D1, D2, D4, D8, D9, §2, §5): auth ported from R (routes, services, OAuth, the
e-mail confirmation gate, password reset, mail transports already present, the signed `/uploads`
route and the media services); households ported from R's groups (services, routes, invites,
member roles, active household, the HouseholdSwitcher, the households card on `/settings`, the
settings screen with profile/language/theme/e-mail cards); `household_modules` with
`requireModule(id)`, `GET /api/households/:id` reporting modules, `POST`/`DELETE
/api/households/:id/modules/:moduleId` for owners/admins; the shell: Home with the enable-module
empty state, the ModuleSwitcher (ActionMenu sheet on phones, segmented group in the sidebar from
`lg`), the tab bar computed from the active module or the module-less set, `RequireModule`; the
auth, households and settings tests ported.

Exit criteria: the five gates green (SPEC §7); register, log in, create a household, invite and
accept, switch household, enable and disable a module over the API all work in the curl
walkthrough AND in tests; Home renders the empty state at 390 px and 1440 px; `GET
/api/households/:id` returns `modules`; a route under a disabled module redirects to Home —
proved without a DOM by two executable checks: the pure decision `moduleGuard(enabledIds, id)`
(T05, `modules/enabled.test.ts`) and the module layout factory test showing every module layout
renders `<RequireModule moduleId>` around its `<Outlet/>` (T10, `modules/layout.test.tsx`); no
module route exists in M1, see §3 risk 6.

### Decisions this plan takes (binding for the tasks below)

1. **Wire contract (T01).** R's `GroupSchema` family is renamed, never aliased:
   `Household`, `HouseholdWithRole`, `HouseholdMember`, `HouseholdInvite`, `InviteStatus`,
   `CreateHouseholdRequest`, `UpdateHouseholdRequest`, `CreateInviteRequest`,
   `UpdateMemberRoleRequest`, `AcceptInviteRequest`, `HouseholdResponse`, `HouseholdListResponse`,
   `HouseholdDetailResponse {household, members}`, `HouseholdMemberResponse`,
   `HouseholdMemberListResponse`, `HouseholdInviteResponse`, `HouseholdInviteListResponse`,
   `InvitePreviewResponse` (field `groupName` → `householdName`), `AcceptInviteResponse
   {household, member}` (each with its `…Schema`). Member and invite DTOs: `groupId` →
   `householdId`. `AuthSessionResponse` / `MeResponse` = `{ user, households, activeHouseholdId }`.
2. **`HouseholdWithRole` drops `recipeCount` and gains `modules: string[]`** — the ids of the
   household's `household_modules` rows that `isModuleId()` accepts, in `MODULE_IDS` order. The core
   cannot count a module's rows (SPEC §2), and `/api/auth/me` (persisted, so offline-readable)
   therefore carries the enabled modules for the shell. Typed `string[]` on the wire like
   `HealthResponse.modules` (an old client tolerates a newer server); the web filters by
   `WEB_MODULES` (SPEC §2 "an unknown module reads as disabled").
3. **Module enabling.** `DEFAULT_ENABLED_MODULES: readonly ModuleId[] = ["recipe"]` and
   `ModuleIdSchema = z.enum(MODULE_IDS)` live in `packages/shared/src/modules/registry.ts`. Every new
   household (register, OAuth sign-up, `POST /api/households`, seed) gets one `household_modules` row
   per default module and then each build module's `onHouseholdCreated` hook runs, via ONE function
   `initializeHousehold(db, householdId, modules = API_MODULES)` in
   `apps/api/src/core/services/households/modules.ts`. The row is written even when the build lacks
   the module (M1 builds none): the UI filters, and M2 needs no backfill.
   `POST /api/households/:householdId/modules/:moduleId` (admin, verified e-mail) accepts any
   `MODULE_IDS` id (else `404 not_found`), body optional `{ settings?: object }`, runs the build
   module's `onEnable(householdId, settings, tx)` if the build has it (a thrown `ApiError` aborts,
   nothing written), upserts the row (keeps `enabled_at`, replaces `settings` only when sent, stored
   as JSON text) and answers `200 { household: HouseholdWithRole }`. `DELETE …/modules/:moduleId`
   (admin, verified e-mail) deletes the row (idempotent, `204`); module data stays in its tables.
4. **Routes split per SPEC §3 without sub-apps.** `core/routes/households.ts` owns the ONE Hono
   instance `householdRoutes` (mounted at `/api/households`); `core/routes/invites.ts`,
   `core/routes/members.ts`, `core/routes/modules.ts` each export a `register…Routes(router)`
   function that adds full-path routes (`/:householdId/members/:userId`, …) to it. Registration
   order inside `households.ts`: invite-token routes (`/invites/:token`, `/invites/accept`) FIRST
   (D8: invites before `:id`), then `/`, `/:householdId`, members, household invites, modules. No
   `app.route()` with a param in the mount path (unproven in this repo).
5. **Copy (D10).** Every German value is copied byte-identically, including R's "Gruppe" wording
   and `DEFAULT_HOUSEHOLD_NAME = "Meine Rezepte"` (its hint string `„Meine Rezepte“` would
   otherwise change too). Renaming the copy to "Haushalt" would change source values, i.e. deviate
   from D10, so it is NOT done in M1 (see §5, an owner decision for M4). Catalog KEYS are renamed:
   R web namespace `groups.*` (group-management keys only) → `household.*`; in `auth.*`
   `auth.register.groupName.*` → `auth.register.householdName.*` and `auth.settings.groups.*` →
   `auth.settings.households.*`. Placeholders inside values (`{groupName}`) stay. Server keys
   `server.group.*` stay as they are (internal, values unchanged). Genuinely new German (Home,
   switcher, module-disabled toast, two strings that lost their recipe count) is listed in §3 T03
   and in `NEW_GERMAN`.
6. **Query keys (D9).** `["toon","me"]`, `["toon","sessions"]`, `["toon","oauth-providers"]`,
   `["toon","households"]`, `["toon","invite",token]`, and under the existing prefix
   `queryKeys.household(id) = ["toon","household",id]`: `…,"detail"`, `…,"members"`,
   `…,"invites",filters`. None of these segments may equal a module id. Persist policy is unchanged:
   `["toon","me"]` is the core's only persisted key (it carries `households[].modules`).
7. **`lib/nav.tsx` is core.** R's `apps/web/src/features/recipes/lib/nav.tsx` (`AppLink`,
   `useAppNavigate`, `useRouteParam(s)`, `useNavigationGuard`) moves verbatim to
   `apps/web/src/lib/nav.tsx`; core screens and (in M2) the recipe module import it from there.
   Likewise two helpers R's group screens import from recipe files become core, verbatim (T05):
   `hasAtLeast` from R `apps/web/src/features/recipes/lib/permissions.ts` → `apps/web/src/lib/
   permissions.ts` (`GroupRole` → `HouseholdRole`; R's `canModifyOwn` stays behind for M2's recipe
   module, which imports `hasAtLeast` from `@/lib/permissions`), and the share block of R
   `apps/web/src/features/recipes/lib/hooks.ts` (`ShareResult`, `ShareLike`, `shareOrCopy`,
   `copyToClipboard`, lines ~174–229) → `apps/web/src/lib/share.ts`. Nothing in H may live under
   `apps/web/src/features/` (SPEC §3).
8. **Shell placement.** Router (T10): root (SessionProvider) → public auth routes; pathless `app`
   (RequireAuth + AppShell) → `/households`, `/households/$householdId`, `/settings` and pathless
   `household-scoped` (RequireActiveHousehold) → `/` Home + one layout per module whose component
   is `moduleLayoutComponent(module.id)` from `apps/web/src/modules/layout.tsx` (renders
   `<RequireModule moduleId><Outlet/></RequireModule>`; RequireModule's decision is the pure
   `moduleGuard` of `modules/enabled.ts`). Nav (T10): inside a module = its three `navItems` + Profil; outside =
   Home · up to two enabled modules · Profil; secondary = the active module's
   `secondaryNavItems` + the core "Gruppen" item (`/households`, `common.nav.groups`), reachable on
   phones through the households card on `/settings` (R's reachability rule for Gruppen). Module
   switcher (T11): Home + the enabled build modules; renders nothing while no build module is
   enabled (all of M1).
9. **`module_disabled` from the API (SPEC §5).** `lib/query-client.ts` gets a `QueryCache` /
   `MutationCache` `onError` that, for `ApiError.code === "module_disabled"`, invalidates
   `["toon","me"]`; the refreshed `households[].modules` makes `RequireModule` redirect to Home
   with the toast. One code path for "disabled while the PWA was open" and "stale bundle".

## 2. Task list and waves

The orchestrator takes up to three ready tasks per wave in list order; a wave of one runs on main.
The list order below (also the structured-output order) puts T08 before the web screens so the API
chain T08 → T08b/T09 is not starved. Waves shown are for `maxParallel = 3`; the deps column is what
is binding — with a larger `maxParallel` the waves compress but no task starts before its deps.

| Wave | Task | Tier | Title | Deps |
| --- | --- | --- | --- | --- |
| 1 | M1-T01 | port | Shared contract: households, auth responses, module registry | — |
| 1 | M1-T02 | build | `/uploads` route + media services (sharp) | — |
| 1 | M1-T03 | port | Web catalogs `auth` + `household` + new `home` copy | — |
| 2 | M1-T04 | port | API households: services, routes, `initializeHousehold`, tests | T01, T02 |
| 2 | M1-T05 | build | Web data + session layer, core `permissions`/`share` helpers, `moduleGuard` | T01, T03 |
| 3 | M1-T08 | port | API auth routes + services, auth/password-reset/smoke tests | T04 |
| 3 | M1-T06 | port | Web auth screens | T05 |
| 3 | M1-T07 | port | Web households screens + HouseholdSwitcher | T05 |
| 4 | M1-T07b | port | Web Settings screen | T05 |
| 4 | M1-T08b | build | Seed, reset-password, scripts, verified-email-gate test | T08 |
| 4 | M1-T09 | core | API module enabling + hooks + tests | T04, T08 |
| 5 | M1-T10 | core | Web router, guards, module layout, nav items, banner, `module_disabled` | T06, T07, T07b |
| 5 | M1-T11 | core | Web Home, ModuleSwitcher, SideNav, PhoneHeaderRow | T05, T07 |
| 6 | M1-T12 | build | Integration: walkthrough test, gates, curl, headless, CLAUDE.md | all |

File ownership per wave is disjoint (each task's "Files"). Shared files and their single owner per
wave: `apps/api/src/index.ts` — T02 (w1), T04 (w2), T08 (w3) (T04 depends on T02 and T08 on T04, so
the edits are serial at any `maxParallel`); `apps/api/src/lib/uploadUrls.ts` (one doc comment) —
T02; `apps/api/package.json` + `bun.lock` — T02 (w1, sharp), T08b (w4, scripts); root
`package.json` — T08b; `scripts/i18n-check.ts` and `apps/web/src/lib/i18n/catalogs/index.ts` — T03;
`apps/api/src/core/routes/households.ts` — T04, then T09 adds one line;
`apps/api/test/smoke.test.ts` — T08; `apps/web/src/router.tsx`, `nav-items.ts`,
`modules/layout.tsx` — T10; `apps/web/src/modules/enabled.ts` — T05; `components/layout/index.ts` —
T11; `CLAUDE.md` — T12. No task in M1 changes `db/schema*.ts` or adds a migration, and no task
touches `apps/api/src/middleware/household.ts` (its `server.group.groupIdMissing` key stays, §1
decision 5) — every leftover-identifier grep below uses `\bgroupId\b`, which does not match that key.

Every brief also implies: read `H/docs/SPEC.md` §1–§3, `H/CLAUDE.md` (Conventions, Gotchas in use),
this plan's §1, and the source files named. Commit with a body naming the SPEC decision / source
file served, ending with the `Co-Authored-By` line the workflow prescribes; no pushes. Long `bun
install` runs go to the background with one log ending in `exit=$?`. Tests: `apps/api/test/`
(never `tests/`), web co-located `*.test.ts(x)`, `packages/shared/test/`. A ported test that needs
unported code is removed and replaced by ONE comment naming the returning milestone (e.g.
`// M2: … returns with the recipe module.`), never skipped.

Common rename table (every port task applies the rows that occur in its files):

| R | H |
| --- | --- |
| tables `groups`, `groupMembers`, `groupInvites`; column prop `groupId`; `activeGroupId` | `households`, `householdMembers`, `householdInvites`; `householdId`; `activeHouseholdId` |
| rows `GroupRow`, `GroupMemberRow`, `GroupInviteRow` | `HouseholdRow`, `HouseholdMemberRow`, `HouseholdInviteRow` |
| shared `Group*` types/schemas, `GroupRole`, `GroupRoleSchema` | `Household*`, `HouseholdRole`, `HouseholdRoleSchema` |
| `requireGroupRole`, `middleware/group.ts`, `resolveMembership` | `requireHouseholdRole`, `middleware/household.ts`, `resolveMembership` |
| `createOwnedGroup`, `setActiveGroup`, `DEFAULT_GROUP_NAME` (api) | `createOwnedHousehold`, `setActiveHousehold`, `DEFAULT_HOUSEHOLD_NAME` |
| route params `:groupId`; paths `/api/groups…` | `:householdId`; `/api/households…` |
| `services/<x>/…` imports (`../../db/…`) | `core/services/<x>/…` (`../../../db/…`) |
| web `"ui.` keys; `@/features/groups/…`; `@/features/auth/…`; `@/features/recipes/lib/nav` | `"common.`; `@/core/features/households/…`; `@/core/features/auth/…`; `@/lib/nav` |
| web `@/features/recipes/lib/permissions` (`hasAtLeast`); `@/features/recipes/lib/hooks` (`copyToClipboard`, `shareOrCopy`, `ShareResult` only) | `@/lib/permissions`; `@/lib/share` (both created by T05) |
| web `groups.` keys (group management only) | `household.` |
| web session `groups`, `activeGroupId`, `activeGroup`, `setActiveGroup`, `useActiveGroup` (`{groupId, group, groups}`), `ActiveGroupValue`, `useRequiredGroupId`, `RequireActiveGroup`, `storageKeys.activeGroupId` | `households`, `activeHouseholdId`, `activeHousehold`, `setActiveHousehold`, `useActiveHousehold` (`{householdId, household, households}`), `ActiveHouseholdValue`, `useRequiredHouseholdId`, `RequireActiveHousehold`, `storageKeys.activeHouseholdId` |
| doc comments "group(s)" (identifier sense) | "household(s)" — comments only; German strings never |

---

### M1-T01 — Shared contract (port)

**Goal.** The household DTO family, the auth bootstrap responses, the module registry additions,
with tests. Additive only: no existing export changes, so every workspace stays green.

**Read.** SPEC D1, D2, §2; this plan §1 decisions 1–3, 5. `R/packages/shared/src/schemas/group.ts`,
`R/packages/shared/src/schemas/auth.ts`, `H/packages/shared/src/core/schemas/{household,user,
common}.ts`, `H/packages/shared/src/modules/registry.ts`, `H/packages/shared/src/core/index.ts`,
`H/packages/shared/test/core.test.ts`.

**Copies and rewrites.**
1. `R/…/schemas/group.ts` → append to `H/packages/shared/src/core/schemas/household.ts` everything
   from `export const GroupSchema` to the end of the file, applying the rename table (`GroupSchema`
   → `HouseholdSchema`, `GroupWithRoleSchema` → `HouseholdWithRoleSchema`, `GroupMemberSchema` →
   `HouseholdMemberSchema` with field `groupId` → `householdId`, `GroupInviteSchema` →
   `HouseholdInviteSchema` with `groupId` → `householdId`, `CreateGroupRequestSchema` →
   `CreateHouseholdRequestSchema`, `UpdateGroupRequestSchema` → `UpdateHouseholdRequestSchema`,
   `GroupResponseSchema` → `HouseholdResponseSchema` with field `group` → `household`,
   `GroupListResponseSchema` → `HouseholdListResponseSchema`, `GroupDetailResponseSchema` →
   `HouseholdDetailResponseSchema` with `group` → `household`, `GroupMember{,List}ResponseSchema` →
   `HouseholdMember{,List}ResponseSchema`, `GroupInvite{,List}ResponseSchema` →
   `HouseholdInvite{,List}ResponseSchema`, `InvitePreviewResponseSchema.groupName` →
   `householdName`, `AcceptInviteResponseSchema.group` → `household` with `HouseholdWithRoleSchema`;
   every `type X = z.infer<…>` renamed alongside; `GroupRoleSchema` → `HouseholdRoleSchema`). Do NOT
   copy R's `GroupRoleSchema`/`InvitableRoleSchema`/`ROLE_RANK`/`roleAtLeast` block — H already has
   them at the top of the file. Replace the M0 placeholder doc line ("Household DTOs … are ported by
   M1") with "Household DTOs: R's GroupSchema family renamed (SPEC D1)." Imports to add:
   `refineKey` from `../i18n/zod.ts`; `IdSchema, IsoDateSchema, MailDeliverySchema, listResponse`
   from `./common.ts`; `EmailSchema, PublicUserSchema` from `./user.ts`.
2. In `HouseholdWithRoleSchema` replace `recipeCount: z.number().int().nonnegative(),` with
   `modules: z.array(z.string()),` and the doc comment: "`modules`: ids of the household's enabled
   modules this codebase knows (MODULE_IDS order). Strings, not ModuleId, so an old client tolerates
   a newer server; the web treats an id without a WebModule as disabled (SPEC §2). The core never
   counts a module's rows."
3. `R/…/schemas/auth.ts` → new `H/packages/shared/src/core/schemas/auth.ts`, verbatim except:
   `GroupWithRoleSchema` → `HouseholdWithRoleSchema` (import from `./household.ts`), field `groups`
   → `households`, `activeGroupId` → `activeHouseholdId`. Add `export * from "./schemas/auth.ts";`
   to `H/packages/shared/src/core/index.ts` after the `household.ts` line.
4. `H/packages/shared/src/modules/registry.ts` gains (imports `z` from `"zod"`):
   ```ts
   /** Wire validation of a module id path/body value. */
   export const ModuleIdSchema = z.enum(MODULE_IDS);
   /** Enabled on every new household (SPEC D2: recipe by default; finance needs its two slots, D3). */
   export const DEFAULT_ENABLED_MODULES: readonly ModuleId[] = ["recipe"];
   ```
   and in `core/schemas/household.ts`:
   ```ts
   /** POST /api/households/:householdId/modules/:moduleId — body optional; settings are module-owned JSON. */
   export const EnableModuleRequestSchema = z.object({ settings: z.record(z.string(), z.unknown()).optional() });
   export type EnableModuleRequest = z.infer<typeof EnableModuleRequestSchema>;
   ```
5. Fix the doc comment on `RegisterRequestSchema.householdName` in `user.ts` only if it is wrong —
   it already reads `(default "Meine Rezepte")`, which stays true (decision 5). No change expected.
6. New test `H/packages/shared/test/household.test.ts` (imports from `"../src/index.ts"`), cases:
   (a) `HouseholdWithRoleSchema` parses an object with `modules: ["recipe"]` and REJECTS one with
   `recipeCount` but no `modules`; (b) `InvitePreviewResponseSchema` requires `householdName`;
   (c) `AuthSessionResponseSchema` parses `{ user, households: [], activeHouseholdId: null }`;
   (d) every `DEFAULT_ENABLED_MODULES` entry is in `MODULE_IDS`, and `ModuleIdSchema` rejects
   `"nope"`; (e) `EnableModuleRequestSchema` accepts `{}` and `{ settings: { a: 1 } }`, rejects
   `{ settings: 1 }`; (f) `HouseholdMemberSchema` has `householdId` (parse fails with only `groupId`).

**Files.** `packages/shared/src/core/schemas/household.ts`, `packages/shared/src/core/schemas/auth.ts`,
`packages/shared/src/core/schemas/user.ts` (only if step 5 applies), `packages/shared/src/core/index.ts`,
`packages/shared/src/modules/registry.ts`, `packages/shared/test/household.test.ts`.

**Acceptance.** All six cases pass; `rg -n "Group" packages/shared/src` finds no `Group`-prefixed
identifier; `bun run typecheck` OK in all five projects (nothing consumes the new names yet).

**Verify.** `cd H && bun run typecheck`; `cd H && bun test packages/shared`;
`cd H && ! grep -rnE "\bGroup[A-Z][A-Za-z]*Schema\b" packages/shared/src`.

---

### M1-T02 — `/uploads` route + media services (build)

**Goal.** The signed `GET /uploads/:filename` route (D4) with on-demand `.thumb.webp` thumbnails,
the image-upload sniffing service in the core (used by the recipe module in M2), `sharp`, and the
uploads/thumbnails tests that do not need recipe routes.

**Read.** SPEC D4, §3 (`core/services/media/`); R/CLAUDE.md gotchas "`/uploads/:filename` needs a
signature", "A LIST never renders `imageUrl`…" (thumbnail rationale), "`mock.module` LEAKS…",
"Bun 1.4 no longer installs OPTIONAL peer dependencies"; R/docs/API.md "Uploads and signed URLs".
Sources: `R/apps/api/src/index.ts` (the `/uploads/:filename` block and its imports),
`R/apps/api/src/services/media/thumbnails.ts`, `R/apps/api/src/services/recipes/uploads.ts`,
`R/apps/api/test/{uploads,thumbnails}.test.ts`, `R/apps/api/test/support/files.ts`,
`H/apps/api/src/index.ts` (the `// --- uploads` M1 comment).

**Steps.**
1. Dependency: in `H/apps/api`, add `"sharp": "^0.35.4"` (R's version) with `bun add sharp@^0.35.4`
   run in the background (log ending `exit=$?`); commit `apps/api/package.json` and `bun.lock`.
   Confirm `bun.lock` lists `sharp@0.35.4` and `@img/sharp-linux-x64`.
2. `R/…/services/media/thumbnails.ts` → `H/apps/api/src/core/services/media/thumbnails.ts`;
   rewrites: `../../env.ts` → `../../../env.ts`, `../../lib/uploadUrls.ts` →
   `../../../lib/uploadUrls.ts`; nothing else.
3. `R/…/services/recipes/uploads.ts` → `H/apps/api/src/core/services/media/uploads.ts`; rewrites:
   `../../env.ts` → `../../../env.ts`, `../../lib/errors.ts` → `../../../lib/errors.ts`,
   `../../lib/uploadUrls.ts` → `../../../lib/uploadUrls.ts`, `../media/thumbnails.ts` →
   `./thumbnails.ts`; header first line "Recipe photo upload." → "Image upload (recipe photos,
   avatars, household covers)."; the `server.recipes.*` keys stay (they exist in the server catalog).
4. `H/apps/api/src/index.ts`: replace the two `// M1: GET /uploads…` comment lines with R's
   `/uploads/:filename` handler and its doc comment verbatim, except the doc sentence naming
   `GET /api/groups/:groupId/imports/:draftId/source` → `GET /api/households/:householdId/recipe/
   imports/:draftId/source (M2)`. Imports added: `existsSync` (node:fs), `join, normalize`
   (node:path), `UPLOAD_EXP_PARAM, UPLOAD_SIG_PARAM, verifyUploadSignature` from
   `./lib/uploadUrls.ts`, `resolveThumbnail` from `./core/services/media/thumbnails.ts`. The
   route stays BEFORE the core routers and the module mounts, static web stays last.
4b. `H/apps/api/src/lib/uploadUrls.ts` line ~30, header doc comment: the same stale path
   `` `GET /api/groups/:groupId/imports/:draftId/source` `` → `` `GET /api/households/:householdId/recipe/imports/:draftId/source` (M2) ``
   — one comment line (rewrap the paragraph if it exceeds 100 columns), no code change. This is the
   last `/api/groups` / `groupId` occurrence in `apps/api/src` outside the `server.group.*` key, so
   T04's and T08's leftover greps start clean.
5. Tests. `R/test/support/files.ts` → `H/apps/api/test/support/files.ts` (import
   `../../src/services/media/thumbnails.ts` → `../../src/core/services/media/thumbnails.ts`).
   `R/test/thumbnails.test.ts` → `H/apps/api/test/thumbnails.test.ts` (import
   `../src/services/media/thumbnails.ts` → `../src/core/services/media/thumbnails.ts`; nothing
   else). `R/test/uploads.test.ts` → `H/apps/api/test/uploads.test.ts` adapted, because R obtains
   its files through the recipe routes that M2 brings:
   - delete `register()`, `sessionCookie()`, `uniqueEmail()`, `createRecipeWithImage()`,
     `PASSWORD`, `JSON_HEADERS`, the `setMailer` before/after hooks (keep `runMigrations`);
   - add `storeImage(): Promise<{ filename: string; signedUrl: string }>` which calls
     `storeUploadedImage(form)` (from `../src/core/services/media/uploads.ts`) with a `FormData`
     holding R's 1×1 `PNG` as `foto.png`, and returns `{ filename, signedUrl: url }`; every test
     that called `createRecipeWithImage(account)` calls `storeImage()` and drops `account`; a
     request that sent `Cookie: account.cookie` sends no cookie (the route ignores cookies);
   - `test("the stored column never holds a signature")` and `describe("import source scans")` are
     removed, replaced by `// M2: "the stored column never holds a signature" and "import source
     scans" return with the recipe routes (toon-recipe test/uploads.test.ts).`;
   - every file a test writes is removed with `removeUpload` (R's convention);
   - add `describe("storeUploadedImage")`: a PNG is stored as `<uuid>.png` with a signed `url`; an
     empty file answers `ApiError` 400; a text file 415.
6. Everything else (the signing primitives tests) verbatim.

**Files.** `apps/api/package.json`, `bun.lock`, `apps/api/src/index.ts`, `apps/api/src/lib/uploadUrls.ts`
(comment only), `apps/api/src/core/services/media/{thumbnails,uploads}.ts`,
`apps/api/test/{uploads,thumbnails}.test.ts`, `apps/api/test/support/files.ts`.

**Acceptance.** `GET /uploads/<name>` with a valid signature serves the file with `private,
max-age=21600, immutable`; unsigned/forged/expired/unknown/traversal → 404; a `.thumb.webp` is
built by sharp at 480 px; `diff R/…/services/media/thumbnails.ts H/…/core/services/media/thumbnails.ts`
shows only the two import lines.

**Verify.** `cd H && bun install --frozen-lockfile`; `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/uploads.test.ts apps/api/test/thumbnails.test.ts`;
`cd H && bun test`; `cd H && grep -q '"sharp"' apps/api/package.json`;
`cd H && ! grep -rn "/api/groups" apps/api/src`.

---

### M1-T03 — Web catalogs `auth` + `household` + new `home` copy (port)

**Goal.** Every web string M1's screens need, typed, registered, with the two restored
language-picker tests and the new-German list. No screen uses them yet.

**Read.** SPEC D10; R/CLAUDE.md gotchas "INTERFACE LANGUAGE AND CONTENT LANGUAGE…", "The i18n layer
is hand-rolled…", "German copy is a REFACTOR…", "The language picker's third state is `system`";
R/docs/i18n.md §2, §9, §10, §11; `H/CLAUDE.md` gotcha "`MessageKey` must stay a literal union";
this plan §1 decision 5. Sources: `R/apps/web/src/lib/i18n/catalogs/{auth,groups}.{de,en}.ts`,
`R/apps/web/src/lib/i18n/i18n.test.ts` (the two tests "every locale has a picker label, in every
catalog" and "language names are autonyms — identical across catalogs"),
`H/apps/web/src/lib/i18n/{catalogs/index.ts,catalogs/home.{de,en}.ts,i18n.test.ts}`,
`H/scripts/i18n-check.ts` (`NEW_GERMAN`).

**Copies and rewrites.**
1. `R/…/catalogs/auth.de.ts` → `H/apps/web/src/lib/i18n/catalogs/auth.de.ts` and `auth.en.ts`
   likewise: verbatim (values byte-identical, comments kept) except the key renames
   `"auth.register.groupName.` → `"auth.register.householdName.` and `"auth.settings.groups.` →
   `"auth.settings.households.`. Export names stay `authDe` / `authEn` / `AuthCatalog`
   (`authEn: LocaleCatalog<AuthCatalog>`), typing unchanged.
2. `R/…/catalogs/groups.de.ts` → `H/…/catalogs/household.de.ts` (`groupsDe` → `householdDe`,
   `satisfies NamespaceCatalog<"household">`, R's `export type GroupsCatalog` → `export type
   HouseholdCatalog = typeof householdDe;`) and `groups.en.ts` → `household.en.ts` (`groupsEn:
   LocaleCatalog<GroupsCatalog>` → `householdEn: LocaleCatalog<HouseholdCatalog>`).
   Keep ONLY the keys under `groups.common.`, `groups.badge.`, `groups.count.members`,
   `groups.role.`, `groups.list.`, `groups.create.`, `groups.detail.`, `groups.settings.`,
   `groups.danger.`, `groups.members.`, `groups.invite.`, `groups.inviteStatus.`, `groups.switcher.`
   (with their section comments); drop `groups.count.recipes`, `groups.tags.*`,
   `groups.collections.*`, `groups.collectionDetail.*`, `groups.tagCombobox.*` (M2 ports them into
   `recipe.*`). Rename the kept keys `"groups.` → `"household.`. Header comment: "German —
   namespace "household" (`core/features/households` + the HouseholdSwitcher): toon-recipe's group
   strings, keys renamed, values byte-identical (SPEC D1, D10)."
   Two values change because the code they label lost its recipe count (decision 2):
   - `household.detail.meta`: de `"{members} · angelegt am {date}"`, en `"{members} · created on {date}"`;
   - `household.danger.warning` becomes a plain string (no plural object): de `"Alle Inhalte und
     Einladungen dieser Gruppe werden endgültig gelöscht. Das kann nicht rückgängig gemacht
     werden."`, en `"All content and invites in this group will be permanently deleted. This cannot
     be undone."`.
3. `H/…/catalogs/home.de.ts` / `home.en.ts` gain (de / en):
   - `home.eyebrow`: "Haushalt" / "Household"
   - `home.modules.availableTitle`: "Verfügbare Module" / "Available modules"
   - `home.modules.enable`: "Aktivieren" / "Enable"
   - `home.modules.memberHint`: "Nur Administrator:innen und Besitzer:innen können Module aktivieren." / "Only admins and owners can enable modules."
   - `home.modules.manage`: "Module verwalten" / "Manage modules"
   - `home.modules.manageDescription`: "Module gelten für den ganzen Haushalt. Die Daten eines deaktivierten Moduls bleiben erhalten." / "Modules apply to the whole household. A disabled module keeps its data."
   - `home.modules.disable`: "Deaktivieren" / "Disable"
   - `home.modules.enabledToast`: "Modul aktiviert" / "Module enabled"
   - `home.modules.disabledToast`: "Modul deaktiviert" / "Module disabled"
   - `home.modules.disableConfirmTitle`: "Modul deaktivieren?" / "Disable module?"
   - `home.modules.disableConfirmDescription`: "„{name}“ verschwindet für alle Mitglieder dieses Haushalts. Die Daten bleiben erhalten." / "“{name}” disappears for every member of this household. Its data is kept."
   - `home.moduleSwitcher.title`: "Modul wechseln" / "Switch module"
   - `home.moduleSwitcher.label`: "Module" / "Modules"
   - `home.moduleDisabled.toast`: "Dieses Modul ist für diesen Haushalt nicht aktiviert." / "This module is not enabled for this household."
   (German quotes „…“ are U+201E/U+201C exactly as in R's catalogs.)
4. `H/…/catalogs/index.ts`: import `authDe/authEn`, `householdDe/householdEn` and spread them into
   `de`/`en` next to `commonDe`/`homeDe` (literal-typed, no annotation — the D10 gotcha).
5. `H/…/i18n/i18n.test.ts`: `prefixes` becomes `["common.", "home.", "auth.", "household."]`;
   restore R's two `auth.settings.language.*` tests verbatim (R's `"ui.` keys, if any, → `"common.`),
   delete the M0 placeholder comment that announced them; add one test: `household.role.owner` is
   "Eigentümer:in" in de.
6. `H/scripts/i18n-check.ts` `NEW_GERMAN` gains, each preceded by `// M1: new household copy (SPEC
   D10)`: `home.modules.availableTitle`, `home.modules.memberHint`, `home.modules.manage`,
   `home.modules.manageDescription`, `home.modules.disable`, `home.modules.enabledToast`,
   `home.modules.disabledToast`, `home.modules.disableConfirmTitle`,
   `home.modules.disableConfirmDescription`, `home.moduleSwitcher.title`,
   `home.moduleSwitcher.label`, `home.moduleDisabled.toast`, `household.detail.meta`,
   `household.danger.warning`. (`home.eyebrow` "Haushalt" and `home.modules.enable` "Aktivieren"
   already exist in the sources, so the check finds them.)

**Files.** `apps/web/src/lib/i18n/catalogs/{auth,household}.{de,en}.ts`,
`apps/web/src/lib/i18n/catalogs/home.{de,en}.ts`, `apps/web/src/lib/i18n/catalogs/index.ts`,
`apps/web/src/lib/i18n/i18n.test.ts`, `scripts/i18n-check.ts`.

**Acceptance.** `MessageKey` still a literal union (existing test); de/en key parity; the i18n-check
parity half prints OK; `diff <(grep -o '"[^"]*"' R/…/auth.de.ts | sort -u) …` style spot check:
every R auth de VALUE appears unchanged in H's `auth.de.ts`.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/lib/i18n`;
`cd H && bun run i18n:check 2>&1 | grep -A1 "1/2 German catalog parity" | grep -q OK`.

---

### M1-T04 — API households (port)

**Goal.** R's group services and routes as the core household API at `/api/households` (members,
invites, roles, active household), `initializeHousehold` + `enabledModulesFor`, the households
tests. Module enabling routes are T09.

**Read.** SPEC D1, D2, D8, §2, §3 (`core/routes`, `core/services/households`); this plan §1
decisions 2–4; R/CLAUDE.md locked decision 1, gotchas "AN UNCONFIRMED E-MAIL ADDRESS MAKES AN
ACCOUNT READ-ONLY…" (per-route gating in the groups router), "A failed mail send must never fail
its action", "`delivered` ALONE IS NOT…", "libSQL 0.17.4 discarded a `file::memory:` DB…",
"`bun:sqlite` IS A NEWER SQLite…"; R/docs/API.md "Groups"; `H/CLAUDE.md` gotchas "Middleware chain
order", "Cross-household guard". Sources: `R/apps/api/src/routes/groups.ts`,
`R/apps/api/src/services/groups/{groups.service,invites.service,mappers,membership,support,
validation}.ts`, `R/apps/api/test/groups.test.ts`; `H/apps/api/src/middleware/household.ts`,
`H/apps/api/src/core/services/auth/users.ts`, `H/apps/api/src/modules/{index,types}.ts`.

**Copies (R → H).** `services/groups/groups.service.ts` → `core/services/households/
households.service.ts`; `invites.service.ts`, `mappers.ts`, `membership.ts`, `support.ts`,
`validation.ts` → same names under `core/services/households/`; `services/groups/access.ts` is NOT
copied (routes import the middleware directly). `routes/groups.ts` → split into
`core/routes/{households,invites,members}.ts`. `test/groups.test.ts` → `test/households.test.ts`.

**Rewrites.**
1. Rename table (§2) throughout; imports `../../db/…`, `../../lib/…`, `../../env.ts` →
   `../../../…`; `../mail/index.ts` → `../mail/index.ts` (unchanged: `core/services/mail`).
   Function renames: `listGroupsForUser` → `listHouseholdsForUser`, `loadGroupRow` →
   `loadHouseholdRow`, `getGroupWithRole` → `getHouseholdWithRole`, `createGroup` →
   `createHousehold`, `updateGroup` → `updateHousehold`, `deleteGroup` → `deleteHousehold`,
   `toGroup` → `toHousehold`, `toGroupWithRole` → `toHouseholdWithRole`, `toGroupMember` →
   `toHouseholdMember`, `toGroupInvite` → `toHouseholdInvite`, `toGroupRole` → `toHouseholdRole`;
   all others keep their names. Error keys `server.group.*` unchanged. In `invites.service.ts` the
   `inviteMail({ groupName: group?.name ?? "Rezepte", … })` call keeps the param name `groupName`
   and the literal (the mail template's API), with `group` → `household` as the variable.
2. `households.service.ts`: delete `recipeCounts()` and the `recipes` import; wherever R combined
   `memberCounts` + `recipeCounts` (`listHouseholdsForUser`, `getHouseholdWithRole`), combine
   `memberCounts` + `enabledModulesFor(db, ids)` and pass `modules.get(id) ?? []` to
   `toHouseholdWithRole(row, role, memberCount, modules)`. `createHousehold` calls `await
   initializeHousehold(tx, id)` inside its existing `withTransaction`, right after the owner's
   membership insert (before the `users.activeHouseholdId` update). R's last line
   `return toGroupWithRole(await loadGroupRow(db, id), "owner", 1, 0);` (literal member/recipe
   counts) becomes exactly `return getHouseholdWithRole(db, id, "owner");` — it reads the module
   rows `initializeHousehold` just wrote, so the response carries `modules: ["recipe"]`. No call site
   anywhere passes a literal `[]` for `modules`. `deleteHousehold`'s doc: "members, invites, module rows and
   every module's household-scoped rows cascade."
3. `mappers.ts`: `toHouseholdWithRole(row, role, memberCount: number, modules: readonly string[])`
   returns `{ ...toHousehold(row), role, memberCount, modules: [...modules] }`.
4. New `core/services/households/modules.ts` with exactly:
   ```ts
   /**
    * household_modules reads + household initialisation (SPEC D2, §2). M1-T09 adds enabling.
    * The core reaches modules only through `modules/index.ts` (API_MODULES).
    */
   import { DEFAULT_ENABLED_MODULES, MODULE_IDS, type ModuleId, isModuleId } from "@toon/shared";
   import { inArray } from "drizzle-orm";
   import { householdModules } from "../../../db/schema.ts";
   import { API_MODULES } from "../../../modules/index.ts";
   import type { ApiModule } from "../../../modules/types.ts";
   import type { DbLike } from "./support.ts";

   /** Enabled module ids per household; ids this codebase does not know are dropped (SPEC §2). */
   export async function enabledModulesFor(db: DbLike, householdIds: readonly string[]): Promise<Map<string, ModuleId[]>> {
     const result = new Map<string, ModuleId[]>();
     if (householdIds.length === 0) return result;
     const rows = await db
       .select({ householdId: householdModules.householdId, moduleId: householdModules.moduleId })
       .from(householdModules)
       .where(inArray(householdModules.householdId, [...householdIds]));
     for (const row of rows) {
       if (!isModuleId(row.moduleId)) continue;
       const list = result.get(row.householdId) ?? [];
       list.push(row.moduleId);
       result.set(row.householdId, list);
     }
     for (const list of result.values()) list.sort((a, b) => MODULE_IDS.indexOf(a) - MODULE_IDS.indexOf(b));
     return result;
   }

   /**
    * Every new household: the default module rows (recipe, SPEC D2) — written even when this build
    * lacks the module, the UI filters — then each build module's `onHouseholdCreated` hook, on the
    * same executor so a failing hook rolls the creation back where transactions exist.
    */
   export async function initializeHousehold(db: DbLike, householdId: string, modules: readonly ApiModule[] = API_MODULES): Promise<void> {
     const now = Date.now();
     await db
       .insert(householdModules)
       .values(DEFAULT_ENABLED_MODULES.map((moduleId) => ({ householdId, moduleId, enabledAt: now, settings: null })))
       .onConflictDoNothing();
     for (const module of modules) await module.onHouseholdCreated?.(householdId, db);
   }
   ```
5. `H/apps/api/src/core/services/auth/users.ts` `createOwnedHousehold`: after the
   `householdMembers` insert add `await initializeHousehold(database, householdId);` (import from
   `../households/modules.ts`). Nothing else in `users.ts` changes.
6. Routes. Source `R/routes/groups.ts` (header comment, imports, then routes in this order: GET `/`,
   POST `/`, GET `/invites/:token`, POST `/invites/accept`, GET/PATCH/DELETE `/:groupId`, GET/PATCH/
   DELETE `/:groupId/members…`, GET/POST `/:groupId/invites`, DELETE `/:groupId/invites/:inviteId`).
   - `core/routes/invites.ts`: `export function registerInviteTokenRoutes(router: Hono<AppEnv>):
     void` with the bodies of GET `/invites/:token` and POST `/invites/accept`, and `export function
     registerHouseholdInviteRoutes(router: Hono<AppEnv>): void` with GET/POST `/:householdId/invites`
     and DELETE `/:householdId/invites/:inviteId`; each handler body and middleware list verbatim
     with `groupRoutes.` → `router.`.
   - `core/routes/members.ts`: `export function registerMemberRoutes(router: Hono<AppEnv>): void`
     with the three `/:householdId/members…` routes.
   - `core/routes/households.ts`: R's header comment (rename table applied; the gated/ungated list
     keeps its content), `export const householdRoutes = new Hono<AppEnv>();`, then IN THIS ORDER:
     `registerInviteTokenRoutes(householdRoutes);` GET `/`, POST `/`, GET/PATCH/DELETE
     `/:householdId` (verbatim bodies), `registerMemberRoutes(householdRoutes);`
     `registerHouseholdInviteRoutes(householdRoutes);` and a comment `// M1-T09:
     registerModuleRoutes(householdRoutes) — /:householdId/modules/:moduleId`. `export default
     householdRoutes;`.
   - Middleware imports in all three files: `requireHouseholdRole` from
     `../../middleware/household.ts`, `requireSession`/`optionalSession` from
     `../../middleware/session.ts`, `requireVerifiedEmail` from `../../middleware/verifiedEmail.ts`;
     `db` from `../../db/client.ts`; services from `../services/households/…`. The POST `/` handler's
     `Location` header is `/api/households/${household.id}`; response field names follow the shared
     schemas (`household`, not `group`).
7. `H/apps/api/src/index.ts`: under `// --- core routers`, replace the `M1: app.route("/api/households"…`
   comment lines with `app.route("/api/households", householdRoutes);` placed AFTER
   `mountModules(app, API_MODULES)` (move the module section above the core routers if needed, keep
   static web last) and keep the `// M1: app.route("/api/auth", authRoutes);` comment for T08.
8. Test: `R/test/groups.test.ts` → `H/apps/api/test/households.test.ts`: rename table; paths
   `/api/groups` → `/api/households`; payload interface `GroupPayload` → `HouseholdPayload` with
   `household: {…, modules: string[]}` (no `recipeCount`); every `recipeCount` assertion removed;
   any test step that inserts into `recipes` (cascade check) drops that step with `// M2: the
   recipe-row cascade assertion returns with the recipe module.`; `foldText` import kept only if
   still used. Import `../src/core/services/mail/index.ts` for `setMailer`. Add to `describe("POST
   /api/households")`: the created household has `modules: ["recipe"]`, and `GET
   /api/households/:id` answers `{ household: { modules: ["recipe"], … }, members: [...] }`; add
   to `describe("GET /api/households")`: a row inserted directly with `moduleId: "legacy-x"` is not
   reported.

**Files.** `apps/api/src/core/services/households/{households.service,invites.service,mappers,
membership,support,validation,modules}.ts`, `apps/api/src/core/routes/{households,invites,
members}.ts`, `apps/api/src/core/services/auth/users.ts`, `apps/api/src/index.ts`,
`apps/api/test/households.test.ts`.

**Acceptance.** Every R groups test has a counterpart (minus recipe cascade lines); invite token
routes resolve before `:householdId` (a test hitting `GET /api/households/invites/<token>` gets the
preview, not a 404/403 for household "invites"); registration path via `createOwnedHousehold`
writes the `recipe` module row; `POST /api/households` answers `household.modules ===
["recipe"]` through `getHouseholdWithRole`; `grep -rnE "\bgroupId\b|GroupRow|requireGroupRole|/api/groups"
apps/api/src` finds nothing (the `server.group.groupIdMissing` key in `middleware/household.ts` does
not match `\bgroupId\b` and stays — decision 5; T02 already fixed the `uploadUrls.ts` comment);
`diff` of `support.ts` against R shows only import-path lines. Do NOT edit
`middleware/household.ts`, `lib/uploadUrls.ts` or the server catalogs to satisfy the grep.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/api/test/households.test.ts`;
`cd H && bun test apps/api`; `cd H && ! grep -rnE "\bgroupId\b|GroupRow|requireGroupRole|/api/groups" apps/api/src`;
`cd H && grep -q "server.group.groupIdMissing" apps/api/src/middleware/household.ts`.

---

### M1-T05 — Web data + session layer, core helpers, `moduleGuard` (build)

**Goal.** The client side of auth and households: `lib/api.ts` request functions, `lib/queries.ts`
keys and query options, `lib/session.tsx` (SessionProvider, guards incl. `RequireModule`),
`lib/nav.tsx`, the core helpers `lib/permissions.ts` and `lib/share.ts` (decision 7), the households
feature's query hooks and role labels, `modules/enabled.ts` with the pure `moduleGuard`.
Nothing is routed yet (T10), so nothing renders it; it must typecheck and its pure parts are tested.

**Read.** SPEC D1, D2, D9, §2, §3 (`lib/session.tsx`), §5 ("Module disabled"); this plan §1
decisions 2, 3, 6, 7, 9; R/CLAUDE.md "Architecture" (data flow), gotchas "The persisted offline
cache is namespaced per user id…", "`useCanMutate()` must NOT be used on the shopping screens",
"AN UNCONFIRMED E-MAIL…" (the `useEmailVerificationBlock` bullet: unknown counts as not-required),
"`safeNextPath`…"; `H/CLAUDE.md` gotchas "No module-level constants over `WEB_MODULES`", "Persist
policy comes from the manifests". Sources: `R/apps/web/src/lib/api.ts` (functions from
`registerAccount` through `revokeGroupInvite`, lines ~397–700), `R/apps/web/src/lib/queries.ts`
(keys `sessions`, `oauthProviders`, `groups`, `invitePreview`, `groupDetail`, `groupMembers`,
`groupInvites`; options `meQuery`, `sessionsQuery`, `oauthProvidersQuery`, `groupsQuery`,
`invitePreviewQuery`, `groupQuery`, `groupMembersQuery`, `groupInvitesQuery`; `invalidate.{everything,
me,sessions,oauthProviders,groups,group,members,invites}`), `R/apps/web/src/lib/session.tsx`,
`R/apps/web/src/features/recipes/lib/nav.tsx`, `R/apps/web/src/features/recipes/lib/permissions.ts`,
`R/apps/web/src/features/recipes/lib/hooks.ts` (the `/* share */` block only, lines ~174–229),
`R/apps/web/src/features/groups/lib/{queries,roleLabels}.ts`;
`H/apps/web/src/lib/{api,queries,queries.test,persist,storage}.ts`,
`H/apps/web/src/components/ui/Toast.tsx` (the `useToast` API), `H/apps/web/src/modules/types.ts`.

**Steps.**
1. `lib/api.ts`: append R's functions with the rename table; paths `/api/groups` →
   `/api/households` (`/api/households/invites/${token}`, `/api/households/invites/accept`, …);
   function renames `fetchGroups` → `fetchHouseholds`, `createGroup` → `createHousehold`,
   `fetchGroup` → `fetchHousehold`, `updateGroup` → `updateHousehold`, `deleteGroup` →
   `deleteHousehold`, `fetchGroupMembers` → `fetchHouseholdMembers`, `removeGroupMember` →
   `removeHouseholdMember`, `fetchGroupInvites` → `fetchHouseholdInvites`, `createGroupInvite` →
   `createHouseholdInvite`, `revokeGroupInvite` → `revokeHouseholdInvite`; others keep their names.
   Add `enableModule(householdId, moduleId: ModuleId, settings?: Record<string, unknown>, options?)`
   → `POST /api/households/${householdId}/modules/${moduleId}` body `settings === undefined ? {} :
   { settings }` returning `HouseholdResponse`, and `disableModule(householdId, moduleId, options?)`
   → `DELETE …` returning `void`. Extend the existing `api` object with an `auth` / `households`
   grouping only if R had one (keep M0's `updateProfile`).
2. `lib/queries.ts`: add the keys of decision 6 (`households()`, `householdDetail(id)`,
   `householdMembers(id)`, `householdInvites(id, query)`, `sessions()`, `oauthProviders()`,
   `invitePreview(token)`), the R query options renamed (`householdsQuery`, `householdQuery`,
   `householdMembersQuery`, `householdInvitesQuery`, `meQuery` verbatim incl. its 401 → null
   handling) and `invalidate.{everything, me, sessions, oauthProviders, households, household,
   members, invites}` (`household(qc,id)` invalidates `householdDetail(id)`). Extend
   `lib/queries.test.ts`: the new household keys start with `["toon","household",id]`; none of
   their 4th segments is a `MODULE_IDS` entry.
3. `lib/nav.tsx`: `R/…/features/recipes/lib/nav.tsx` verbatim; header first sentence →
   "Router helpers shared by core screens and module screens."; `@/lib/unsavedWork` import stays.
3b. `lib/permissions.ts`: R `features/recipes/lib/permissions.ts` header doc comment (with
   `requireGroupRole` → `requireHouseholdRole`) and `hasAtLeast` verbatim, `GroupRole` →
   `HouseholdRole` (import type from `@toon/shared`); do NOT copy `canModifyOwn` (recipe-specific;
   M2's recipe module keeps it and imports `hasAtLeast` from `@/lib/permissions`). Add
   `lib/permissions.test.ts`: `hasAtLeast(undefined, "member")` false, `("admin","admin")` true,
   `("member","admin")` false, `("owner","admin")` true.
3c. `lib/share.ts`: R `features/recipes/lib/hooks.ts` from `export type ShareResult` through the end
   of `copyToClipboard` (`ShareResult`, `ShareLike`, `shareOrCopy`, `copyToClipboard`), verbatim incl.
   their doc comments; file header: "Share sheet with clipboard fallback — core (R's
   features/recipes/lib/hooks.ts share block; SPEC §3). Never throws." No test (DOM/navigator only).
4. `lib/session.tsx`: R's file with the rename table; `"ui.` → `"common.`; `me?.groups` →
   `me?.households`; `data.activeGroupId ?? data.groups[0]?.id` → `data.activeHouseholdId ??
   data.households[0]?.id`; `updateProfile({ activeGroupId })` → `({ activeHouseholdId })`;
   `invalidate.groups` → `invalidate.households`; `navigate({ to: "/groups" })` →
   `navigate({ to: "/households" })`; doc comments "group" → "household". Keep the
   `setActiveCacheUser` effect and `purgePersistedCache` on logout exactly (data-leak guard). Add:
   ```tsx
   /**
    * Module route guard (SPEC D2, §5): a module route for a household without that module goes
    * Home with a toast. Rendered by the module layout route (router.tsx), never around a lazy screen.
    */
   export function RequireModule({ moduleId, children }: { moduleId: ModuleId; children: ReactNode })
   ```
   It reads `useSession().activeHousehold?.modules ?? []` and computes `const decision =
   moduleGuard(modules, moduleId)` (import `{ moduleGuard } from "@/modules/enabled"` — this exact
   path; `enabled.ts` is pure and imports no registry, so the cycle rule below is kept). When
   `decision === "redirect"` it shows `toast` (variant `"info"`, title
   `t("home.moduleDisabled.toast")`) once in an effect, navigates to `"/"` with `replace: true`, and
   renders `null`; when `"render"` its children. `session.tsx` must NOT import the REGISTRY —
   `@/modules` or `@/modules/index` (manifests import screens that import this file);
   `@/modules/enabled` is allowed and expected.
5. `modules/enabled.ts` (pure, takes the registry as a parameter, never imports `./index`):
   `isModuleEnabled(enabledIds: readonly string[], id: ModuleId): boolean`,
   `moduleGuard(enabledIds: readonly string[], id: ModuleId): "render" | "redirect"` (`"render"` iff
   `isModuleEnabled`; the single decision `RequireModule` acts on — SPEC §5 "Module disabled"),
   `enabledWebModules(modules: readonly WebModule[], enabledIds: readonly string[]): WebModule[]`
   (registry order, unknown ids ignored), `availableWebModules(modules, enabledIds)` (build modules
   not enabled). `modules/enabled.test.ts` covers all four with fake `WebModule` objects (cast
   through a minimal factory; `routes: []`, `homeCard: () => null`); `moduleGuard` cases:
   `(["recipe"], "recipe")` → `"render"`; `([], "recipe")` → `"redirect"`; `(["finance"],
   "recipe")` → `"redirect"`; `(["legacy-x", "recipe"], "recipe")` → `"render"`.
6. `core/features/households/lib/queries.ts` ← `R/…/features/groups/lib/queries.ts` (hooks renamed
   `useGroups` → `useHouseholds`, `useGroupDetail` → `useHouseholdDetail`, `useGroupMembers` →
   `useHouseholdMembers`, `useGroupInvites` → `useHouseholdInvites`, `useCreateGroup` →
   `useCreateHousehold`, `useUpdateGroup` → `useUpdateHousehold`, `useDeleteGroup` →
   `useDeleteHousehold`; `UpdateGroupInput` → `UpdateHouseholdInput`; others unchanged;
   `INVITE_STATUS_LABELS` keys `"groups.inviteStatus.` → `"household.inviteStatus.`).
   `core/features/households/lib/roleLabels.ts` ← R's with `GroupRole` → `HouseholdRole` and
   `"groups.role.` → `"household.role.`.

**Files.** `apps/web/src/lib/{api.ts,queries.ts,queries.test.ts,session.tsx,nav.tsx}`,
`apps/web/src/lib/{permissions.ts,permissions.test.ts,share.ts}`,
`apps/web/src/modules/{enabled.ts,enabled.test.ts}`,
`apps/web/src/core/features/households/lib/{queries.ts,roleLabels.ts}`.

**Acceptance.** No `fetch` outside `lib/api.ts`; `lib/session.tsx` imports `@/modules/enabled`
and never the registry (`@/modules` / `@/modules/index`); `RequireModule` exported and driven by
`moduleGuard`; `hasAtLeast`, `shareOrCopy`, `copyToClipboard`, `ShareResult` exported from
`@/lib/permissions` / `@/lib/share`; query keys per decision 6; `grep -rnE "\"ui\.|\bgroupId\b|/api/groups"
apps/web/src/lib apps/web/src/core` finds nothing; nothing created under `apps/web/src/features/`.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/lib apps/web/src/modules`;
`cd H && ! grep -nE "from \"@/modules(/index)?\"" apps/web/src/lib/session.tsx`;
`cd H && grep -q "moduleGuard" apps/web/src/lib/session.tsx`;
`cd H && grep -q "export function hasAtLeast" apps/web/src/lib/permissions.ts && grep -q "export async function shareOrCopy" apps/web/src/lib/share.ts`;
`cd H && ! grep -rnE "/api/groups|\"ui\." apps/web/src/lib apps/web/src/core`;
`cd H && test ! -e apps/web/src/features`.

---

### M1-T06 — Web auth screens (port)

**Goal.** R's public auth screens under `core/features/auth/` (not routed until T10).

**Read.** SPEC D4, D10; R/CLAUDE.md gotchas "OAuth never auto-links…", "`safeNextPath`…",
"German copy is a REFACTOR…"; R/docs/redesign/specs/05-frontend-shell.md §12.6 (copied at
`H/docs/design/recipe-redesign/specs/05-frontend-shell.md`). Sources:
`R/apps/web/src/features/auth/{AuthLayout,LoginPage,RegisterPage,ForgotPasswordPage,
ResetPasswordPage,VerifyEmailPage,OAuthButtons,OAuthCallbackPage,InvitePage}.tsx`.

**Copies.** Each → `H/apps/web/src/core/features/auth/<same name>.tsx`.

**Rewrites.** Rename table; `"ui.` → `"common.`; `@/features/groups/lib/roleLabels` →
`@/core/features/households/lib/roleLabels`; `@/features/recipes/lib/nav` → `@/lib/nav`.
`RegisterPage`: state `groupName`/`setGroupName` → `householdName`/`setHouseholdName`, request field
`groupName` → `householdName`, input `name="householdName"`, `errors.groupName` →
`errors.householdName`, `clearField(current, "groupName")` → `"householdName"`, keys
`auth.register.groupName.*` → `auth.register.householdName.*`, `invite.data.groupName` →
`invite.data.householdName` (the placeholder name passed to `t()` stays `groupName:`); doc comment
"first group ("Meine Rezepte" …)" → "first household ("Meine Rezepte" …)". `InvitePage`:
`setActiveGroup` → `setActiveHousehold`, `invalidate.groups` → `invalidate.households`,
`data.group.id/name` → `data.household.id/name`, `invite.groupName` → `invite.householdName`
(placeholder key `groupName:` stays). Every `<Link to=…>` stays; if `tsc` rejects a `to`, replace
that one `Link` by `AppLink` from `@/lib/nav` and note it. Everything else byte-identical.

**Files.** `apps/web/src/core/features/auth/{AuthLayout,LoginPage,RegisterPage,ForgotPasswordPage,
ResetPasswordPage,VerifyEmailPage,OAuthButtons,OAuthCallbackPage,InvitePage}.tsx`.

**Acceptance.** `diff` of each file against R shows only listed rewrites; every `t("…")` key exists
(typecheck enforces); default exports kept (R exports screens as default too).

**Verify.** `cd H && bun run typecheck`; `cd H && bun run build`;
`cd H && ! grep -rnE "\"ui\.|features/groups|features/recipes|groupName\)" apps/web/src/core/features/auth`.

---

### M1-T07 — Web households screens + HouseholdSwitcher (port)

**Goal.** `/households`, `/households/$householdId`, the switcher component and the households
feature barrel. Not routed until T10. (Settings is M1-T07b.)

**Read.** SPEC D1, D5, §3, §5; R/CLAUDE.md "Navigation" (the Gruppen reachability bullet),
gotchas "`controlClasses` carries `min-w-0`…", "A page component must NOT re-apply `mx-auto
max-w-content…`", "`delivered` ALONE IS NOT…" (InvitePanel's three states);
`H/docs/design/recipe-redesign/specs/05-frontend-shell.md` §4 (GroupSwitcher variants), §12.6.
Sources: `R/apps/web/src/features/groups/{GroupsPage,GroupDetailPage,GroupSwitcher}.tsx`,
`R/apps/web/src/features/groups/index.ts`, `R/…/features/groups/components/{MemberList,
InvitePanel}.tsx`; `H/apps/web/src/lib/{permissions,share,nav}.ts(x)` (T05).

**Copies.** `GroupsPage.tsx` → `core/features/households/HouseholdsPage.tsx`; `GroupDetailPage.tsx`
→ `core/features/households/HouseholdDetailPage.tsx`; `GroupSwitcher.tsx` →
`core/features/households/HouseholdSwitcher.tsx`; `components/{MemberList,InvitePanel}.tsx` →
`core/features/households/components/`; `index.ts` → `core/features/households/index.ts`.

**Rewrites.**
1. Rename table; `"ui.` → `"common.`; `"groups.` → `"household.`; import rewrites, each exactly:
   - `@/features/recipes/lib/nav` → `@/lib/nav` (GroupsPage, GroupDetailPage);
   - `import { hasAtLeast } from "@/features/recipes/lib/permissions";` →
     `import { hasAtLeast } from "@/lib/permissions";` (GroupDetailPage.tsx:29,
     components/MemberList.tsx:16);
   - `import { copyToClipboard, shareOrCopy } from "@/features/recipes/lib/hooks";` →
     `import { copyToClipboard, shareOrCopy } from "@/lib/share";` (components/InvitePanel.tsx:37);
   - any other `@/features/groups/…` → relative or `@/core/features/households/…`.
   Do NOT create files outside this task's list (no `apps/web/src/features/…`, no inlined copies of
   the helpers — T05 provides them). `./lib/queries` and `./lib/roleLabels` paths stay relative (T05
   put them in `core/features/households/lib/`). Component renames `GroupsPage` → `HouseholdsPage`,
   `GroupDetailPage` → `HouseholdDetailPage`, `GroupSwitcher`/`GroupSwitcherProps` →
   `HouseholdSwitcher`/`HouseholdSwitcherProps`; route strings `"/groups"` → `"/households"`,
   `/groups/$groupId` → `/households/$householdId`, `useRouteParam("groupId")` →
   `useRouteParam("householdId")`.
2. Recipe counts go (decision 2): `HouseholdSwitcher` deletes the two `household.count.recipes`
   renderings (and the separator that joined them to the member count); `HouseholdsPage` deletes its
   one; `HouseholdDetailPage` renders the meta as `t("household.detail.meta", { members:
   t("household.count.members", { count: household.memberCount }), date: … })` (no `recipes:`), the
   danger zone loses its `recipeCount` prop and renders `t("household.danger.warning")` without
   values.
3. `index.ts` barrel: exports renamed per T05's hook names; header "Households feature barrel
   (HouseholdSwitcher.tsx is used by the shell)."; still no screen re-exports.
4. Everything else (copy, class names, structure) byte-identical.

**Files.** `apps/web/src/core/features/households/{HouseholdsPage,HouseholdDetailPage,
HouseholdSwitcher}.tsx`, `apps/web/src/core/features/households/index.ts`,
`apps/web/src/core/features/households/components/{MemberList,InvitePanel}.tsx`.

**Acceptance.** No `recipeCount`, `groups.`, `ui.`, `/groups`, `features/recipes`,
`features/groups` left in these files; MemberList/HouseholdDetailPage import `hasAtLeast` from
`@/lib/permissions`, InvitePanel imports the share helpers from `@/lib/share`; InvitePanel still
distinguishes `sent` / `not_configured` / `failed`; `apps/web/src/features` does not exist.

**Verify.** `cd H && bun run typecheck`; `cd H && bun run build`;
`cd H && ! grep -rnE "recipeCount|\"groups\.|\"ui\.|\"/groups|features/recipes|features/groups" apps/web/src/core/features/households`;
`cd H && grep -q "@/lib/permissions" apps/web/src/core/features/households/components/MemberList.tsx && grep -q "@/lib/share" apps/web/src/core/features/households/components/InvitePanel.tsx`;
`cd H && test ! -e apps/web/src/features`.

---

### M1-T07b — Web Settings screen (port)

**Goal.** `/settings` (profile, e-mail, appearance/theme, language, password, connected accounts,
sessions, the households card, enabled modules' `settingsSections`). Not routed until T10.

**Read.** SPEC D1, D6 (Profil), §5 (Settings); R/CLAUDE.md "Navigation" (the households card on
`/settings` is the only phone route to Gruppen), gotchas "The language picker's third state is
`system`", "`controlClasses` carries `min-w-0`…", "A page component must NOT re-apply…";
`H/docs/design/recipe-redesign/specs/05-frontend-shell.md` §12.4. Sources:
`R/apps/web/src/features/auth/AccountSettingsPage.tsx`; `H/apps/web/src/lib/session.tsx`,
`H/apps/web/src/modules/{enabled,index,types}.ts`.

**Copies.** `R/…/features/auth/AccountSettingsPage.tsx` → `core/features/settings/SettingsPage.tsx`.

**Rewrites.**
1. Rename table; `"ui.` → `"common.`; `@/features/recipes/lib/nav` → `@/lib/nav`; component
   renames `AccountSettingsPage` → `SettingsPage`, `GroupsCard` → `HouseholdsCard` (props
   `activeGroupName` → `activeHouseholdName`); `auth.settings.groups.*` → `auth.settings.households.*`
   (the `{groupName}` placeholder key passed to `t()` stays `groupName:`); `useActiveGroup()` →
   `useActiveHousehold()` with `{ household: activeHousehold }`; the card links to `/households`;
   doc comments "group" → "household".
2. After the households card add, with `WEB_MODULES` from `@/modules` and `enabledWebModules` from
   `@/modules/enabled` (allowed here: a screen, not imported by `lib/` or a manifest):
   ```tsx
   {enabledWebModules(WEB_MODULES, activeHousehold?.modules ?? []).flatMap((module) =>
     (module.settingsSections ?? []).map((Section, index) => <Section key={`${module.id}-${index}`} />),
   )}
   ```
   (SPEC §5; renders nothing in M1). Header doc: "`/settings` — profile, households, password,
   appearance, language, sessions, and each enabled module's settings section (SPEC §5)."
3. Everything else (copy, class names, structure, the default export) byte-identical.

**Files.** `apps/web/src/core/features/settings/SettingsPage.tsx`.

**Acceptance.** No `groups.`, `ui.`, `/groups`, `features/` imports left; the HouseholdsCard links
to `/households`; the language picker keeps its `system` state; `diff` against R shows only the
listed rewrites and the settings-sections block.

**Verify.** `cd H && bun run typecheck`; `cd H && bun run build`;
`cd H && ! grep -nE "\"auth\.settings\.groups\.|\"ui\.|\"/groups|@/features/" apps/web/src/core/features/settings/SettingsPage.tsx`;
`cd H && grep -q "settingsSections" apps/web/src/core/features/settings/SettingsPage.tsx`.

---

### M1-T08 — API auth routes + services, auth tests (port)

**Goal.** `/api/auth` (register, login, logout, me, profile, password, forgot/reset, e-mail
verification request/confirm, sessions, OAuth start/callback/link/unlink), the remaining auth
services, the mount in `index.ts`, the `auth` and `password-reset` tests and the smoke additions.
(Seed, reset-password, scripts and the verified-email-gate test are M1-T08b.)

**Read.** SPEC D4, D1, §4 (users); R/CLAUDE.md locked decision 4 and gotchas "AN UNCONFIRMED E-MAIL
ADDRESS…", "OAuth never auto-links…", "`safeNextPath`…", "A failed mail send must never fail its
action", "`delivered` ALONE…", "`bun test` gets a silent ConsoleMailer", "`clientIp()` ignores
`X-Forwarded-For` unless `TRUST_PROXY=1`", "`mock.module` LEAKS…"; R/docs/API.md "Auth", "Password
reset", "E-mail verification". Sources: `R/apps/api/src/routes/auth.ts`,
`R/apps/api/src/services/auth/{bootstrap,emailVerification,index,invites,oauthAccounts,
passwordReset,passwords,rateLimit,tokens}.ts`, `R/apps/api/test/{auth,password-reset}.test.ts`;
`H/apps/api/src/core/services/auth/{sessions,users,verifiedEmail}.ts` (M0, not re-copied),
`H/apps/api/src/core/services/households/households.service.ts` (T04),
`H/apps/api/test/smoke.test.ts`.

**Copies.** `routes/auth.ts` → `core/routes/auth.ts`; the nine service files → `core/services/auth/`
(same names); `test/{auth,password-reset}.test.ts` → `apps/api/test/`.

**Rewrites.**
1. Rename table; service imports `../../…` → `../../../…`; route imports `../db/…` →
   `../../db/…`, `../lib/…` → `../../lib/…`, `../env.ts` → `../../env.ts`, `../middleware/group.ts`
   → `../../middleware/household.ts`, `../middleware/session.ts` → `../../middleware/session.ts`,
   `../services/auth/…` → `../services/auth/…`, `../services/mail/index.ts` →
   `../services/mail/index.ts`. `body.groupName ?? DEFAULT_GROUP_NAME` →
   `body.householdName ?? DEFAULT_HOUSEHOLD_NAME`; `accepted.groupId` → `accepted.householdId`.
2. `bootstrap.ts`: `loadUserGroups` → `loadUserHouseholds`, implemented as `return
   listHouseholdsForUser(database, userId)` (import from `../households/households.service.ts`) —
   delete R's inline `recipeCount` SQL and row mapping; `buildAuthSession` returns `{ user,
   households, activeHouseholdId }` and keeps R's "repair a stale active pointer" logic with
   `setActiveHousehold`. `index.ts` barrel re-exports the renamed names (and M0's `sessions`,
   `users`, `verifiedEmail` exports as R's barrel does).
3. `services/auth/invites.ts` (register-with-invite path): rename table; `AcceptedInvite.groupId`
   → `householdId`.
4. `H/apps/api/src/index.ts`: replace the `// M1: app.route("/api/auth", authRoutes);` comment with
   `app.route("/api/auth", authRoutes);` (before `/api/households`). Smoke test: add
   `describe("anonymous requests")` with one test asserting `GET /api/auth/me`, `GET /api/households`
   and `GET /api/households/x` each answer 401 with the standard error envelope (H's smoke test
   has no such table yet).
5. Tests: rename table; `../src/services/` → `../src/core/services/`; `../src/middleware/group.ts`
   → `../src/middleware/household.ts`; response fields `groups` → `households`, `activeGroupId` →
   `activeHouseholdId`, register body `groupName` → `householdName`; `createOwnedGroup(db, …)` →
   `createOwnedHousehold(db, …)` returning `{ householdId }`. In `auth.test.ts` `describe("group
   invites")` → `"household invites"` and `describe("requireGroupRole")` → `"requireHouseholdRole"`.
   Add to `describe("POST /api/auth/register")`: the response's `households[0].modules` equals
   `["recipe"]`. A test that needs a recipe route is replaced by one `// M2: …` comment (none
   expected in these two files; report any).

**Files.** `apps/api/src/core/routes/auth.ts`, `apps/api/src/core/services/auth/{bootstrap,
emailVerification,index,invites,oauthAccounts,passwordReset,passwords,rateLimit,tokens}.ts`,
`apps/api/src/index.ts`, `apps/api/test/{auth,password-reset,smoke}.test.ts`.

**Acceptance.** Register → 201 with cookie, `households[0]` owner with `modules: ["recipe"]`;
register with `inviteToken` joins that household; login/logout/me/forgot (204 for known AND unknown
address)/reset/verify behave as in R; anonymous `/api/auth/me` and `/api/households` → 401;
`grep -rnE "\bgroupId\b|activeGroupId|createOwnedGroup|loadUserGroups" apps/api/src` finds nothing
(the `server.group.groupIdMissing` key does not match and stays — decision 5; never edit
`middleware/household.ts` or the server catalogs to satisfy it).

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/auth.test.ts apps/api/test/password-reset.test.ts apps/api/test/smoke.test.ts`;
`cd H && bun test`;
`cd H && ! grep -rnE "\bgroupId\b|activeGroupId|createOwnedGroup|loadUserGroups" apps/api/src`.

---

### M1-T08b — Seed, reset-password, scripts, verified-email-gate test (build)

**Goal.** `bun run seed` (core part), `bun run auth:reset-password`, their package scripts, and
`verified-email-gate.test.ts` adapted so the CORE gate stays fully covered: the recipe-only cases go
to M2, the gate-behaviour cases are retargeted to core gated writes, never deleted.

**Read.** SPEC D4, §4 (users); R/CLAUDE.md gotchas "AN UNCONFIRMED E-MAIL ADDRESS MAKES AN ACCOUNT
READ-ONLY…" (the per-route gating list: `PATCH /:groupId` and `POST /:groupId/invites` are gated,
invite accept and leaving are not), "`bun test` gets a silent ConsoleMailer"; R/docs/API.md
"Unconfirmed accounts are read-only". Sources: `R/apps/api/scripts/{seed,reset-password}.ts`,
`R/apps/api/test/verified-email-gate.test.ts`, `R/package.json` + `R/apps/api/package.json`
(scripts); `H/apps/api/src/core/routes/households.ts` (T04),
`H/apps/api/src/core/services/households/modules.ts` (T04).

**Work.**
1. `scripts/seed.ts` → `apps/api/scripts/seed.ts` (R's header rewritten to: "bun run seed — creates
   the demo user demo@toon.local / demo1234 and the demo household "Familie" (owner), with the
   default module rows. Idempotent. M2 adds the recipe demo content, M3 the finance demo ledger."):
   keep R's user + group blocks with the rename table (`groups` → `households`, …) and after the
   owner membership insert call `await initializeHousehold(db, householdId)` (from
   `../src/core/services/households/modules.ts`); delete everything from the tag block onward plus
   the now-unused imports and helpers (`parseSectionedSteps`, `HEADING_LINE`, `DAY_MS`) with one
   comment `// M2: tags, courses, demo recipes, plan entries, cook log and the demo shopping list
   (toon-recipe scripts/seed.ts) return with the recipe module.` Keep `runMigrations`, the final
   log line and `client.close()` if R has it.
2. `scripts/reset-password.ts` → `apps/api/scripts/reset-password.ts`: imports `../src/services/…`
   → `../src/core/services/…`; nothing else.
3. Scripts: `apps/api/package.json` gains `"seed": "bun scripts/seed.ts"`, `"auth:reset-password":
   "bun scripts/reset-password.ts"`; root `package.json` gains `"seed": "bun --filter @toon/api
   seed"`, `"auth:reset-password": "bun --filter @toon/api auth:reset-password --"` (R's exact
   strings). Run `bun install` so `bun.lock` stays consistent (expect no lock change).
4. `test/verified-email-gate.test.ts` → `apps/api/test/verified-email-gate.test.ts`: rename table;
   `../src/services/` → `../src/core/services/`; `/api/groups` → `/api/households`; the
   `Account.groupId` field and `register()` helper → `householdId` from `payload.households[0]?.id`
   (error text "registration produced no household"); response fields per the shared schemas. Test
   titles stay as in R. Then, case by case (R line numbers approximate):
   - "an unconfirmed account can still READ everything" (~123): keep; drop from the path array the
     entries containing `/recipes`, `/tags`, `/collections`, `/shopping-lists`, `/imports`, `/plan`,
     and `"/api/cards"`.
   - "every write answers 403 email_unverified": DELETE the five recipe/import/shopping/cards
     tests ("recipes, tags and collections", "every import source…", "the import upload routes
     reject BEFORE reading the body", "shopping lists…", "saving a card…"); KEEP "creating a group,
     renaming one, and inviting into one" (paths renamed).
   - "403, never 401 — a valid session must not be logged out over this" (~252): RETARGET the write
     to `PATCH /api/households/${account.householdId}` body `{ name: "Spam" }` → 403; the
     `/api/auth/me` → 200 assertion stays.
   - "accept an invite — the write that must never be gated" (~270): keep the invite + accept
     steps; DROP the two standalone assertions on `/recipes` (GET) and `/tags` (POST) and put in their
     place: `GET /api/households/${host.householdId}` with the invited cookie → 200 (it can READ the
     household it joined) and `POST /api/households` body `{ name: "Eigener Haushalt" }` with the
     invited cookie → 403 (still cannot write); the explanatory comment stays.
   - "leave a group…" (~305): keep (paths renamed; it has no recipe request).
   - "ask for a new confirmation mail, and change its own profile": keep verbatim.
   - "the same session can write immediately afterwards" (~354): RETARGET both writes to `PATCH
     /api/households/${account.householdId}`, bodies `{ name: "Vorher" }` → 403 and, after
     `confirm(account)`, `{ name: "Nachher" }` → **200** (PATCH answers 200, not 201); the
     "No re-login" comment stays.
   - "the TIMESTAMP is what counts, not the boolean" (~376): RETARGET to `PATCH
     /api/households/${account.householdId}` `{ name: "Spam" }` → 403 and `errorCode` ===
     `"email_unverified"`.
   - "an unconfirmed account writes freely" (~397): RETARGET to `PATCH
     /api/households/${account.householdId}` `{ name: "Ohne Mailserver" }` → **200**.
   - the `bun test` default, `/api/health`, and "the override is handed back" tests: verbatim.
   Add ONE comment at the top of the "every write answers 403" describe: `// M2: the
   recipe/tag/collection/import/shopping/plan/cards write cases (and the /recipes, /tags reads and
   writes of the invite test) of toon-recipe test/verified-email-gate.test.ts return with the recipe
   module.` Keep every `setVerifiedEmailRequired(null)` / `setMailer(null)` handback. Remove helper
   functions that end up unused (typecheck/lint).

**Files.** `apps/api/scripts/{seed,reset-password}.ts`, `apps/api/package.json`, `package.json`,
`bun.lock` (only if changed), `apps/api/test/verified-email-gate.test.ts`.

**Acceptance.** `bun run seed` against a fresh file DB is idempotent and leaves Familie with its
`recipe` module row; `bun run auth:reset-password` without args prints R's usage and exits 1 (as in R); the
gate test contains, as executable tests, 403-not-401, accept-invite (+ read OK / write 403),
leave, confirm-lifts-the-gate (403 → confirm → 200 in the same session), timestamp-not-boolean,
and no-mail-transport-writes-freely, all on `/api/households…` writes; no `/recipes`, `/tags`,
`/collections`, `/shopping-lists`, `/imports`, `/cards` path remains in it.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/verified-email-gate.test.ts`;
`cd H && bun test`;
`cd H && ! grep -nE "/recipes|/tags|/collections|/shopping-lists|/imports|/api/cards|/api/groups" apps/api/test/verified-email-gate.test.ts`;
`cd H && for t in "never 401" "can write immediately afterwards" "TIMESTAMP is what counts" "writes freely" "accept an invite"; do grep -q "$t" apps/api/test/verified-email-gate.test.ts || exit 1; done`;
`cd H && rm -f data/m1-t08-seed.db* && DATABASE_URL=file:./data/m1-t08-seed.db bun run db:migrate && DATABASE_URL=file:./data/m1-t08-seed.db SESSION_SECRET=0123456789abcdef0123 bun run seed && DATABASE_URL=file:./data/m1-t08-seed.db SESSION_SECRET=0123456789abcdef0123 bun run seed`;
`cd H && ! grep -rnE "\bgroupId\b|activeGroupId|createOwnedGroup" apps/api/scripts`.

---

### M1-T09 — API module enabling + hooks (core)

**Goal.** `POST`/`DELETE /api/households/:householdId/modules/:moduleId` per decision 3, the
`onEnable` hook, tests for the whole module gate from enable to `requireModule`. Depends on T04
(household routes/services) AND T08 (`/api/auth` mounted: test (a) reads `GET /api/auth/me`, and
users are created through `POST /api/auth/register`).

**Read.** SPEC D2, D3 (why `onEnable` may refuse), D8, §2; this plan §1 decisions 2–4; `H/CLAUDE.md`
gotchas "Middleware chain order is load-bearing", "`file::memory:` is per client"; R/CLAUDE.md
"libSQL 0.17.4 discarded a `file::memory:` DB on transaction commit…". Sources (H):
`apps/api/src/core/services/households/{modules,support,households.service}.ts`,
`apps/api/src/core/routes/{households,members}.ts`, `apps/api/src/middleware/{household,module,
verifiedEmail}.ts`, `apps/api/src/modules/{types,mount,index}.ts`, `apps/api/test/middleware.test.ts`.

**Work.**
1. `core/services/households/modules.ts` gains
   `enableModule(db, householdId, moduleId: ModuleId, settings: Record<string, unknown> | undefined,
   modules: readonly ApiModule[] = API_MODULES): Promise<void>` — inside `withTransaction`: the
   build module (if any) `onEnable?.(householdId, settings ?? null, tx)`; then insert
   `{ householdId, moduleId, enabledAt: now, settings: settings === undefined ? null :
   JSON.stringify(settings) }` with `onConflictDoUpdate` on (householdId, moduleId) setting
   `settings` only when `settings !== undefined` (otherwise `onConflictDoNothing`); and
   `disableModule(db, householdId, moduleId): Promise<void>` (delete; no error when absent).
2. `core/routes/modules.ts`: `registerModuleRoutes(router)` adding
   `POST /:householdId/modules/:moduleId` and `DELETE /:householdId/modules/:moduleId`, each
   `requireSession(), requireHouseholdRole("admin"), requireVerifiedEmail()`; the param is checked
   with `isModuleId` (else `throw ApiError.notFound()`); POST validates the optional JSON body with
   `EnableModuleRequestSchema` (empty body = `{}`; use the same `zValidator` + `onValidationError`
   pattern as `households.ts`, or parse manually when the body is empty) and answers `json(c, {
   household: await getHouseholdWithRole(db, membership.householdId, membership.role) })` with
   `const membership = requireMembership(c)` (from `../../lib/types.ts`, as the other household
   routes do — the third parameter is the caller's ROLE, not a user id); DELETE answers `noContent`.
   Header comment: the gating decision (admin + verified e-mail: a household-wide settings write,
   like PATCH `/:householdId`) and that data stays on disable. In `households.ts` replace the
   `// M1-T09:` comment with `registerModuleRoutes(householdRoutes);`.
3. Tests `apps/api/test/modules.test.ts` (shared `db` + `runMigrations(db)`; users and sessions
   created through `POST /api/auth/register` on the real `app` (T08), extra households through
   `POST /api/households`, or direct inserts as `middleware.test.ts` does):
   (a) `POST /api/households` → `modules: ["recipe"]`, and `GET /api/auth/me` lists it the same;
   (b) owner `POST …/modules/finance` → 200, `household.modules` `["recipe","finance"]`; a second
   POST → 200 and `enabled_at` unchanged; (c) `POST` with `{ settings: { a: 1 } }` stores
   `'{"a":1}'`; (d) `DELETE …/modules/recipe` → 204, GET reports `["finance"]`, DELETE again 204;
   (e) member → 403 `forbidden`, admin → 200, non-member → 403, no cookie → 401, `…/modules/nope` →
   404 `not_found`; (f) with `setVerifiedEmailRequired(true)` an unconfirmed admin gets 403
   `email_unverified` (hand back with `setVerifiedEmailRequired(null)` in `afterAll`);
   (g) end to end: a test Hono app (copy `testApp()` from `middleware.test.ts`) with
   `mountModules(app, [fakeFinance])` where `fakeFinance.householdRouter` answers `GET /ping` →
   404 `module_disabled` before enabling, 200 after enabling through the REAL `app`'s POST, 404 again
   after DELETE; (h) `enableModule(db, id, "finance", undefined, [moduleWithRefusingOnEnable])`
   rejects with the thrown `ApiError` and writes no row; (i) `initializeHousehold(db, id,
   [moduleWithRecordingHook])` calls `onHouseholdCreated` once with the id.

**Files.** `apps/api/src/core/services/households/modules.ts`, `apps/api/src/core/routes/modules.ts`,
`apps/api/src/core/routes/households.ts` (one line), `apps/api/test/modules.test.ts`.

**Acceptance.** All cases pass; `GET /api/households/:id` reports `modules`; the chain order of
`middleware.test.ts` is untouched and still green.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/api/test/modules.test.ts`;
`cd H && bun test apps/api`.

---

### M1-T10 — Web router, guards, module layout, nav items, banner, `module_disabled` (core)

**Goal.** Wire everything into the route tree (decision 8) with the module layout factory that
proves the disabled-module redirect is wired, compute nav items from the session's enabled modules
with Profil and the core Gruppen item, restore `UnverifiedEmailBanner`, handle `module_disabled`
responses (decision 9).

**Read.** SPEC D6, §2, §3 (router), §5; this plan §1 decisions 8, 9; R/CLAUDE.md "Navigation"
(reachability), gotchas "SCREENS ARE CODE-SPLIT WITH `lazyRouteComponent`" (router header),
"Bottom action bar needs `bottom-tabbar`…", "A page component must NOT re-apply…"; `H/CLAUDE.md`
gotchas "No module-level constants over `WEB_MODULES`", "Open type seam for M2";
`H/docs/design/recipe-redesign/specs/05-frontend-shell.md` §5, §7, §9, §11. Sources:
`R/apps/web/src/router.tsx` (helpers `optionalString`/`pick`, root with SessionProvider, the public
routes, `appRoute` with RequireAuth, `groupScopedRoute`, `/groups`, `/groups/$groupId`, `/settings`),
`R/apps/web/src/components/layout/{AppShell,UnverifiedEmailBanner}.tsx`; `H/apps/web/src/{router.tsx,
components/layout/{nav-items,nav-items.test,use-nav-items,AppShell}.ts(x),lib/query-client.ts}`.

**Work.**
1. `router.tsx`: keep H's header (update the route map) and module layout mechanics; add R's
   `optionalString`/`pick`, `RootLayout` with `<SessionProvider>`, the seven public routes under
   root with R's `validateSearch` (eager imports from `@/core/features/auth/*`), `AppLayout` =
   `<RequireAuth><AppShell><Outlet/></AppShell></RequireAuth>`, `/households` and
   `/households/$householdId` and `/settings` as `lazyRouteComponent` children of `appRoute`, a
   pathless `householdScopedRoute` (`id: "household-scoped"`, `<RequireActiveHousehold>`) holding
   `homeRoute` and the module layouts; each module layout's `component` is
   `moduleLayoutComponent(module.id)` (step 1b; never an inline component, never wrapping a lazy
   screen). `routes` export gains the new routes. No `/search` or recipe routes.
1b. `modules/layout.tsx` (imports `type ReactElement` from `react` — React 19 has no global `JSX`
   namespace —, `type ModuleId` from `@toon/shared`, `Outlet` from `@tanstack/react-router` and
   `RequireModule` from `@/lib/session`; never the registry):
   ```tsx
   /** The component of every module's layout route (SPEC D2, §5): the guard sits ABOVE the module's
    *  lazy screens, so a disabled module redirects Home before any module chunk loads. */
   export function moduleLayoutComponent(moduleId: ModuleId): () => ReactElement {
     return function ModuleLayout() {
       return <RequireModule moduleId={moduleId}><Outlet /></RequireModule>;
     };
   }
   ```
   `modules/layout.test.tsx` (no DOM needed: `ModuleLayout` uses no hooks, so calling it returns
   the element tree): for `"recipe"` and `"finance"`, `const el = moduleLayoutComponent(id)()`;
   `expect(el.type).toBe(RequireModule)`, `expect(el.props.moduleId).toBe(id)`,
   `expect(el.props.children.type).toBe(Outlet)`. Together with T05's `moduleGuard` test this is the
   executable proof of the exit criterion "a route under a disabled module redirects to Home".
   If importing `@/lib/session` under `bun test` fails for an environment reason, report the error
   verbatim and fall back to asserting `el.type.name === "RequireModule"` via a re-export — never
   delete the test.
2. `nav-items.ts`: `NavPath` adds `"/households" | \`/households/${string}\``; new exports
   `PROFILE_NAV_ITEM` (`/settings`, `common.nav.profile`, `CircleUser`, `exact: false`) and
   `HOUSEHOLDS_NAV_ITEM` (`/households`, `common.nav.groups`, `Users`, `exact: false`);
   `primaryNavItems`: inside a module `[...module.navItems, PROFILE_NAV_ITEM]`, outside
   `[HOME_NAV_ITEM, ...enabledModuleTabs(max 2), PROFILE_NAV_ITEM]`; `secondaryNavItems`:
   `[...(active module's secondaryNavItems ?? []), HOUSEHOLDS_NAV_ITEM]`. `activeModule` keeps its
   signature (T11 uses it). Update the doc comments ("+ Profil from M1" → done).
   `nav-items.test.ts`: outside a module with no modules → Home, Profil; with two fake enabled
   modules + one disabled → Home, A, B, Profil; three enabled → only two module tabs; inside a module
   → its three items + Profil; secondary always ends with the households item.
3. `use-nav-items.ts`: `enabledModuleIds` = `useSession().activeHousehold?.modules ?? []`.
4. `components/layout/UnverifiedEmailBanner.tsx` ← R's (`"ui.` → `"common.`, `AppLink` from
   `@/lib/nav`); `AppShell.tsx` renders it where R's AppShell does (after `UpdateBanner`); update
   AppShell's doc comment (no auth guard note → "RequireAuth wraps it in router.tsx").
5. `lib/query-client.ts`: `createQueryClient()` builds `new QueryCache({ onError })` and
   `new MutationCache({ onError })` whose `onError` invalidates `queryKeys.me()` when
   `isApiError(error) && error.code === "module_disabled"`; doc comment cites SPEC §5.
   `lib/query-client.test.ts`: a query whose fn throws `new ApiError({ code: "module_disabled",
   status: 404, message: "x" })` makes the `["toon","me"]` query invalid (seed it with
   `setQueryData` first, then assert `getQueryState(...).isInvalidated`); another code does not.

**Files.** `apps/web/src/router.tsx`, `apps/web/src/components/layout/{nav-items.ts,nav-items.test.ts,
use-nav-items.ts,AppShell.tsx,UnverifiedEmailBanner.tsx}`, `apps/web/src/lib/{query-client.ts,
query-client.test.ts}`, `apps/web/src/modules/{layout.tsx,layout.test.tsx}`.

**Acceptance.** Unauthenticated `/` redirects to `/login?next=/`; `/login`, `/register`,
`/invite/$token` render without the shell; `/settings` and `/households` render inside the shell
without an active household; every module layout route's component is
`moduleLayoutComponent(module.id)` (layout test green); nav tests green; build emits separate
chunks for HouseholdsPage, HouseholdDetailPage, SettingsPage.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/web/src/components/layout apps/web/src/lib apps/web/src/modules`;
`cd H && bun run build`; `cd H && ls apps/web/dist/assets | grep -q SettingsPage`;
`cd H && grep -q "moduleLayoutComponent(" apps/web/src/router.tsx`.

---

### M1-T11 — Web Home, ModuleSwitcher, SideNav, PhoneHeaderRow (core)

**Goal.** The household Home (§5): household name + switcher, one `homeCard` per enabled build
module, the empty state, enable-module cards and "Module verwalten" for owners/admins; the
ModuleSwitcher in its two chrome variants; SideNav with the household switcher, the module group
and the footer account row; `PhoneHeaderRow`.

**Read.** SPEC D2, D5, D6, §5; this plan §1 decisions 3, 8; R/CLAUDE.md locked decision 2 (236 px /
1204 px), gotchas "THE PALETTE IS DECLARED FOUR TIMES…", "THE DISPLAY FAMILY SHIPS EXACTLY ONE
WEIGHT…", "NEVER write `px-4 px-safe`…", "A page component must NOT re-apply…", "A header gets ONE
overflow trigger…", "Text next to an icon in a `flex` `<p>` must be ONE child", "`useCanMutate()`…";
`H/docs/design/recipe-redesign/SPEC.md`, `specs/01-design-system.md` §2 (type scale, `.eyebrow`),
`specs/05-frontend-shell.md` §3 (SideNav rows 1–6), §4 (switcher chip/sidebar variants), §6.2
(PhoneHeaderRow), §8 (the `+` sheet as the ActionMenu pattern). Sources:
`R/apps/web/src/components/layout/{SideNav,PhoneHeaderRow}.tsx`; `H/apps/web/src/components/
{layout/SideNav.tsx,layout/index.ts,ui/ActionMenu.tsx,ui/Card.tsx,ui/Switch.tsx,ui/ConfirmDialog.tsx,
ui/EmptyState.tsx}`, `H/apps/web/src/core/features/home/HomePage.tsx`,
`H/apps/web/src/core/features/households/HouseholdSwitcher.tsx` (T07), `H/apps/web/src/modules/
{enabled,types}.ts`, `H/apps/web/src/lib/session.tsx` (T05).

**Work.**
1. `components/layout/module-switcher-items.ts` (pure): `moduleSwitcherItems(modules, enabledIds)`
   → `[]` when no build module is enabled, else `[{ to: "/", labelKey: "home.nav.label", icon:
   House }, ...enabled modules as { to: basePath, labelKey: nameKey, icon }]`; test file next to it.
2. `components/layout/ModuleSwitcher.tsx`: `variant: "chip" | "segmented"`; renders `null` when
   the items are empty. Chip (phones): a button with the active entry's icon + label
   (`activeModule(pathname, WEB_MODULES)` or Home) opening an `ActionMenu` titled
   `home.moduleSwitcher.title` whose items navigate; segmented (sidebar from `lg`): a
   `role="group"` row (`aria-label` `home.moduleSwitcher.label`) of `Link`s with `aria-current` on
   the active one, `bg-brand-soft text-brand-soft-fg` for active (the SideNav active treatment).
   Only tokens and the type scale; no arbitrary `text-[…px]`.
3. `components/layout/PhoneHeaderRow.tsx` ← R's with `GroupSwitcher` → `HouseholdSwitcher` (chip)
   and the ModuleSwitcher chip beside it; `lg:hidden`.
4. `components/layout/SideNav.tsx`: R's row structure with H's nav items: row 1 logo + wordmark
   (`home.appName`), row 2 `HouseholdSwitcher` sidebar variant, row 2b `ModuleSwitcher
   variant="segmented"`, row 3 primary items (no counts, no "Neu" pill), row 4 Organise group
   (secondary items), row 5 the footer user row (Avatar + name, link to `/settings`,
   `common.sidenav.accountAction`). Drop R's `useShoppingLists` and recipe counts (M2/M4).
   `components/layout/index.ts` exports `ModuleSwitcher`, `PhoneHeaderRow`.
5. `core/features/home/lib/queries.ts`: `useEnableModule()` / `useDisableModule()` mutations over
   `enableModule` / `disableModule` (T05) invalidating `me`, `households`, `household(id)`; toasts
   `home.modules.enabledToast` / `disabledToast`; errors via `errorMessage`.
6. `core/features/home/ModuleCards.tsx`: "Verfügbare Module" section over
   `availableWebModules(WEB_MODULES, modules)`: a `Card` per module (icon, `t(nameKey)`, button
   `home.modules.enable` for `hasRole("admin")`, else the `home.modules.memberHint` line); renders
   nothing when the list is empty. Buttons disabled by `useCanMutate()`.
   `core/features/home/ManageModulesDialog.tsx`: `Dialog` with `home.modules.manage` /
   `manageDescription`, one row per build module with a `Switch` (on = enabled); switching off asks
   `ConfirmDialog` (`disableConfirmTitle` / `disableConfirmDescription` with `{name}`,
   confirm label `home.modules.disable`).
7. `HomePage.tsx`: `PhoneHeaderRow` on top; `PageHeader` with `above={<span className="eyebrow
   text-fg-faint">{t("home.eyebrow")}</span>}` and `title={household.name}` (content, not `t()`),
   actions = "Module verwalten" button for admins when `WEB_MODULES.length > 0`; then the grid of
   `enabledWebModules(WEB_MODULES, household.modules).map(m => <m.homeCard key={m.id} />)` or, when
   empty, the existing `EmptyState` (`home.empty.*`); then `ModuleCards`. Household from
   `useActiveHousehold()` (Home sits under RequireActiveHousehold after T10). Page root stays a
   plain `flex flex-col gap-4`.

**Files.** `apps/web/src/components/layout/{ModuleSwitcher.tsx,module-switcher-items.ts,
module-switcher-items.test.ts,PhoneHeaderRow.tsx,SideNav.tsx,index.ts}`,
`apps/web/src/core/features/home/{HomePage.tsx,ModuleCards.tsx,ManageModulesDialog.tsx,lib/queries.ts}`.

**Acceptance.** With `WEB_MODULES` empty Home shows the household name, the empty state, no
switcher and no manage button; switcher items test green; SideNav keeps `w-sidebar` and
`bg-bg-sunken`; no `@/modules` import in any file a manifest could import (only screens and layout
components that are not imported by `lib/` or `modules/*/`).

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/web/src/components/layout`;
`cd H && bun run build`; `cd H && ! grep -rnE "text-\[[0-9.]+px\]" apps/web/src/components/layout apps/web/src/core/features/home`.

---

### M1-T12 — Integration (build)

**Goal.** Prove the exit criteria on the merged tree: an API walkthrough test, the gates, the curl
walkthrough against a real server, the headless render, CLAUDE.md "Commands".

**Read.** this plan; SPEC §7; R/CLAUDE.md "Verification gates" and gotcha "Verify a phone layout
in a real headless browser" (incl. "Do NOT match the tab bar by its aria-label"); R/README.md
"Smoke test against a real server"; `H/docs/plans/m0-scaffold.md` §2 M0-T12 (the same procedure).

**Work.**
1. `apps/api/test/core-walkthrough.test.ts` (through `app.request`, shared `db`): A registers
   (201, `households[0].modules = ["recipe"]`), logs out, logs in; A creates "WG" (201); A invites
   b@… (201, `inviteUrl`); B registers WITHOUT invite, then `POST /api/households/invites/accept
   {token}` (200, B member of WG); B `PATCH /api/auth/me {activeHouseholdId: WG}` and `GET
   /api/auth/me` reports it (switch); A enables `finance` on WG (200, modules `["recipe","finance"]`),
   B's POST → 403; B sees the modules on `GET /api/households/:WG`; A disables `recipe` (204); B's
   `GET /api/auth/me` shows WG with `["finance"]`.
2. Gates with logs: `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, `bun run
   build`, `bun run i18n:check` — classify every hit (expected: comment quotes; ported literals like
   `inviteMail`'s `"Rezepte"` fallback and seed's demo names = content class; a parity failure is a
   bug unless its key is in `NEW_GERMAN`).
3. Real server: `rm -f data/m1.db*`, `DATABASE_URL=file:./data/m1.db bun run db:migrate`, `… bun run
   seed`, then `DATABASE_URL=file:./data/m1.db SESSION_SECRET=<32 hex> bun run dev` in the
   background (log). curl the walkthrough of step 1 with cookie jars (`-c/-b`), plus
   `/api/health` (`modules: []`), `/uploads/x.png` → 404, demo login. Record each status line.
4. Headless (playwright in a scratch dir OUTSIDE the repo, background install, log with `exit=`):
   log in as demo via `fetch("/api/auth/login", {credentials:"include"})` from the page, then at
   390×844 and 1440×900: `/` shows "Familie" and "Noch keine Module aktiviert"; the phone tab bar
   (`nav.fixed`) shows exactly Start and Profil; the sidebar is visible at 1440 with the household
   switcher and the "Gruppen" item; `/settings` shows the profile, language, theme, e-mail and
   households cards; `/households` lists Familie; logged out `/` lands on `/login`;
   `documentElement.scrollWidth === clientWidth` everywhere; no console errors. Screenshots stay in
   the scratch dir.
5. `CLAUDE.md` "Commands": move `bun run seed` and `bun run auth:reset-password` from "Arrive later"
   into the list (one line each); leave every other section to the workflow's docs step. Commit
   `docs/plans/m1-core.md` too if it has uncommitted changes. Minimal integration fixes only, each
   its own commit naming the task it repairs.

**Files.** `apps/api/test/core-walkthrough.test.ts`, `CLAUDE.md`, `docs/plans/m1-core.md`
(+ any minimal integration fix, named in its commit).

**Acceptance.** Every step above recorded with its output; the exit criteria of §1 met.

**Verify.** `cd H && bun install --frozen-lockfile`; `cd H && bun run typecheck`; `cd H && bun test`;
`cd H && bun test apps/api/test/core-walkthrough.test.ts`; `cd H && bun run build`;
`cd H && bun run i18n:check 2>&1 | grep -A1 "1/2 German catalog parity" | grep -q OK`;
`cd H && rm -f data/m1-verify.db* && DATABASE_URL=file:./data/m1-verify.db bun run db:migrate && DATABASE_URL=file:./data/m1-verify.db SESSION_SECRET=0123456789abcdef0123 bun run seed`;
`cd H && grep -q "bun run seed" CLAUDE.md`.

## 3. Risks

1. **Haiku and the large ports (T04, T07, T08).** Each moves ~1,000+ source lines with renames.
   Mitigation: T07 (households) and T08 (auth) were split — Settings is T07b, and seed/scripts/the
   judgement-heavy gate test are T08b (build tier); the rename table, exact function names and
   import rewrites, the T04 `modules.ts` code given verbatim, grep verifies anchored on
   `\bgroupId\b` (so the kept `server.group.groupIdMissing` key never trips them; T02 fixes the one
   stale `/api/groups` comment beforehand), and the verifier's `diff` against R.
2. **`initializeHousehold` imports `modules/index.ts` from a core service.** Today the registry is
   empty; in M2 a manifest whose routes import `core/services/households/*` creates an import cycle
   through `modules/index.ts`. Functions-only cycles are safe in ESM, a top-level read is not: M2
   must keep `API_MODULES` reads inside functions (same rule as the web's `WEB_MODULES`).
3. **Tests that need recipe routes** (uploads "stored column", import source scans, the
   recipe/shopping half of the verified-email gate, the recipe-row cascade in households, seed
   content) are removed with `M2:` comments — M2 must restore each (listed in §6).
4. **`file::memory:` transactions.** `withTransaction` runs without a transaction under `bun test`
   (`transactionsSupported`), so the "refusing `onEnable` writes nothing" test (T09 h) passes only
   because the hook runs BEFORE the insert; keep that order.
5. **Typed links.** M0 left the route tree loose (any `to` compiles); ported `<Link to>`s therefore
   cannot be checked by tsc in M1. The headless pass (T12) is the check; M2 restores the strict tree.
6. **"A route under a disabled module redirects to Home" has no module route to exercise in M1.**
   Covered executably without a DOM: `moduleGuard` (the decision RequireModule acts on, T05), the
   `moduleLayoutComponent` element-tree test (every module layout renders RequireModule around its
   Outlet, T10), and the `module_disabled` → `me` invalidation test (T10). Not covered in M1: the
   toast/navigate effect itself in a browser — M2's headless pass must disable `recipe` and load
   `/recipe` (handed on in §6).
7. **sharp on CI/hosts.** Prebuilt binaries via optionalDependencies (not optional peers, so Bun 1.4
   installs them); if `bun install --frozen-lockfile` fails on CI, the lock must be regenerated with
   `bun add` on Linux x64, not hand-edited.
8. **Parallel edits of `apps/api/src/index.ts` are avoided by deps, not by wave luck**: T02 → T04
   → T08 is a dependency chain, and T09 (deps T04, T08) edits `households.ts` only. If an
   implementer needs `index.ts` in T09 or T08b, that is a plan bug: add the route in
   `households.ts` instead.
9. **Test retargeting in T08b.** The core gate tests now write through `PATCH
   /api/households/:id` (owner, verified e-mail). If that route's gating ever changes, these tests
   are the alarm; M2 adds the recipe write cases back next to them, it does not replace them.

## 4. Deviations expected (to be confirmed in "what changed vs plan")

One from SPEC §1, recorded in `docs/adr/0001-household-copy-without-recipe-counts.md` (D10, the
two recipe-count strings below, added after the M1 review). Plan-level choices to confirm:

- **Copy keeps R's "Gruppe" wording** in every household screen, the switcher, mails and server
  errors, and `DEFAULT_HOUSEHOLD_NAME` stays "Meine Rezepte" (D10 byte-identical rule). An app
  whose Home says "Haushalt" while the switcher says "Gruppe wechseln" is the visible cost; renaming
  values would change source strings and needs an ADR amending D10 — an owner decision for M4.
- `HouseholdWithRole` drops `recipeCount` and gains `modules` (§1 decision 2); two catalog values
  therefore lose their recipe count (`household.detail.meta`, `household.danger.warning`, both in
  `NEW_GERMAN`; ADR 0001).
- `household_modules` rows for `recipe` are written on every new household although the M1 build
  has no recipe module; `POST …/modules/:id` accepts any `MODULE_IDS` id.
- Disabling a module deletes its `household_modules` row (its `settings` are lost; module data is
  kept).
- SPEC §3's `core/routes/{households,members,invites,modules}.ts` are `register…Routes()`
  functions on one Hono instance, not separate sub-apps.
- `lib/nav.tsx` (R's `features/recipes/lib/nav.tsx`) is core; `lib/permissions.ts` (`hasAtLeast`
  from R's `features/recipes/lib/permissions.ts`) and `lib/share.ts` (the share block of R's
  `features/recipes/lib/hooks.ts`) are core; `core/services/media/uploads.ts` (R's
  `services/recipes/uploads.ts`) is core.
- `verified-email-gate.test.ts`'s gate-behaviour cases write through `PATCH /api/households/:id`
  and `POST /api/households` instead of R's recipe/tag routes (T08b); R's recipe-route cases return
  in M2.
- Server keys `server.group.*` and the `{groupName}` placeholders keep their names.
- No new migration; no SW rule changes.

## 5. Out of this milestone

Every recipe and finance feature (M2/M3), module `homeCard`s with data and the switcher's visual
polish (M4), finance participants and `finance_settings` (M3), `uploads:gc` (M2), `plan:run` (M3),
the strict route tree and module routes reaching their layout (M2 obligation from M0), module SW
rules (M2/M3), the copy rename "Gruppe" → "Haushalt" (owner/ADR, M4 at the earliest),
`migrate:legacy` (M5), Docker/Caddy (M6), `docs/API.md` and `docs/modules/*.md` (M7).

## 6. Obligations

Closed by M1 (from M0): the two `auth.settings.language.*` tests and the `"auth."`/`"household."`
prefixes (T03); `lib/session.tsx`, `UnverifiedEmailBanner`, the switchers, `/uploads` + thumbnails
+ sharp, `seed`, `auth:reset-password` (T05, T10, T11, T02, T08b).

Closed by the M1 review fix: the core cases of toon-recipe `packages/shared/test/schemas.test.ts`
(`ApiErrorSchema` envelope and bare message, `RegisterRequestSchema` e-mail normalisation and short
password) are ported into `packages/shared/test/core.test.ts`. The remaining cases of that file are
recipe/plan/import/shopping schemas and are handed to M2 (port them with their schemas into
`packages/shared/test/`).

Handed to M2: restore the `M2:` placeholders of `uploads.test.ts`, `verified-email-gate.test.ts`
(ADDING the recipe cases next to the retargeted core ones), `households.test.ts` (recipe-row
cascade) and `seed.ts`; the recipe module imports `hasAtLeast` from `@/lib/permissions` and the share
helpers from `@/lib/share` (its own `lib/hooks.ts` drops the share block, `canModifyOwn` lives in the
module); the headless check that a disabled
`recipe` redirects `/recipe` to Home with the toast; keep `API_MODULES`/`WEB_MODULES` reads inside
functions (risk 2). M0's M2/M3 obligations stand unchanged.

## 7. Integration record (M1-T12, 2026-10-13)

Run on the merged tree at `80d273b` plus the new `apps/api/test/core-walkthrough.test.ts`. No
integration fix was needed, so there is no repair commit.

**Gates** (each with its own log, last line `exit=$?`):

| Gate | Result |
| --- | --- |
| `bun install --frozen-lockfile` | `Checked 431 installs across 620 packages (no changes)`, exit 0 |
| `bun run typecheck` | all five tsc projects, `[typecheck] OK`, exit 0 |
| `bun test` | 426 pass, 0 fail, 1949 expect() calls, 30 files, exit 0 (was 214 in 16 files at M0) |
| `bun test apps/api/test/core-walkthrough.test.ts` | 9 pass, 0 fail |
| `bun run build` | Vite build + PWA generateSW, `precache 29 entries (752.22 KiB)`, exit 0 |
| `bun run i18n:check` | exit 1 by design; half 1/2 (German catalog parity) `OK`; half 2/2 lists 16 hits |

**i18n:check half 2/2, every hit classified.** All 16 are the "comment quote" class (a German UI
label or an umlaut example quoted inside a doc comment; no German string literal reaches `t()`-less
UI code): `ModuleCards.tsx:17` ("Verfügbare Module", new Home copy quoted in a comment),
`InstallPrompt.tsx:8`, `ConfirmDialog.tsx:21`, `Chip.tsx:26`, `pwa.ts:3`, `validation.ts:12`,
`storage.ts:17` (inherited from toon-recipe, were 11 hits at M0), `db/schema/core.ts:13`,
`passwordReset.ts:8`, `mail/index.ts:71`, `mail/smtp.ts:24,440,441` and `households/support.ts:59,60,62`
(ported with the auth and household services). There is no content-class hit (the `"Rezepte"`
fallback and the seed's demo names do not trip the heuristic) and no parity failure.

**Real server.** `data/m1.db` fresh: `bun run db:migrate` exit 0, `bun run seed` exit 0 (demo login
printed), `bun run dev` with `SESSION_SECRET` set; `curl` with cookie jars (`-c`/`-b`), status
line per call:

```
200 GET /api/health                       {"ok":true,"status":"ok",...,"modules":[],"features":{"verifiedEmailRequired":false}}
404 GET /uploads/x.png                    {"error":{"code":"not_found",...}}
200 POST /api/auth/login (demo)           200 GET /api/auth/me (demo)
201 POST /api/auth/register (A)           204 POST /api/auth/logout        401 GET /api/auth/me (old cookie)
200 POST /api/auth/login (A)              201 POST /api/households {name:"WG"}  (modules ["recipe"])
201 POST /api/households/:WG/invites      201 POST /api/auth/register (B, no invite)
200 POST /api/households/invites/accept   200 PATCH /api/auth/me {activeHouseholdId:WG}
200 POST /api/households/:WG/modules/finance (A)  modules ["recipe","finance"]
403 POST /api/households/:WG/modules/finance (B)  forbidden
200 GET  /api/households/:WG (B)          modules ["recipe","finance"]
204 DELETE /api/households/:WG/modules/recipe (A)
200 GET  /api/auth/me (B)                 WG modules ["finance"]
200 GET  http://localhost:5173/api/health (through the Vite proxy)  modules []
```

**Headless** (playwright 1.64 + the cached chromium 1248, installed in a scratch dir outside the
repo, `bun add` log ends `exit=0`; demo login via `fetch("/api/auth/login")` from the page), 34
checks, all pass, at 390x844 and 1440x900: logged-out `/` lands on `/login`; Home shows "Familie"
and "Noch keine Module aktiviert"; at 390 the tab bar (`nav.fixed`) is exactly "Start", "Profil"
and the sidebar is hidden; at 1440 the sidebar (`aside[data-app-shell]`) is visible with the
household switcher ("Familie", "1 Mitglied") and "Gruppen" under ORGANISIEREN, the tab bar is
hidden; `/settings` shows the cards "Dein Konto", "Sprache", "Aussehen", "E-Mail-Adresse",
"Gruppen"; `/households` lists "Familie"; no console error while logged in. Two measurement notes:
(1) `<html>` carries `scrollbar-gutter: stable` (inherited verbatim from toon-recipe), so under
classic desktop scrollbars `scrollWidth` is 375 / 1425 against `clientWidth` 390 / 1440; the check is
therefore `scrollWidth <= clientWidth` (no horizontal overflow), not strict equality; (2) the only
console error on the logged-out `/login` visit is the browser's own line for the `401` of the
`/api/auth/me` session probe, expected and filtered to that single class.

**Exit criteria (§1).** Five gates green (typecheck, test, build, install; i18n:check parity OK,
leftover hits all comment quotes); walkthrough in tests and curl; Home empty state at 390 and
1440 px; `GET /api/households/:id` returns `modules`; `moduleGuard` and `moduleLayoutComponent`
tests are part of the 426 passing tests. M1 exit criteria met.
