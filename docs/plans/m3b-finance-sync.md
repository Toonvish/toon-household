# M3b — finance-sync: plan

**Status: PLANNED (2026-10-15).** Sections 9 (integration record) and 10 (what changed vs plan) are
written by M3b-T12.

Milestone M3b of `docs/SPEC.md` §8, written by the planner of the `build-household` workflow. Paths:
`H` = `/home/erics/software/toon-household` (this repo), `R` = `/home/erics/software/toon-recipe`,
`F` = `/home/erics/software/toon-finance` (both READ-ONLY: `cat`, `grep`, `diff`, `git log`, `git show`,
`cp` out of them; never `bun install`, `bun test`, `sqlite3` or any script inside them).

Goal: bring the finance module and the legacy migration up to F `origin/main` = `1715207` (what
production runs). M3 was ported from F `cbdec67`; seven commits followed:

| F commit | Subject | Where it goes |
| --- | --- | --- |
| `97ab955` | shared-host deploy tooling (toon-edge, deploy.yml, toon-deploy.sh, env.example) | NOT here: M6 (section 7.2) |
| `00ea694` | "Erfassen" as a global sheet, petrol palette, list grouped by day | behaviour + copy: T03, T04; palette/tabs: not ported (decisions 9, 10) |
| `760639d` | redesign-review fixes (gotchas 62-65, required labels, separator) | T03, T04 |
| `590697f` | publish on every push (release.yml) | NOT here: M6 |
| `b1b517d` | placeholder members + claim invites | core: T01, T05, T10; finance: T07, T11; migration: T08, T09 |
| `8978cad` | typography / styling / icons aligned with toon-recipe | nothing to port (H already IS toon-recipe's system, D5); hunk audit in T03/T04 |
| `1715207` | security-review fixes (gotchas 66-74) | core: T06; finance: T07; web: T10, T11 |

Exit (SPEC §8 M3b and the workflow): gates green; every F test file at `1715207` has a passing
counterpart (the m3 plan's test map updated); a test proves a migrated placeholder is claimable by
register on the fixtures; the real-data dry run
`bun run migrate:legacy -- --recipe-db migration-in/recipe/local.db --recipe-uploads migration-in/recipe/uploads --finance-db migration-in/finance/local.db --report migration-out/m3b-dry-run.json`
(with `DATABASE_URL=file:./migration-out/toon.db UPLOAD_DIR=./migration-out/uploads`) exits 0 with no
errors, the finance balance OK and the placeholder plus its claim invite listed; `--apply` into
`migration-out/`, then a second `--apply` writes nothing; the changed finance screens (the Erfassen
sheet, the participants section with the placeholder flow, the claim-invite registration) verified at
390px and 1440px with screenshots in `docs/plans/screenshots/m3b/` using seeded demo data only.

**The owner's backups are never copied.** `migration-in/` and `migration-out/` are gitignored
(`.gitignore` lines 20-21). No file, report, row content, name or e-mail address from them enters the
tree, a plan, a screenshot, a commit message or a test. This plan and the integration record quote
only counts and the balance verdict. A command that prints the report to stdout redirects it into
`migration-out/` (or a `mktemp -d` directory), and nobody pastes it anywhere.

## 1. Context

### 1.1 State of H at plan time (`7b974b1`)

- M0 to M5 are done; `bun test` 2016 pass in 115 files (measured for this plan), typecheck and build
  green, `i18n:check` parity OK and 138 classified leftover hits (CLAUDE.md).
- Core `users` (`apps/api/src/db/schema/core.ts` lines 25-63): `email text NOT NULL` with
  `uniqueIndex("users_email_unique")`, no `email_normalized` column (R's model: `email` is stored
  lower-cased and trimmed, `createUser`), `password_hash` already nullable (OAuth-only accounts).
- Core `household_invites` (lines 208-236): `email NOT NULL`, `role`, `token` (unique), `status`,
  `invited_by`, `accepted_by`, `expires_at`, `accepted_at`, `created_at`. Invites are created by
  admins+ with a REQUIRED e-mail (`CreateInviteRequestSchema` in
  `packages/shared/src/core/schemas/household.ts` line 95) and redeemed by `POST
  /api/households/invites/accept` or `POST /api/auth/register { inviteToken }`
  (`apps/api/src/core/routes/auth.ts` lines 158-200, `core/services/auth/invites.ts`
  `loadRedeemableInvite` / `acceptInvite`).
- Migrations: `0000_core`, `0001_recipe`, `0002_finance` (drizzle-kit `dialect: "turso"`, so a dropped
  NOT NULL is an `ALTER TABLE … ALTER COLUMN`, exactly F's `0002_placeholder_members.sql`).
- Finance: `finance_participants` by user id (D3), ADR 0004 churn rules (a seated leaver with any
  ledger row gets `409 member_has_ledger`, an empty-ledger leaver loses the seat, a slot-2 survivor is
  re-seated in slot 1, the plan payer follows), M4-T01 finding B (plan payer and income person must be
  participants). The web finance tabs are D6's Übersicht · Buchungen · Erfassen (`/finance/new`) ·
  Profil; `NewTransactionPage` still has F's old "Mehr Details" form
  (`finance.transactions.form.moreDetails`).
- Migration (`apps/api/scripts/legacy/`): the finance schema gate is `{ migrations: 2, lastCreatedAt:
  1787307431957, lastTag: "0001_material_nebula" }` (`sources.ts` line 27), so the production finance
  DB (3 migrations) is refused today. `users.ts` groups F users by `email_normalized ?? email`
  (line 135), which a placeholder (both NULL) breaks. F `invites` are counted as "not migrated by
  design". Fixtures in `apps/api/test/fixtures/legacy/` hold F's drizzle folder at `cbdec67`.
- Security: H has no origin guard and no CSP; `clientIp` trusts the FIRST `X-Forwarded-For` entry
  (`core/services/auth/rateLimit.ts` line 130); `readJson` (`core/routes/auth.ts` line 121) parses any
  content type; the 401 handler (`apps/web/src/lib/session.tsx` line 170) does not purge the persisted
  cache; `db/client.ts` does not send `foreign_keys = ON`; H's `cors()` allows `env.webOrigins`
  (`apps/api/src/index.ts` line 40) because the dev default `PUBLIC_API_URL=http://localhost:3001`
  makes the browser call the API cross-origin (same SITE) from `:5173`.

### 1.2 The owner's data (counts only, read from copies in a scratch directory)

- Finance backup: 3 applied migrations, last `created_at` `1789194481486` (= F's journal `when` of
  `0002_placeholder_members`); 2 users, one of them a placeholder (password hash and e-mail NULL);
  1 household; slot 1 holds the account, slot 2 the placeholder; 334 transactions; 2 incomes; the
  plan is enabled and its payer is the account; 1 invite row, a plain (non-claim) invite, revoked.
  **There is no pending claim invite**, so the migration mints a fresh one.
- Recipe backup: 9 applied migrations (the gate's `0008_shopping_bought`), 2 users, 2 groups,
  55 recipes. The finance account's e-mail matches one recipe user, who is a member of exactly one
  group. With decision 13 (placeholders do not count when looking for a group) the finance household
  therefore merges into that group (`only-group`) and the placeholder joins it as `member`.

### 1.3 What F changed, hunk group by hunk group (disposition)

Every changed file of `git -C F diff cbdec67 1715207` (130 files) has one line here. "T0n" is the
task that ports it; "—" means not ported, with the reason.

| F path (at 1715207) | Disposition |
| --- | --- |
| `.github/workflows/ci.yml` (590697f, 1715207) | T06: pin the three actions H's ci.yml uses to F's SHAs; F's `docker-build` job → M6 |
| `.github/workflows/deploy.yml`, `release.yml` | — M6 (section 7.2) |
| `CLAUDE.md` | read for the gotchas; H's CLAUDE.md is synced by T12 (F's gotchas 18-56 were renumbered +1) |
| `README.md` | — |
| `apps/api/drizzle/0002_placeholder_members.sql`, `meta/_journal.json` | T02 copies them byte-identical into the fixtures; H's own migration `0003_placeholder_members.sql` is generated by T01 |
| `apps/api/drizzle/meta/0002_snapshot.json` | — (the fixtures keep no snapshots, M5 decision 17) |
| `apps/api/scripts/seed.ts` | T06 (production guard: `ALLOW_SEED=1` + own `SEED_PASSWORD`) |
| `apps/api/src/db/client.ts` | T06 (`foreign_keys = ON`, data directory `0700`) |
| `apps/api/src/db/schema.ts` | T01 (core `users.email` nullable, `household_invites.claims_user_id`) |
| `apps/api/src/env.ts` | T06 (`SESSION_SECRET` placeholder refused in production) |
| `apps/api/src/index.ts`, `middleware/originGuard.ts`, `middleware/securityHeaders.ts` | T06 (H-adapted, decisions 15, 16) |
| `apps/api/src/routes/auth.ts` | register claim path: T05; `readJson` content type: T06; forgot-password e-mail guard: T01 (type) |
| `apps/api/src/routes/households.ts` | placeholder routes: T05 (H `core/routes/members.ts`); invite `claimsUserId`: T05; rate limits: T06 |
| `apps/api/src/services/auth/invites.ts` | T05 (H `core/services/households/invites.service.ts` + `core/services/auth/invites.ts`) |
| `apps/api/src/services/auth/rateLimit.ts` | T06 (last `X-Forwarded-For` hop, `INVITE_RULE`, `HOUSEHOLD_CREATE_RULE`) |
| `apps/api/src/services/auth/users.service.ts` | `isPlaceholderUser`, `requireAccountEmail`: T01; `createPlaceholderUser`, `claimPlaceholderUser` (conditional UPDATE): T05 |
| `apps/api/src/services/households/members.service.ts` | placeholder add/remove/rename: T05 (core); the 1715207 leave rules (anchor, enabled-plan payer, incomes): covered by ADR 0004, counterpart tests in T07 (decision 12) |
| `apps/api/src/services/ledger/idempotency.ts`, `settlements.service.ts`, `transactions.service.ts`, `plan/accrual.service.ts`, `plan/plan.service.ts`, `support.ts`, `tags/tags.service.ts` | T07 |
| `apps/api/test/placeholders.test.ts` | T05 (`apps/api/test/placeholders.test.ts`) + T07 (seat rules in `finance-participants.test.ts`) |
| `apps/api/test/security.test.ts` | T06 (`apps/api/test/security.test.ts`: origin, body, headers) + T07 (`apps/api/test/finance-security.test.ts`: plan, periods, leaving, bounds, idempotency) |
| `apps/web/index.html`, `package.json`, `public/favicon.svg`, `public/fonts/*`, `public/icons/*`, `scripts/icons.sh`, `styles/fonts.css`, `styles/index.css`, `styles/theme.css`, `lib/theme.ts`, `vite.config.ts` | — D5: H already self-hosts R's four font files, has its own icon set (`scripts/icons.ts`) and theme-colour source (`lib/theme-colors.ts`); the petrol palette is F's colour, not H's |
| `components/layout/AppShell.tsx`, `BottomTabBar.tsx`, `Logo.tsx`, `QuickAddFab.tsx`, `SideNav.tsx`, `TopBar.tsx`, `nav-items.ts` | — D6 keeps Erfassen as tab 3 and the shell is core and module-neutral (decisions 9, 10) |
| `components/ui/Dialog.tsx` | T03: the two focus fixes (gotchas 58, 63) on H's (R's) primitive; F's classes are not ported |
| `components/ui/ActionMenu`, `Badge`, `Button`, `Card`, `Chip`, `EmptyState`, `ErrorState`, `Field`, `IconButton`, `Input`, `Label`, `Select`, `Switch`, `Tabs`, `Textarea`, `index.ts` | — H's primitives are R's (D5); `Card tone`, `Button inverse` exist for F's palette only. T03 uses H's `Chip` and H's required-field marker for the two required fields (760639d) |
| `features/auth/AuthLayout.tsx`, `ForgotPasswordPage.tsx`, `LoginPage.tsx`, `ResetPasswordPage.tsx` | — typography only; H's auth screens are R's |
| `features/auth/InvitePage.tsx`, `RegisterPage.tsx` | T10 (claim variant) |
| `features/household/HouseholdPage.tsx`, `components/InviteCard.tsx`, `components/MemberList.tsx`, `lib/queries.ts` | T10 (core households feature) + T11 (finance participants feature), decision 7 |
| `features/overview/components/BalanceHero.tsx`, `FixedCostCard.tsx`, `MonthSummaryCard.tsx` | — palette (`Card tone`) and typography; T04 confirms the `MonthSummaryCard` hunk carries no copy or behaviour |
| `features/transactions/NewTransactionPage.tsx`, `QuickAddDialog.tsx`, `lib/useCreateForm.ts`, `components/AmountInput.tsx`, `KindPicker.tsx`, `TagInput.tsx`, `TransactionFormFields.tsx`, `InviteSecondPerson.tsx`, `TransactionsPage.tsx` | T03 |
| `features/transactions/components/TransactionList.tsx`, `TransactionRow.tsx`, `lib/format.ts`, `lib/format.test.ts` | T04 |
| `lib/api.ts` | core fetchers + `seg()` path encoding: T10; finance fetchers + `seg()`: T11 |
| `lib/i18n/catalogs/auth.*` | T10 (core `auth.*`) |
| `lib/i18n/catalogs/common.*` (`common.appName` "Finanzen") | — H's name is "Haushalt" (M4 manifest) |
| `lib/i18n/catalogs/nav.*` (`nav.manage` "Verwalten") | — only F's SideNav uses it |
| `lib/i18n/catalogs/settings.*` | T10 (core `household.*`) and T11 (`finance.settings.household.*`) |
| `lib/i18n/catalogs/transactions.*` | T03 (`finance.transactions.*`) |
| `lib/lazy-page.tsx` (gotcha 60) | — H's screens are `lazyRouteComponent`s per route; no glob |
| `lib/quick-add.tsx` | T03, module-local (`apps/web/src/modules/finance/lib/quick-add.tsx`) |
| `lib/session.tsx` (401 purge) | T10 |
| `router.tsx` (`QuickAddHost`) | T03 mounts it in `FinanceGate` instead (decision 10) |
| `bun.lock` | — |
| `docker-compose.yml`, `docker/Caddyfile`, `docker/env.example`, `docker/toon-deploy.sh` | — M6 (section 7.2) |
| `docs/spec.md` | the source of the German copy (§6) and the contract (§2.1, §2.5, §3.5) |
| `packages/shared/src/i18n/catalogs/server.*` | T01 (all new server keys at once) |
| `packages/shared/src/schemas/auth.ts` (password/token bounds, control characters) | T06 (H core `user.ts`, `household.ts`) |
| `packages/shared/src/schemas/common.ts` (`ERROR_CODES` +2: T01; `PeriodSchema` bounds: T07) | T01, T07 |
| `packages/shared/src/schemas/households.ts` | contracts: T01 (responses) and T05 (`CreateInviteRequest.claimsUserId`) |
| `packages/shared/src/schemas/tags.ts`, `transactions.ts` | T07 |
| `packages/shared/test/schemas.test.ts` | T01 (core `ERROR_CODES`) |

### 1.4 Decisions this plan takes (binding for the tasks)

1. **A placeholder is a core user row with `email IS NULL AND password_hash IS NULL`.** H has no
   `email_normalized` column (R's model), so only `users.email` loses its NOT NULL (`password_hash`
   already allows NULL for OAuth-only accounts, which is why the hash alone cannot be the predicate
   in H, unlike F's `isPlaceholderUser`). `isPlaceholderUser(row)` in
   `apps/api/src/core/services/auth/users.ts` is the one predicate: `row.email === null &&
   row.passwordHash === null`. A placeholder has no `oauth_accounts`, no sessions, `email_verified =
   0`, `email_verified_at = NULL`, `avatar_url = NULL`. SQLite's unique index treats NULLs as distinct,
   so any number of placeholders coexist under `users_email_unique`. A placeholder can never log in:
   login, password reset and OAuth all look up by e-mail or provider id. `toUserDto` (the `/me`
   mapper) refuses a placeholder with 401 (F's `requireAccountEmail`): a session naming one is a bug.
2. **A placeholder is a household member, role `member`, created by an admin+.** Core route `POST
   /api/households/:householdId/members` (`requireSession`, `requireHouseholdRole("admin")`,
   `requireVerifiedEmail`), body `CreatePlaceholderMemberRequest = { displayName }` (F's name;
   `DisplayNameSchema`), answers `201 { member: HouseholdMember }`. The user row and the membership
   are written in one `withTransaction` (an orphan placeholder is invisible and unclaimable). There
   is no "household full" rule in the core (D1: N members). `users.name` holds the display name.
3. **Placeholder management in the core.** `PATCH /api/households/:householdId/members/:userId/
   placeholder { name }` (admin+, verified e-mail) renames a placeholder's `users.name`; `404` for a
   non-member, `409 member_has_account` for a member with an account. `PATCH …/members/:userId`
   (role) on a placeholder is `409 conflict` with the new key `server.household.placeholderRole` (an
   owner transfer to a person without a login would orphan the household). `DELETE
   …/members/:userId` on a placeholder runs the normal `removeMember` (rank rules, every build
   module's `onMemberRemoving` veto, so finance answers `409 member_has_ledger` while the placeholder
   holds a seat and the ledger has rows, ADR 0004) and then deletes the user row in the same
   transaction (its claim invites go by `ON DELETE cascade`). Deleting a household also deletes the
   users that were placeholder members of it, after the household row (whose cascade removes the
   finance rows that reference them).
4. **Claim invites.** `household_invites.claims_user_id text REFERENCES users(id) ON DELETE cascade`
   (+ index `household_invites_claims_user_id_idx`) and `household_invites.email` nullable.
   `CreateInviteRequest` becomes `{ email?: Email; role: default "member"; claimsUserId?: Id }`
   refined so that `email` is required unless `claimsUserId` is present. A claim invite: the target
   must be a member of the household (`404 not_found` otherwise) and a placeholder (`409
   member_has_account`); older pending claim invites for the same `claims_user_id` are revoked in the
   same transaction (one open claim link per placeholder, like R's per-address rule); `role` is
   `member`; it is mailed only when an `email` was given; the route keeps its admin+ and
   verified-e-mail gates. A claim invite is redeemed ONLY by `POST /api/auth/register { inviteToken }`:
   `claimPlaceholderUser` is ONE conditional `UPDATE users SET email, name, password_hash,
   email_verified = 0, email_verified_at = NULL, updated_at WHERE id = ? AND password_hash IS NULL
   AND email IS NULL RETURNING id` (F gotcha 72: never check-then-write); zero rows → `409
   member_has_account`; a unique violation → `409 email_taken`; then the invite becomes `accepted`
   with `accepted_by = claims_user_id`, the user's `active_household_id` is the invite's household, the
   confirmation mail goes out like any registration, and the session belongs to the claimed id (same
   id: every `payer_id`, `person_id`, membership and `finance_participants` row stays valid). `POST
   /api/households/invites/accept` on a claim invite answers `409 invite_claim_requires_register`
   (unless the caller IS the claimed user, a replay). The preview (`GET /api/households/invites/
   :token`) adds `claimsDisplayName: string | null` (the placeholder's `users.name`) and its `email`
   becomes nullable. The claimed account is unconfirmed, so the verified-e-mail gate makes it
   read-only until the address is confirmed (D4, unchanged).
5. **Wire shapes.** `PublicUser.email: string | null`; `HouseholdMember.hasAccount: boolean`;
   `HouseholdInvite.email: string | null`, `HouseholdInvite.claimsUserId: string | null`;
   `InvitePreviewResponse.email: string | null`, `claimsDisplayName: string | null`;
   `FinanceParticipantResponse.email: string | null`, `hasAccount: boolean`. `User` (`/me`) keeps
   `email: string`. Core `ERROR_CODES` gains `member_has_account` and
   `invite_claim_requires_register`.
6. **Finance seats.** A placeholder may hold slot 2 only: `PUT …/finance/participants` and the
   enable settings answer `422 validation_failed` with the new key `server.finance.placeholderSlotOne`
   when slot 1 is a placeholder (slot 1 anchors the balance and is the viewer-side default; F's
   placeholder only ever fills the free slot 2). `assignParticipants` names a new placeholder seat
   after `users.name` (never its NULL e-mail). F's "yourself or the placeholder" rename becomes `PATCH
   …/finance/participants/:userId { displayName }`: any participant may rename the OTHER seat when it
   is a placeholder (`403 forbidden` for a seat with an account, `404` for a non-participant); the own
   seat stays `PATCH …/participants/me`. ADR 0004's re-seat can leave a placeholder alone in slot 1
   (the account in slot 1 leaves an empty ledger); that state is accepted (nobody can open the ledger
   until an admin seats two people) and recorded as a risk.
7. **Where F's household screens go (M3 renames).** F `MemberList` → core
   `apps/web/src/core/features/households/components/MemberList.tsx`: the placeholder row gets the
   badge "ohne Konto", the hint "Kann sich noch nicht anmelden." instead of an e-mail, and for admins+
   "Umbenennen" (new `PlaceholderRenameDialog.tsx`), "Person entfernen" (the existing remove with F's
   confirm text; a `409 member_has_ledger` keeps the dialog open and shows the error) and "Konto für
   {name} verknüpfen" (new `ClaimInviteDialog.tsx`: create the claim link, show and copy it with F's
   `linkAccountLinkHint`). F `InviteCard`'s "Ohne Konto hinzufügen" form → finance
   `ParticipantsSection` (when a seat is free or replaceable) and `EnableFinanceDialog` (always
   offered; the one-member household gets it instead of a dead end). The finance section also shows
   the placeholder badge, F's rename (decision 6) and the claim link for admins+. F
   `InviteSecondPerson` → `apps/web/src/modules/finance/features/transactions/components/
   InviteSecondPerson.tsx`, linking to `/settings` (M3's mapping of F's `/household`). F
   `InvitePage`/`RegisterPage` claim behaviour → core `core/features/auth/InvitePage.tsx` and
   `RegisterPage.tsx`.
8. **Catalog keys (values byte-identical to F at 1715207 / F docs/spec.md §6).** Core `auth.*` gets
   F's keys unchanged: `auth.register.claimHint`, `auth.invite.claimSubtitle`,
   `auth.invite.claimCreateAccount`, `auth.invite.claimLoggedIn`, `auth.invite.claimLogout`. Core
   `household.*` (file `apps/web/src/lib/i18n/catalogs/household.{de,en}.ts`) gets
   `household.placeholder.badge` ← F `settings.household.placeholderBadge`, `.hint` ←
   `placeholderHint`, `.rename` ← `placeholderRename`, `.remove` ← `placeholderRemove`,
   `.removeConfirm` ← `placeholderRemoveConfirm`, `.nameLabel` ← `settings.household.displayName`,
   `household.claim.title` ← `linkAccount`, `.hint` ← `linkAccountHint`, `.create` ←
   `linkAccountCreate`, `.linkHint` ← `linkAccountLinkHint`. Finance (file
   `apps/web/src/modules/finance/catalogs/settings.{de,en}.ts`) gets `finance.settings.household.`
   + `placeholderTitle`, `placeholderDescription`, `placeholderCreate`, `placeholderBadge`,
   `placeholderHint`, `placeholderRename`, `linkAccount`, `linkAccountHint`, `linkAccountCreate`,
   `linkAccountLinkHint` (F's suffixes, prefix `finance.`), and `finance.settings.household.inviteEmail`
   (if it exists in H) takes F's new value "E-Mail-Adresse". Server (core
   `packages/shared/src/core/i18n/catalogs/server.{de,en}.ts`): F's
   `server.household.memberHasAccount`, `server.invite.claimRequiresRegister`,
   `server.error.originMismatch`, `server.validation.periodBounds`, `server.validation.noControlChars`
   verbatim; NEW German (listed in `NEW_GERMAN`): `server.household.placeholderRole` "Eine Person ohne
   Konto kann keine andere Rolle bekommen." and `server.finance.placeholderSlotOne` "Eine Person ohne
   Konto kann nur Platz 2 belegen." F's `server.household.anchorCannotLeave` is NOT ported (ADR 0004
   re-seats instead). Every web value that F has is found by the parity check in F's tree, so only the
   two server keys are new German.
9. **D6 stands: Erfassen stays tab 3 at `/finance/new`; Fixkosten stays sidebar-only.** F moved
   Erfassen to a floating "+" and gave the tab to Fixkosten; D6 enumerates H's finance tabs, and the
   task names ADR 0006 for D4 only. No ADR, no tab change, the `FixedCostCard` path stays.
10. **The sheet is ported, module-local, without a FAB.** `modules/finance/lib/quick-add.tsx`
    (F's `QuickAddProvider`, `useQuickAdd`, `useQuickAddHostedHere`, the `n` shortcut) and
    `QuickAddHost`/`QuickAddDialog` are mounted by `FinanceGate` for participants only (static
    imports, F's cold-offline reason; the gate is already in the participant-only branch). Openers:
    the `n` key on every finance screen and the opener F's `TransactionsPage` has. `/finance/new`
    claims the host (`useQuickAddHostedHere`, gotcha 65). No `QuickAddFab` (phones have the Erfassen
    tab; a second "+" above it would duplicate it) and no SideNav primary button (the shell is core
    and module-neutral). Both frames share ONE form hook (`useCreateForm.ts`) and H's existing create
    mutation with its client-minted `mutationId` and the `["toon","finance","tx"]` outbox namespace
    (never a second mutation path).
11. **Gotcha numbering.** F renumbered its gotchas 18-56 to 19-57 and added 57-74 (new 57-74 are
    numbered after the shift). H's CLAUDE.md and code comments that cite F gotcha numbers are updated
    by T12 to F's numbering at `1715207` (e.g. "gotcha 47" → 48, "gotcha 50" → 51); tasks cite the NEW
    numbers.
12. **F's 1715207 leave rules are covered by ADR 0004.** F refuses slot 1 leaving while slot 2 sits
    (`anchorCannotLeave`), refuses the payer of an ENABLED plan, and deletes the leaver's incomes. H
    (ADR 0004) refuses any seated leaver while the ledger has a row or an income names them, and on an
    empty ledger deletes the seat, re-seats a slot-2 survivor in slot 1 and moves the plan payer. The
    F test cases get counterparts asserting H's rule (named after F's case), no code change.
13. **Migration placeholder rule (owner's decision, ADR 0006).** A finance user with
    `password_hash IS NULL` (F's predicate; its `email` and `email_normalized` must also be NULL, else
    an error) migrates as a placeholder: target row `{ id: F id (fresh UUID if claimed, with the
    usual warning), email: NULL, name, avatar_url: NULL, email_verified: 0, email_verified_at: NULL,
    password_hash: NULL, active_household_id: the household its seat lands in, locale: F locale,
    created_at, updated_at }`, ledger `users/finance/<F id>`, never grouped or matched by e-mail.
    Household matching (M5 decision 10) uses the account members only: a placeholder is excluded from
    the member set a group must contain, and joins the target household as `member` (through the
    existing `addMembers` path for a merge). A finance household whose members are all placeholders is
    an error (`no-account-members`, exit 1) unless `--mapping` maps it to a group. `finance_participants`
    copy the placeholder's slot and `display_name` unchanged. Then per migrated placeholder exactly ONE
    pending claim invite in `household_invites` (ledger key `household_invites` / `finance` /
    `claim:<F user id>`): a legacy claim invite of that placeholder that is still pending (status
    `pending`, `expires_at` in the future; the newest one) becomes that invite (its token,
    `created_at`, `expires_at`, `email` kept; `invited_by` mapped, or the household owner when the
    inviter was not migrated; a token already present in the target gets a fresh one and a warning);
    otherwise a fresh one: `id` UUID, `token` from the core's `generateInviteToken`
    (`apps/api/src/core/services/auth/invites.ts`), `email` NULL, `role` `member`, `status` `pending`,
    `invited_by` the target household's owner, `expires_at` = run time + `INVITE_TTL_MS` (14 days),
    `created_at` = run time, `claims_user_id` = the placeholder's target id. Other F invites stay
    unmigrated (the "not migrated by design" count excludes the reused claim invite).
14. **The claim link in the report.** A new report section `== Placeholders and claim invites ==`
    (after `== Finance balance per household ==`, before `== Warnings ==`) lists per placeholder: the
    legacy and target user ids, the target household, the slot and the claim invite state
    (`would-create`, `would-reuse`, `created`, `reused`, `already-migrated`). The invite URL
    (`<origin>/invite/<token>`) appears ONLY in an `--apply` run's real pass, on stdout and in that
    run's `--report` JSON (field `inviteUrl`), and on a later `--apply` for a still-pending invite
    (read-only lookup through the ledger); never in a dry run. `<origin>` is the first entry of
    `WEB_ORIGIN` as `resolveCliEnv` reads it (process env, then the root `.env`, then `.env.local`,
    default `http://localhost:5173` like `env.ts`). `docs/migration.md` says the apply report is a
    credential (it holds live claim links) and must stay outside any repository.
15. **Origin guard (F gotcha 66), H-adapted.** `apps/api/src/middleware/originGuard.ts` on `/api/*`
    for unsafe methods, BEFORE the routers: an `Origin` header whose origin (scheme + host + port) is
    in `env.webOrigins` passes (H's dev default calls the API from `:5173`, same SITE, which F's rule
    would refuse); otherwise F's rule: `Sec-Fetch-Site: cross-site|same-site` → `403
    forbidden` with `server.error.originMismatch`; `Origin: null` → 403; an `Origin` host ≠ request
    host → 403; no `Origin` (curl, tests, server-to-server) passes. Placed after `cors()` (so a
    preflight still gets its headers) and before `mountModules`.
16. **Security headers (F gotcha 67), H-adapted CSP.** `apps/api/src/middleware/securityHeaders.ts`
    with F's `inlineScriptHashes` over the BUILT `index.html` (H's pre-paint theme script is inline),
    on every response. Differences from F, because the recipe module needs them: `script-src 'self'
    'wasm-unsafe-eval' <hashes>` (zxing-wasm instantiates WebAssembly for the card scanner),
    `img-src 'self' data: blob: https:` (import previews are `blob:`/`data:`; a recipe may keep an
    external `https:` hero image, see the fixtures' `EXTERNAL_IMAGE_URL`), `media-src 'self' blob:`.
    Everything else as F (`style-src 'self'`, `font-src 'self'`, `connect-src 'self'`,
    `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, no HSTS: the Caddy owns it, D11).
    No `Permissions-Policy` that would block the camera. Verified on the built app in T12 (console
    clean on every recipe and finance screen).

### 1.5 Paths the tasks rely on

- Core API: `apps/api/src/db/schema/core.ts`, `apps/api/src/core/services/auth/{users,invites}.ts`,
  `apps/api/src/core/services/households/{households.service,invites.service,mappers}.ts`,
  `apps/api/src/core/routes/{auth,households,members,invites}.ts`, `apps/api/src/index.ts`,
  `apps/api/src/env.ts`, `apps/api/src/db/client.ts`, `apps/api/scripts/seed.ts`.
- Shared: `packages/shared/src/core/schemas/{user,household,common}.ts`,
  `packages/shared/src/core/i18n/catalogs/server.{de,en}.ts`,
  `packages/shared/src/modules/finance/schemas/{common,tags,transactions,participants}.ts`.
- Finance API: `apps/api/src/modules/finance/services/participants/participants.service.ts`,
  `routes/participants.ts`, `services/{ledger,plan,tags}/…`, `services/support.ts`.
- Web: `apps/web/src/lib/{api,session}.ts(x)`, `apps/web/src/core/features/{households,auth}/…`,
  `apps/web/src/modules/finance/{features/transactions,features/participants,lib,catalogs}/…`,
  `apps/web/src/components/ui/Dialog.tsx`.
- Migration: `apps/api/scripts/migrate-legacy.ts`, `apps/api/scripts/legacy/*.ts`,
  `apps/api/test/fixtures/legacy/*`, `apps/api/test/legacy-*.test.ts`, `docs/migration.md`.

## 2. The F test files and their H counterparts (additions to m3 plan section 8 / 9.3)

| F test file at 1715207 | cases | H counterpart | task |
| --- | --- | --- | --- |
| `apps/api/test/placeholders.test.ts` | 8 | `apps/api/test/placeholders.test.ts` (core: create, rename, remove, claim by register, accept refused, member_has_account, cannot log in, email_taken on claim, conditional UPDATE race) + `finance-participants.test.ts` (placeholder in slot 2, slot-1 refusal, remove refused with bookings) | T05, T07 |
| `apps/api/test/security.test.ts` | 15 | `apps/api/test/security.test.ts` (origin guard 4+1 for `webOrigins`, body parsing 2, headers 2) + `apps/api/test/finance-security.test.ts` (plan members 2, leaving 2 asserting ADR 0004, request bounds 2, household-scoped idempotency 1) | T06, T07 |
| `apps/web/src/lib/format.test.ts` (`formatDayHeading`) | +cases | `apps/web/src/modules/finance/lib/format.test.ts` | T04 |
| `packages/shared/test/schemas.test.ts` (`ERROR_CODES` 32) | changed | `packages/shared/test/finance-schemas.test.ts` + a core error-code case in `packages/shared/test/core.test.ts` | T01, T07 |

Every other F test file is unchanged between `cbdec67` and `1715207` (`git diff --stat cbdec67
1715207 -- '*.test.ts' '*.test.tsx'` lists only these four), so the M3 map stands for them. T12
re-counts cases per pair (H ≥ F) and appends the result to the m3 plan's section 9.3.

## 3. Task list and waves

| Wave | Tasks (parallel worktrees, merged in id order) |
| --- | --- |
| 1 | T01 core contracts + migration + ADR 0006 · T02 fixture schema at 3 migrations · T03 Erfassen sheet · T04 list by day + rows |
| 2 | T05 core placeholder/claim API · T07 finance API security + seats · T08 migration: placeholder users and households |
| 3 | T06 core security hardening · T09 migration: claim invites, report, CLI · T10 core web placeholders + claim registration |
| 4 | T11 finance web placeholder flow |
| 5 | T12 integration |

Shared files and their single owner per wave: `packages/shared/src/core/i18n/catalogs/server.*`
and `scripts/i18n-check.ts` (`NEW_GERMAN`): T01 only (no later task adds server keys);
`packages/shared/src/core/schemas/household.ts`: T01 (wave 1), T05 (wave 2), T06 (wave 3);
`core/routes/auth.ts`: T01, T05, T06 in that order; `apps/web/src/lib/api.ts`: T10 only;
`apps/web/src/modules/finance/lib/api.ts`: T11 only; `apps/api/scripts/legacy/report.ts` and
`types.ts`: T08 then T09; CLAUDE.md, SPEC §3 and the m3 plan's test map: T12 (SPEC §1/§4/§6/§9:
T01 with the ADR).

Common verify commands (each must exit 0; `i18n:check` exits 1 by design, so its parity half is
checked with grep):

```bash
cd /home/erics/software/toon-household && bun run typecheck
cd /home/erics/software/toon-household && bun test
cd /home/erics/software/toon-household && bun run build
cd /home/erics/software/toon-household && bun run i18n:check 2>&1 | grep -A1 "1/2 German catalog parity" | grep -q "\[i18n:check\] OK"
# migrations are generated, never hand-written: a fresh generate adds nothing
cd /home/erics/software/toon-household && bun run db:generate >/dev/null 2>&1; test -z "$(git status --porcelain apps/api/drizzle)"
# the legacy fixtures are what build.ts produces
cd /home/erics/software/toon-household && bun run apps/api/test/fixtures/legacy/build.ts --check
# finance web greps (CLAUDE.md), after every finance web task
cd /home/erics/software/toon-household && ! grep -rnE "(\bto[=:] ?|\bgo\(|\bgoTo\()[\"'\`]/(transactions|new|plan|categories|household)\b|\bto[=:] ?[\"']/[\"']" apps/web/src/modules/finance
cd /home/erics/software/toon-household && ! grep -rnE "\b(Link|useNavigate|useParams|useBlocker)\b[^;]*from \"@tanstack/react-router\"" apps/web/src/modules/finance/features apps/web/src/modules/finance/components
cd /home/erics/software/toon-household && ! grep -rnE "[\"'\`](common|nav|transactions|categories|plan|balance|settings)\.[a-zA-Z]" apps/web/src/modules/finance --include='*.ts' --include='*.tsx' --exclude-dir=catalogs
```

## 4. Tasks

### M3b-T01 — Core contracts for placeholders and claim invites, migration 0003, ADR 0006 (core)

Goal: the schema, the generated migration, the shared wire shapes, every server catalog key of the
milestone and the ADR, with every existing code path compiling and behaving as before against a
nullable e-mail.

Read: SPEC §1 D1, D4, D10, §4, §6 (items 1, 2, 5), §9; this plan 1.4 decisions 1-8, 13, 14; F
`docs/spec.md` §2.1 (Platzhalter), §2.5 (Claim-Einladung), §3.5 (members/invites routes) and the §6
server rows; F `git show b1b517d -- apps/api/src/db/schema.ts apps/api/drizzle/0002_placeholder_members.sql
apps/api/src/services/auth/users.service.ts packages/shared/src/schemas/households.ts
packages/shared/src/schemas/common.ts packages/shared/src/i18n/catalogs/server.de.ts`; F CLAUDE.md
decision 1 ("Platzhalter") and gotcha 72; H CLAUDE.md "Migrations are generated", "D7 pragmas",
"`HouseholdWithRole` has `modules: string[]`", "Finance server catalog (ADR 0002)".

Steps:
1. `apps/api/src/db/schema/core.ts`: `users.email` → `text("email")` (comment: NULL only for a
   placeholder, decision 1; the unique index stays); `householdInvites.email` → `text("email")`
   (NULL for a claim invite without an address); add `claimsUserId: text("claims_user_id")
   .references(() => users.id, { onDelete: "cascade" })` and
   `index("household_invites_claims_user_id_idx").on(table.claimsUserId)`.
2. `cd apps/api && bunx drizzle-kit generate --name placeholder_members` → `apps/api/drizzle/
   0003_placeholder_members.sql` + `meta/0003_snapshot.json` + journal entry. Read the SQL: it must be
   `ALTER TABLE … ALTER COLUMN` statements (turso dialect) plus the `ADD claims_user_id` and the index;
   if drizzle-kit emits a table rebuild instead, STOP and report (a `users` rebuild under the
   migrator's transaction would cascade-delete). Prove it on a fresh file DB and on a DB migrated to
   `0002_finance` first (a test in `apps/api/test/db-placeholder-migration.test.ts` that migrates a
   temp `file:` DB with `@libsql/client`, inserts a user with `email = NULL`, two such users, and a
   claim invite, and checks `PRAGMA foreign_key_list(household_invites)` names `claims_user_id` with
   `CASCADE`).
3. `apps/api/src/core/services/auth/users.ts`: export `isPlaceholderUser(row: Pick<UserRow, "email" |
   "passwordHash">): boolean` (decision 1) and use a private `requireAccountEmail(row)` in
   `toUserDto` (401 `ApiError.unauthorized()` for a NULL e-mail).
4. Shared contracts (decision 5) in `packages/shared/src/core/schemas/user.ts` (`PublicUserSchema.
   email` nullable) and `household.ts` (`HouseholdMemberSchema.hasAccount`, `HouseholdInviteSchema.
   email` nullable + `claimsUserId: IdSchema.nullable()`, `InvitePreviewResponseSchema.email` nullable +
   `claimsDisplayName: z.string().nullable()`, new `CreatePlaceholderMemberRequestSchema = z.object({
   displayName: DisplayNameSchema })` and `UpdatePlaceholderMemberRequestSchema = z.object({ name:
   DisplayNameSchema })` with their types; do NOT change `CreateInviteRequestSchema` here, T05 does);
   `packages/shared/src/core/schemas/common.ts` `ERROR_CODES` + `"member_has_account"`,
   `"invite_claim_requires_register"`; `packages/shared/src/modules/finance/schemas/participants.ts`
   `email` nullable + `hasAccount: z.boolean()`. Export through the existing barrels.
5. Server catalog keys (decision 8), all of the milestone, in `packages/shared/src/core/i18n/catalogs/
   server.de.ts` and `server.en.ts` (F's de and en values byte-identical for the five F keys; the two
   new German keys with an English counterpart "A person without an account cannot get another role."
   and "A person without an account can only take seat 2."); add the two new keys to `NEW_GERMAN` in
   `scripts/i18n-check.ts` with the comment `// M3b: placeholder rules (ADR 0006)`.
6. Make every reader compile and behave: `bun run typecheck` lists them. API: mappers
   (`core/services/households/mappers.ts`: `hasAccount: !isPlaceholderUser(row)`, `email` passed
   through, invite `email`/`claimsUserId`), `invites.service.ts` (`previewInvite` returns `email`
   as stored and `claimsDisplayName: null` for now; the invite mail is only sent with an address),
   `core/routes/auth.ts` (mail `to:` sites narrow with an explicit guard; a session user always has an
   e-mail), `apps/api/scripts/reset-password.ts`, `modules/recipe/services/import/commit.ts`,
   `modules/finance/services/participants/participants.service.ts` (`toParticipantResponse` →
   `hasAccount`, the display-name fallback uses `users.name` and never a NULL e-mail),
   `modules/finance/seed.ts`. Web: the core households `MemberList.tsx` / `InvitePanel.tsx` and
   `core/features/auth/InvitePage.tsx` render a NULL e-mail as nothing (no new copy here; T10 adds the
   placeholder UI). No behaviour change for accounts.
7. ADR `docs/adr/0006-placeholder-members-and-claim-invites.md` (date, context: F 1715207 production
   data holds a placeholder; decision: decisions 1-4 and 13-14 of this plan in prose; consequences:
   nullable `users.email`, claim invites redeemed only by registration, D4's "no auto-linking" intact
   because a claim writes credentials onto a row that has none and never merges two accounts, the
   migration rule, the claim link in the apply report is a credential). In the SAME commit edit SPEC:
   D4 (append: "Placeholder accounts without e-mail or password exist (a household member added by
   name, so the finance ledger can name them); they cannot sign in and become accounts only through a
   claim invite redeemed by registration, in place, same id (ADR 0006)."), §4 table rows `users`
   (placeholders, NULL e-mail) and `household_invites` ("finance `invites` are not migrated, except a
   still-pending claim invite of a migrated placeholder, ADR 0006"), §6 item 1 (finance: 3), §6 item 2
   (append the placeholder rule of decision 13 in two sentences), §6 item 5 ("finance invites …
   except claim invites"), §6 item 6 (the placeholders section), §9 ("migrating sessions or finance
   invites (claim invites of placeholders excepted, ADR 0006)").
8. Tests: the migration test of step 2; `isPlaceholderUser` cases (account, OAuth-only account with
   NULL hash, placeholder) in `apps/api/test/placeholders-core.test.ts`; a `/me` 401 case is not
   reachable through HTTP (no session can name a placeholder), so test `toUserDto` directly; core
   `ERROR_CODES` contains both codes (`packages/shared/test/core.test.ts`); existing tests stay green.

Files: `apps/api/src/db/schema/core.ts`, `apps/api/drizzle/0003_placeholder_members.sql`,
`apps/api/drizzle/meta/0003_snapshot.json`, `apps/api/drizzle/meta/_journal.json`,
`apps/api/src/core/services/auth/users.ts`, `apps/api/src/core/services/households/mappers.ts`,
`apps/api/src/core/services/households/invites.service.ts`, `apps/api/src/core/routes/auth.ts`,
`apps/api/scripts/reset-password.ts`, `apps/api/src/modules/recipe/services/import/commit.ts`,
`apps/api/src/modules/finance/services/participants/participants.service.ts`,
`apps/api/src/modules/finance/seed.ts`, `packages/shared/src/core/schemas/{user,household,common}.ts`,
`packages/shared/src/modules/finance/schemas/participants.ts`,
`packages/shared/src/core/i18n/catalogs/server.{de,en}.ts`, `scripts/i18n-check.ts`,
`apps/web/src/core/features/households/components/{MemberList,InvitePanel}.tsx`,
`apps/web/src/core/features/auth/InvitePage.tsx`, `docs/adr/0006-placeholder-members-and-claim-invites.md`,
`docs/SPEC.md`, `apps/api/test/db-placeholder-migration.test.ts`, `apps/api/test/placeholders-core.test.ts`,
`packages/shared/test/core.test.ts`.

Acceptance: the generated SQL has no table rebuild; a second `db:generate` adds nothing; `bun test`
green (count ≥ 2016 + new); the ADR exists and SPEC D4, §4, §6 items 1/2/5/6 and §9 are edited in
the same commit as the ADR; parity OK.

### M3b-T02 — Legacy fixtures at F's three-migration schema (port)

Goal: the fixture schema folder is F's drizzle folder at `1715207`, the schema gate expects 3
migrations, the fixture databases are rebuilt on it; no placeholder rows yet (T08 adds them).

Exact rewrites:
- `cp /home/erics/software/toon-finance/apps/api/drizzle/0002_placeholder_members.sql
  apps/api/test/fixtures/legacy/migrations/finance/` and
  `cp /home/erics/software/toon-finance/apps/api/drizzle/meta/_journal.json
  apps/api/test/fixtures/legacy/migrations/finance/meta/_journal.json` (byte-identical; no snapshots).
  Check: `diff -r -x '*_snapshot.json' /home/erics/software/toon-finance/apps/api/drizzle
  apps/api/test/fixtures/legacy/migrations/finance` prints nothing.
- `apps/api/scripts/legacy/sources.ts` line 27: `finance: { migrations: 3, lastCreatedAt:
  1789194481486, lastTag: "0002_placeholder_members" }`.
- `apps/api/test/fixtures/legacy/facts.ts`: `EXPECTED.migrations.finance = { count: 3, lastWhen:
  1789194481486 }`.
- `apps/api/test/fixtures/legacy/README.md`: the finance row says "3 migrations", "source commit
  `1715207`".
- Rebuild: `bun run apps/api/test/fixtures/legacy/build.ts`, then `--check`. If `build.ts` inserts
  F `invites` rows without the new `claims_user_id` column, that is correct (NULL); if it lists
  columns explicitly and fails, add `claims_user_id: null` only where its insert needs it.
- Tests that state "2 migrations" or "of 2" for finance (`grep -rn "of 2\|migrations: 2\|0001_material_nebula"
  apps/api/test apps/api/scripts`) are updated to 3 / `0002_placeholder_members`. Do not touch
  `docs/migration.md` (T09 owns it) or SPEC (T01).

Read: plan m5 decisions 4 and 17, fixtures `README.md` "Rules", H CLAUDE.md "Long commands".

Files: `apps/api/test/fixtures/legacy/migrations/finance/0002_placeholder_members.sql`,
`apps/api/test/fixtures/legacy/migrations/finance/meta/_journal.json`,
`apps/api/scripts/legacy/sources.ts`, `apps/api/test/fixtures/legacy/facts.ts`,
`apps/api/test/fixtures/legacy/README.md`, `apps/api/test/fixtures/legacy/build.ts` (only if needed),
`apps/api/test/fixtures/legacy/finance.db`, `apps/api/test/legacy-framework.test.ts`,
`apps/api/test/legacy-fixtures.test.ts`, `apps/api/test/legacy-cli.test.ts`.

Acceptance: the diff against F's folder is empty; `build.ts --check` exits 0; `bun test
apps/api/test/legacy-` green; a 2-migration finance DB is refused with the gate's message naming
`0002_placeholder_members`.

### M3b-T03 — The Erfassen sheet and the shared capture form (build)

Goal: F's capture redesign (00ea694, 760639d) in the finance module: one form hook, two frames
(`/finance/new` page and the module-local sheet), all fields at once, no "Mehr Details".

Read: this plan decisions 9, 10; F CLAUDE.md "Navigation" (the Erfassen paragraph) and gotchas 58,
59, 62, 63, 65; F `docs/spec.md` §4.5 (REDESIGN box) and the `transactions.*` rows of §6; F files at
`1715207`: `apps/web/src/lib/quick-add.tsx`, `features/transactions/{QuickAddDialog,NewTransactionPage,
TransactionsPage}.tsx`, `features/transactions/lib/useCreateForm.ts`, `features/transactions/
components/{TransactionFormFields,KindPicker,AmountInput,TagInput,InviteSecondPerson}.tsx`,
`components/ui/Dialog.tsx` (the focus effect only); the hunks `git -C F show 8978cad --
apps/web/src/features/transactions/components/KindPicker.tsx` (typography only: map to H's tokens,
port nothing visual that D5 forbids); H's `modules/finance/features/transactions/*`,
`features/participants/FinanceGate.tsx`, `modules/finance/phone-header.test.ts`,
`styles/design-system.test.ts` (Table D rules), H CLAUDE.md "FinanceGate renders PendingSyncNote as a
Fragment sibling", "Hand-written utilities beat breakpoint variants", "Inherited finance gotchas"
(offline outbox 7-9, 11; Buchen bar 15 → `.bottom-tabbar`), D5 and R `docs/redesign/SPEC.md`.

Rewrites for every F file: `@/lib/quick-add` → `@/modules/finance/lib/quick-add`; `@/lib/i18n/
I18nProvider.tsx` `useT` → `@/lib/i18n` `useT`; catalog keys `transactions.*` → `finance.transactions.*`,
`common.*` (F's) → `finance.common.*`, `nav.household` → `finance.nav.household`,
`settings.household.*` → `finance.settings.household.*`; `Link`/`useNavigate` from
`@tanstack/react-router` → `AppLink`/`useAppNavigate` from `@/lib/nav`; F's `/household` → `/settings`,
F's `/new` → `/finance/new`; `useOtherMember` → `useOtherParticipant`
(`@/modules/finance/lib/participants`); F's `useHousehold` → `useFinanceHousehold`; F's create
mutation → H's existing create mutation from `features/transactions/lib/queries.ts` (keep the
`mutationId` minted at the call site, the offline toast `finance.transactions.toast.queued`, the undo
toast if H has it); F's UI primitives → H's `@/components/ui/*` (use H's `Chip` for the date and
category chips, H's `Dialog` `footer` slot, H's required-field marker); colours/fonts from F's classes
are NOT ported, use H's tokens only.

Steps:
1. `apps/web/src/modules/finance/lib/quick-add.tsx` (F's file with the rewrites; context type and
   `n` shortcut unchanged).
2. `features/transactions/lib/useCreateForm.ts` (F's hook over H's mutation; exports a pure
   `isCreateFormDirty`/validation helper used by both frames).
3. `QuickAddDialog.tsx` + `QuickAddHost` (F's), `useUnsavedWork(form.isDirty)` NOT gated on `isOpen`
   (gotcha 62); `InviteSecondPerson.tsx` (F's, `AppLink to="/settings"`, the H keys
   `finance.nav.household`, `finance.settings.household.invite`, `finance.settings.household.manage`
   that H's `NewTransactionPage` already uses).
4. `NewTransactionPage.tsx` on `useCreateForm` + `TransactionFormFields`, `useQuickAddHostedHere()`,
   `useUnsavedWork(form.isDirty)`; keep H's `PageHeader` and the sticky Buchen bar
   (`sticky bottom-tabbar … bleed-gutter-inset`, never `bottom-0`).
5. `TransactionFormFields.tsx`, `KindPicker.tsx`, `TagInput.tsx`, `AmountInput.tsx` (gotcha 59: the
   text buffer follows a value change from OUTSIDE, compared against the last value it emitted
   itself; keep M4's `pr-12` + `flex items-center` and `AmountInput.test.ts`'s guards),
   `CategorySheet.tsx` if the "Alle {count}" chip needs a prop. Date chips and category chips as F;
   both required fields (Betrag, Beschreibung) show the required marker (760639d).
6. `TransactionsPage.tsx`: F's `useQuickAdd().open` opener (the button F's page has), in H's header.
7. `features/participants/FinanceGate.tsx`: wrap the participant branch in `QuickAddProvider` and
   render `QuickAddHost` as a sibling of the outlet; `PendingSyncNote` stays a Fragment sibling of the
   outlet (update `modules/finance/phone-header.test.ts` only if its source pin must name the new
   sibling; the rule itself stays).
8. `apps/web/src/components/ui/Dialog.tsx`: gotcha 58 (`[data-autofocus]` queried on its own before
   the generic selector) and gotcha 63 (the focus effect runs after every render with two refs: one
   fallback, one when the real target appears, never a third time). Recipe dialogs keep working (no
   prop change).
9. Catalogs `apps/web/src/modules/finance/catalogs/transactions.{de,en}.ts`: add
   `finance.transactions.quickAdd.open`, `.quickAdd.shortcuts`, `.quickAdd.staysOpen`,
   `finance.transactions.form.categoryAll` (F's de/en values); delete
   `finance.transactions.form.moreDetails` after `grep` shows no reader.
10. Tests (source pins in H's style, `tsconfig.test.json`): `QuickAddDialog` registers
    `useUnsavedWork(form.isDirty)` without `isOpen` (gotcha 62); `NewTransactionPage` calls
    `useQuickAddHostedHere` (gotcha 65); `Dialog.tsx` queries `[data-autofocus]` in its own
    `querySelector` before the combined selector (gotcha 58); `quick-add.tsx`'s typing-target check
    and host counter as pure-function tests where exportable; `useCreateForm`'s pure helpers (empty
    state keeps the kind after submit, dirty detection, validation keys).

Files: `apps/web/src/modules/finance/lib/quick-add.tsx`,
`apps/web/src/modules/finance/features/transactions/{QuickAddDialog,NewTransactionPage,TransactionsPage}.tsx`,
`apps/web/src/modules/finance/features/transactions/lib/useCreateForm.ts`,
`apps/web/src/modules/finance/features/transactions/lib/useCreateForm.test.ts`,
`apps/web/src/modules/finance/features/transactions/components/{TransactionFormFields,KindPicker,AmountInput,TagInput,CategorySheet,InviteSecondPerson}.tsx`,
`apps/web/src/modules/finance/features/transactions/components/AmountInput.test.ts`,
`apps/web/src/modules/finance/features/transactions/quick-add.test.ts`,
`apps/web/src/modules/finance/features/participants/FinanceGate.tsx`,
`apps/web/src/modules/finance/phone-header.test.ts`, `apps/web/src/components/ui/Dialog.tsx`,
`apps/web/src/components/ui/dialog-focus.test.ts`,
`apps/web/src/modules/finance/catalogs/transactions.{de,en}.ts`.

Acceptance: typecheck, test, build green; design-system test green with no new pinned exception; the
three finance greps and parity clean; no import of `@/modules`, `@/components/layout` or
`use-nav-items` from a static manifest import (`manifest.test.ts`, `persist.test.ts` green).

### M3b-T04 — Transaction list grouped by day and the row fixes (build)

Goal: F's denser list (00ea694: one card per day with weekday, date and the day's sum in the head,
rows flat without a repeated date) and the row fixes (gotchas 61, 64).

Read: F CLAUDE.md gotchas 31 (390px measured in a browser), 61, 64; F files at `1715207`:
`features/transactions/components/{TransactionList,TransactionRow}.tsx`, `lib/format.ts`
(`formatDayHeading`), `lib/format.test.ts`; `git -C F show 8978cad -- apps/web/src/features/
transactions/components/TransactionList.tsx apps/web/src/features/overview/components/
MonthSummaryCard.tsx` (typography only: confirm and port nothing); H's
`modules/finance/features/transactions/components/{TransactionList,TransactionRow}.tsx`,
`modules/finance/lib/format.ts`, `features/overview/components/RecentTransactionsCard.tsx` (it may
render the list), H CLAUDE.md "Inherited finance gotchas" (38/39: never a raw sign; 40/41
`isExpense`), `styles/design-system.test.ts`.

Rewrites: as T03 (keys `transactions.*` → `finance.transactions.*`, `@/lib/format` (F) →
`@/modules/finance/lib/format`, router hooks → `@/lib/nav`); H's tokens and H's `AmountText`.

Steps: `formatDayHeading` in `modules/finance/lib/format.ts` with F's cases in `format.test.ts`;
`TransactionList` groups by `bookedAt` day (F's grouping and day sum, the sum computed with F's rule
over integer cents); `TransactionRow`: separators joined between parts, never appended (gotcha 64);
below `sm` only the bare share figure under the amount with the sentence in `aria-label`, from `sm`
the written sentence in the meta line (gotcha 61); the RecentTransactionsCard keeps working (it may
opt out of grouping if F's overview card does). Add pure helpers (`groupByDay`, `joinMetaParts`) with
tests. No catalog edit (F's list uses existing keys; if a key turns out to be needed, report it
instead of editing the catalog T03 owns).

Files: `apps/web/src/modules/finance/features/transactions/components/{TransactionList,TransactionRow}.tsx`,
`apps/web/src/modules/finance/features/transactions/lib/group-by-day.ts`,
`apps/web/src/modules/finance/features/transactions/lib/group-by-day.test.ts`,
`apps/web/src/modules/finance/lib/format.ts`, `apps/web/src/modules/finance/lib/format.test.ts`,
`apps/web/src/modules/finance/features/overview/components/RecentTransactionsCard.tsx`.

Acceptance: typecheck, test, build green; `format.test.ts` has F's `formatDayHeading` cases; the
finance greps and the design-system test clean; no raw sign rendered.

### M3b-T05 — Core API: placeholder members and claim invites (core)

Goal: decisions 2-4 implemented in the core, with F's `placeholders.test.ts` ported as H's.

Read: this plan decisions 1-5; ADR 0006 (T01); F `git show b1b517d -- apps/api/src/routes/auth.ts
apps/api/src/routes/households.ts apps/api/src/services/auth/invites.ts
apps/api/src/services/auth/users.service.ts apps/api/src/services/households/members.service.ts
apps/api/test/placeholders.test.ts` and `git show 1715207 -- apps/api/src/services/auth/users.service.ts`
(the conditional UPDATE); F CLAUDE.md gotchas 23 (the token is the capability), 55 (an accepted token
stops being one), 72; H's `core/routes/{auth,members,invites}.ts`,
`core/services/auth/{users,invites}.ts`, `core/services/households/{households.service,invites.service}.ts`,
`apps/api/test/households.test.ts` and `auth.test.ts` for the harness style; H CLAUDE.md "Middleware
chain order", "A seated participant cannot leave", "API import cycle", "`file::memory:` is per
client".

Steps:
1. `users.ts`: `createPlaceholderUser(tx, name)` (decision 1 row; `locale` NULL so `env.defaultLocale`
   applies) and `claimPlaceholderUser(db, userId, { email, name, passwordHash })` exactly as decision 4
   (one conditional UPDATE … RETURNING; `isUniqueViolation` → `email_taken`; zero rows →
   `member_has_account`).
2. `households.service.ts`: `addPlaceholderMember(db, householdId, displayName)` (transaction: user +
   `household_members` row role `member`), `renamePlaceholderMember`, `isPlaceholderMember`;
   `removeMember` deletes the user row after the membership when the removed member is a placeholder
   (inside the existing transaction, after the module hooks); `updateMemberRole` refuses a placeholder
   (`409 conflict`, `server.household.placeholderRole`); `deleteHousehold` deletes the placeholder
   members' user rows after the household row.
3. Routes in `core/routes/members.ts`: `POST /:householdId/members` and `PATCH
   /:householdId/members/:userId/placeholder` (decision 2/3 middleware; the PATCH path is registered
   before `/:householdId/members/:userId` if Hono needs it).
4. Invites: `packages/shared/src/core/schemas/household.ts` `CreateInviteRequestSchema` per decision 4
   (refine with `refineKey` and an existing required-field key); `invites.service.ts`
   `createInvite` claim branch (member check, placeholder check, revoke older pending claim invites of
   that user, mail only with an address, response `mailDelivery` omitted and `emailSent: false`
   without one), `previewInvite` `claimsDisplayName`; `acceptInvite` (both services) → `409
   invite_claim_requires_register` for a claim invite unless the caller is the claimed user.
5. `core/routes/auth.ts` register: load the invite first (as now); if it has `claimsUserId` and
   status `pending`: `claimPlaceholderUser`, mark the invite accepted, set the active household, send
   the confirmation mail, start the session, `201` with the auth payload; an accepted claim invite →
   `404 invite_invalid` (F gotcha 55); otherwise the existing path unchanged. The `email_taken`
   pre-check stays before the claim (an address that already has an account never claims).
6. Tests `apps/api/test/placeholders.test.ts` (every F case of `placeholders.test.ts` that is a core
   concern, adapted to H: admin creates a placeholder → `201`, member list `hasAccount: false`,
   `email: null`; a plain member gets `403`; rename by admin, `409 member_has_account` on an account;
   role change refused; remove → user row gone and its claim invites gone; claim invite for an
   account `409 member_has_account`, for a stranger `404`; register with the claim token → `201`,
   SAME user id, membership kept, invite accepted, `email_verified_at` NULL; second register with the
   same token → `404`/`409`; an existing account accepting → `409 invite_claim_requires_register`; a
   taken address → `409 email_taken` and the placeholder untouched; the race: two
   `claimPlaceholderUser` calls in `Promise.all` → exactly one wins, the other `409
   member_has_account`; login is impossible for a placeholder; `GET …/invites/:token` shows
   `claimsDisplayName`; deleting the household removes the placeholder user). The finance-side cases
   (seat, bookings veto) are T07's.

Files: `apps/api/src/core/services/auth/{users,invites}.ts`,
`apps/api/src/core/services/households/{households.service,invites.service}.ts`,
`apps/api/src/core/routes/{auth,members,invites}.ts`, `packages/shared/src/core/schemas/household.ts`,
`apps/api/test/placeholders.test.ts`, `apps/api/test/households.test.ts` (only if an existing case
must change).

Acceptance: `bun test apps/api/test/placeholders.test.ts apps/api/test/households.test.ts
apps/api/test/auth.test.ts` green; the claim is one UPDATE statement with the two NULL conditions
(read the code); full suite and typecheck green.

### M3b-T06 — Core security hardening from 1715207 (build)

Goal: F's core-side security fixes on H's core, each with its test.

Read: this plan decisions 15, 16; F CLAUDE.md gotchas 18 (now 18, unchanged), 66, 67, 70, 74; F
files `apps/api/src/middleware/{originGuard,securityHeaders}.ts`, `git show 1715207 --
apps/api/src/index.ts apps/api/src/env.ts apps/api/src/db/client.ts apps/api/scripts/seed.ts
apps/api/src/routes/auth.ts apps/api/src/routes/households.ts apps/api/src/services/auth/rateLimit.ts
packages/shared/src/schemas/auth.ts packages/shared/src/schemas/households.ts .github/workflows/ci.yml
apps/api/test/security.test.ts`; H `apps/api/src/index.ts` (cors, mount order: health, `/uploads`,
`mountModules`, `/api/auth`, `/api/households`, static web last), `middleware/staticWeb.ts`,
`apps/web/index.html` (inline pre-paint script), `apps/web/vite.config.ts` (proxy, PWA register mode),
`modules/recipe/features/cards/lib/scan.ts` (wasm), H CLAUDE.md "D7 pragmas", "Middleware chain order
is load-bearing", "Uploads are signed", "API import cycle", "Headless runs".

Steps:
1. `middleware/originGuard.ts` (decision 15) mounted in `index.ts` on `/api/*` after `cors()` and
   `localeMiddleware`, before health/`mountModules`; `middleware/securityHeaders.ts` (decision 16,
   F's `inlineScriptHashes` exported) on `*` with `env.webDistDir`.
2. `core/routes/auth.ts` `readJson`: refuse a body whose `Content-Type` is not `application/json`
   (`400`, `server.auth.invalidJsonBody`).
3. `rateLimit.ts`: `clientIp` takes the LAST `X-Forwarded-For` entry; add `INVITE_RULE` (10/h per
   user, only when the invite carries an `email`) in `core/routes/invites.ts` and
   `HOUSEHOLD_CREATE_RULE` (5/h per user) on `POST /api/households` in `core/routes/households.ts`;
   tests reset the buckets (`resetRateLimits`).
4. `env.ts`: in production refuse a `SESSION_SECRET` matching `/^change-me/i` with F's English message.
   `scripts/seed.ts`: in production refuse unless `ALLOW_SEED=1` and `SEED_PASSWORD` (≥ 10 chars) is
   set, then use it for the demo users (else `demo1234` as today); `.env.example` documents both.
5. `db/client.ts`: `"foreign_keys = ON"` appended to `LOCAL_FILE_PRAGMAS`, the data directory created
   with `mode: 0o700`; update `test/db-pragmas.test.ts` (D7 stays: WAL + FULL).
6. Shared bounds: `LoginRequestSchema.password` and `currentPassword` `.max(200)` (min as today);
   `DisplayNameSchema` and the household name schemas (`CreateHouseholdRequestSchema.name`,
   `UpdateHouseholdRequestSchema.name`) refuse control characters with
   `refineKey("server.validation.noControlChars")`.
7. `.github/workflows/ci.yml`: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`,
   `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`,
   `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0` (F's pins, byte-identical).
8. Tests `apps/api/test/security.test.ts`: F's origin cases (cross-site 403 before any handler,
   same-site sibling 403, mismatching `Origin` 403, matching and absent pass, safe methods never
   checked) plus "an `Origin` in `WEB_ORIGIN` passes even with `Sec-Fetch-Site: same-site`"; the body
   cases (text/plain → 400; an oversized password → 422 before argon2); the header cases (CSP with
   `'wasm-unsafe-eval'`, the `img-src` of decision 16, `frame-ancestors 'none'`, `nosniff`, no
   `strict-transport-security`; `inlineScriptHashes` hashes inline bodies and skips `src=`); last-hop
   `clientIp`; the production refusals of `env.ts` (pure function or subprocess) and `seed.ts`
   (subprocess with `NODE_ENV=production`). Existing tests that post without
   `Content-Type: application/json` to `/api/auth/*` are fixed to send it.

Files: `apps/api/src/index.ts`, `apps/api/src/middleware/originGuard.ts`,
`apps/api/src/middleware/securityHeaders.ts`, `apps/api/src/core/routes/{auth,households,invites}.ts`,
`apps/api/src/core/services/auth/rateLimit.ts`, `apps/api/src/env.ts`, `apps/api/src/db/client.ts`,
`apps/api/scripts/seed.ts`, `.env.example`, `packages/shared/src/core/schemas/{user,household}.ts`,
`.github/workflows/ci.yml`, `apps/api/test/security.test.ts`, `apps/api/test/db-pragmas.test.ts`,
`apps/api/test/static-web.test.ts`, `apps/api/test/auth.test.ts` and other `apps/api/test/*.test.ts`
that need the content type (never the `legacy-*` and `import-order` tests: T09 owns them in the same
wave; T09's new register call sends the header itself).

Acceptance: full suite, typecheck, build green; `import-order.test.ts` green; a local
`WEB_DIST_DIR=./apps/web/dist bun run start` answers `/` with a CSP header containing one
`'sha256-…'` per inline script of the built `index.html` (curl, recorded in the commit body).

### M3b-T07 — Finance API: 1715207 fixes and placeholder seats (build)

Goal: F's finance-side security fixes and the seat rules of decision 6, with
`finance-security.test.ts` and the placeholder cases of `finance-participants.test.ts`.

Read: this plan decisions 6, 12; ADR 0004; F CLAUDE.md gotchas 48 (Zod refine codes, was 47), 51
(cause chain, was 50), 68, 70, 71, 73; F `git show 1715207 -- apps/api/src/services
packages/shared/src/schemas/common.ts packages/shared/src/schemas/tags.ts
packages/shared/src/schemas/transactions.ts apps/api/test/security.test.ts` and `git show b1b517d --
apps/api/test/placeholders.test.ts`; H `modules/finance/services/{support.ts,ledger/*,plan/*,tags/*,
participants/participants.service.ts}`, `routes/participants.ts`, `test/support/finance-harness.ts`
(`createPlainHousehold`, `addMember`, `enableFinance`), H CLAUDE.md "Finance TS identifiers carry a
`finance` prefix", "Participants and the gate", "Plan payer and income person must be participants",
"The finance test harness".

Rewrites: F's `transactions`, `mutationClaims`, `tags`, `incomes`, `fixedCostPlans` →
`financeTransactions as transactions` etc. (aliased imports); F's `getMember(db, householdId, id)` →
H's participant lookup (`participantSlotOf`, `server.finance.personNotParticipant`); route bodies
stay H's.

Steps:
1. `packages/shared/src/modules/finance/schemas/common.ts`: `MIN_PERIOD`/`MAX_PERIOD` and the bounds
   refine (`server.validation.periodBounds`); `tags.ts` `q` max 100; `transactions.ts` `tags`
   `.max(20)`, `tagIds` `.max(400)`, `q` `.max(100)`; `participants.ts` display name refuses control
   characters (`server.validation.noControlChars`).
2. `services/support.ts` `escapeLikePattern` + `escape '\\'` in `transactions.service.ts` (`q`) and
   `tags.service.ts` (`listTags`); `tagIds` de-duplicated and capped at 10.
3. `ledger/idempotency.ts` `peekMutationClaim(db, mutationId, householdId)` and its caller;
   `settlements.service.ts` replay loads the row filtered by household (`404` otherwise);
   `plan/accrual.service.ts` stores `${error.name}: see server log` and logs the full error.
4. `plan/plan.service.ts`: `assertPeriodRange` on item and income create/update (`422`,
   `server.validation.periodRange`); `enabled: true` without `payerId` re-checks the stored payer is
   a participant (H's finding-B check, same error).
5. Participants (decision 6): `assignParticipants` refuses a placeholder in slot 1 (`422
   validation_failed`, detail on the slot-1 entry, `server.finance.placeholderSlotOne`), names a
   placeholder seat after `users.name`; `PATCH …/participants/:userId { displayName }` for the other
   seat when it is a placeholder; responses carry `hasAccount`.
6. Tests: `apps/api/test/finance-security.test.ts` with F's cases (plan payer/income stranger 422; a
   period before 2000 and an inverted range 422 never 500; leaving: the two F cases as ADR 0004
   asserts them, named "F: slot 1 cannot leave … (H: ADR 0004 re-seat)" and "F: the payer of an
   ENABLED plan … (H: payer follows on an empty ledger, 409 with rows)"; more than 20 tags 422; `q=%`
   matches only a literal `%`; a settlement replay with another household's `mutationId` 404; a
   delete replay with another household's `mutationId` is not a silent no-op); and in
   `finance-participants.test.ts`: a placeholder (created through the core route) seated in slot 2,
   refused in slot 1, renamed by the other participant, a real seat not renameable by the other,
   `hasAccount` false, and removing the seated placeholder with bookings → `409 member_has_ledger`
   (through the core DELETE). Shared schema cases in `packages/shared/test/finance-schemas.test.ts` /
   `finance-period.test.ts`.

Files: `packages/shared/src/modules/finance/schemas/{common,tags,transactions,participants}.ts`,
`apps/api/src/modules/finance/services/support.ts`,
`apps/api/src/modules/finance/services/ledger/{idempotency,settlements.service,transactions.service}.ts`,
`apps/api/src/modules/finance/services/plan/{accrual.service,plan.service}.ts`,
`apps/api/src/modules/finance/services/tags/tags.service.ts`,
`apps/api/src/modules/finance/services/participants/participants.service.ts`,
`apps/api/src/modules/finance/routes/participants.ts`, `apps/api/test/finance-security.test.ts`,
`apps/api/test/finance-participants.test.ts`, `apps/api/test/support/finance-harness.ts` (only if a
helper is needed), `packages/shared/test/finance-schemas.test.ts`, `packages/shared/test/finance-period.test.ts`.

Acceptance: `bun test apps/api/test/finance- packages/shared/test/finance-` green, full suite green;
`finance-cross-household.test.ts` gains the new by-id route (`PATCH …/participants/:userId` with
another household's user id → 404); the NOSHADOW grep of plan m3 section 3 clean.

### M3b-T08 — Migration: placeholder users and their households (core)

Goal: decision 13's user and household half on the fixtures: FH6 with a placeholder in slot 2 and a
pending legacy claim invite, migrated as a placeholder member of the merged group with its seat.

Read: plan m5 decisions 9, 10, 11, 17, 18 and Table F; this plan decision 13; ADR 0006 (T01);
`apps/api/scripts/legacy/{users,households,types,report,mapping}.ts`,
`apps/api/test/fixtures/legacy/{facts,build}.ts`, `README.md`, the `legacy-*.test.ts` files; F
`apps/api/drizzle/0002_placeholder_members.sql`; H CLAUDE.md "Long commands".

Steps:
1. Fixtures: `facts.ts` gains `FINANCE_USERS.pia` (placeholder: `email`, `emailNormalized`,
   `password`, `hash` all `null`; widen `FixtureUser` accordingly; name "Pia Platzhalter"),
   `FINANCE_HOUSEHOLDS.FH6` (`id: fixtureId(NS.financeHousehold, 6)`, name "Kasse Anna & Pia",
   creator anna, members anna slot 1 "Anna", pia slot 2 "Pia", plan payer anna, plan disabled, the
   expected decision `merge` into G2, reason as the existing proposal rule yields once G1 is taken by
   FH1), three FH6 transactions (one paid by pia), and one F `invites` row for FH6: `claims_user_id =
   pia`, `status: "pending"`, `expires_at` far in the future (fixed, e.g. 2099), fixed 43-char token,
   `email: null`, `invited_by: anna`. Update `EXPECTED` (users, financeParticipants, financeSettings,
   householdModules, balances rows, `legacyRows.finance`, `financeLedgers.FH6`) and the traps comment
   ("FH6's slot 2 is a placeholder with a pending claim invite"). `build.ts` writes them; rebuild; `--check`.
2. `users.ts`: decision 13's placeholder branch (F predicate `password_hash IS NULL`; non-NULL
   e-mail on such a row → error); `report.users.placeholders` count (add the field in `types.ts`).
3. `households.ts`: candidate groups computed from account members only; placeholders added as
   `member` (merge: via `addMembers`; new household: a `member` row); `memberEmails` entries for a
   placeholder read `placeholder <F user id>` (no name in a field meant for addresses); the
   `no-account-members` error (add the reason to `DecisionReason`); `finance_participants` copy
   unchanged; `active_household_id` of the placeholder set by the existing guarded UPDATE.
4. Tests: `legacy-users.test.ts` (pia written with NULL e-mail/hash/verified, own ledger row, never
   matched by e-mail, fresh id when taken); `legacy-households.test.ts` (FH6 merges into G2, pia is a
   G2 member, slot 2 seat with display name "Pia"); `legacy-finance.test.ts` (FH6 balance OK with a
   placeholder payer); a mutated-copy case where the only member is a placeholder → error
   `no-account-members`, exit 1; `legacy-fixtures.test.ts`, `legacy-cli.test.ts` counts. F `invites`
   are still "not migrated" in this task (T09 changes that).

Files: `apps/api/test/fixtures/legacy/{facts,build}.ts`, `apps/api/test/fixtures/legacy/finance.db`,
`apps/api/test/fixtures/legacy/README.md`, `apps/api/scripts/legacy/{users,households,types,report}.ts`,
`apps/api/test/legacy-{users,households,finance,fixtures,cli,framework}.test.ts`.

Acceptance: `build.ts --check` exits 0; `bun test apps/api/test/legacy-` green; the fixture CLI dry
run and apply (T08's commands of plan m5 9.4) exit 0 with every balance OK.

### M3b-T09 — Migration: claim invites, the report section, the claim proven by register (core)

Goal: decision 13's claim-invite half and decision 14, plus the exit test "a migrated placeholder is
claimable by register on the fixtures", and `docs/migration.md`.

Read: this plan decisions 13, 14; ADR 0006; plan m5 decisions 5, 6, 7, 15, 16, 18;
`apps/api/scripts/{migrate-legacy.ts,legacy/run.ts,legacy/report.ts,legacy/types.ts,legacy/households.ts}`,
`apps/api/src/core/services/auth/invites.ts` (`generateInviteToken`, `INVITE_TTL_MS`: import only
this light module, after the CLI's redirect like every library import), `docs/migration.md`,
`apps/api/test/{legacy-cli,legacy-migration-doc,import-order}.test.ts`; T05's register claim path.

Steps:
1. New `apps/api/scripts/legacy/claims.ts` `migrateClaimInvites(ctx)` called by `run.ts` after
   `migrateFinance` (seats exist) and before `verifyBalances`: decision 13's reuse-or-create with the
   ledger key `claim:<F user id>`; in dry-run mode it decides and reports but the token is not shown.
   F `invites` "not migrated" count excludes reused claim invites.
2. `types.ts`/`report.ts`: `Report.placeholders: PlaceholderEntry[]` (`financeUserId`,
   `targetUserId`, `financeHouseholdId`, `targetHouseholdId`, `slot`, `claimInvite` state,
   `inviteId?`, `inviteUrl?` only in apply), the `== Placeholders and claim invites ==` section;
   `RunOptions.webOrigin`.
3. `migrate-legacy.ts`: `resolveCliEnv` also returns `webOrigin` (decision 14), passed to the real
   pass of `--apply` only; a second `--apply` prints the existing pending link read through the ledger
   and writes nothing.
4. Tests `apps/api/test/legacy-placeholders.test.ts`: dry run lists pia with `would-reuse` and no URL;
   apply: one `household_invites` row with `claims_user_id` = pia's target id, the legacy token, status
   pending, `email` NULL, `inviteUrl` = `<origin>/invite/<token>`; a mutated copy with the legacy claim
   invite revoked → `created`, fresh token, `invited_by` = G2's owner, `expires_at` = run time + 14
   days, `email` NULL; a mutated copy with it expired → `created`; a second apply writes 0 rows and
   no second invite; THE CLAIM: migrate the fixtures with `runLegacyMigration({ mode: "apply", target:
   { db, client, url: "file::memory:" }, … })` into the shared test DB (after `runMigrations(db)`;
   first assert no fixture e-mail exists there, else fail loudly), then `app.request("/api/auth/register",
   { method: "POST", headers: { "Content-Type": "application/json" }, body: { email: "pia@example.test",
   name: "Pia", password: <≥ 8 chars>, inviteToken: <the claim token> } })` → `201`, the session's user
   id equals pia's migrated id, `users.email` set and `password_hash` non-NULL, the invite accepted,
   `GET …/finance/participants` (as anna) shows pia's seat with `hasAccount: true` and every
   transaction pia paid still names her. `legacy-cli.test.ts`: the new heading in its order;
   `import-order.test.ts`: `legacy/claims.ts` in a fresh process.
5. `docs/migration.md`: the placeholder rule, where the claim link appears (apply output only),
   that it is a credential (hand it over privately, never commit or paste the apply report), how to
   re-print it (a second `--apply`), the `WEB_ORIGIN` it uses, and the 3-migration finance gate.
   Keep `legacy-migration-doc.test.ts` green (update the headings it pins if any).
6. Real data, as a check only (outputs into a temp dir, never pasted): the dry run against
   `/home/erics/software/toon-household/migration-in/…` exits 0.

Files: `apps/api/scripts/legacy/{claims,run,report,types}.ts`, `apps/api/scripts/migrate-legacy.ts`,
`apps/api/test/legacy-placeholders.test.ts`, `apps/api/test/legacy-cli.test.ts`,
`apps/api/test/import-order.test.ts`, `apps/api/test/legacy-migration-doc.test.ts`, `docs/migration.md`.

Acceptance: legacy suite green; the claim test passes; the real-data dry run exits 0 (verify below).

### M3b-T10 — Core web: placeholders in the member list, claim links, claim registration (build)

Goal: decision 7's core half, decision 8's core keys, and F's web security fixes on the core.

Read: this plan decisions 4, 5, 7, 8; F `git show b1b517d -- apps/web/src/features/household
apps/web/src/features/auth apps/web/src/lib/api.ts apps/web/src/lib/i18n/catalogs/auth.de.ts
apps/web/src/lib/i18n/catalogs/settings.de.ts` and `git show 1715207 -- apps/web/src/lib/api.ts
apps/web/src/lib/session.tsx`; F `docs/spec.md` §4.8 (the household screen text) and the §6 `auth.*`
and `settings.household.*` rows; H `core/features/households/{HouseholdDetailPage.tsx,
components/MemberList.tsx,components/InvitePanel.tsx,lib/queries.ts}`,
`core/features/auth/{InvitePage,RegisterPage}.tsx`, `lib/{api.ts,queries.ts,session.tsx,persist.ts}`,
`lib/i18n/catalogs/{auth,household}.{de,en}.ts`; H CLAUDE.md "`MessageKey` must stay a literal union",
"Every shell screen renders `PhoneHeaderRow`", the D5 design-system rules; R `docs/redesign/SPEC.md`.

Steps:
1. `lib/api.ts`: `seg()` = `encodeURIComponent` for every path segment built from a value (F
   1715207); fetchers `createPlaceholderMember(householdId, { displayName })`,
   `renamePlaceholderMember(householdId, userId, { name })`, `createInvite` accepting
   `{ claimsUserId }`; `lib/queries.ts`/`core/features/households/lib/queries.ts` hooks with the
   members and invites invalidation.
2. `lib/session.tsx`: the 401 handler also calls `setActiveCacheUser(null)` and
   `purgePersistedCache()` (F 1715207), like `useLogout`.
3. `MemberList.tsx`: placeholder badge + hint; admin+ row actions "Umbenennen"
   (`PlaceholderRenameDialog.tsx`), "Person entfernen" (F's confirm, `409 member_has_ledger` keeps
   it open with the error), "Konto für {name} verknüpfen" (`ClaimInviteDialog.tsx`: create, show,
   copy with `shareOrCopy`/`copyToClipboard`, `linkAccountLinkHint`); no role menu for a placeholder.
   `InvitePanel.tsx`: a pending claim invite row reads `household.claim.title` with the name instead of
   an address.
4. `InvitePage.tsx`: the claim variant (`claimsDisplayName !== null`): logged out → claim subtitle and
   "Konto erstellen" to `/register` with the invite token and the name prefilled; logged in →
   `auth.invite.claimLoggedIn` and "Abmelden" (logout, stay on the page); the plain variant unchanged.
   `RegisterPage.tsx`: with a claim invite, `auth.register.claimHint`, name prefilled, no household
   name field; a `409 email_taken` shown as today.
5. Catalogs (decision 8) in `lib/i18n/catalogs/{auth,household}.{de,en}.ts`, literal-typed.
6. Tests: a pure `inviteMode(preview, isLoggedIn)` helper with cases; a `seg` test (a `/` in an id
   stays inside one segment); a source pin that the 401 handler purges; the core phone-header guard
   stays green.

Files: `apps/web/src/lib/api.ts`, `apps/web/src/lib/queries.ts`, `apps/web/src/lib/session.tsx`,
`apps/web/src/lib/api.test.ts`, `apps/web/src/core/features/households/lib/queries.ts`,
`apps/web/src/core/features/households/components/{MemberList,InvitePanel,PlaceholderRenameDialog,ClaimInviteDialog}.tsx`,
`apps/web/src/core/features/households/HouseholdDetailPage.tsx`,
`apps/web/src/core/features/auth/{InvitePage,RegisterPage}.tsx`,
`apps/web/src/core/features/auth/lib/invite-mode.ts`, `apps/web/src/core/features/auth/lib/invite-mode.test.ts`,
`apps/web/src/lib/session-purge.test.ts`, `apps/web/src/lib/i18n/catalogs/{auth,household}.{de,en}.ts`.

Acceptance: typecheck, test, build green; parity OK; the design-system test green; no `t()` of a
person's name (names are content).

### M3b-T11 — Finance web: the placeholder flow in the enable dialog and the participants section (build)

Goal: decision 7's finance half: "Ohne Konto hinzufügen" in `EnableFinanceDialog` and
`ParticipantsSection`, the placeholder badge, F's rename, the claim link; finance `seg()` encoding.

Read: this plan decisions 6, 7, 8; F `git show b1b517d -- apps/web/src/features/household/components/
InviteCard.tsx apps/web/src/features/household/components/MemberList.tsx
apps/web/src/features/household/lib/queries.ts`; F `docs/spec.md` §4.8; H
`modules/finance/features/participants/{EnableFinanceDialog,ParticipantsSection}.tsx`,
`lib/{assignment,queries}.ts`, `assignment.test.ts`, `modules/finance/lib/{api,participants}.ts`,
`modules/finance/catalogs/{settings,participants}.{de,en}.ts`; T10's core fetchers in `@/lib/api`;
H CLAUDE.md "`settingsSections` are rendered", "A module owns its layout route and its static import
graph stays shell-free" (`EnableFinanceDialog` and `ParticipantsSection` are static manifest imports:
no `@/modules`, `@/components/layout`, `use-nav-items`, and no import from `@/core/features/*`), the
finance greps.

Steps:
1. `modules/finance/lib/api.ts`: `seg()` for every path segment; `renameParticipant(householdId,
   userId, { displayName })`.
2. `assignment.ts`: placeholders are assignable to slot 2 only (`hasAccount`), with tests.
3. `EnableFinanceDialog.tsx`: an "Ohne Konto hinzufügen" block (F's title, description, a name field,
   "Person eintragen") that creates the placeholder through the core fetcher, refetches the members
   and preselects it as Platz 2; the one-member household gets this block instead of only the "Lade
   zuerst jemanden ein" text.
4. `ParticipantsSection.tsx`: the placeholder badge and hint on its seat, "Umbenennen" for the other
   participant (decision 6), "Konto für {name} verknüpfen" for admins+ (core `createInvite({
   claimsUserId })`, link shown and copied with F's hint), and "Ohne Konto hinzufügen" for admins+
   when slot 2 is replaceable (PUT refused with rows: the `409 finance_participant_in_use` text as
   today).
5. Catalogs `finance.settings.household.*` (decision 8) in `modules/finance/catalogs/settings.{de,en}.ts`.

Files: `apps/web/src/modules/finance/lib/api.ts`, `apps/web/src/modules/finance/lib/participants.ts`,
`apps/web/src/modules/finance/features/participants/{EnableFinanceDialog,ParticipantsSection}.tsx`,
`apps/web/src/modules/finance/features/participants/lib/{assignment,queries}.ts`,
`apps/web/src/modules/finance/features/participants/lib/assignment.test.ts`,
`apps/web/src/modules/finance/catalogs/settings.{de,en}.ts`.

Acceptance: typecheck, test, build green; the finance greps and parity clean; `manifest.test.ts` and
`persist.test.ts` green (shell-free graph).

### M3b-T12 — Integration: gates, evidence runs, headless screenshots, docs sync (build)

Goal: prove the exit criteria on the merged tree and sync the docs.

Read: this whole plan; CLAUDE.md "Headless runs", "`scrollbar-gutter: stable`", "Printing a recipe",
"Long commands"; plan m4 section 9 for the record format; `docs/migration.md` (T09).

Steps:
1. Gates on the merged tree (section 3 commands), `i18n:check` leftover hits classified (expect 138
   plus the new comment quotes; list each new one).
2. Fresh-DB walkthrough (`DATABASE_URL=file:./data/m3b.db`, `db:migrate`, `seed`, built app with
   `WEB_DIST_DIR`): curl creates a placeholder (`POST …/members`), seats it (`PUT …/finance/
   participants` on a new household), creates a claim invite, registers with it (same id), checks
   `409 invite_claim_requires_register` for a logged-in accept, the origin guard (`Origin:
   https://evil.example` → 403; the app's own origin → passes), the CSP header, `foreign_keys` on.
3. Owner data, from the main checkout (absolute paths if run in a worktree; `migration-in/` exists
   only there), with `DATABASE_URL=file:./migration-out/toon.db UPLOAD_DIR=./migration-out/uploads`
   and `migration-out/toon.db` absent (move an older one to `migration-out/pre-m3b/` first): the dry
   run of the exit criterion with `--report migration-out/m3b-dry-run.json` and stdout redirected to
   `migration-out/m3b-dry-run.log`; then `--apply --report migration-out/m3b-apply.json` (stdout to
   `migration-out/m3b-apply.log`: it holds the live claim link, hand it to nobody here); then a second
   `--apply` (`migration-out/m3b-apply-2.log`) that ends `[migrate:legacy] already migrated: nothing
   written.` Record ONLY counts (users, households, transactions, placeholders = 1, claim invites = 1,
   balance verdict OK) in section 9.
4. Headless (Playwright in a scratch directory outside the repo, log ending `exit=$?`), seeded demo
   data only, 390 (mobile context) and 1440, light (dark where cheap): the Erfassen sheet opened by
   `n` and by the TransactionsPage opener (stays open and clears after "Buchen", focus on Betrag);
   `/finance/new` (host claimed: `n` does nothing there); the transaction list grouped by day; the
   enable dialog with "Ohne Konto hinzufügen" on a fresh household created through the API from a
   non-SPA page; the participants section with the placeholder and the claim link; the core member
   list with the badge; the claim InvitePage logged out and logged in; the RegisterPage with the claim
   hint. Checks: no console error (CSP included) on these and on the recipe list, detail, import,
   shopping and cards screens, `scrollWidth <= clientWidth`, no element beyond the viewport. PNGs in
   `docs/plans/screenshots/m3b/` (`<screen>-<390|1440>-<light|dark>.png`), indexed in section 9.
5. Docs: CLAUDE.md (status M3b, layout additions, new gotchas: placeholders and claim invites, origin
   guard with `WEB_ORIGIN`, CSP and its recipe exceptions, the module-local sheet without FAB, the
   migration's claim links are credentials, F gotcha renumbering; the M6 obligations of section 7.2);
   F gotcha numbers in H code comments and CLAUDE.md moved to F's 1715207 numbering (decision 11); the
   m3 plan's section 9.3 gets an "M3b addendum" with section 2's pairs and case counts (H ≥ F); SPEC
   §3 lists the two new middleware files and `scripts/legacy/claims.ts`; this plan's sections 9 and 10.

Files: `CLAUDE.md`, `docs/SPEC.md`, `docs/plans/m3b-finance-sync.md`, `docs/plans/m3-finance-module.md`,
`docs/plans/screenshots/m3b/*.png`, code comments citing F gotcha numbers (comment-only edits), plus
any defect fix found by the run (each its own commit, listed in section 9).

Acceptance: every exit criterion of the milestone, evidenced in section 9; nothing from
`migration-in/` or `migration-out/` in `git status` or in any commit.

## 5. Risks

- **The `users` ALTER.** drizzle-kit could emit a table rebuild for the nullable e-mail; a rebuild of
  `users` inside the migrator's transaction with foreign keys on would cascade into every table. T01
  stops on anything but `ALTER COLUMN` and proves the migration on a populated DB.
- **Origin guard vs the dev setup.** H's default dev path is cross-origin (`:5173` → `:3001`, same
  site); F's guard would 403 every write. Decision 15's `webOrigins` allowance is the fix; T06 tests
  it and T12 exercises `bun run dev`-shaped requests with curl.
- **CSP vs the recipe module.** zxing-wasm needs `'wasm-unsafe-eval'`; previews use `blob:`/`data:`;
  remote hero images need `https:`; a `Permissions-Policy` would kill the camera. The headless run
  watches the console on the recipe screens; the card scanner itself cannot be exercised headless
  (no camera) and is listed as unverified if so.
- **Content-type requirement** breaks any test or client that posts to `/api/auth/*` without
  `application/json`; H's web client sets it (`lib/api.ts` line 229). T06 fixes the tests.
- **Shared test DB in the claim test** (T09): the fixtures' e-mails could collide with a user another
  test file registered in the same `bun test` process. The test asserts absence first and fails loudly.
- **A placeholder alone in slot 1** after ADR 0004's re-seat (decision 6): no one can open the ledger
  until an admin seats two people; the participants section must render that state (T11).
- **Real data surprises.** The plan's counts come from one read of copies; T09's verify runs the dry
  run early so T12 is not the first to meet them.
- **`n` shortcut collisions.** The recipe module has no `n` binding today (grep in T03); the listener
  only lives inside the finance gate.
- **Gotcha renumbering** touches many comments; T12 does it as comment-only edits in one commit.

## 6. Deviations expected (to be confirmed in "what changed vs plan")

- ADR 0006 (SPEC D4, §4, §6 items 1/2/5/6, §9): placeholder accounts and claim invites; the migration
  rule for placeholders. The only §1 change.
- Plan-level (no ADR): D6 kept, no FAB, no SideNav button (decisions 9, 10); `img-src`/`script-src`
  wider than F's CSP for the recipe module (decision 16); origin guard trusts `WEB_ORIGIN` (decision
  15); F's leave rules not ported because ADR 0004 covers them (decision 12); claim invites need
  admin+ in H (F: either member); `anchorCannotLeave`, `common.appName`, `nav.manage`, palette, fonts,
  icons, `lazy-page` not ported.

## 7. Out of this milestone

### 7.1 Not here at all

The N-person ledger (D3); F's petrol palette, fonts, logo and icons (D5); F's tab change (D6); a
global sync badge; a placeholder outside finance's use (the core allows it, no UI promotes it).

### 7.2 What M6 must take from F `97ab955`, `590697f` and `1715207` (recorded for the M6 plan)

- `docker-compose.yml`: `cap_drop: [ALL]` and `security_opt: [no-new-privileges:true]` on `app`;
  mailpit (if kept for local stacks) bound to `127.0.0.1` and on no shared network (its UI shows
  every reset and invite link); the network alias lesson (F gotcha 19) does not apply to D11's
  single stack but a service name must never be reused on a shared network.
- `release.yml`: publish on push to `main` and on `v*` tags; `:latest` from
  `type=raw,value=latest,enable={{is_default_branch}}`; typecheck + test BEFORE the image push;
  `provenance: false`; a digest output; actions pinned to commit SHAs; `WITH_OCR=1 WITH_PDF=0`.
- `deploy.yml` gated by the repository VARIABLE `DEPLOY_ENABLED` (a job-level `if` cannot read
  secrets); a freshly published GHCR package is private and must be made public (or the server
  logged in) by hand.
- `docker/toon-deploy.sh`: forced-command SSH key per app, `set -f` (globbing off), F's argument
  checks; `docker/env.example` with `TOON_IMAGE`, `TRUST_PROXY=1` and no TLS variables in the app's
  env (the Caddy owns `TOON_TLS_ISSUER`, `TOON_HSTS_MAX_AGE`).
- Caddy: keep `header_up X-Forwarded-For {remote_host}` (H now reads the LAST hop, F gotcha 74); HSTS
  from the Caddy only (the app sends none, decision 16).
- `bun run seed` in the container refuses production without `ALLOW_SEED=1` + `SEED_PASSWORD` (T06).

## 8. Obligations carried forward

M5's and earlier obligations stand (CLAUDE.md "Obligations"); M7's `docs/API.md` must document `POST
…/members` (placeholder), `PATCH …/members/:userId/placeholder`, the claim invite and its two `409`
codes, `PATCH …/finance/participants/:userId`, the origin guard and the CSP.

## 9. Integration record

(written by M3b-T12)

## 10. What changed vs plan

(written by M3b-T12)
