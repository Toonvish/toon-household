# 0006: Placeholder members and claim invites (refines D1, D4, D12, §4, §6, §9)

Date: 2026-10-15

## Context

toon-finance moved on after M3 was ported (`cbdec67..1715207`, plan `m3b-finance-sync.md`). Its
commit `b1b517d` added **placeholder members**: the second person of a two-person ledger can be
seated without an account, as a `users` row with no e-mail and no password, so the ledger can name
them as payer before they ever sign in. A **claim invite** (`invites.claims_user_id`) later turns
that row into an account by registration, in place, with the same id, so no `payer_id`,
`person_id` or seat has to be re-pointed (F `docs/spec.md` §2.1, §2.5; F CLAUDE.md decision 1 and
gotcha 72).

The production finance database the owner will migrate holds exactly that state: two users, one of
them a placeholder (e-mail and password hash NULL) seated in slot 2, 334 transactions naming both
(plan m3b section 1.2). SPEC as written cannot take it: D4 knows only accounts with an e-mail, D1
only e-mail invites, D12 and §6 match finance members by e-mail, §6 gates the finance input at two
migrations and §9 excludes every finance invite. The owner decided that the placeholder is migrated
as a placeholder user with a NULL e-mail plus a claim invite.

## Decision

1. **A placeholder is a core user row with `email IS NULL AND password_hash IS NULL`.** H keeps
   toon-recipe's user model (no `email_normalized` column), so only `users.email` loses its NOT
   NULL; `password_hash` is already nullable for OAuth-only accounts, which is why the hash alone
   (toon-finance's predicate) cannot decide it here. `isPlaceholderUser` in
   `core/services/auth/users.ts` is the one predicate. A placeholder has no OAuth link, no session,
   no confirmed address and no avatar, and cannot sign in: login, password reset and OAuth all look
   up by e-mail or provider id. The unique index on `users.email` stays (SQLite treats NULLs as
   distinct). The `/me` mapper refuses a placeholder with 401: a session naming one is a bug.
2. **A placeholder is a household member with role `member`, added by an admin or owner** by display
   name (`POST /api/households/:householdId/members`); the user row and the membership are written in
   one transaction. The core has no "household full" rule (D1 keeps N members). Admins rename a
   placeholder (`PATCH …/members/:userId/placeholder`); a role change on a placeholder is refused
   (`409`, `server.household.placeholderRole`); removing one runs the normal member removal with
   every module's veto (finance: `409 member_has_ledger` while it holds a seat and the ledger has
   rows, ADR 0004) and then deletes the user row; deleting a household deletes its placeholders.
3. **Claim invites.** `household_invites.claims_user_id` (FK to `users`, `ON DELETE cascade`, indexed)
   and a nullable `household_invites.email`. A claim invite names a placeholder member of the
   household, carries role `member`, may carry an e-mail (only then is it mailed) and revokes older
   pending claim invites for the same placeholder. It is redeemed ONLY by registration
   (`POST /api/auth/register { inviteToken }`): one conditional `UPDATE users … WHERE id = ? AND
   password_hash IS NULL AND email IS NULL` writes e-mail, name and password hash onto the
   placeholder's own row (toon-finance gotcha 72: never check-then-write; zero rows is `409
   member_has_account`, a taken address `409 email_taken`), the invite becomes `accepted`, and the
   session belongs to the claimed id. `POST /api/households/invites/accept` on a claim invite answers
   `409 invite_claim_requires_register`. The claimed account is unconfirmed, so D4's verified-e-mail
   gate keeps it read-only until the address is confirmed.
4. **Wire shapes.** `PublicUser.email`, `HouseholdInvite.email` and `InvitePreviewResponse.email`
   become nullable; `HouseholdMember.hasAccount`, `HouseholdInvite.claimsUserId`,
   `InvitePreviewResponse.claimsDisplayName` and the finance participant's `hasAccount` are added;
   `User` (`/me`) keeps a non-null e-mail. The core error codes gain `member_has_account` and
   `invite_claim_requires_register`.
5. **Migration (SPEC D12, §6).** The finance input is gated at F's three migrations. A finance user
   with `password_hash IS NULL` (its e-mail must be NULL too, else an error) migrates as a
   placeholder: its own target row with a NULL e-mail, never grouped or matched by e-mail. Household
   matching uses the account members only: a finance household merges into the recipe group whose
   members include every finance member that has an account; placeholders join the target
   household as `member`; a finance household whose members are all placeholders is the
   `no-account-members` error unless `--mapping` names its target. `finance_participants` copy the
   placeholder's slot and display name unchanged. Each migrated placeholder gets exactly one pending
   claim invite: a still-pending legacy claim invite of it is reused (token, dates and e-mail kept),
   otherwise a fresh one is minted (no e-mail, role `member`, invited by the target household's owner,
   14 days). Other finance invites stay unmigrated.
6. **The claim link in the report.** A report section `== Placeholders and claim invites ==` lists
   each placeholder with its claim invite state; the invite URL appears only in an `--apply` run's
   real pass (stdout and the `--report` JSON), never in a dry run.

SPEC D1, D4, D12, §4 (`users`, `household_invites`), §6 items 1, 2, 5 and 6 and §9 carry the new
wording in the same commit.

## Consequences

- `users.email` is nullable (migration `0003_placeholder_members`, no table rebuild: libSQL's
  `ALTER COLUMN` only drops the NOT NULL). Every reader that needs an address narrows it explicitly
  (`requireAccountEmail` for session users and auth mails; a lookup by e-mail never finds a
  placeholder). The migration's SQL body is drizzle-kit's output with three generator defects
  corrected (every index dropped and re-created, including a DROP of the not-yet-existing new index;
  the new index created before its column; the lost `ON DELETE cascade`); the snapshot and journal
  are untouched generator output, so a second `db:generate` adds nothing.
- D4's "OAuth with explicit linking only, no auto-linking" stays intact: a claim writes credentials
  onto a row that has none and never merges two existing accounts; it needs the claim link, which only
  an admin of the household can create.
- A placeholder may hold finance slot 2 only (`422 server.finance.placeholderSlotOne` for slot 1, plan
  m3b decision 6); ADR 0004's re-seat can still leave a placeholder alone in slot 1 after the account in
  slot 1 leaves an empty ledger, a state nobody can open until an admin seats two people.
- The apply report of `migrate:legacy` is a credential while it holds live claim links: it must stay
  outside any repository (`docs/migration.md`).
- The core household screens show a placeholder as a member "ohne Konto" with rename, remove and the
  claim link; their German copy is module-neutral (plan m3b decision 8; five new keys in
  `NEW_GERMAN`), while toon-finance's finance-flavoured wording stays in the finance participants
  section.
