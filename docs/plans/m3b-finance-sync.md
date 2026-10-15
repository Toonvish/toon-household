# M3b — finance-sync: plan

**Status: PLANNED (2026-10-15), revised after the plan review the same day (section 11).** Section 9
(integration record) is written by M3b-T12, section 10 (what changed vs plan) by M3b-T13.

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
| `CLAUDE.md` | read for the gotchas; H's CLAUDE.md is synced by T13 (F inserted a new gotcha 19, so its old 19-55 are now 20-56; 57-74 are new; decision 11) |
| `README.md` | — |
| `apps/api/drizzle/0002_placeholder_members.sql`, `meta/_journal.json` | T02 copies them byte-identical into the fixtures; H's own migration `0003_placeholder_members.sql` is generated by T01 |
| `apps/api/drizzle/meta/0002_snapshot.json` | — (the fixtures keep no snapshots, M5 decision 17) |
| `apps/api/scripts/seed.ts` | T06 (production guard: `ALLOW_SEED=1` + own `SEED_PASSWORD`), carried to H's `modules/finance/seed.ts` logins through the `seedDemo` context (decision 17) |
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
   "Umbenennen" (new `PlaceholderRenameDialog.tsx`), "Person entfernen" (the existing remove with the
   core confirm text `household.placeholder.removeConfirm` of decision 8; a `409 member_has_ledger`
   keeps the dialog open and shows the server's error) and "Konto für {name} verknüpfen" (new
   `ClaimInviteDialog.tsx`: create the claim link, show and copy it with `household.claim.linkHint`). F `InviteCard`'s "Ohne Konto hinzufügen" form → finance
   `ParticipantsSection` (when a seat is free or replaceable) and `EnableFinanceDialog` (always
   offered; the one-member household gets it instead of a dead end). The finance section also shows
   the placeholder badge, F's rename (decision 6) and the claim link for admins+, with F's
   finance-flavoured texts (`finance.settings.household.linkAccountHint`, `…linkAccountLinkHint`). F
   `InviteSecondPerson` → `apps/web/src/modules/finance/features/transactions/components/
   InviteSecondPerson.tsx`, linking to `/settings` (M3's mapping of F's `/household`). F
   `InvitePage`/`RegisterPage` claim behaviour → core `core/features/auth/InvitePage.tsx` and
   `RegisterPage.tsx`.
8. **Catalog keys (values byte-identical to F at 1715207 / F docs/spec.md §6, except five
   core-neutral values).** F wrote its placeholder copy for its finance household screen. In H the
   core Gruppe screens and the auth pages are module-neutral and say "Gruppe" (D10), and a
   recipe-only household must not read finance vocabulary or mix "Haushalt" with "Gruppe" on one
   screen. So: F's module-neutral strings go to the core byte-identical; F's finance-flavoured
   strings (they name "Buchungen", the seat "Platz" or "Haushalt") stay in the finance participants
   section only, byte-identical; the core gets five NEW German values instead.
   - Core `auth.*` (`apps/web/src/lib/i18n/catalogs/auth.{de,en}.ts`): byte-identical
     `auth.invite.claimCreateAccount` "Konto erstellen", `auth.invite.claimLoggedIn` "Dieser Link legt
     das Konto für eine bereits eingetragene Person an. Melde dich ab, um ihn zu nutzen.",
     `auth.invite.claimLogout` "Abmelden". NEW German (F's text with "im Haushalt" → "in der
     Gruppe"): `auth.register.claimHint` 'Du erstellst das Konto für „{display}" in der Gruppe
     „{household}".' (en: 'You are creating the account for "{display}" in the group "{household}".'),
     `auth.invite.claimSubtitle` '{name} hat dich als „{display}" in der Gruppe „{household}"
     eingetragen. Erstelle dein Konto, um dich anzumelden.' (en: '{name} added you as "{display}" to the
     group "{household}". Create your account to sign in.').
   - Core `household.*` (`apps/web/src/lib/i18n/catalogs/household.{de,en}.ts`): byte-identical
     `household.placeholder.badge` ← F `settings.household.placeholderBadge` "ohne Konto", `.hint` ←
     `placeholderHint` "Kann sich noch nicht anmelden.", `.rename` ← `placeholderRename`
     "Umbenennen", `.remove` ← `placeholderRemove` "Person entfernen", `.nameLabel` ←
     `settings.household.displayName` "Anzeigename", `household.claim.title` ← `linkAccount` "Konto für
     {name} verknüpfen", `household.claim.create` ← `linkAccountCreate` "Link zum Verknüpfen
     erstellen". NEW German: `household.placeholder.removeConfirm` '„{name}" wirklich entfernen? Die
     Person hat kein Konto und wird ganz gelöscht.' (en: 'Really remove "{name}"? This person has no
     account and is deleted entirely.'; a module veto such as `409 member_has_ledger` shows the
     server's own text), `household.claim.hint` "Der Link legt das Konto für diese Person an. Alles,
     was ihr in der Gruppe zugeordnet ist, bleibt ihr zugeordnet." (en: "The link creates the account
     for this person. Everything assigned to them in the group stays with them."),
     `household.claim.linkHint` "Der Link gilt 14 Tage. Wer ihn öffnet, erstellt damit das Konto für
     diese Person." (en: "The link is valid for 14 days. Whoever opens it creates the account for
     this person.").
   - Finance (`apps/web/src/modules/finance/catalogs/settings.{de,en}.ts`), byte-identical:
     `finance.settings.household.` + `placeholderTitle`, `placeholderDescription`,
     `placeholderCreate`, `placeholderBadge`, `placeholderHint`, `placeholderRename`, `linkAccount`,
     `linkAccountHint`, `linkAccountCreate`, `linkAccountLinkHint` (F's suffixes, prefix `finance.`),
     and `finance.settings.household.inviteEmail` (if it exists in H) takes F's new value
     "E-Mail-Adresse".
   - Server (core `packages/shared/src/core/i18n/catalogs/server.{de,en}.ts`): F's
     `server.household.memberHasAccount`, `server.invite.claimRequiresRegister`,
     `server.error.originMismatch`, `server.validation.periodBounds`, `server.validation.noControlChars`
     verbatim; NEW German: `server.household.placeholderRole` "Eine Person ohne Konto kann keine andere
     Rolle bekommen." and `server.finance.placeholderSlotOne` "Eine Person ohne Konto kann nur Platz 2
     belegen." F's `server.household.anchorCannotLeave` is NOT ported (ADR 0004 re-seats instead).
   - `NEW_GERMAN` (`scripts/i18n-check.ts`): T01 adds all SEVEN keys at once (the two server keys
     with `// M3b: placeholder rules (ADR 0006)`, the five core web keys with `// M3b: core-neutral
     wording of F's placeholder copy (plan m3b decision 8)`); the list is a set of exemptions, so a
     key listed before T10 writes its catalog entry is harmless. Every other new web value is found
     by the parity check in F's tree.
9. **D6 stands: Erfassen stays tab 3 at `/finance/new`; Fixkosten stays sidebar-only.** F moved
   Erfassen to a floating "+" and gave the tab to Fixkosten; D6 enumerates H's finance tabs, and ADR
   0006 is about placeholders (D1, D4, D12), not navigation. No ADR, no tab change, the `FixedCostCard` path stays.
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
11. **Gotcha numbering.** Between `cbdec67` and `1715207` F inserted a new gotcha 19 (the
    docker network alias), so its old 19-55 are now 20-56, and added 57-74; 1-18 kept their numbers
    (18 is `clientIp`). (An earlier draft of this plan said "18-56 → 19-57"; the titles show the shift
    starts at 19.) Every task of M3b (T01-T12) cites F's NEW numbers in the code it writes (e.g.
    "gotcha 48 (was 47)", "51 (was 50)"). T13 then moves ONLY the citations that predate M3b, i.e.
    lines unchanged since `7b974b1` (checked with `git blame`), and maps each old number to the new
    one by the gotcha's TITLE in the two CLAUDE.md versions, never by a blanket +1 (a blanket shift
    would turn the new 48 into 49). Historical plans and ADRs keep the numbers of their date.
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
    unmigrated (the "not migrated by design" count excludes the reused claim invite). This changes
    the text of D12 (a finance household now merges into the group whose members include every
    finance member WITH AN ACCOUNT; placeholders join as members; an all-placeholder household is the
    `no-account-members` error) and of D1 (beside R's e-mail invites there is a claim invite, without
    an e-mail, naming a placeholder, redeemable only by registration), so ADR 0006 edits D1 and D12
    too (T01 step 7).
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
    clean on every recipe and finance screen). **The trap (F gotcha 50):** `connect-src 'self'` and
    `img-src 'self'` presume the served build calls the API with RELATIVE URLs. `lib/api.ts` builds
    `API_BASE_URL` from `PUBLIC_API_URL ?? VITE_API_URL ?? "http://localhost:3001"`, and H's
    `.env.example` sets `PUBLIC_API_URL="http://localhost:3001"` for the cross-origin dev setup, so a
    build made without `PUBLIC_API_URL=""` bakes `http://localhost:3001` and, served from any other
    origin, has every API call and every `/uploads` image (`mediaUrl`) blocked. A run at
    `localhost:3001` hides it. Hence: T12 builds with `PUBLIC_API_URL=""` and checks a second origin
    (`127.0.0.1:3001`); M6's image build must set it empty (section 7.2); dev is unaffected (Vite
    serves `index.html`, the API's CSP never reaches it). The CSP is not widened for this.
17. **The demo password reaches every module's seed.** F gotcha 74's seed guard (`ALLOW_SEED=1` plus
    an own `SEED_PASSWORD` in production) must cover every login the seed creates, and H's finance
    module seeds two more (robin, kim) from its own `DEMO_PASSWORD = "demo1234"`
    (`modules/finance/seed.ts` line 32). `scripts/seed.ts` resolves the password once and passes it in
    the `seedDemo` context (`{ householdId, userId, demoPassword }`, `modules/types.ts`; SPEC §2's line
    edited by T06, no ADR: §2 is the contract, not a §1 decision); no module keeps its own password
    constant.
18. **The migration claim test cleans the shared DB.** T09's exit test runs a real `apply` into the
    shared `file::memory:` DB (it must: `app.request` only sees that DB). To keep later test files
    order-independent it migrates a FINANCE-ONLY input (no `recipe`, no uploads: the placeholder's
    household is then a new household, which is enough for the claim), asserts first that no fixture
    e-mail exists, records `count(*)` of `users`, `households`, `household_invites`, `legacy_ids`, and
    in `afterAll` deletes every household and user the run wrote (ids from `legacy_ids`, households
    first so the cascade takes the finance rows, then the users, then the `legacy_ids` rows) and
    asserts the four counts are back. The merge path (pia joining G2) is proven by T08's tests on
    the legacy harness's temp DBs, not here. Fallback, only if the finance-only apply reports an
    error the full-fixture run does not: migrate the full fixtures (uploads into a temp `UPLOAD_DIR`)
    with the same absence check and the same cleanup extended to the recipe groups' households and
    users, and record the choice in the task result.

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
| `apps/api/test/placeholders.test.ts` | 8 | `apps/api/test/placeholders.test.ts` (core) + `apps/api/test/finance-participants.test.ts` (seats); case by case in the table below | T05, T07 |
| `apps/api/test/security.test.ts` | 15 | `apps/api/test/security.test.ts` (origin guard 4+1 for `webOrigins`, body parsing 2, headers 2) + `apps/api/test/finance-security.test.ts` (plan members 2, leaving 2 asserting ADR 0004, request bounds 2, household-scoped idempotency 1) | T06, T07 |
| `apps/web/src/lib/format.test.ts` (`formatDayHeading`) | +cases | `apps/web/src/modules/finance/lib/format.test.ts` | T04 |
| `packages/shared/test/schemas.test.ts` (`ERROR_CODES` 32) | changed | `packages/shared/test/finance-schemas.test.ts` + a core error-code case in `packages/shared/test/core.test.ts` | T01, T07 |

F `placeholders.test.ts`, case by case (every case has a named H counterpart; where H's rule differs
the H test asserts H's rule and names F's case in its title):

| F case | H counterpart (file: case) | task |
| --- | --- | --- |
| seats a person without an account in slot 2 | `placeholders.test.ts`: admin creates a placeholder → `201`, `hasAccount: false`, `email: null`; `finance-participants.test.ts`: the placeholder seated in slot 2 | T05, T07 |
| a third seat is still 409 household_full, and a plain invite is refused too | `finance-participants.test.ts`: "F: a third seat … (H: `PUT …/participants` with a third entry → 422 `validation_failed` from the `.length(2)` schema, exactly two seats, D3)"; `placeholders.test.ts`: "F: … a plain invite is refused too (H: a plain e-mail invite in a household that has a placeholder → 201, D1 has N members, no household_full)" | T07, T05 |
| the other member may rename and remove the placeholder, but never a real member | `placeholders.test.ts`: admin renames (`PATCH …/members/:userId/placeholder`) and removes it; renaming an account → `409 member_has_account`; a plain member → `403`; `finance-participants.test.ts`: the other participant renames the placeholder seat (`PATCH …/participants/:userId`), a seat with an account → `403` | T05, T07 |
| a placeholder with bookings cannot be removed (409 member_has_ledger) | `finance-participants.test.ts`: the seated placeholder with bookings, core `DELETE …/members/:userId` → `409 member_has_ledger`, the user row stays | T07 |
| registering with a claim token turns the placeholder into the account — same user id | `placeholders.test.ts`: register with the claim token → `201`, same id, membership kept, invite accepted, `email_verified_at` NULL | T05 |
| an existing account cannot accept a claim invite (409 invite_claim_requires_register) | `placeholders.test.ts`: same | T05 |
| a claim invite for a member who already has an account is 409 member_has_account | `placeholders.test.ts`: same (+ a stranger's id → `404`) | T05 |
| a placeholder cannot log in and a taken address is 409 email_taken on claim | `placeholders.test.ts`: same (+ the `Promise.all` race of two claims: exactly one wins) | T05 |

Every other F test file is unchanged between `cbdec67` and `1715207` (`git diff --stat cbdec67
1715207 -- '*.test.ts' '*.test.tsx'` lists only these four), so the M3 map stands for them. T13
re-counts cases per pair (H ≥ F) and appends the result to the m3 plan's section 9.3; the per-case
table above is checked case by case, not only by count.

## 3. Task list and waves

Dependencies (`deps`, each must be merged before the task starts):

| Task | deps | why |
| --- | --- | --- |
| T01 | — | |
| T02 | — | |
| T03 | — | |
| T04 | — | no file shared with T03 (list and row vs form and sheet) |
| T05 | T01 | schema, contracts, server keys |
| T08 | T01, T02 | nullable `users.email` in the target, 3-migration fixtures |
| T06 | T05 | edits `core/routes/{auth,households,invites}.ts` and `household.ts` after T05 |
| T07 | T01, T05 | its seat tests create the placeholder through T05's core route and remove it through T05's placeholder branch of `removeMember` |
| T10 | T05 | the core routes and contracts it calls |
| T09 | T05, T08 | T05's register claim path, T08's placeholder users |
| T11 | T07, T10 | T07's `PATCH …/participants/:userId` and `hasAccount`, T10's core fetchers |
| T12 | T01-T11 | evidence on the merged tree |
| T13 | T12 | docs sync from T12's evidence |

How the workflow schedules them (`.claude/workflows/build-household.js`): each wave is
`ready.slice(0, MAX_PARALLEL)` over the task ARRAY in its order, `MAX_PARALLEL = 3` by default, and a
wave of more than one task runs in parallel worktrees. The task array is therefore ordered T01, T02,
T03, T04, T05, T08, T06, T07, T10, T09, T11, T12, T13 (not by id) so that the waves below are the
ones the scheduler actually runs:

| Wave | Tasks (parallel worktrees) | ready but held back by `MAX_PARALLEL` |
| --- | --- | --- |
| 1 | T01 core contracts + migration + ADR 0006 · T02 fixture schema at 3 migrations · T03 Erfassen sheet | T04 |
| 2 | T04 list by day + rows · T05 core placeholder/claim API · T08 migration: placeholder users and households | — |
| 3 | T06 core security hardening · T07 finance API security + seats · T10 core web placeholders + claim registration | T09 |
| 4 | T09 migration: claim invites, report, CLI · T11 finance web placeholder flow | — |
| 5 | T12 integration: gates and evidence (on main) | — |
| 6 | T13 docs sync and gotcha renumbering (on main) | — |

With `maxParallel: 4` the scheduler would run T04 in wave 1 and T09 in wave 3; the ownership
argument below holds for that layout too (T04 shares no file with T01-T03; T09 shares none with
T06, T07, T10).

File ownership, checked per wave:

- Wave 1: T01 owns the core schema, the migration, `packages/shared/src/core/**` contracts and
  catalogs, `scripts/i18n-check.ts`, the participants service, `modules/finance/seed.ts`, the three
  core web files of its step 6, ADR 0006 and `docs/SPEC.md`; T02 owns the legacy fixture schema
  folder, `legacy/sources.ts`, `facts.ts`, `finance.db`, the fixture README and the three legacy tests
  of its list; T03 owns the finance capture screens, `quick-add.tsx`, `FinanceGate.tsx`,
  `phone-header.test.ts` (finance), `components/ui/Dialog.tsx` and `finance/catalogs/transactions.*`.
  No overlap.
- Wave 2: T04 owns `TransactionList`, `TransactionRow`, `group-by-day.ts`, `modules/finance/lib/format*`
  and `RecentTransactionsCard.tsx`; T05 owns `core/services/auth/{users,invites}.ts`,
  `core/services/households/{households.service,invites.service}.ts`,
  `core/routes/{auth,members,invites}.ts`, `packages/shared/src/core/schemas/household.ts`,
  `apps/web/src/core/features/households/components/InvitePanel.tsx` (type narrowing only),
  `placeholders.test.ts`, `households.test.ts`; T08 owns `apps/api/scripts/legacy/{users,households,
  types,report}.ts`, the fixtures and `legacy-{users,households,finance,fixtures,cli,framework}.test.ts`.
  No overlap.
- Wave 3: T06 owns `apps/api/src/index.ts`, the two new middleware files,
  `core/routes/{auth,households,invites}.ts`, `rateLimit.ts`, `env.ts`, `db/client.ts`,
  `apps/api/scripts/seed.ts`, `apps/api/src/modules/finance/seed.ts`, `apps/api/src/modules/types.ts`,
  `.env.example`,
  `packages/shared/src/core/schemas/{user,household}.ts`, `.github/workflows/ci.yml`, SPEC §2's
  `seedDemo` line, `security.test.ts`, `db-pragmas.test.ts`, `static-web.test.ts`, `finance-seed.test.ts`
  and the API tests that need the JSON content type EXCEPT T07's files; T07 owns
  `packages/shared/src/modules/finance/schemas/**`, `apps/api/src/modules/finance/services/**` and
  `routes/participants.ts`, `finance-security.test.ts`, `finance-participants.test.ts`,
  `finance-cross-household.test.ts`, `test/support/finance-harness.ts` (already sends the JSON header,
  `finance-harness.ts` line 60) and `packages/shared/test/finance-{schemas,period}.test.ts`; T10 owns
  `apps/web/src/lib/{api,queries,session}.ts(x)`, `apps/web/src/core/features/{households,auth}/**`
  and the core web catalogs `auth.*`, `household.*`. No overlap (T06 edits nothing under `apps/web`
  and nothing under `modules/finance/services`; T07 nothing under `core/`).
- Wave 4: T09 owns `apps/api/scripts/legacy/{claims,run,report,types}.ts`,
  `apps/api/scripts/migrate-legacy.ts`, `legacy-placeholders.test.ts`, `legacy-cli.test.ts`,
  `import-order.test.ts`, `legacy-migration-doc.test.ts`, `docs/migration.md`; T11 owns
  `apps/web/src/modules/finance/{lib/api.ts,lib/participants.ts,features/participants/**,
  catalogs/settings.*}`. No overlap.
- Waves 5 and 6 run alone on main.

Shared files across waves (each edited in sequence, never by two tasks of one wave):
`packages/shared/src/core/i18n/catalogs/server.*` and `scripts/i18n-check.ts` (`NEW_GERMAN`): T01
only (T01 lists every new German key of the milestone, server and web, decision 8);
`packages/shared/src/core/schemas/household.ts`: T01 (w1), T05 (w2), T06 (w3);
`core/routes/auth.ts`: T01 (w1), T05 (w2), T06 (w3); `InvitePanel.tsx`: T01 (w1), T05 (w2), T10 (w3);
`modules/finance/seed.ts`: T01 (w1), T06 (w3); `participants.service.ts`: T01 (w1), T07 (w3);
`apps/api/scripts/legacy/report.ts` and `types.ts`: T08 (w2) then T09 (w4); `legacy-cli.test.ts`:
T02 (w1), T08 (w2), T09 (w4); `apps/web/src/lib/api.ts`: T10 only;
`apps/web/src/modules/finance/lib/api.ts`: T11 only; `docs/SPEC.md`: T01 (§1 D1/D4/D12, §4, §6, §9
with the ADR), T06 (§2 `seedDemo` line), T13 (§3); CLAUDE.md and the m3 plan's test map: T13 only;
this plan's section 9: T12, section 10: T13.

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

Deps: none (wave 1).

Read: SPEC §1 D1, D4, D10, D12, §4, §6 (items 1, 2, 5, 6), §9; this plan 1.4 decisions 1-8, 13, 14; F
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
   and "A person without an account can only take seat 2."); add to `NEW_GERMAN` in
   `scripts/i18n-check.ts` all seven new German keys of decision 8: the two server keys with the
   comment `// M3b: placeholder rules (ADR 0006)` and `auth.register.claimHint`,
   `auth.invite.claimSubtitle`, `household.placeholder.removeConfirm`, `household.claim.hint`,
   `household.claim.linkHint` with `// M3b: core-neutral wording of F's placeholder copy (plan m3b
   decision 8)` (T10 writes those five catalog entries; T01 writes no web catalog value).
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
   D1 (append: "Besides R's e-mail invites, a claim invite (no e-mail, naming a placeholder member)
   turns that placeholder into an account; it is redeemed only by registration (ADR 0006)."), D4 (append: "Placeholder accounts without e-mail or password exist (a household member added by
   name, so the finance ledger can name them); they cannot sign in and become accounts only through a
   claim invite redeemed by registration, in place, same id (ADR 0006)."), D12 ("a finance household
   merges into the recipe group whose members include both finance members" → "… whose members
   include every finance member that has an account (placeholders do not count; they join the
   household as members, and a finance household without any account member needs `--mapping`, ADR
   0006)"), §4 table rows `users`
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
green (count ≥ 2016 + new); the ADR exists and SPEC D1, D4, D12, §4, §6 items 1/2/5/6 and §9 are
edited in the same commit as the ADR (`git show --stat HEAD` lists both; `grep -c "ADR 0006"
docs/SPEC.md` ≥ 6); `NEW_GERMAN` holds the seven keys; parity OK.

### M3b-T02 — Legacy fixtures at F's three-migration schema (port)

Deps: none (wave 1).

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

Deps: none (wave 1).

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

Deps: none (ready in wave 1, scheduled in wave 2 by `MAX_PARALLEL = 3`; shares no file with T03).

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

Deps: T01 (wave 2, beside T04 and T08). T07 and T10 build on it.

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
   `claimsDisplayName`; deleting the household removes the placeholder user; "F: a third seat … and a
   plain invite is refused too (H: a plain e-mail invite in a household that has a placeholder → 201,
   D1 has N members, no household_full)"). Name each test after F's case where one exists (section 2
   per-case table). The finance-side cases (seat, third seat, bookings veto) are T07's.
7. Web compile fix (no new UI): once `CreateInviteRequestSchema.email` is optional,
   `apps/web/src/core/features/households/components/InvitePanel.tsx` passes `result.data.email`
   (now `string | undefined`) into `t("household.invite.sentDescription", { email })` (around line
   162) and `t("household.invite.failedToastDescription", { email, fallback })` (around line 176).
   The panel's form always sends an address: parse with a local form schema whose `email` is
   required (`CreateInviteRequestSchema.extend({ email: EmailSchema })` or a narrowing guard), so the
   type is `string` again. No copy, no layout change; T10 adds the claim rows later. If `bun run
   typecheck` shows another web file broken by the optional e-mail, fix its type the same way and
   list it in the task result.

Files: `apps/api/src/core/services/auth/{users,invites}.ts`,
`apps/api/src/core/services/households/{households.service,invites.service}.ts`,
`apps/api/src/core/routes/{auth,members,invites}.ts`, `packages/shared/src/core/schemas/household.ts`,
`apps/web/src/core/features/households/components/InvitePanel.tsx` (type narrowing only, step 7),
`apps/api/test/placeholders.test.ts`, `apps/api/test/households.test.ts` (only if an existing case
must change).

Acceptance: `bun test apps/api/test/placeholders.test.ts apps/api/test/households.test.ts
apps/api/test/auth.test.ts` green; the claim is one UPDATE statement with the two NULL conditions
(read the code); full suite, `bun run typecheck` (all five projects, web included) and `bun run
build` green.

### M3b-T06 — Core security hardening from 1715207 (core)

Tier `core` (Opus): a new middleware in `apps/api/src/index.ts`, whose mount order is load-bearing
and where module-scope work risks the import cycle; the CSP hashing of the built `index.html`; the
production refusals of `env.ts` and the seeds; the D7 pragmas; the rate-limit identity; shared auth
schemas. A mis-step here breaks every module. Deps: T05 (wave 3, beside T07 and T10).

Goal: F's core-side security fixes on H's core, each with its test.

Read: this plan decisions 15, 16, 17; F CLAUDE.md gotchas 18 (`clientIp`, number unchanged), 50
(`PUBLIC_API_URL` MUST be empty: a build with an absolute API URL makes every request cross-origin,
which the new `connect-src 'self'` blocks), 66, 67, 70, 74; F files
`apps/api/src/middleware/{originGuard,securityHeaders}.ts`, `git show 1715207 --
apps/api/src/index.ts apps/api/src/env.ts apps/api/src/db/client.ts apps/api/scripts/seed.ts
apps/api/src/routes/auth.ts apps/api/src/routes/households.ts apps/api/src/services/auth/rateLimit.ts
packages/shared/src/schemas/auth.ts packages/shared/src/schemas/households.ts .github/workflows/ci.yml
apps/api/test/security.test.ts`; H `apps/api/src/index.ts` (cors, mount order: health, `/uploads`,
`mountModules`, `/api/auth`, `/api/households`, static web last), `middleware/staticWeb.ts`,
`apps/web/index.html` (inline pre-paint script), `apps/web/vite.config.ts` lines 130-160 (proxy,
`PUBLIC_API_URL`), `apps/web/src/lib/api.ts` lines 58-70 (`API_BASE_URL` falls back to
`http://localhost:3001` when `PUBLIC_API_URL` is unset at build time; `""` gives relative URLs),
`.env.example` line 37, `modules/recipe/features/cards/lib/scan.ts` (wasm),
`apps/api/src/modules/types.ts` line 79 (`seedDemo`), `apps/api/src/modules/finance/seed.ts`
(`DEMO_PASSWORD` line 32, the robin and kim logins), `apps/api/test/finance-seed.test.ts`, SPEC §2
(the `seedDemo` line), H CLAUDE.md "D7 pragmas", "Middleware chain order is load-bearing", "Uploads
are signed", "API import cycle", "Headless runs".

Steps:
1. `middleware/originGuard.ts` (decision 15) mounted in `index.ts` on `/api/*` after `cors()` and
   `localeMiddleware`, before health/`mountModules`; `middleware/securityHeaders.ts` (decision 16,
   F's `inlineScriptHashes` exported) on `*` with `env.webDistDir`. Both are hoisted function
   declarations or factories called inside `index.ts`; no module-scope call into a core service
   (import-cycle gotcha). Comment at the CSP: `connect-src 'self'` presumes a build with
   `PUBLIC_API_URL=""` (F gotcha 50, decision 16).
2. `core/routes/auth.ts` `readJson`: refuse a body whose `Content-Type` is not `application/json`
   (`400`, `server.auth.invalidJsonBody`).
3. `rateLimit.ts`: `clientIp` takes the LAST `X-Forwarded-For` entry; add `INVITE_RULE` (10/h per
   user, only when the invite carries an `email`) in `core/routes/invites.ts` and
   `HOUSEHOLD_CREATE_RULE` (5/h per user) on `POST /api/households` in `core/routes/households.ts`;
   tests reset the buckets (`resetRateLimits`).
4. `env.ts`: in production refuse a `SESSION_SECRET` matching `/^change-me/i` with F's English message.
5. Seeds (decision 17): `scripts/seed.ts` resolves the demo password once: in production it refuses
   unless `ALLOW_SEED=1` and `SEED_PASSWORD` (≥ 10 chars) are set and then uses `SEED_PASSWORD`;
   outside production `SEED_PASSWORD` if set, else `demo1234` as today. It passes the password to
   every module through the `seedDemo` context: `apps/api/src/modules/types.ts` `seedDemo?(database,
   context: { householdId: string; userId: string; demoPassword: string })`; finance's
   `modules/finance/seed.ts` drops its `DEMO_PASSWORD` constant and hashes `context.demoPassword` for
   robin and kim (its log line prints the password only outside production); recipe's seed creates
   no login and ignores the field (no edit). SPEC §2 line `seedDemo?(database, { householdId, userId
   })` gains `demoPassword` in the same commit. `.env.example` documents `ALLOW_SEED` and
   `SEED_PASSWORD`; the CLAUDE.md seed text is T13's.
6. `db/client.ts`: `"foreign_keys = ON"` appended to `LOCAL_FILE_PRAGMAS`, the data directory created
   with `mode: 0o700`; update `test/db-pragmas.test.ts` (D7 stays: WAL + FULL).
7. Shared bounds: `LoginRequestSchema.password` and `currentPassword` `.max(200)` (min as today);
   `DisplayNameSchema` and the household name schemas (`CreateHouseholdRequestSchema.name`,
   `UpdateHouseholdRequestSchema.name`) refuse control characters with
   `refineKey("server.validation.noControlChars")`.
8. `.github/workflows/ci.yml`: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`,
   `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0`,
   `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0` (F's pins, byte-identical).
9. Tests `apps/api/test/security.test.ts`: F's origin cases (cross-site 403 before any handler,
   same-site sibling 403, mismatching `Origin` 403, matching and absent pass, safe methods never
   checked) plus "an `Origin` in `WEB_ORIGIN` passes even with `Sec-Fetch-Site: same-site`"; the body
   cases (text/plain → 400; an oversized password → 422 before argon2); the header cases (CSP with
   `'wasm-unsafe-eval'`, the `img-src` of decision 16, `connect-src 'self'`, `frame-ancestors 'none'`,
   `nosniff`, no `strict-transport-security`; `inlineScriptHashes` hashes inline bodies and skips
   `src=`); last-hop `clientIp`; the production refusals of `env.ts` (pure function or subprocess)
   and `seed.ts` (subprocess with `NODE_ENV=production`: no `ALLOW_SEED` → exit ≠ 0 and nothing
   written; `ALLOW_SEED=1` without or with a short `SEED_PASSWORD` → exit ≠ 0). In
   `finance-seed.test.ts`: `seedDemo` with `demoPassword: "x-test-pass-123"` → robin's and kim's
   hashes verify against it and NOT against `demo1234`. Existing tests that post without
   `Content-Type: application/json` to `/api/auth/*` are fixed to send it, EXCEPT T07's files of the
   same wave (`finance-security.test.ts`, `finance-participants.test.ts`,
   `finance-cross-household.test.ts`, `test/support/finance-harness.ts`, which already sends the
   header on every body, line 60); if one of those fails only because of the header, report it in the
   task result instead of editing it (T12 fixes it on main). The same holds for `legacy-*.test.ts`
   and `import-order.test.ts` (T09's files; with `maxParallel: 4` T09 shares this wave): never edited
   here, a header-only failure is reported.

Files: `apps/api/src/index.ts`, `apps/api/src/middleware/originGuard.ts`,
`apps/api/src/middleware/securityHeaders.ts`, `apps/api/src/core/routes/{auth,households,invites}.ts`,
`apps/api/src/core/services/auth/rateLimit.ts`, `apps/api/src/env.ts`, `apps/api/src/db/client.ts`,
`apps/api/scripts/seed.ts`, `apps/api/src/modules/types.ts`, `apps/api/src/modules/finance/seed.ts`,
`.env.example`, `docs/SPEC.md` (§2 `seedDemo` line only),
`packages/shared/src/core/schemas/{user,household}.ts`, `.github/workflows/ci.yml`,
`apps/api/test/security.test.ts`, `apps/api/test/db-pragmas.test.ts`, `apps/api/test/static-web.test.ts`,
`apps/api/test/finance-seed.test.ts`, and other `apps/api/test/*.test.ts` that need the content type
(never T07's four files above, never `legacy-*.test.ts` or `import-order.test.ts`).

Acceptance: full suite, typecheck, build green; `import-order.test.ts` green; a local
`WEB_DIST_DIR=./apps/web/dist bun run start` answers `/` with a CSP header containing one
`'sha256-…'` per inline script of the built `index.html` (curl, recorded in the commit body); a
production-mode seed without `ALLOW_SEED=1` writes nothing; no demo login of any module is created
with `demo1234` when `SEED_PASSWORD` is set.

### M3b-T07 — Finance API: 1715207 fixes and placeholder seats (build)

Deps: T01, T05 (wave 3, beside T06 and T10). T05 is a dependency because the seat tests create the
placeholder through T05's core route (`POST /api/households/:householdId/members`) and remove it
through T05's placeholder branch of `removeMember` (core `DELETE …/members/:userId`); neither exists
before T05 is merged. T07 never edits `core/` (no re-implementation of the core route).

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
   `finance-participants.test.ts`: a placeholder (created through T05's core route `POST
   /api/households/:householdId/members`) seated in slot 2, refused in slot 1 (`422`,
   `server.finance.placeholderSlotOne`), renamed by the other participant, a real seat not
   renameable by the other (`403`), `hasAccount` false, "F: a third seat is still 409 household_full
   … (H: `PUT …/participants` with a third entry → 422 `validation_failed`, exactly two seats, D3)",
   and removing the seated placeholder with bookings → `409 member_has_ledger` through T05's core
   `DELETE …/members/:userId`, the user row still there. Name each test after F's case where one
   exists (section 2 per-case table). Shared schema cases in `packages/shared/test/finance-schemas.test.ts` /
   `finance-period.test.ts`.

Files: `packages/shared/src/modules/finance/schemas/{common,tags,transactions,participants}.ts`,
`apps/api/src/modules/finance/services/support.ts`,
`apps/api/src/modules/finance/services/ledger/{idempotency,settlements.service,transactions.service}.ts`,
`apps/api/src/modules/finance/services/plan/{accrual.service,plan.service}.ts`,
`apps/api/src/modules/finance/services/tags/tags.service.ts`,
`apps/api/src/modules/finance/services/participants/participants.service.ts`,
`apps/api/src/modules/finance/routes/participants.ts`, `apps/api/test/finance-security.test.ts`,
`apps/api/test/finance-participants.test.ts`, `apps/api/test/finance-cross-household.test.ts`,
`apps/api/test/support/finance-harness.ts` (only if a helper is needed, e.g. `addPlaceholder` over the
core route; it already sends the JSON content type that T06 starts requiring), `packages/shared/test/finance-schemas.test.ts`, `packages/shared/test/finance-period.test.ts`.

Acceptance: `bun test apps/api/test/finance- packages/shared/test/finance-` green, full suite green;
`finance-cross-household.test.ts` gains the new by-id route (`PATCH …/participants/:userId` with
another household's user id → 404); the NOSHADOW grep of plan m3 section 3 clean.

### M3b-T08 — Migration: placeholder users and their households (core)

Deps: T01, T02 (wave 2, beside T04 and T05).

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

Deps: T05, T08 (wave 4, beside T11; T06's content-type rule is already merged, so the register call
sends `Content-Type: application/json`).

Goal: decision 13's claim-invite half and decision 14, plus the exit test "a migrated placeholder is
claimable by register on the fixtures", and `docs/migration.md`.

Read: this plan decisions 13, 14, 18; ADR 0006; plan m5 decisions 5, 6, 7, 15, 16, 18;
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
   no second invite (these cases on the legacy harness's temp DBs, `test/support/legacy-harness.ts`).
   THE CLAIM (decision 18), in a `describe` of its own: `beforeAll` runs `runMigrations(db)` on the
   shared test DB, asserts no fixture e-mail exists there (else fail loudly) and records `count(*)`
   of `users`, `households`, `household_invites`, `legacy_ids`; it then migrates a FINANCE-ONLY input
   (the fixture `finance.db` copied to a temp dir, no `recipe`, no uploads source) with
   `runLegacyMigration({ mode: "apply", target: { db, client, url: "file::memory:" }, … })`; the test
   calls `app.request("/api/auth/register", { method: "POST", headers: { "Content-Type":
   "application/json" }, body: JSON.stringify({ email: "pia@example.test", name: "Pia", password: <≥ 8
   chars>, inviteToken: <the claim token> }) })` → `201`, the session's user id equals pia's migrated
   id, `users.email` set and `password_hash` non-NULL, the invite accepted, `GET
   …/finance/participants` (as anna, logged in with her fixture password from `facts.ts`) shows
   pia's seat with `hasAccount: true`, and every
   transaction pia paid still names her. `afterAll` deletes what the run wrote: the target
   households named in `legacy_ids` (cascade removes memberships, invites, module rows and every
   `finance_*` row), then the users named there (pia included), then those `legacy_ids` rows, and
   asserts the four counts equal the ones recorded in `beforeAll`. `legacy-cli.test.ts`: the new
   heading in its order;
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

Deps: T05 (wave 3, beside T06 and T07; T06 edits nothing under `apps/web`, T07 nothing under `core/`).

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
   (`PlaceholderRenameDialog.tsx`), "Person entfernen" (`household.placeholder.removeConfirm`, the
   core-neutral text of decision 8; `409 member_has_ledger` keeps it open with the server's error),
   "Konto für {name} verknüpfen" (`ClaimInviteDialog.tsx`: `household.claim.hint`, create, show,
   copy with `shareOrCopy`/`copyToClipboard`, `household.claim.linkHint`); no role menu for a
   placeholder. No finance vocabulary ("Buchungen", "Platz", "Haushalt") on these core screens.
   `InvitePanel.tsx`: a pending claim invite row reads `household.claim.title` with the name instead of
   an address.
4. `InvitePage.tsx`: the claim variant (`claimsDisplayName !== null`): logged out → claim subtitle and
   "Konto erstellen" to `/register` with the invite token and the name prefilled; logged in →
   `auth.invite.claimLoggedIn` and "Abmelden" (logout, stay on the page); the plain variant unchanged.
   `RegisterPage.tsx`: with a claim invite, `auth.register.claimHint`, name prefilled, no household
   name field; a `409 email_taken` shown as today.
5. Catalogs (decision 8) in `lib/i18n/catalogs/{auth,household}.{de,en}.ts`, literal-typed: the
   byte-identical F values and the five NEW German values exactly as decision 8 spells them (T01
   already listed those five keys in `NEW_GERMAN`; T10 does not edit `scripts/i18n-check.ts`).
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

Acceptance: typecheck, test, build green; parity OK (any parity failure names a key outside the
five of decision 8 and is a copy error, not a reason to extend `NEW_GERMAN`); the design-system test
green; no `t()` of a person's name (names are content); `grep -nE "Buchung|Platz|Haushalt"
apps/web/src/lib/i18n/catalogs/household.de.ts apps/web/src/lib/i18n/catalogs/auth.de.ts` shows no
new hit from this task.

### M3b-T11 — Finance web: the placeholder flow in the enable dialog and the participants section (build)

Deps: T07, T10 (wave 4, beside T09).

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

### M3b-T12 — Integration: gates, evidence runs, headless screenshots (build)

Deps: T01-T11 (every implementation task). Runs alone on main. Defect fixes found here are its own
commits; the docs sync is T13's, so a failure here is retried without redoing the docs.

Goal: prove the exit criteria on the merged tree and write this plan's section 9.

Read: this whole plan; CLAUDE.md "Headless runs", "`scrollbar-gutter: stable`", "Printing a recipe",
"Long commands"; F CLAUDE.md gotcha 50 (`PUBLIC_API_URL` must be empty) and decision 16 here (the
CSP's `connect-src 'self'`); `apps/web/src/lib/api.ts` lines 58-70; plan m4 section 9 for the record
format; `docs/migration.md` (T09).

Steps:
1. Gates on the merged tree (section 3 commands), `i18n:check` leftover hits classified (expect 138
   plus the new comment quotes; list each new one). Parity OK with the seven NEW_GERMAN keys of
   decision 8.
2. Build for the evidence runs with a RELATIVE API base: `PUBLIC_API_URL="" bun run build` (the
   variable set and empty, so `lib/api.ts`'s `??` keeps `""`; F gotcha 50). Check the built bundle
   holds no `http://localhost:3001` (`! grep -rl "localhost:3001" apps/web/dist/assets`).
3. Fresh-DB walkthrough (`DATABASE_URL=file:./data/m3b.db`, `db:migrate`, `seed`, built app with
   `WEB_DIST_DIR`): curl creates a placeholder (`POST …/members`), seats it (`PUT …/finance/
   participants` on a new household), creates a claim invite, registers with it (same id), checks
   `409 invite_claim_requires_register` for a logged-in accept, the origin guard (`Origin:
   https://evil.example` → 403; the app's own origin → passes; an `Origin` from `WEB_ORIGIN` →
   passes), the CSP header, `PRAGMA foreign_keys` = 1 on the file DB, and the seed's production
   refusal (`NODE_ENV=production bun run seed` without `ALLOW_SEED` exits ≠ 0).
4. Owner data, from the main checkout (absolute paths if run in a worktree; `migration-in/` exists
   only there), with `DATABASE_URL=file:./migration-out/toon.db UPLOAD_DIR=./migration-out/uploads`
   and `migration-out/toon.db` absent (move an older one to `migration-out/pre-m3b/` first): the dry
   run of the exit criterion with `--report migration-out/m3b-dry-run.json` and stdout redirected to
   `migration-out/m3b-dry-run.log`; then `--apply --report migration-out/m3b-apply.json` (stdout to
   `migration-out/m3b-apply.log`: it holds the live claim link, hand it to nobody here); then a second
   `--apply` (`migration-out/m3b-apply-2.log`) that ends `[migrate:legacy] already migrated: nothing
   written.` Record ONLY counts (users, households, transactions, placeholders = 1, claim invites = 1,
   balance verdict OK) in section 9.
5. Headless (Playwright in a scratch directory outside the repo, log ending `exit=$?`), seeded demo
   data only, 390 (mobile context) and 1440, light (dark where cheap), against the build of step 2
   served by `WEB_DIST_DIR=./apps/web/dist bun run start`: the Erfassen sheet opened by `n` and by
   the TransactionsPage opener (stays open and clears after "Buchen", focus on Betrag);
   `/finance/new` (host claimed: `n` does nothing there); the transaction list grouped by day; the
   enable dialog with "Ohne Konto hinzufügen" on a fresh household created through the API from a
   non-SPA page; the participants section with the placeholder and the claim link; the core member
   list with the badge; the claim InvitePage logged out and logged in; the RegisterPage with the claim
   hint. Checks: no console error (CSP violations included) on these and on the recipe list, detail,
   import, shopping and cards screens, `scrollWidth <= clientWidth`, no element beyond the viewport.
   Run the CSP console check TWICE: once with the page at `http://localhost:3001` and once at
   `http://127.0.0.1:3001` (a different origin from the one a default build bakes in; with the
   relative build both must be clean: login works, the Home cards load, an `/uploads` image renders).
   Record, as an observation, whether a build WITHOUT `PUBLIC_API_URL=""` opened at 127.0.0.1 shows
   `connect-src` violations (expected: yes; it is the M6 item of section 7.2, not fixed here). PNGs in
   `docs/plans/screenshots/m3b/` (`<screen>-<390|1440>-<light|dark>.png`), indexed in section 9.
6. Section 9 of this plan: gate logs (summaries), the curl walkthrough, the owner-data counts, the
   headless numbers, the screenshot index, every defect fixed (commit ids).

Files: `docs/plans/m3b-finance-sync.md` (section 9 only), `docs/plans/screenshots/m3b/*.png`, plus
any defect fix found by the run (each its own commit, listed in section 9).

Acceptance: every exit criterion of the milestone, evidenced in section 9; both origins clean in the
CSP console check; nothing from `migration-in/` or `migration-out/` in `git status` or in any commit.

### M3b-T13 — Docs sync and the F gotcha renumbering (build)

Deps: T12. Runs alone on main. Comment-only and docs-only edits; no behaviour change.

Goal: CLAUDE.md, SPEC §3, the m3 plan's test map and this plan's section 10 reflect the merged tree;
pre-M3b citations of F gotcha numbers follow F's numbering at `1715207`.

Read: this plan (decision 11, sections 2, 6, 7.2 and T12's section 9); `git -C
/home/erics/software/toon-finance show cbdec67:CLAUDE.md` and F `CLAUDE.md` at `1715207` (the two
gotcha lists); H CLAUDE.md; `docs/plans/m3-finance-module.md` section 9.3.

Steps:
1. Gotcha map BY TITLE (decision 11): list every numbered gotcha of F at `cbdec67` and at `1715207`
   with its bold title, pair them by title, and write the old → new map into section 10 (expected:
   1-18 unchanged, old 19-55 → 20-56, 57-74 new; any pair the titles do not confirm is listed and
   left alone).
2. Renumber ONLY citations that predate M3b: the candidates are `git grep -nE "gotchas? [0-9]+"
   7b974b1 -- apps packages scripts` (19 lines at plan time) plus CLAUDE.md's "toon-finance gotcha N"
   / "F gotcha N" citations; for each, confirm with `git blame -L <line>,<line> <file>` that the
   line is unchanged since `7b974b1` (a line written by T01-T12 already cites the NEW number and is
   never touched; never apply a blanket +1). Only citations of TOON-FINANCE gotchas move; toon-recipe
   gotchas, H's own plan decisions and the historical plans and ADRs (`docs/plans/m*.md` before m3b,
   `docs/adr/000[1-5]*`) keep the numbers of their date. One commit, its body carries the map.
3. CLAUDE.md: status M3b, test count, layout additions (the two middleware files,
   `scripts/legacy/claims.ts`, `modules/finance/lib/quick-add.tsx`, the new core and finance web
   files), commands (`ALLOW_SEED` / `SEED_PASSWORD` for `bun run seed`), new gotchas: placeholders and
   claim invites (decisions 1-6), origin guard with `WEB_ORIGIN`, CSP and its recipe exceptions plus
   `PUBLIC_API_URL=""` for a served build (F gotcha 50), the module-local sheet without FAB, the
   migration's claim links are credentials, the claim test's cleanup on the shared DB (decision 18),
   the core-neutral copy of decision 8 (the "15 web and 4 server keys are new German" count updated),
   "F gotcha numbers are F's numbering at `1715207`"; the M6 obligations of section 7.2.
4. SPEC §3 lists the two new middleware files and `scripts/legacy/claims.ts`.
5. The m3 plan's section 9.3 gets an "M3b addendum" with section 2's pairs and case counts (H ≥ F),
   and the eight `placeholders.test.ts` cases with their H case names.
6. This plan: section 10 "what changed vs plan" (deviations confirmed against section 6, the gotcha
   map), status line DONE.

Files: `CLAUDE.md`, `docs/SPEC.md` (§3 only), `docs/plans/m3b-finance-sync.md` (status, section 10),
`docs/plans/m3-finance-module.md` (section 9.3 addendum), code comments citing pre-M3b F gotcha
numbers (comment-only edits).

Acceptance: typecheck and test green (comment-only code edits); `git diff 7b974b1 -- apps packages
scripts` after the renumbering commit shows no non-comment change from that commit (`git show --stat`
plus a read); every renumbered citation's new number names the same title in F's 1715207 CLAUDE.md.

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
- **CSP vs a baked absolute API URL (F gotcha 50).** `connect-src 'self'` and `img-src 'self'` block
  every API call and every `/uploads` image of a build whose `PUBLIC_API_URL` is absolute (or unset:
  `lib/api.ts` then falls back to `http://localhost:3001`) whenever the page is served from another
  origin. A headless run at `localhost:3001` passes by coincidence; T12 builds with
  `PUBLIC_API_URL=""` and checks a second origin (`127.0.0.1:3001`), and section 7.2 makes the empty
  value an M6 requirement of the image build. Dev is unaffected (Vite serves `index.html` without the
  API's headers).
- **Content-type requirement** breaks any test or client that posts to `/api/auth/*` without
  `application/json`; H's web client sets it (`lib/api.ts` line 229). T06 fixes the tests it owns;
  T07's files of the same wave already send the header (the finance harness).
- **Shared test DB in the claim test** (T09, decision 18): the migrated rows would otherwise stay in the
  `file::memory:` DB that every later test file of the same `bun test` process uses (counts of users,
  households, uploads, plan runs over every finance household). T09 migrates a finance-only input (no
  recipe DB, no uploads), asserts the fixture e-mails are absent first, and deletes every row it
  created in `afterAll` (households through the ledger, cascade; users; `legacy_ids` rows), then
  asserts the counts it read before are restored.
- **A placeholder alone in slot 1** after ADR 0004's re-seat (decision 6): no one can open the ledger
  until an admin seats two people; the participants section must render that state (T11).
- **Real data surprises.** The plan's counts come from one read of copies; T09's verify runs the dry
  run early so T12 is not the first to meet them.
- **`n` shortcut collisions.** The recipe module has no `n` binding today (grep in T03); the listener
  only lives inside the finance gate.
- **Gotcha renumbering** could shift a citation twice (a new M3b citation already carries F's new
  number). T13 maps by title and renumbers only lines unchanged since `7b974b1` (decision 11), as
  comment-only edits in one commit.
- **Scheduler layout.** The waves of section 3 depend on the task array's order and on
  `MAX_PARALLEL = 3`; a run with another `maxParallel` changes the waves, and section 3 shows the
  ownership argument still holds for 4.

## 6. Deviations expected (to be confirmed in "what changed vs plan")

- ADR 0006 (SPEC D1, D4, D12, §4, §6 items 1/2/5/6, §9): placeholder accounts and claim invites (D1:
  a claim invite beside R's e-mail invites; D4: placeholders that cannot sign in; D12: group matching
  counts account members only, a placeholder joins as a member); the migration rule for placeholders.
  The only §1 change.
- SPEC §2 (not §1, no ADR): the `seedDemo` context gains `demoPassword` (T06, decision 17).
- Plan-level (no ADR): D6 kept, no FAB, no SideNav button (decisions 9, 10); `img-src`/`script-src`
  wider than F's CSP for the recipe module (decision 16); origin guard trusts `WEB_ORIGIN` (decision
  15); F's leave rules not ported because ADR 0004 covers them (decision 12); claim invites need
  admin+ in H (F: either member); five core web strings get NEW German, core-neutral variants of F's
  finance-flavoured placeholder copy (decision 8), while the finance section keeps F's text;
  `anchorCannotLeave`, `common.appName`, `nav.manage`, palette, fonts, icons, `lazy-page` not ported.

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
- `bun run seed` in the container refuses production without `ALLOW_SEED=1` + `SEED_PASSWORD` (T06);
  the password reaches every module's demo logins (decision 17).
- **`PUBLIC_API_URL` must be empty in the image build** (F gotcha 50, decision 16): the Dockerfile's
  web build runs with `PUBLIC_API_URL=""` set (not unset: `lib/api.ts` falls back to
  `http://localhost:3001` for an unset variable), and the image check greps the built assets for
  `localhost:3001`. Otherwise the CSP's `connect-src 'self'` / `img-src 'self'` block every API call
  and every upload image on the real hostname.

## 8. Obligations carried forward

M5's and earlier obligations stand (CLAUDE.md "Obligations"); M7's `docs/API.md` must document `POST
…/members` (placeholder), `PATCH …/members/:userId/placeholder`, the claim invite and its two `409`
codes, `PATCH …/finance/participants/:userId`, the origin guard and the CSP.

## 9. Integration record

Written by M3b-T12 on the merged tree (`main`, after the merge of T11), run on 2026-10-15. Logs of the
gate and headless runs are in the session scratch directory (not committed); the owner-data outputs are in
`migration-out/` (gitignored, and `m3b-apply.log` holds a live claim link, so none of them is quoted
here beyond counts). The Playwright script lived in a scratch directory outside the repo (Playwright
1.64, Chromium 1248, de-DE, `Europe/Berlin`, one login per script run, seeded demo data only).

### 9.1 Defect found by the integration run (its own commit, with the failing check)

1. `af71df1` **A production build has no dev fallback API URL.** Check: `PUBLIC_API_URL="" bun run build`
   then `! grep -rl 'localhost:3001' apps/web/dist/assets` (step 2 and the task's verify command) found
   `assets/queries-*.js`. Cause: `lib/api.ts` read `PUBLIC_API_URL ?? VITE_API_URL ?? "http://localhost:3001"`
   and Vite inlines `import.meta.env` as an object, so the dead fallback literal stayed in the bundle with the
   variable set and empty (the value used was `""`, so no request went there; the literal is only a trap for
   the image check of M6 and for anybody who greps). The fallback is now
   `import.meta.env.PROD ? "" : "http://localhost:3001"`: Vite replaces `PROD` statically, the literal is
   dropped from a production build, and a production build that sets neither variable is relative too
   (toon-finance's default, gotcha 50, whose F `lib/api.ts` has `""`). `bun run dev` and `bun test` are
   unchanged (`PROD` is false or undefined there, so tests still see the absolute base). Guard in
   `apps/web/src/lib/api.test.ts` (one source test). After: grep finds nothing in the built assets. Not a
   SPEC §1 deviation (D11's same-origin deployment is what this serves); section 7.2's M6 item stays valid
   (`PUBLIC_API_URL=""` set explicitly in the Dockerfile is still the right, defensive form, and the image
   check by grep now works).

No other defect: the headless run, the curl walkthrough and the owner-data runs found nothing else.

### 9.2 Gates (merged tree, after the fix)

| Gate | Result |
| --- | --- |
| `bun run typecheck` | exit 0, five projects, `[typecheck] OK` |
| `bun test` | exit 0, **2202 pass, 0 fail**, 12052 `expect()` calls, 129 files, 23.6 s (2201 in 129 files before the one guard test of 9.1) |
| `PUBLIC_API_URL= bun run build` | exit 0; `! grep -rl 'localhost:3001' apps/web/dist/assets` holds after 9.1 (it failed before) |
| `bun run i18n:check` | exit 1 by design; step 1/2 (catalog parity) `[i18n:check] OK` (the seven NEW_GERMAN keys of decision 8 are in the set); step 2/2 reports **146** hits (see 9.3) |
| `bun run db:generate` then `git status --porcelain apps/api/drizzle` | empty: no pending migration, `0003` is the last one |
| `bun run apps/api/test/fixtures/legacy/build.ts --check` | `committed fixtures match a fresh build` |
| `grep -q 'already migrated' migration-out/m3b-apply-2.log` | holds |
| `git status --porcelain` for `migration-in/` and `migration-out/` | nothing (both gitignored); no commit of this task touches them |

### 9.3 `i18n:check` leftover hits (146, all classified)

The M5 tree (`5162e6e`) reported 138. The diff of the two hit lists by file and text (line numbers ignored)
shows 13 added and 5 removed lines (net +8), all of them **German labels quoted in doc comments** of the
M3b finance web code, so false positives like the 128 before them. Added: `participants/ClaimLinkDialog.tsx`
("Konto für {name} verknüpfen"), `EnableFinanceDialog.tsx`, `ParticipantsSection.tsx`, `PlaceholderForm.tsx`
and `participants/lib/queries.ts` ("Ohne Konto hinzufügen", the last one wrapped), `AmountInput.tsx`
("12,50", "Buchen", "Bitte gib einen Betrag ein"), `TransactionFormFields.tsx` and `NewTransactionPage.tsx`
("Mehr Details", now said to be gone), `TransactionList.tsx` ("Mehr laden"), `TransactionRow.tsx` ("Dein
Anteil", two lines), `NewTransactionPage.tsx` ("Rückgängig") and `lib/format.ts` ("das war …"). Removed: the
five quotes of the old comments of `CategorySheet.tsx`, `TransactionFormFields.tsx`, `TransactionList.tsx`
and `NewTransactionPage.tsx` (two), which the rewrite replaced. The 10 recipe content vocabulary lines are
unchanged. No German literal in code, no new German outside `NEW_GERMAN`.

### 9.4 Fresh database and curl (`data/m3b.db`, built app on `:3001`, `PUBLIC_API_URL=""` build)

`db:migrate`, `seed`, `seed` again: exit 0; the second run reports "already present" for every recipe and
the ledger (idempotent). Walkthrough as the demo user (`curl`, one cookie jar per user):

- `POST /api/households` 201; `POST …/members {displayName}` **201**, `{ role: "member", hasAccount: false,
  email: null }` (a placeholder).
- `POST …/modules/finance` with the two participants (the placeholder in slot 2) **200**; `PUT
  …/finance/participants` with the same two **200**, items slot 1 `hasAccount: true`, slot 2
  `hasAccount: false`; `GET …/finance/participants` `viewerSlot: 1`.
- `POST …/invites { claimsUserId }` **201** (`email: null`, a `/invite/<token>` URL); `GET
  /api/households/invites/<token>` (public) 200 with `claimsDisplayName`, `status: pending`.
- **A logged-in accept of the claim token: `409 invite_claim_requires_register`.**
- **Register with the claim token (no session): `201`, the new user's id equals the placeholder's id**
  (`sameId: true`), `emailVerified: false`; `GET /api/auth/me` for that session lists the household. The
  claim is spent (the preview now reports `status: accepted`), and `GET …/finance/participants` as the demo
  user shows slot 2 with `hasAccount: true`: the ledger seat is the same person, nothing was re-seated.
- **Origin guard** (`POST /api/households/invites/accept` with a bad token, only the status class matters):
  `Origin: https://evil.example` **403**; `Origin: null` **403**; `Sec-Fetch-Site: same-site` without an
  Origin **403**; `Origin: http://127.0.0.1:3001` against `http://localhost:3001` **403** (host differs); the
  app's own origin `http://localhost:3001` passes (404 for the bad token); an `Origin` from `WEB_ORIGIN`
  (`http://localhost:5173`) passes (404); no Origin (curl) passes (404); `Origin: http://127.0.0.1:3001`
  against `http://127.0.0.1:3001` passes (401, not 403).
- **CSP header** on `/` and on `/api/health`: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'
  'sha256-…'` (one hash: the pre-paint theme script); `style-src 'self'`; `img-src 'self' data: blob:
  https:`; `media-src 'self' blob:`; `font-src 'self'`; `connect-src 'self'`; `manifest-src 'self'`;
  `worker-src 'self'`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`; `object-src
  blob:`; plus `X-Frame-Options: DENY` and `X-Content-Type-Options: nosniff`; no `Strict-Transport-Security`
  (the Caddy owns it, D11) and no `Permissions-Policy`.
- `PRAGMA foreign_keys` through the app's own client on the file DB: **1** (`journal_mode` `wal`,
  `synchronous` 2, D7).
- `NODE_ENV=production bun run seed` without `ALLOW_SEED`: exit 1 ("refusing to run with
  NODE_ENV=production"); with `ALLOW_SEED=1` but no `SEED_PASSWORD`: exit 1 ("SEED_PASSWORD (>= 10 chars)
  is required in production"); no database file was created by either.
- The API also keeps the 5-per-hour household-creation limit (`429 rate_limited`), which the headless
  script runs around by restarting the server between passes (in-memory buckets).

### 9.5 The owner's data (counts only; `migration-out/`, outputs gitignored)

Inputs, copies in `migration-in/` (as in section 1.2): finance backup at 3 migrations
(`0002_placeholder_members`), 2 users, 1 household, 2 participants, 334 transactions, 2 incomes, 1 plain
invite; recipe backup at 9 migrations, 2 users, 2 groups, 55 recipes. `DATABASE_URL=file:./migration-out/toon.db`,
`UPLOAD_DIR=./migration-out/uploads`, `toon.db` absent beforehand (nothing to move to `pre-m3b/`).

| Run | Exit | Result |
| --- | --- | --- |
| dry run (`--report migration-out/m3b-dry-run.json`, stdout to `m3b-dry-run.log`) | **0** | **no errors, no warnings**; 3032 rows would be written, 89 files would be copied; mapping proposal: the finance household **merges** into the recipe group (`only-group`, the placeholder is added as a member); finance balance per household **OK** (legacy and migrated balance equal, 334 legacy and 334 migrated transactions, equal sums); `== Placeholders and claim invites ==` lists **1 placeholder** (slot 2) with claim invite `would-create`, and no invite URL is printed in a dry run |
| `--apply --report migration-out/m3b-apply.json` (stdout to `m3b-apply.log`) | **0** | "applied: 3032 rows written, 89 files copied"; the same section lists the placeholder with the claim invite **`created`** and its link under "Claim links" (a credential: the log is shared with nobody) |
| second `--apply` (`m3b-apply-2.log`) | **0** | **"already migrated: nothing written."**; the section reports the claim invite `already-migrated` |

Counts read from `migration-out/toon.db` after the apply (read-only query): users **3**, of which
placeholders (no e-mail, no password) **1**; households **2**; household members 4; `finance_participants` 2;
`finance_transactions` **334**; `recipe_recipes` 55; pending claim invites **1** (claim invites in total 1);
uploads copied 89; `PRAGMA foreign_keys` 1. A claim invite of the placeholder exists exactly once after two
applies.

### 9.6 Headless run (**354 of 354 checks pass**, exit 0, six passes of 59 checks)

Contexts: 390x844 is a mobile context (`isMobile`, `hasTouch`, overlay scrollbars), 1440x900 a desktop
context, `colorScheme` light and dark. Four passes at `http://localhost:3001` (390 light, 1440 light, 390
dark, 1440 dark; they take the 92 screenshots) and two at `http://127.0.0.1:3001` (390 light, 1440 light, no
screenshots), all against the build of step 2 (`PUBLIC_API_URL=""`) served by `WEB_DIST_DIR=./apps/web/dist
bun run start`. Each pass creates its own households from a non-SPA page (`/api/health`, the stale
`["toon","me"]` rule) and restarts the API first (login and household-create limits). Per pass, 20 pages
plus the two logged-out claim pages:

- **Screens**: Home, the finance list grouped by day (12 day headings, e.g. "MITTWOCH, 14.10.2026 28,50 €"),
  `/finance/new`, the finance overview, recipe library, detail, import, shopping, cards and plan, Settings,
  and on fresh households: the empty finance list, the participants section with the placeholder, the
  claim-link dialog, the core member list (`ohne Konto`), Home with "Aktivieren", the enable dialog, the
  finance overview after enabling, and the claim `InvitePage` and `RegisterPage` logged out and logged in.
- **No console error, no page error, no CSP violation, no failed request** on any of them, at both origins
  and both widths (STATS per pass: `consoleErrors` 0, `pageErrors` 0, `csp` 0, `failedReq` 0). One
  `net::ERR_ABORTED` per pass (a `…/members` query of the enable flow, cancelled by the page) is a
  request the page itself cancelled and is counted apart (`aborted: 1`), not a failure. The only tolerated
  console line is the pre-login `401 /api/auth/me` on the two logged-out pages.
- **CSP on the second origin** (decision 16, the trap): at `http://127.0.0.1:3001` the relative build logs
  in, the Home cards load (recipe week strip and the finance card), the finance and recipe screens render
  and the `/uploads` hero image of the recipe detail decodes (`naturalWidth` 900) with zero violations,
  exactly as at `http://localhost:3001`.
- **Observation, the build WITHOUT `PUBLIC_API_URL=""`** (opened at 127.0.0.1, Chromium, logged in): with
  the variable set to the `.env.example` value `http://localhost:3001` (what an unset variable baked in
  before 9.1) the SPA stays on "Anmeldung wird geprüft …" and logs **4 CSP violations** ("Connecting to
  'http://localhost:3001/api/auth/me' violates the following Content Security Policy directive:
  "connect-src 'self'""); at `http://localhost:3001` the same build is clean (the trap's hiding place).
  After 9.1 a build with the variable truly UNSET is relative and clean at both origins (0 violations at
  127.0.0.1); the only way to get the trap now is to set the variable to an absolute URL, which
  `.env.example` already says not to do for a served build. M6's image build still sets it empty (7.2).
- **Erfassen sheet** (decision 10): `n` on `/finance/transactions` opens it (a bottom sheet at 390, a
  centred dialog at 1440), the focus is on Betrag, Esc closes it; the "Erste Buchung erfassen" opener of the
  empty list opens it; a booking of "12,50" with a description: the sheet **stays open**, **Betrag is empty**,
  the booking is in the list after Esc, `n` reopens it; on `/finance/new` `n` does nothing (host claimed) and
  there is exactly one "Buchen" button and no dialog. Observation, not a defect: after a click on "Buchen" the
  focus is on `body`, not on Betrag (the sheet re-renders the form); toon-finance has no refocus code
  either (its `grep focus` finds only `Dialog`, the one-shot autofocus on opening), so this matches F;
  Cmd/Ctrl+Enter from inside the field keeps the focus where it is.
- **Enable dialog** (decision 8): on a household with one placeholder member and finance off, Home's
  "Aktivieren" opens "Finanzen aktivieren" with "Ohne Konto hinzufügen"; a second placeholder entered in the
  dialog ("Person eintragen") is preselected for Platz 2 as "<name> (ohne Konto)"; "Aktivieren" closes the
  dialog and `GET …/finance/participants` answers 200 with a seat that has `hasAccount: false`.
- **Claim flow screens**: the participants section shows the placeholder with the "ohne Konto" badge,
  "Umbenennen" and "Konto für Pia verknüpfen"; the dialog creates the link (`/invite/<token>`, shown with
  "Kopieren"); the core member list shows the badge and "Kann sich noch nicht anmelden."; logged out the
  `InvitePage` offers "Konto erstellen", logged in it explains the link and offers "Abmelden"; the
  `RegisterPage` shows the hint "Du erstellst das Konto für „Pia" in der Gruppe „…"." with the name prefilled.
  The claim link of the dialog starts with the first `WEB_ORIGIN` entry (`http://localhost:5173` in this
  run), as decision 14 says; the run opened its token on the served origin.
- **No horizontal overflow** (`documentElement.scrollWidth <= clientWidth` and no element's right edge
  beyond `innerWidth` + 0.5, elements inside an `overflow-x` clipper excluded; every page prints its
  numbers): 60 page measurements per width, all equal to the same numbers:

| Context | `scrollWidth` | `clientWidth` | `innerWidth` | max element right |
| --- | --- | --- | --- | --- |
| 390, mobile (overlay scrollbar) | 390 | 390 | 390 | 390 |
| 1440, desktop (`scrollbar-gutter: stable`) | 1425 | 1440 | 1440 | 1425 |

  The 15 px difference at 1440 is the stable gutter, shown from the script and never in the app: with
  `documentElement.style.scrollbarGutter = "auto"` the numbers become **1440 == 1440** (before: 1425/1440),
  once per script run (six runs). The Erfassen sheet and the enable dialog, opened, measure the same.

### 9.7 Screenshot index (`docs/plans/screenshots/m3b/<screen>-<width>-<scheme>.png`, KB)

**92** viewport-only PNGs, **5.37 MB** in total (under the 25 MB limit, nothing stored as JPEG). Seeded
demo data only: the Familie household and the fixture households "Kasse A/B", never the owner's data.
`finance-erfassen-sheet` is the sheet opened by `n` on the Familie list, `finance-erfassen-opener` the
sheet opened by "Erste Buchung erfassen" on the empty list, `finance-erfassen-after-book` the same after one
"Buchen" (the sheet stays open, the success toast on top); `settings-claim-link` is the claim-link dialog on
the participants section; the `invite-claim-*` and `register-claim` pages are the claim flow logged in and
out. The light 390 and 1440 sets are complete; dark exists for the screens with a dash-free column.

| screen | 390 light | 390 dark | 1440 light | 1440 dark |
|---|---|---|---|---|
| `home` | 43 | 44 | 62 | 63 |
| `home-enable-finance` | 34 | - | 53 | - |
| `home-finance-placeholder` | 41 | - | 59 | - |
| `finance-transactions` | 62 | 62 | 106 | 107 |
| `finance-transactions-empty` | 29 | 29 | 52 | 53 |
| `finance-new` | 51 | 51 | 92 | 93 |
| `finance-overview` | 46 | - | 84 | - |
| `finance-overview-placeholder` | 44 | - | 75 | - |
| `finance-erfassen-sheet` | 47 | 47 | 149 | 143 |
| `finance-erfassen-opener` | 48 | 48 | 106 | 104 |
| `finance-erfassen-after-book` | 49 | 49 | 117 | 113 |
| `finance-enable-dialog` | 41 | 40 | 80 | 75 |
| `finance-enable-dialog-placeholder-added` | 41 | 39 | 80 | 74 |
| `settings` | 40 | 40 | 64 | 64 |
| `settings-participants` | 43 | 43 | 68 | 68 |
| `settings-claim-link` | 44 | 43 | 92 | 85 |
| `household-detail` | 43 | 41 | 64 | 62 |
| `invite-claim-out` | 25 | 25 | 31 | 30 |
| `invite-claim-in` | 29 | 29 | 36 | 35 |
| `register-claim` | 32 | 31 | 37 | 36 |
| `recipe-library` | 47 | 47 | 114 | 115 |
| `recipe-detail` | 44 | 44 | 100 | 101 |
| `recipe-import` | 43 | 43 | 68 | 69 |
| `recipe-shopping` | 51 | 51 | 89 | 90 |
| `recipe-cards` | 33 | 33 | 56 | 57 |

### 9.8 Exit criteria (SPEC §8 M3b, this plan's goal) against the evidence

| Criterion | Evidence |
| --- | --- |
| Gates green | 9.2: typecheck OK, `bun test` 2202 pass / 0 fail, build OK with no `localhost:3001` in the assets, parity OK, no pending migration, fixtures match |
| Every F test file at `1715207` has a passing counterpart | section 2 of this plan maps the four F test files that changed (`placeholders`, `security`, `format`, `schemas`) to their H counterparts; all of them exist (`placeholders.test.ts`, `security.test.ts`, `finance-security.test.ts`, `finance-participants.test.ts`, `finance-schemas.test.ts`, `core.test.ts`, `modules/finance/lib/format.test.ts`) and run green inside the 2202; the per-case recount into the m3 plan is T13's |
| A migrated placeholder is claimable by register on the fixtures | `legacy-placeholders.test.ts` (T09), and 9.4 proves the same path over HTTP on a fresh database (register with the claim token returns the placeholder's own id; a logged-in accept is `409 invite_claim_requires_register`) |
| Real-data dry run exits 0, no errors, balance OK, placeholder and claim invite listed | 9.5: exit 0, no errors and no warnings, balance OK, 1 placeholder, claim invite `would-create` |
| `--apply` into `migration-out/`, then a second `--apply` writes nothing | 9.5: exit 0 and 0, "already migrated: nothing written.", 1 pending claim invite, 1 placeholder |
| The changed finance screens verified at 390 and 1440 with screenshots, seeded demo data only | 9.6 and 9.7: 354 of 354 checks, 92 PNGs |
| CSP console clean on two origins, no horizontal overflow | 9.6: zero violations at `localhost` and `127.0.0.1`, `scrollWidth <= clientWidth` on every measured page |
| Nothing from `migration-in/` or `migration-out/` in git | `git status --porcelain` shows neither directory, and the commits of this task add only the code fix, its test and this plan section plus the PNGs |

## 10. What changed vs plan

(written by M3b-T13)

## 11. Review revisions (2026-10-15, before implementation)

The plan review raised 14 points (two of them the same T07 dependency); each is addressed here:

- T07 gained the dependency on T05 (its seat tests use T05's core route and `removeMember` branch);
  T07 moves to wave 3. Rejected alternative: seeding the placeholder through the db in T07 (it would
  not prove the core DELETE path F's case covers).
- Section 3 now states the waves the scheduler actually runs (`ready.slice(0, MAX_PARALLEL)` over the
  task array, `MAX_PARALLEL = 3`), orders the task array to get them, and re-checks file ownership
  per real wave; the wrong "T09 owns … in the same wave" note in T06 is gone.
- T05 owns `InvitePanel.tsx` for the type narrowing the optional invite e-mail forces (step 7).
- Decision 16 names the CSP / baked API URL trap (F gotcha 50); T06 and T12 read it, T12 builds with
  `PUBLIC_API_URL=""` and checks a second origin, section 7.2 makes it an M6 requirement.
- Decision 11 and T13: renumbering only of citations that predate M3b, mapped by title; the shift
  itself corrected (old 19-55 → 20-56).
- Decision 17 and T06: the seed password reaches the finance demo logins through the `seedDemo`
  context (`modules/types.ts`, `modules/finance/seed.ts`, SPEC §2).
- T12 split into T12 (gates and evidence) and T13 (docs sync and renumbering).
- ADR 0006 edits D1 and D12 as well (decision 13, T01 step 7 and acceptance).
- Decision 18 and T09: the claim test migrates a finance-only input and cleans the shared DB.
- Decision 8: core-neutral wording for five core strings (NEW German), F's finance-flavoured text
  only in the finance section.
- Section 2: a per-case map of F's `placeholders.test.ts`, including "a third seat … plain invite is
  refused too" (T07: third PUT entry → 422; T05: plain invite allowed, D1).
- T06 is tier `core`.
