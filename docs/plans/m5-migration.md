# M5 — migration: plan

**Status: PLANNED (2026-10-15; revised the same day after the plan review: mapping validation
before any write, the CLI's `.env` and import order, the in-run id set, the verified-only e-mail
match, non-participant plan payers and incomes, ADR 0005).** Milestone M5 of `docs/SPEC.md` §8, written by the planner of the
`build-household` workflow. Paths: `H` = `/home/erics/software/toon-household` (this repo),
`R` = `/home/erics/software/toon-recipe`, `F` = `/home/erics/software/toon-finance` (both READ-ONLY:
`cat`, `grep`, `diff`, `cp` out of them, `git log`; never run `bun install`, `bun test`, `sqlite3`
or any script against a file inside them; a file is only ever opened from a copy).

Goal (SPEC D12, §4, §6): `bun run migrate:legacy` reads the two old libSQL files and the recipe
uploads directory and writes them into the household DB, dry-run by default, idempotent through the
`legacy_ids` ledger, with a report that proves the finance balance per household to the cent.

Exit (SPEC §8 M5, as the workflow states it): `bun run migrate:legacy` against the fixtures prints
the proposal and the report in dry-run and writes nothing; with `--apply` it migrates; a second
`--apply` writes nothing and says so; the balance invariant test passes; a run against copies of the
owner's real data produces a report without errors. **Owner data:** none was provided at plan time
(`H/migration-in/` does not exist). The integration task (T10) looks for the copies at the paths
section 1.4 names; if they are absent, the fixtures plus a copy of R's local dev database are the
evidence and section 9 says so explicitly.

## 1. Context

### 1.1 State of H at plan time

`main` at `cbcc723` (M4 closed). Re-run by the planner: `bun run typecheck` OK; `bun test` **1832
pass, 0 fail, 106 files** (16.5 s). `API_MODULES` / `WEB_MODULES` are `[recipe, finance]`.

What M5 builds on (exists, is NOT rebuilt):

- `apps/api/src/db/schema/core.ts` already has `legacyIds` (`legacy_ids`: SQL column `table`, TS
  property `tableName`; `legacy_source`, `legacy_id`, `new_id`, `created_at`; PK `(table,
  legacy_source, legacy_id)`), created by `0000_core.sql`. **No schema change and no new drizzle
  migration in M5.**
- `apps/api/src/modules/types.ts` has a placeholder `LegacyMigrator { source }` and
  `ApiModule.legacyMigration?` that nothing sets (decision 2 removes them).
- `apps/api/src/db/client.ts`: `createDatabase({ url })` → `{ client, db, ready }` (sends WAL +
  `synchronous = FULL` to a local `file:` DB); importing the module ALSO opens the shared DB at
  `env.DATABASE_URL` (a file is created and switched to WAL on import).
- `apps/api/src/db/migrate.ts`: `runMigrations(database)` = drizzle `migrate` + every module's
  `afterMigrate(database)` (recipe: `backfillFoldedColumns`, `modules/recipe/migrate.ts`).
- `apps/api/scripts/migrate.ts` shows the script bootstrap: placeholder `SESSION_SECRET`, then
  DYNAMIC imports so `env.ts` validates after it. `finance-import-xlsx.ts` shows the testable script
  shape (exported functions + `if (import.meta.main) await main();`) and its CLI test spawns
  `bun run apps/api/scripts/…` from the repo root.
- Upload helpers: `normalizeStoredUploadUrl` (`src/lib/uploadUrls.ts`), `filenameOf`
  (`src/core/services/media/references.ts`), `THUMBNAIL_SUFFIX` / `originalOfThumbnail`
  (`src/core/services/media/thumbnails.ts`). `env.uploadDir` is the developer's real
  `data/uploads` under `bun test` too: **migration tests always pass an explicit temp target dir.**
- Finance: `getBalance(db, householdId, viewerUserId, viewerSlot, includeAggregates)` and
  `computeBalanceDelta` (`modules/finance/services/ledger/balance.service.ts`), `slot1UserId(db,
  householdId)` (`services/participants/participants.service.ts`); `@toon/shared` exports
  `computeBreakdown`, `computeBalance`, `deltaForTransaction`, `halfForOther`,
  `DEFAULT_CATEGORY_SLUGS`, `SAMMELBUCHUNG_TAG`, `foldText`. `setup.ts` `ensureFinanceHousehold`
  completes a household that has no categories / settings / plan row on the next enable.
- libSQL facts the planner measured on H's `@libsql/client` 0.18 (scratch tests):
  `PRAGMA foreign_keys` is **1** by default (copy order matters, an unmapped FK fails the insert);
  `client.batch(stmts, "write")` is atomic (a failing statement rolls the whole batch back);
  `PRAGMA query_only = 1` blocks writes; a WAL database copied as `<db>` + `<db>-wal` (no `-shm`)
  opens with all its data, while a copy of the main file alone LOSES every page still in the WAL
  (the planner's test table had all its rows in the WAL); `VACUUM INTO` is refused under
  `query_only`.

### 1.2 The two legacy schemas (verified against H's snapshots)

The planner compared R's `0008_snapshot.json`, F's `0001_snapshot.json` and H's
`0002_snapshot.json` column by column: **every R table maps to an H table with exactly the same
column set** after `group_id → household_id` (and `users.active_group_id → active_household_id`), and
every F ledger table maps to `finance_<name>` with exactly the same columns
(`household_members → finance_participants` included). F's `households`, `users`, `invites`,
`sessions`, `password_reset_tokens` have no `finance_*` counterpart (they map to core rows or are
not migrated, Table M).

Migration journals (drizzle stores each applied migration in `__drizzle_migrations(id, hash,
created_at)`, `created_at` = the journal's `when`):

| Source | Journal entries | Last tag | Last `when` | Last commit touching `drizzle/` |
| --- | --- | --- | --- | --- |
| R `apps/api/drizzle/` | 9 (`0000_rare_ultron` … `0008_shopping_bought`) | `0008_shopping_bought` | `1788859780811` | `928582f` |
| F `apps/api/drizzle/` | 2 (`0000_mean_true_believers`, `0001_material_nebula`) | `0001_material_nebula` | `1787307431957` | `cbdec67` |

Both stacks store `DATABASE_URL=file:/app/data/local.db` in the volume `toon-data` (compose project
names make them `toon-recipe_toon-data` and `toon-finance_toon-data`); R keeps its uploads in
`/app/data/uploads` (flat: `<uuid>.<ext>` plus generated `<name>.thumb.webp`). Both run WAL, so a
copy of a volume holds `local.db`, `local.db-wal`, `local.db-shm`.

E-mail normalisation: R stores `users.email` as `email.trim().toLowerCase()` (H the same); F stores
`users.email_normalized` = `email.trim().toLowerCase()`. The union key is that value.

### 1.3 R's local dev database (secondary evidence)

`R/data/local.db` (+ `local.db-wal`, `local.db-shm`) exists, at all 9 migrations, with 3 users, 3
groups, 4 group members, 4 recipes and 2 uploads in `R/data/uploads/` (planner's `sqlite3` on a
scratch COPY). F has no local database. This is the owner's development data, not production; T10
uses a copy of it as a recipe-only evidence run (section 4, T10).

### 1.4 Where the owner's copies are expected

`H/.gitignore` already ignores `migration-in/` and `migration-out/` ("migration inputs and outputs
live outside the tree"). The documented layout (T09 writes it into `docs/migration.md`):

```
migration-in/recipe/local.db  (+ local.db-wal if present)   copy of toon-recipe_toon-data
migration-in/recipe/uploads/                                 its uploads
migration-in/finance/local.db (+ local.db-wal if present)   copy of toon-finance_toon-data
migration-out/                                               target DB, uploads and reports of a run
```

### 1.5 Decisions this plan takes (binding for the tasks below)

1. **Layout (SPEC §3).** The CLI is `apps/api/scripts/migrate-legacy.ts`; its library is
   `apps/api/scripts/legacy/`: `types.ts`, `sources.ts`, `ledger.ts`, `copy.ts`, `report.ts` (the
   framework, T02), `users.ts` (T03), `mapping.ts` (T04), `households.ts` (T05), `recipe.ts` +
   `uploads.ts` (T06), `finance.ts` + `balance.ts` (T07), `run.ts` (T08). Fixtures in
   `apps/api/test/fixtures/legacy/`. Tests `apps/api/test/legacy-*.test.ts` (prefix `legacy-`, so
   `bun test apps/api/test/legacy-` runs the milestone's suite). The scripts directory is not
   scanned by `i18n:check`; every console line is English.
2. **No module manifest hook.** The legacy migrators are not part of the module contract: the two
   legacy schemas are historical inputs of two specific apps, not something a future module
   implements, and keeping the code under `scripts/` keeps it out of the server's import graph.
   T02 deletes `LegacyMigrator` and `ApiModule.legacyMigration` from `modules/types.ts`; T10 deletes
   the `legacyMigration?` line from SPEC §2 and updates §3's `legacy/…` list. This is a §2/§3 edit,
   not a §1 decision: no ADR.
3. **Inputs are opened from snapshots, never in place.** `sources.ts` copies each legacy file
   (`<db>` and `<db>-wal` when present, never `-shm`) into the run's scratch directory and opens
   the copy with a plain `createClient` (NOT `createDatabase`: its WAL pragma would rewrite a
   header) followed by `PRAGMA query_only = 1`. The operator's files are byte-identical after any
   run (tested by sha256). A WAL file left behind means its pages are only in the WAL: copying the
   main file alone would lose them (section 1.1), which is why the `-wal` copy is mandatory and why
   `docs/migration.md` says to copy the whole volume.
4. **Schema version gate.** `openLegacy` reads `__drizzle_migrations` and refuses (exit 2, nothing
   written) unless the copy has exactly the source's journal count and its newest `created_at`
   equals the last `when` of section 1.2 (`LEGACY_SCHEMAS` in `sources.ts`). Message: "legacy recipe
   database is at migration N of 9; start the old app once (it migrates on boot) and copy it again".
5. **Dry-run = the full pipeline against a scratch copy of the target.** `DATABASE_URL` names the
   target (a local `file:` URL; a remote `libsql://` target is refused with exit 2). The CLI snapshots
   the target into the scratch directory (or starts from nothing when the file does not exist),
   points `process.env.DATABASE_URL` at that scratch file BEFORE its first dynamic import (so the
   shared client every service module opens is the scratch DB, never the target), runs
   `runMigrations` and the whole migration there, with uploads in plan-only mode (stat, never copy).
   The report of that pass is real: counts, skipped rows and the balance check come from an actual
   database, through the same code path. Consequence for the code: `migrate-legacy.ts` statically
   imports only `node:` builtins and types; `./legacy/*` and `../src/*` are dynamic imports after the
   redirect, because the library reaches `src/db/client.ts` and `src/env.ts` transitively (schema,
   `normalizeStoredUploadUrl`, the finance balance service). The library functions always take the
   target `db` / `client` as parameters and never use the shared `db`. A relative `file:` target
   resolves against the repo root as `env.ts` does, but the CLI computes it ITSELF: its repo root is
   `resolve(import.meta.dir, "../../..")` in `migrate-legacy.ts`, and the CLI never imports
   `src/env.ts`, statically or dynamically, not even after the redirect (it needs nothing from it:
   decision 16 resolves the upload target too). `env.ts` freezes `env.databaseUrl` when it loads, so
   importing it (even dynamically, "just" for `REPO_ROOT` or `resolveDatabaseUrl`) before the
   redirect would make the shared client in `src/db/client.ts` open, create and switch to WAL the
   REAL target during a dry run. The static-import grep of section 4 cannot see a dynamic import;
   the source-order guard and the subprocess cases of T08 (target file and `-wal` absent after a dry
   run, target bytes unchanged) are the proof.
   **Import order (H/CLAUDE.md "API import cycle").** `migrate-legacy.ts` and `run.ts` are new
   process entry points, and the library reaches `src/db/schema.ts`, `lib/uploadUrls.ts` and the
   finance balance service → participants service → … → `modules/index.ts` → recipe routes that call
   `requireSession()` at module scope: a first import in a new order can die with "Cannot access …
   before initialization" while every in-process test passes. The CLI's first dynamic imports after
   the redirect are therefore `../src/db/client.ts`, then `../src/db/migrate.ts` (the order
   `scripts/migrate.ts` uses and `import-order.test.ts` proves), and only then `./legacy/*`. The
   library files have no module-scope code beyond imports and constants, and T08 adds the library's
   entry points to `import-order.test.ts`.
6. **`--apply` = the dry pass, then the real write.** With `--apply` the CLI first runs decision 5's
   scratch pass; if it reports any error (balance mismatch, failed insert, upload conflict), it
   stops with exit 1 and the target is untouched. Otherwise it opens the target with
   `createDatabase({ url: target })`, runs `runMigrations` on it and runs the migration again for
   real (uploads copied). A balance that differs therefore can never reach the target; the real
   pass re-checks it anyway (belt and braces) and fails the run if it differs.
7. **Idempotency.** Every written row records `(table, legacy_source, legacy_id) → new_id` in
   `legacy_ids` in the SAME `client.batch(…, "write")` as the row (chunks of 500 rows, SPEC §6.5). A
   row whose ledger entry exists is counted "already migrated" and never touched (also never
   UPDATED: a legacy row edited after the first apply is not propagated; the tool is a one-shot
   cutover that can be resumed, not a sync). Composite keys are spelled `<a>:<b>` (Table M). A run
   interrupted mid-way resumes on the next run from the first unmapped row. A second `--apply` on
   the same inputs writes 0 rows and copies 0 files and ends with
   `[migrate:legacy] already migrated: nothing written.`
8. **Row copies are schema-driven.** `copy.ts` reads legacy rows by `rowid` keyset (`WHERE rowid >
   ? ORDER BY rowid LIMIT 500`), maps each through the table's `transform`, and inserts with raw
   parametrised SQL whose column list is `getTableConfig(target).columns` (SQL names). Values pass
   as SQLite storage values (booleans stay 0/1, JSON stays text, reals stay reals: no drizzle
   mode conversion). The transformed row's key set must EQUAL the target's column set, else the
   copier throws a programming error (no column can be dropped silently; section 1.2 shows the
   sets are equal). A batch that fails is retried row by row; a row that still fails is recorded in
   `skipped` with `error: true` and `reason: "insert failed: <libSQL message>"`, its ledger entry is
   not written, the other rows proceed, and the run's exit code is 1.
9. **Users (SPEC §6.2).** Union by `email.trim().toLowerCase()`. A user in both apps keeps the
   recipe row as it is (id, name, avatar, verified flag + timestamp, password hash, locale) and gets
   two ledger rows (`users/recipe/<R id>` and `users/finance/<F id>` → R id). **A recipe account
   without a password (OAuth-only) stays without one**: F never verified addresses, so carrying F's
   hash would let whoever registered that address in F sign into the OAuth account (the account
   takeover toon-recipe's gotcha on auto-linking describes). The report lists such a collision with
   "finance password not carried (recipe account is OAuth-only; use password reset)". This is the
   reading of §6.2's "finance's hash is only used when recipe has none, i.e. the user existed only in
   finance": F's hash is used exactly for F-only users. A finance-only user becomes `{ id: F id,
   email: email_normalized, name, avatar_url: null, email_verified: 0, email_verified_at: null,
   password_hash: F hash, active_household_id: (set by T05), locale: F locale, created_at,
   updated_at }` (SPEC §4: read-only until confirmed). The new id is the legacy id unless that id is already
   CLAIMED, either by a target `users` row (DB lookup) or by a user decided earlier in the same run:
   `migrateUsers` keeps an in-run `Set` of claimed target ids, decides every R user first (claiming
   each kept id and each matched target id), then the F-only users, and checks every candidate id
   against the set AND the DB lookup; a claimed id gets `crypto.randomUUID()` and a warning. The DB
   lookup alone is not enough: gina's F id equals cleo's R id (Table F), both rows are written in the
   same pass and usually in the same 500-row batch, so the batch would fail on the PRIMARY KEY and the
   per-row fallback would record gina as an error instead of re-keying her (a "fix" that catches the
   PK error and retries with a fresh id is wrong too: it re-keys whichever row lost the race, possibly
   cleo). The same claimed-set pattern applies to household ids in T05 (FH3's id equals G2's).
   If the target already has a user with that e-mail and no ledger entry for it (somebody registered
   in the new app first), the legacy user is mapped onto that row ONLY when that row has
   `email_verified_at` set (ledger rows written, no user row written, warning "matched an existing
   account in the target"). An unconfirmed target account (`email_verified_at` NULL, whatever its
   `email_verified` boolean says) is never matched: handing it the legacy user's households, cards and
   finance seat is the takeover R's gotcha forbids ("the boolean alone is NOT evidence"; explicit OAuth
   linking only), the same reason F's hash stays off OAuth-only accounts above. Such a legacy user is
   skipped with `error: true` and the error "unverified target account <email> blocks the merge"
   (exit 1, so `--apply` refuses to write); every row referencing that user is then skipped as "user
   <id> not migrated". The operator confirms that address in the new app (or deletes the unconfirmed
   account) and runs again; `docs/migration.md` says so.
10. **Households (SPEC §6.3, D12).** Every recipe group becomes a household with the same id
    (fresh UUID if the id is taken in the target). Each finance household H with members M (by
    unified user id):
    - `M` empty → `skip`, reason `no-members`; all of H's rows are skipped with
      "finance household <id> skipped: no members".
    - the candidates are the groups whose member set contains all of `M` (one member for a solo
      ledger, two otherwise), ordered by recipe count desc, then `created_at` asc, then id asc;
      groups already taken by an earlier finance household (processing order: `--mapping` entries
      first, then the rest by H's `created_at` asc, then id) are removed. One candidate →
      `merge`, reason `only-group`; several → the first, reason `most-recipes` (or `tie-oldest`
      when the first two have the same recipe count); none left but some taken → `new`, reason
      `group-taken`; none at all → `new`, reason `no-group`.
    - `--mapping <file>` (`{"finance": {"<H.id>": "<G.id>" | "new"}}`, SPEC §6.3) overrides an entry
      (reason `mapping`). Errors (exit 2, nothing written): file not JSON, top-level keys other than
      `finance`, an unknown H id, a G id that is not a recipe group, two entries naming the same G.
      A mapped G that lacks a finance member gets that member added as `member` (`addMembers`,
      listed in the report).
    - **Where the mapping checks live.** `mapping.ts` (T04) exports `validateMappingOverride(override,
      known)` (unknown finance id, unknown group id, non-string value, two entries naming one group;
      `"new"` may repeat) and `parseMappingFile(text, known)` (JSON and shape checks, then
      `validateMappingOverride`). `known` holds the R `groups.id` set and the F `households.id` set read
      from the opened snapshots: mapping keys, mapping values, `GroupInfo.id` and
      `ProposalEntry.groupId` are LEGACY ids, which `migrateHouseholds` translates through
      `ctx.ids.households.recipe`. The CLI (T08) calls `parseMappingFile` after `openLegacy` and before
      pass 1, so a bad file exits 2 before anything is written anywhere; `--mapping` without
      `--finance-db` is a usage error (exit 2). `runLegacyMigration` (T08) calls
      `validateMappingOverride` before `migrateUsers`, and `migrateHouseholds` (T05) calls it again as
      its first statement, before it writes anything, because both are public functions that take an
      already-parsed `MappingOverride`.
    - A finance household the ledger already maps keeps that target (reason `already-migrated`); a
      `--mapping` entry that disagrees is ignored with a warning.
    - `new`: a household `{ id: H.id (fresh if taken), name: H.name, description: null, image_url:
      null, created_by: mapped H.created_by, created_at, updated_at }`; members: H's creator is
      `owner` (when the creator is no longer a member, the remaining member with the lowest slot is:
      FH4's gina), the other `member`,
      `created_at = joined_at`. `merge`: no household row; the ledger row `households/finance/<H.id>
      → <G.id>` records the decision.
11. **Modules and participants (SPEC §6.4, D2, D3).** `household_modules` gets `recipe` for every
    group household (`enabled_at` = the group's `created_at`, `settings` NULL) and `finance` for
    every household that received a finance household (`enabled_at` = H's `created_at`, `settings`
    NULL: finance never reads it back). Households created from a finance household do NOT get
    `recipe` (§6.4 enables recipe only where a group was the origin; the owner turns it on from
    Home). `finance_participants` come from F's `household_members`: slot, `display_name`,
    `joined_at` unchanged. A solo finance household (one member) is migrated with one seat and a
    warning ("one participant; seat the second with PUT …/finance/participants"); when that one
    member sat in slot 2 it is re-seated in slot 1 (slot 1 anchors the balance and must resolve, as in
    ADR 0004). Both are states H's runtime never produces while the ledger has rows: D2 enables finance
    only with two seats (`onEnable` answers `422 finance_participants_required`), and D3 / ADR 0004
    refuse any slot change while the ledger has rows. The migration needs them because F's data is
    already in that state (F let a member who never paid leave). T05 records this in **ADR 0005**
    (`docs/adr/0005-legacy-migration-ledger-states.md`, together with decision 14's payer re-point) and
    edits SPEC D2, D3 and §6 step 4 in the same commit. The household then behaves as ADR 0004's
    one-seat ledger: a booking that needs the other slot answers `409 conflict`, and an admin seats a
    second participant with `PUT …/participants` (nobody leaves, so ADR 0004's veto does not apply). `finance_settings` from H's `default_locale`, `created_at`, `updated_at`. The
    migration writes these rows directly and does NOT call `initializeHousehold`, `onHouseholdCreated`
    or `onEnable` (they would seed default categories that collide with the copied ones); a migrated
    recipe-only household that enables finance later gets its categories, settings and plan row from
    `ensureFinanceHousehold` (`modules/finance/setup.ts`), exactly like a pre-M3 household.
    Finance-only users whose `active_household_id` is NULL get the household their (earliest-joined)
    finance household landed in (an UPDATE guarded by `IS NULL`, so a re-run changes nothing).
12. **What is copied, renamed and normalised: Table M (section 2).** URLs: `users.avatar_url`,
    `groups.image_url`, `recipes.image_url`, `collections.cover_image_url` pass through
    `normalizeStoredUploadUrl` (strips a signature or origin, SPEC §4); JSON columns
    (`import_drafts.parsed`, `source_meta`, `shopping_*.source_recipe_ids`) are copied verbatim
    (ids are kept, so the recipe ids inside stay valid). Fold columns are recomputed with
    `foldText` at copy time (one definition of the fold, H's); `backfillFoldedColumns(target.db)` runs
    after the recipe copy and must return 0. `users.email` is lower-cased and trimmed. Not migrated
    (counted in the report's "Not migrated by design" section): `sessions` (both, everyone logs in
    again), F `invites`, F `password_reset_tokens` (SPEC §4, §9). R's `password_reset_tokens` and
    `email_verification_tokens` ARE copied (SPEC §4 lists them as core-from-recipe; they are hashes
    and expire on their own).
13. **Uploads (SPEC §6.5).** Every regular file at the top level of `--recipe-uploads` (originals and
    `.thumb.webp` derivatives, referenced or not; sub-directories and symlinks are skipped with a
    warning) is copied to the target upload directory: absent → copy (`COPYFILE_EXCL`) and verify
    the size afterwards (a mismatch is an error); present with the same size → "already present";
    present with a different size → error, target file kept, never overwritten. A filename some
    legacy row references (`filenameOf` over the four URL columns, `source_meta.storedPath` and
    `parsed.imageUrl`) that is missing in the source directory is a warning (the row is still
    migrated; the image will 404 as it did before). The target directory is the CLI's own `UPLOAD_DIR`
    resolution in the CLI (decision 16; never `env.uploadDir`) and an explicit temp directory in
    tests. Files are not ledger rows; their idempotency is
    "exists with the same size".
14. **Balance invariant (SPEC §6.6).** For every finance household that was migrated, `balance.ts`
    computes the legacy breakdown with `computeBreakdown` over F's rows of that household from the
    perspective of the legacy user who holds slot 1 in the TARGET (identity-based, so a re-seated
    slot-2 survivor compares correctly), and the migrated breakdown with `getBalance(target.db,
    householdId, slot1, 1, true)` (all rows, `sammelbuchung` included). `balanceCents` and
    `transactionCount` must be equal and `sum(amount_cents)` over the household's rows must be equal,
    and the target's slot-1 user must be the mapped legacy slot-1 user; otherwise the row is `FAIL`,
    an error is recorded and the run exits 1.
    **Plan payers and income persons (ADR 0005).** toon-finance produces non-participants there
    itself: F `services/households/households.service.ts` (lines 72-80) creates the `fixed_cost_plans`
    row with `payerId: ownerId` (the creator), and F `members.service.ts` `removeMember` (lines 168-183)
    only refuses a leaver who PAID a transaction and touches neither `fixed_cost_plans.payer_id` nor
    `incomes.person_id`. A household whose creator left (FH4's shape) therefore normally carries a plan
    payer who is no longer a member, and possibly incomes naming them. `--mapping` cannot change a
    payer and the inputs are read-only, so treating this as an error would make real data
    unmigratable. The migration mirrors ADR 0004's runtime rule instead (a leaver's payer role moves to
    the remaining participant):
    - a `fixed_cost_plans.payer_id` that is not a TARGET participant of its household is re-pointed to
      the household's slot-1 participant by T07's transform, with the warning "finance household
      <id>: plan payer <email> is not a participant; payer set to <slot-1 email>";
    - an income whose `person_id` is not a participant is copied unchanged with the warning "income
      <id> of finance household <id> names <email>, who is not a participant; the plan stays
      incomplete until an admin deletes or replaces it". It is never an error and never skipped: at
      runtime it is harmless (`isPlanComputable` counts incomes per participant, so the plan reports
      `plan_incomplete`) and an admin removes it with `DELETE …/finance/plan/incomes/:incomeId`.
    After the copy `verifyBalances` re-checks that every migrated plan payer is a participant; an
    error there is a bug in the transform, not a data problem. Incomes are not checked as errors.
15. **Report and exit codes.** The report (`report.ts`, model in `types.ts`) is printed as English
    text to stdout; `--report <file>` also writes it as JSON (`reportToJson`). Sections, in order,
    each with a fixed heading line that tests and `docs/migration.md` rely on:
    `== Inputs ==`, `== Household mapping proposal ==`, `== Users ==`, `== Rows per table ==`,
    `== Skipped rows ==`, `== Not migrated by design ==`, `== Uploads ==`,
    `== Finance balance per household ==`, `== Warnings ==`, `== Errors ==`, then exactly one final
    line:
    - dry-run, something to write: `[migrate:legacy] dry run complete: <n> rows would be written, <m> files would be copied. Nothing was written.`
    - dry-run, nothing to write: `[migrate:legacy] dry run complete: already migrated, nothing would be written. Nothing was written.`
    - apply: `[migrate:legacy] applied: <n> rows written, <m> files copied.`
    - apply, nothing to write: `[migrate:legacy] already migrated: nothing written.`
    - any error: `[migrate:legacy] FAILED: <k> error(s), see Errors above.` (with `--apply` after a
      failed dry pass also `Nothing was written.`)

    Money is printed as integer cents (`-1234 ct`), never as a float. Exit codes: `0` success; `1`
    the run found errors (balance, insert, upload conflict); `2` usage, mapping or input error
    (missing file, wrong schema version, remote target), detected before anything is written.
16. **CLI contract.** `bun run migrate:legacy -- [--recipe-db <file>] [--recipe-uploads <dir>]
    [--finance-db <file>] [--mapping <json>] [--apply] [--report <file>] [--help]` (SPEC §6). At
    least one of `--recipe-db` / `--finance-db` is required; `--recipe-uploads` requires
    `--recipe-db`; without `--recipe-uploads` the uploads step is skipped with a warning. Relative
    paths resolve against the repo root (the convention `env.ts` uses for `DATABASE_URL` and
    `UPLOAD_DIR`; `bun --filter @toon/api` runs the script with `cwd = apps/api`, so `process.cwd()`
    would be wrong). The target is `DATABASE_URL`; the upload target is `UPLOAD_DIR` (default
    `./data/uploads`, env.ts's default), both resolved against the repo root by the CLI itself.
    **`.env` policy.** `bun run dev`, `db:migrate` and `seed` accept these in the process environment
    OR the root `.env` (env.ts loads it), so the CLI does too, but it has to read them before anything
    may load `env.ts` (decision 5). `migrate-legacy.ts` therefore exports `resolveCliEnv(processEnv,
    repoRoot): { databaseUrl: string; uploadDir: string }`, which merges the root `.env` and then
    `.env.local` into a COPY of the process environment with env.ts's rules (an existing process value
    wins; the same line syntax, `export` prefix, quote stripping and trailing-comment removal; nothing
    is read when `NODE_ENV=test`, like env.ts), keeps a short comment "kept in step with env.ts
    `loadRootDotEnv`; env.ts cannot be imported before the redirect", and returns absolute values. It
    never writes `process.env` except for the two redirect assignments of decision 5. A missing
    `DATABASE_URL` is exit 2 with `DATABASE_URL is not set (process environment or the repo's root
    .env); point it at the target, e.g. DATABASE_URL=file:./migration-out/toon.db`; a non-`file:` URL
    is exit 2 (decision 5). The header lines print the resolved target and upload directory, so a
    target taken from `.env` is visible before anything is written (and a dry run never writes it).
    The CLI supplies a placeholder `SESSION_SECRET` like `scripts/migrate.ts` (nothing it does signs a
    URL).
    The scratch directory is `mkdtemp(join(tmpdir(), "toon-migrate-legacy-"))`, removed in a
    `finally`.
17. **Fixtures (SPEC §7).** `apps/api/test/fixtures/legacy/` holds verbatim copies of R's and F's
    migration SQL and `meta/_journal.json` (no snapshots), a deterministic builder `build.ts` that
    applies them with drizzle's libSQL migrator to fresh files (plain `createClient`, rollback
    journal, so no `-wal` is ever produced) and inserts the anonymised rows of Table F, the built
    `recipe.db` and `finance.db` (committed: `.gitignore` gains `!apps/api/test/fixtures/legacy/*.db`),
    an `uploads/` directory, and `facts.ts` (every id, e-mail, password and expected count, the
    single source the tests read). `build.ts --check` rebuilds into a temp dir and compares a logical
    dump (schema SQL + every row of every table, ordered) with the committed files; the fixture test
    does the same, so builder and files cannot drift. Determinism: fixed ids and timestamps,
    argon2id hashes precomputed once and pasted as constants into `facts.ts` (Bun's hash is salted).
18. **Tests use temp file databases.** Every migration test creates its own temp directory with a
    target `createDatabase({ url: "file:<tmp>/target.db" })` + `runMigrations(target.db)` and copies of
    the fixtures; it never uses the shared `file::memory:` `db` (the CLI path cannot use it either)
    and never `env.uploadDir`. A subprocess test sets `NODE_ENV: "development"` (under `bun test` the
    child inherits `NODE_ENV=test`, and `env.ts` would then force `file::memory:`), an absolute
    `DATABASE_URL`, `UPLOAD_DIR` and a placeholder `SESSION_SECRET`.

### 1.6 The library's types (T02 writes them; later tasks import, never edit)

```ts
// apps/api/scripts/legacy/types.ts
import type { Client, InStatement, Value } from "@libsql/client";
import type { Database } from "../../src/db/client.ts";   // import type ONLY (decision 5)

export type LegacySource = "recipe" | "finance";
export type Mode = "dry-run" | "apply";
export type Row = Record<string, Value>;                     // a legacy row, SQL column names
export interface LegacyDb { source: LegacySource; client: Client; originalPath: string; snapshotPath: string }
export interface TargetDb { db: Database; client: Client; url: string }
export interface IdMaps {
  users: Record<LegacySource, Map<string, string>>;          // legacy user id -> target user id
  households: Record<LegacySource, Map<string, string>>;     // R group id / F household id -> target household id
}
export type MappingOverride = Record<string, string | "new">; // F household id -> R group id | "new"
export interface UploadOptions { sourceDir?: string; targetDir: string; copy: boolean } // copy=false: plan only
export interface MigrationContext {
  mode: Mode;                 // which pass this is (the CLI's dry pass of an --apply run is "dry-run")
  recipe?: LegacyDb; finance?: LegacyDb; target: TargetDb;
  ids: IdMaps; report: Report; uploads: UploadOptions; mapping?: MappingOverride;
  chunkSize: number;          // CHUNK_SIZE = 500 (SPEC §6.5); tests may lower it
}
export interface TableCount { table: string; source: LegacySource; read: number; written: number; alreadyMigrated: number; skipped: number }
export interface SkippedRow { table: string; source: LegacySource; legacyId: string; reason: string; error: boolean }
export interface NotMigrated { table: string; source: LegacySource; rows: number; reason: string }
export interface UserCollision { email: string; recipeUserId: string; financeUserId: string; targetUserId: string; passwordFrom: "recipe" | "none"; note?: string }
export type DecisionReason = "only-group" | "most-recipes" | "tie-oldest" | "group-taken" | "no-group" | "mapping" | "no-members" | "already-migrated";
export interface HouseholdDecision {
  financeHouseholdId: string; financeName: string; memberEmails: string[];
  decision: "merge" | "new" | "skip"; targetHouseholdId?: string; targetName?: string;
  reason: DecisionReason; addMembers: string[];   // e-mails added to a mapped group
}
export interface UploadSummary { sourceFiles: number; copied: number; wouldCopy: number; alreadyPresent: number; bytesCopied: number; conflicts: string[]; missingReferenced: string[]; ignoredEntries: string[] }
export interface BalanceCheck {
  financeHouseholdId: string; targetHouseholdId: string; name: string; slot1Email: string;
  legacyBalanceCents: number; migratedBalanceCents: number;
  legacyTransactionCount: number; migratedTransactionCount: number;
  legacyAmountSumCents: number; migratedAmountSumCents: number;
  slot1Matches: boolean; ok: boolean;
}
export interface Report {
  mode: Mode; target: string;
  inputs: { source: LegacySource; path: string; schema: string; tables: Record<string, number> }[];
  decisions: HouseholdDecision[]; users: { recipe: number; finance: number; target: number; collisions: UserCollision[] };
  counts: TableCount[]; skipped: SkippedRow[]; notMigrated: NotMigrated[];
  uploads?: UploadSummary; balances: BalanceCheck[]; warnings: string[]; errors: string[];
}
```

`sources.ts` exports `LEGACY_SCHEMAS`, `snapshotDatabase(sourcePath, destPath)`, `openLegacy(source,
path, scratchDir): Promise<LegacyDb>`, `LegacyInputError` (exit-2 class), `readAll(legacy, sql,
args?)`. `ledger.ts` exports `lookupMany(client, table, source, legacyIds): Promise<Map<string,
string>>` (IN lists of at most 500), `loadAll(client, table, source)`, `ledgerStatement(table, source,
legacyId, newId): InStatement` (created_at = `Date.now()`). `copy.ts` exports `CHUNK_SIZE = 500`,
`columnNames(table)`, `renameColumns(row, renames)`, `insertStatement(table, values)`,
`writeEntries(ctx, table, entries, count)` (entries = `{ values; ledger: { source; legacyId }[];
newId; label }`, chunked batches with the per-row fallback of decision 8; returns the written
entries), `copyTable(ctx, spec): Promise<TableCount>` with `CopySpec = { source; legacyTable; target:
SQLiteTable; legacyId?(row): string /* default row.id */; transform(row, ctx): Row | { skip: string;
error?: boolean }; newId?(values, row): string /* default values.id ?? legacyId */; ledgerTable?:
string /* default the target's SQL name */ }`. `report.ts` exports `createReport(mode, target)`,
`addCount`, `renderProposal(decisions)`, `renderReport(report)` (the sections and final line of
decision 15; `totalWritten(report)` sums `written`), `reportToJson(report)`, `exitCodeFor(report)`.

## 2. Table M — what goes where

`→` maps a column through the id maps; "same" = the legacy value. Ledger key = `legacy_id` stored in
`legacy_ids` (with `table` = the target table's SQL name and `legacy_source` = the source). Every
table not listed is not migrated (decision 12).

| # | Legacy (source) | Target | Ledger key → new id | Column changes |
| --- | --- | --- | --- | --- |
| 1 | `users` (R) | `users` | `id` → R id (or existing target user, or fresh if taken) | `email` trim+lower; `avatar_url` normalised; `active_group_id` → `active_household_id` (value via the R group map) |
| 2 | `users` (F) | `users` (F-only) or none (collision) | `id` → unified id | decision 9 shape |
| 3 | `oauth_accounts` (R) | `oauth_accounts` | `id` → same | `user_id` → |
| 4 | `password_reset_tokens` (R) | same | `id` → same | `user_id` → |
| 5 | `email_verification_tokens` (R) | same | `id` → same | `user_id` → |
| 6 | `groups` (R) | `households` | `id` → same (fresh if taken) | `created_by` →; `image_url` normalised |
| 7 | `group_members` (R) | `household_members` | `id` → same | `group_id` → `household_id` →; `user_id` → |
| 8 | `group_invites` (R) | `household_invites` | `id` → same | `group_id` → `household_id` →; `invited_by` →, `accepted_by` → (nullable) |
| 9 | (new) | `household_modules` (`recipe`) | `<G.id>` → `<hh>:recipe` | `enabled_at` = group `created_at`, `settings` NULL |
| 10 | `households` (F) | `households` (`new`) or decision only (`merge`) | `<H.id>` → target household id | decision 10 |
| 11 | `household_members` (F) | `household_members` (`new` households, mapped `addMembers`) | `<H.id>:<F user id>` → fresh UUID | role per decision 10, `created_at` = `joined_at` |
| 12 | `household_members` (F) | `finance_participants` | `<H.id>:<F user id>` → `<hh>:<user>` | `household_id` →, `user_id` →; slot (re-seat rule of decision 11), `display_name`, `joined_at` same |
| 13 | `households` (F) | `finance_settings` | `<H.id>` → `<hh>` | `default_locale`, `created_at`, `updated_at` |
| 14 | (new) | `household_modules` (`finance`) | `<H.id>` → `<hh>:finance` | `enabled_at` = H `created_at`, `settings` NULL |
| 15 | `tags` (R) | `recipe_tags` | `id` → same | `group_id` → `household_id` → |
| 16 | `recipes` (R) | `recipe_recipes` | `id` → same | `group_id` → `household_id` →; `created_by` →; `image_url` normalised; `title_fold`, `description_fold` = `foldText(title)`, `foldText(description ?? "")` |
| 17 | `recipe_ingredients` (R) | `recipe_recipe_ingredients` | `id` → same | `name_fold` = `foldText(name)` |
| 18 | `recipe_steps` (R) | `recipe_recipe_steps` | `id` → same | — |
| 19 | `recipe_tags` (R) | `recipe_recipe_tags` | `<recipe_id>:<tag_id>` → same | — |
| 20 | `collections` (R) | `recipe_collections` | `id` → same | `group_id` → `household_id` →; `created_by` →; `cover_image_url` normalised |
| 21 | `collection_recipes` (R) | `recipe_collection_recipes` | `<collection_id>:<recipe_id>` → same | — |
| 22 | `meal_plan_entries` (R) | `recipe_meal_plan_entries` | `id` → same | `group_id` → `household_id` →; `created_by` → |
| 23 | `recipe_cook_log` (R) | `recipe_recipe_cook_log` | `id` → same | `group_id` → `household_id` →; `cooked_by` → |
| 24 | `import_drafts` (R) | `recipe_import_drafts` | `id` → same | `group_id` → `household_id` →; `created_by` →; JSON verbatim |
| 25 | `shopping_lists` (R) | `recipe_shopping_lists` | `id` → same | `group_id` → `household_id` →; `created_by` → |
| 26 | `shopping_list_items` (R) | `recipe_shopping_list_items` | `id` → same | — |
| 27 | `shopping_list_catalog` (R) | `recipe_shopping_list_catalog` | `id` → same | — |
| 28 | `shopping_bought_items` (R) | `recipe_shopping_bought_items` | `id` → same | `bought_by` → (nullable) |
| 29 | `shopping_list_recipes` (R) | `recipe_shopping_list_recipes` | `id` → same | `added_by` → (nullable) |
| 30 | `shopping_mutations` (R) | `recipe_shopping_mutations` | `id` → same | — |
| 31 | `cards` (R) | `recipe_cards` | `id` → same | `user_id` → |
| 32 | `categories` (F) | `finance_categories` | `id` → same | `household_id` → |
| 33 | `tags` (F) | `finance_tags` | `id` → same | `household_id` → |
| 34 | `transactions` (F) | `finance_transactions` | `id` → same | `household_id` →; `payer_id` →; `created_by` → (nullable) |
| 35 | `transaction_tags` (F) | `finance_transaction_tags` | `<transaction_id>:<tag_id>` → same | skipped with its transaction |
| 36 | `mutation_claims` (F) | `finance_mutation_claims` | `id` → same | `household_id` → |
| 37 | `fixed_cost_items` (F) | `finance_fixed_cost_items` | `id` → same | `household_id` → |
| 38 | `incomes` (F) | `finance_incomes` | `id` → same | `household_id` →; `person_id` → (kept when not a participant, warning: decision 14) |
| 39 | `fixed_cost_plans` (F) | `finance_fixed_cost_plans` | `<H.id>` → `<hh>` | `household_id` →; `payer_id` → (re-pointed to the slot-1 participant when not a participant, warning: decision 14) |
| 40 | `accrual_runs` (F) | `finance_accrual_runs` | `id` → same | `household_id` → |
| — | `sessions` (R, F), `invites` (F), `password_reset_tokens` (F) | not migrated | — | counted in "Not migrated by design" |

Order of the steps (FKs are enforced, section 1.1): users (1–5) → households (6–14) → recipe (15–31,
in the listed order) → `backfillFoldedColumns` → uploads → finance (32–40, in the listed order) →
balance check. An unmapped user or household in a row is a skipped row with `error: true` ("user <id>
not migrated" / "household <id> not migrated"), except rows of a finance household that decision 10
skipped (`error: false`, "finance household <id> skipped: no members").

## 3. Table F — fixture content (T01; the facts file is the source of truth)

All names, e-mails and amounts are invented (F's commit `82d4f76` replaced real names in F for the
same reason). Ids are fixed UUID-shaped strings, timestamps fixed (2026-08/09 unix ms).

Recipe DB (`recipe.db`, R schema at `0008`):

| Who / what | Rows |
| --- | --- |
| `anna@example.test` | password `recipe-pass-anna`, verified, `locale "de"`, `active_group_id` = G1, `avatar_url` stored SIGNED (`/uploads/<avatar>.png?exp=…&sig=…`) |
| `ben@example.test` | OAuth-only (`password_hash` NULL), verified, one `oauth_accounts` row (google) |
| `cleo@example.test` | password `recipe-pass-cleo`, NOT verified (`email_verified` 0, `email_verified_at` NULL) |
| `dana@example.test` | password `recipe-pass-dana`, verified, `locale` NULL |
| G1 "Familie Beispiel" | anna owner, ben admin, cleo member; 3 recipes; `image_url` `/uploads/<group>.png` |
| G2 "Freundeskreis" | anna owner, ben member, dana member; 1 recipe |
| G3 "WG Gartenstraße" | cleo owner, dana member; 2 recipes |
| recipe content (G1 mostly) | every R table at least one row: tags (one `kind` ≠ `free`), ingredients with umlauts (fold check, e.g. "Äpfel"), steps, `recipe_tags`, a collection with a cover `/uploads/<cover>.png` and two `collection_recipes`, meal-plan entries, a cook-log row linked to an entry, an import draft (`source_meta.storedPath` = `<scan>.jpg`, `parsed.imageUrl`), a shopping list with items, catalog, bought items (one `bought_by` NULL), list recipes, a mutation, cards for anna and ben, a pending `group_invites` row, one `password_reset_tokens` and one `email_verification_tokens` row, one `sessions` row |
| recipe images | one recipe `/uploads/<hero>.jpg` (with `<hero>.jpg.thumb.webp` on disk), one `https://example.test/bild.jpg` (external, untouched), one `/uploads/<missing>.jpg` (absent from `uploads/`: warning) |

Finance DB (`finance.db`, F schema at `0001`):

| Who / what | Rows |
| --- | --- |
| `Anna@Example.test` (normalised `anna@example.test`) | password `finance-pass-anna` (differs from recipe's: proves which hash is kept) |
| `ben@example.test`, `cleo@example.test`, `dana@example.test` | finance passwords `finance-pass-<name>` |
| `emil@example.test`, `fritz@example.test`, `gina@example.test` | finance-only users; **gina's F id equals cleo's R id** (trap: the id is taken, gina must get a fresh UUID and FH4 must follow the map, never the raw id) |
| FH1 "Kasse Anna & Ben" | anna slot 1 (creator), ben slot 2; anna+ben sit in G1 (3 recipes) and G2 (1) → `merge` G1, `most-recipes` |
| FH2 "Kasse Cleo & Dana" | cleo slot 1, dana slot 2; only G3 holds both → `merge` G3, `only-group` |
| FH3 "Emil & Fritz" | emil slot 1 (creator), fritz slot 2; no group → `new`, `no-group`; **FH3's id equals G2's id** (trap: fresh UUID) |
| FH4 "Gina allein" | gina alone in **slot 2** (solo). Its creator is **fritz** (`households.created_by`; he held slot 1 and left before paying anything, which F's `removeMember` allows) → `new`, gina `owner` (lowest remaining slot), `created_by` = fritz's unified id, re-seated slot 1, solo warning. Its plan row (disabled) has **payer fritz** (F's create path) → re-pointed to gina, warning. Two incomes: one gina's, **one naming fritz** → copied unchanged, warning (decision 14, ADR 0005) |
| FH5 "Leer" | no members, no transactions, but its `fixed_cost_plans` row (payer gina) → `skip`, `no-members`; the plan row is skipped with that reason |
| ledger FH1 | the 21 default categories (`DEFAULT_CATEGORY_SLUGS`, `fixkosten` `is_system` 1) + one custom (`custom_label` set, one `is_hidden` 1); ≥ 12 transactions: `SPLIT_EQUAL` by both payers incl. `-101` (refund; `halfForOther(-101) = -50`) and an odd amount, `OTHER_ONLY` by both, a `SETTLEMENT`, two `fixed_plan` rows with `plan_period`, two `import` rows with `import_seq` and `external_key`, one tagged `sammelbuchung`; two tags (`sammelbuchung`, one more) with `transaction_tags`; two `fixed_cost_items`; two `incomes` (one per member); `fixed_cost_plans` enabled with `last_booked_period`; one `accrual_runs`; two `mutation_claims` (one linked to a transaction) |
| ledger FH2, FH3, FH4 | the 21 categories each; FH2 ≥ 5 transactions, FH3 ≥ 4 (one `OTHER_ONLY` by fritz), FH4 2 (gina only); a plan row each (disabled for FH3, FH4) |
| not migrated | one `sessions`, one `invites`, one `password_reset_tokens` row |

Uploads (`uploads/`): `<avatar>.png`, `<group>.png`, `<cover>.png`, `<hero>.jpg`,
`<hero>.jpg.thumb.webp`, `<scan>.jpg`, `orphan.png` (unreferenced, still copied); tiny deterministic
bytes of distinct sizes.

Expected after one `--apply` (T01 writes the numbers it actually built into `facts.ts`; the tests
assert from there): users 7 (4 R + emil, fritz, gina), collisions 4 (one with `passwordFrom: "none"`:
ben); households 5 (G1, G2, G3, FH3', FH4'); `household_modules` 7 (recipe ×3, finance ×4);
`finance_participants` 7 (2+2+2+1); `finance_settings` 4; decisions FH1 merge/most-recipes, FH2
merge/only-group, FH3 new/no-group, FH4 new/no-group, FH5 skip/no-members; uploads 7 source files, 7
copied, 1 missing referenced; `finance_incomes` 4 (FH1 2, FH4 2, the fritz one included); FH4's
plan payer = gina's target id; balances 4 rows, all OK; warnings include gina's fresh id, the FH4 solo
seat, the FH4 payer re-point, the FH4 income naming fritz and the missing upload; errors 0.

## 4. Task list and waves

List order is the structured-output order. Deps are binding; every pair of tasks without a
dependency path has disjoint `files`.

| Wave | Task | Tier | Title | Deps |
| --- | --- | --- | --- | --- |
| 1 | M5-T01 | build | Legacy fixtures: verbatim schemas, deterministic builder, committed DBs | — |
| 1 | M5-T02 | core | Migration framework: snapshots, schema gate, ledger, chunked copier, report | — |
| 2 | M5-T03 | build | Users: union by e-mail, collision rule, auth rows | T01, T02 |
| 2 | M5-T04 | core | Household mapping proposal and `--mapping` (pure) | T02 |
| 3 | M5-T05 | core | Households, members, invites, modules, participants, settings, ADR 0005 | T03, T04 |
| 4 | M5-T06 | build | Recipe module rows and the uploads copy | T05 |
| 4 | M5-T07 | build | Finance ledger rows and the balance invariant | T05 |
| 4 | M5-T09 | build | `docs/migration.md` with the cutover order | T05 |
| 5 | M5-T08 | build | Orchestrator, CLI, package scripts, end-to-end and subprocess tests | T06, T07 |
| 6 | M5-T10 | build | Integration: gates, fixture and evidence runs, SPEC/CLAUDE sync | all |

**Shared files and their single owner.** `.gitignore` — T01; `apps/api/src/modules/types.ts` —
T02; `docs/adr/0005-legacy-migration-ledger-states.md` — T05; `docs/SPEC.md` — T05 (only the D2, D3
and §6 step 4 sentences of ADR 0005), then T10 (no other task touches it); `apps/api/test/import-order.test.ts`
— T08; `apps/api/test/support/legacy-harness.ts` — T03 (later tasks import it, never edit it; a task
that needs more setup writes it in its own test file); `apps/api/package.json`, root
`package.json` — T08; `docs/migration.md` — T09 (T10 may correct it after the real output exists);
`CLAUDE.md`, `docs/SPEC.md`, this plan's sections 9 and 10 — T10. No task adds a dependency
(`bun.lock` unchanged); no task adds a drizzle migration.

**Common checks.**

```sh
# the milestone's suite
cd /home/erics/software/toon-household && bun test apps/api/test/legacy-
# nothing in the server references the removed placeholder (after T02)
cd /home/erics/software/toon-household && bash -c '! grep -rnE "LegacyMigrator|legacyMigration" apps/api/src'
# the CLI statically imports node builtins and types only; everything that can reach
# src/db/client.ts or src/env.ts (the legacy library does, transitively) is a dynamic import
# made after the DATABASE_URL redirect (decision 5)
cd /home/erics/software/toon-household && bash -c '! grep -nE "^import [^t].*from \"(\.\./src|\./legacy)/" apps/api/scripts/migrate-legacy.ts'
# the CLI never imports env.ts, not even dynamically (decision 5); the grep above cannot see dynamic imports
cd /home/erics/software/toon-household && bash -c '! grep -n "src/env" apps/api/scripts/migrate-legacy.ts'
```

Every brief also implies: read `H/docs/SPEC.md` §1 (D3, D7, D12, D13), §4, §6, §7; `H/CLAUDE.md`
(Conventions; Gotchas "D7 pragmas", "`file::memory:` is per client", "API import cycle", "Migrations are generated", "A
`household_modules` row is the enabled state", "Fold columns and the backfill", "Uploads are signed,
not cookie-checked", "Finance TS identifiers carry a `finance` prefix", "Participants and the gate",
"Long commands"); this plan §1–§4. API tests live in `apps/api/test/` (never `tests/`). Commit per
task; the body names the SPEC decision or the source file served and ends with the harness's
`Co-Authored-By` line. Never `rm -rf` a path built from a variable in a verify step; use a fresh
`mktemp -d` directory instead.

## 5. Tasks

### M5-T01 — Legacy fixtures: verbatim schemas, deterministic builder, committed DBs (build)

**Goal.** Small anonymised legacy databases in both source schemas, built by a script from the
sources' drizzle migrations, covering every case of Table F; the single facts file the later tests
read.

**Read.** This plan §1.2, §1.5 decision 17, §3 (Table F); SPEC §6, §7; `R/apps/api/drizzle/*.sql`
and `meta/_journal.json`; `F/apps/api/drizzle/*.sql` and `meta/_journal.json`; `R/apps/api/src/db/
schema.ts` (column meanings and enum values: tag `kind`, card `format`, draft `status` /
`source_type`, invite `status`); `F/apps/api/src/db/schema.ts` and H's
`apps/api/src/modules/finance/schema.ts` (enums: `split_mode`, `date_source`, `origin`,
`category_source`, accrual `trigger`); `packages/shared/src/modules/finance/{categories,tags,money}.ts`
(`DEFAULT_CATEGORY_SLUGS`, `SYSTEM_CATEGORY_SLUG`, `SAMMELBUCHUNG_TAG`, `halfForOther`); F/CLAUDE.md
gotchas 31–33 (the rounding the fixture amounts exercise); R/CLAUDE.md on `/uploads` and thumbnails;
`H/.gitignore`.

**Work.**
1. Copy verbatim (`cp`, byte-identical): `R/apps/api/drizzle/{0000_rare_ultron,…,0008_shopping_bought}.sql`
   + `R/apps/api/drizzle/meta/_journal.json` → `apps/api/test/fixtures/legacy/migrations/recipe/`
   (same names, `meta/_journal.json`); `F/apps/api/drizzle/{0000_mean_true_believers,
   0001_material_nebula}.sql` + `meta/_journal.json` → `…/migrations/finance/`. No snapshot files.
   `apps/api/test/fixtures/legacy/README.md` names the source commits (R `928582f`, F `cbdec67`), says
   the files are copies that must never be edited, and how to rebuild (`bun run
   apps/api/test/fixtures/legacy/build.ts`) and check (`… build.ts --check`).
2. `facts.ts`: every fixed id (users per source, groups, finance households, recipes, uploads
   filenames), e-mails, plain passwords and their precomputed argon2id hashes (generate once with
   `bun -e 'console.log(await Bun.password.hash("recipe-pass-anna", { algorithm: "argon2id" }))'` and
   paste; never hash at build time), and `EXPECTED` (the counts of §3's last paragraph plus the legacy
   row count per table per source). Also the expected decisions per finance household and the
   expected solo / trap facts.
3. `build.ts`: `export async function buildLegacyFixtures(outDir: string): Promise<{ recipeDb;
   financeDb; uploadsDir }>` — for each source: `createClient({ url: "file:<out>/<source>.db" })` (never
   H's `createDatabase`), `migrate(drizzle(client), { migrationsFolder })` from
   `drizzle-orm/libsql/migrator` on the copied folder (this writes `__drizzle_migrations` exactly as
   the source apps do), then the Table F rows as plain parametrised INSERTs (FK-consistent; libSQL
   enforces FKs), then `VACUUM`, close. Writes `uploads/` files from fixed byte arrays. `export async
   function dumpDatabase(path): Promise<string>` (JSON of `sqlite_master` SQL plus every table's rows
   ordered by rowid). CLI: no argument → build into `apps/api/test/fixtures/legacy/` (overwriting the
   two DBs and `uploads/`); `--check` → build into `mkdtemp` and compare `dumpDatabase` of each DB and
   the bytes of each upload with the committed ones; exit 1 with the first difference.
4. Build once and commit `recipe.db`, `finance.db`, `uploads/*`. `.gitignore`: add
   `!apps/api/test/fixtures/legacy/*.db` after the `*.db` line (with a one-line comment). No `-wal` /
   `-shm` file may be committed.
5. `apps/api/test/legacy-fixtures.test.ts`: (a) a fresh build into a temp dir dumps equal to the
   committed DBs and uploads; (b) each committed DB's `__drizzle_migrations` has the count and last
   `created_at` of §1.2; (c) the committed DBs hold `EXPECTED` row counts per table; (d) the traps hold
   (gina's F id = cleo's R id; FH3's id = G2's id; FH4's only member sits in slot 2; FH4's
   `created_by` is fritz, who is not a member of FH4; FH4's plan `payer_id` is fritz; exactly one FH4
   income names fritz; FH5 has no members);
   (e) the fixture DBs are in rollback-journal mode (`PRAGMA journal_mode` = `delete`).

**Files.** `apps/api/test/fixtures/legacy/**` (migrations/, `README.md`, `facts.ts`, `build.ts`,
`recipe.db`, `finance.db`, `uploads/*`), `apps/api/test/legacy-fixtures.test.ts`, `.gitignore`.

**Acceptance.** The SQL and journal copies are byte-identical to the sources; `build.ts --check`
exits 0 on the committed tree and 1 after any edit of a fixture row; the fixture test passes; both DBs
are tracked by git; total fixture size under 1 MB.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/api/test/legacy-fixtures.test.ts`;
`cd H && bun run apps/api/test/fixtures/legacy/build.ts --check`;
`cd H && diff -r -x '*_snapshot.json' /home/erics/software/toon-recipe/apps/api/drizzle apps/api/test/fixtures/legacy/migrations/recipe`;
`cd H && diff -r -x '*_snapshot.json' /home/erics/software/toon-finance/apps/api/drizzle apps/api/test/fixtures/legacy/migrations/finance`;
`cd H && ! git check-ignore -q apps/api/test/fixtures/legacy/recipe.db && ! git check-ignore -q apps/api/test/fixtures/legacy/finance.db`.

---

### M5-T02 — Migration framework: snapshots, schema gate, ledger, chunked copier, report (core)

**Goal.** The library every step uses (decisions 3–8, 15; types of §1.6), with unit tests on temp
file databases, and the removal of the manifest placeholder (decision 2).

**Read.** This plan §1.1, §1.5 (all decisions; 3, 4, 5, 7, 8, 15 in detail), §1.6, §2 (ledger key
column); `H/apps/api/src/db/{client,migrate}.ts`, `schema/core.ts` (`legacyIds`), `scripts/migrate.ts`;
`H/apps/api/test/finance-file-db.test.ts` (temp `file:` DB pattern); `H/apps/api/src/modules/types.ts`;
drizzle's `getTableConfig` (`drizzle-orm/sqlite-core`); `@libsql/client` `batch`, `InStatement`.

**Work.**
1. `types.ts` exactly as §1.6.
2. `sources.ts`: `LEGACY_SCHEMAS = { recipe: { migrations: 9, lastCreatedAt: 1788859780811, lastTag:
   "0008_shopping_bought" }, finance: { migrations: 2, lastCreatedAt: 1787307431957, lastTag:
   "0001_material_nebula" } }`; `snapshotDatabase(src, dest)` (refuses a missing path or a directory
   with `LegacyInputError`; copies `src` and `src-wal` when present, never `-shm`); `openLegacy` (snapshot
   into `<scratch>/<source>.db`, plain `createClient`, `PRAGMA query_only = 1`, schema gate of
   decision 4 with its message, `LegacyDb` result); `readAll`. `LegacyInputError` carries
   `exitCode = 2`.
3. `ledger.ts` and `copy.ts` per §1.6 and decisions 7–8 (keyset by `rowid`; prefetch the chunk's
   ledger entries with `lookupMany`; key-set assertion against `columnNames(target)`; one
   `client.batch([...rowInserts, ...ledgerInserts], "write")` per chunk; per-row fallback; counts).
4. `report.ts` per decision 15 (aligned plain-text tables; `renderProposal` renders `decisions` as
   the table `Finance household | Members | Decision | Target household | Reason`; `renderReport`
   includes it under its heading; empty sections print `(none)`).
5. `apps/api/src/modules/types.ts`: delete `LegacyMigrator` and `legacyMigration` (doc comment of
   the deleted block not kept); nothing else changes.
6. `apps/api/test/legacy-framework.test.ts` (temp dirs only): (a) `snapshotDatabase` of a WAL DB
   whose rows live only in the WAL (create it with `createClient`, `PRAGMA journal_mode = WAL`,
   insert, keep the WAL) yields a copy with all rows, and the source's main and `-wal` bytes are
   unchanged (sha256); (b) `openLegacy` refuses a DB whose `__drizzle_migrations` has fewer rows or an
   older last `created_at` (`LegacyInputError`, message names N of 9) and accepts one whose table
   has 9 rows ending at `1788859780811` (build both by hand in a temp file: T01's fixtures land in the
   same wave, T03 covers them), and a write on the opened copy fails (`query_only`); (c) `copyTable` of a toy legacy table
   (`people(id, email, name, created_at)` in a temp legacy file) into the target's `users` with
   `chunkSize: 2` over 5 rows writes 5 rows and 5 ledger rows in 3 batches; a second run writes 0 and
   counts 5 already migrated; (d) a row whose transformed `email` duplicates an existing user fails
   alone: 4 written, 1 skipped with `error: true` and a `UNIQUE` reason, no ledger row for it;
   (e) a transform that omits a target column throws (programming error); (f) `renderReport` of a
   hand-built report contains every heading of decision 15 in order and the right final line for
   each of the five cases; `exitCodeFor` is 1 with an error, 0 without.

**Files.** `apps/api/scripts/legacy/{types,sources,ledger,copy,report}.ts`,
`apps/api/src/modules/types.ts`, `apps/api/test/legacy-framework.test.ts`.

**Acceptance.** Tests pass; `import-order.test.ts` and `modules.test.ts` unchanged and green; the
LegacyMigrator grep (section 4) finds nothing; `types.ts` imports `Database` with `import type`.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/api/test/legacy-framework.test.ts`;
`cd H && bun test apps/api/test/import-order.test.ts apps/api/test/modules.test.ts`;
`cd H && bash -c '! grep -rnE "LegacyMigrator|legacyMigration" apps/api/src'`.

---

### M5-T03 — Users: union by e-mail, collision rule, auth rows (build)

**Goal.** `migrateUsers(ctx)`: Table M rows 1–5, decision 9, the users part of the report and the
"Not migrated by design" counts of `sessions` (both) and F's `password_reset_tokens`; plus the test
harness the later tasks share.

**Read.** This plan §1.5 decisions 7–9, 12, §1.6, §2 rows 1–5, §3; SPEC §4 (users row), §6.2, D4;
R/CLAUDE.md on `email_verified_at` ("the boolean alone is NOT evidence") and OAuth explicit linking;
`H/apps/api/src/db/schema/core.ts` (`users` comments); `H/apps/api/src/core/services/auth/users.ts`
(lower-casing); `H/apps/api/src/lib/uploadUrls.ts` (`normalizeStoredUploadUrl`); T01's `facts.ts`;
T02's library.

**Work.**
1. `apps/api/test/support/legacy-harness.ts`: `createLegacyRun({ mode?, mapping?, chunkSize?,
   withUploads? })` → copies the committed fixtures into a fresh `mkdtemp` dir, `openLegacy` both,
   creates the target with `createDatabase({ url: "file:<tmp>/target.db" })` + `runMigrations`, an empty
   `<tmp>/uploads-target`, a context (`ids` empty maps, `createReport`), and `cleanup()` (closes the
   clients, removes the temp dir). Also `sha256File(path)` and `countRows(client, table)`.
2. `apps/api/scripts/legacy/users.ts`: `migrateUsers(ctx)` — read both `users` tables, union by the
   normalised e-mail, decide per decision 9 (ledger first: a mapped user only fills `ctx.ids`; then the
   e-mail match, ONLY onto a target row with `email_verified_at` set, an unverified one is the error of
   decision 9; then the id, checked against the in-run claimed set AND the DB, all R users before any
   F-only user; never catch a PK error to re-key), write
   with `writeEntries` (one row, one or two ledger entries), record collisions and warnings, fill
   `ctx.ids.users.{recipe,finance}`. `active_household_id` of an R user is the R `active_group_id`
   value as is (group ids are kept; T05 never changes it). Then `copyTable` for R's `oauth_accounts`,
   `password_reset_tokens`, `email_verification_tokens` (`user_id` through the map). Then the
   `notMigrated` entries (counts from the legacy DBs).
3. `apps/api/test/legacy-users.test.ts` (fixtures via the harness): 7 users; anna's target id = her R
   id, `Bun.password.verify("recipe-pass-anna", hash)` true and `finance-pass-anna` false; ben's hash
   NULL and his collision has `passwordFrom: "none"` with the note; emil verifies
   `finance-pass-emil`, `email_verified` 0, `email_verified_at` NULL, locale = F's; cleo stays
   unverified; gina got a fresh id (≠ cleo's) with a warning, and `ctx.ids.users.finance` maps gina's F
   id to it; anna's `avatar_url` is the bare `/uploads/<avatar>.png`; 4 collisions; oauth/token rows
   copied with mapped user ids; `notMigrated` lists sessions (R 1, F 1) and F's reset tokens (1); a
   second `migrateUsers` on the same target writes 0 rows and fills the same maps; a target that
   already holds `anna@example.test` (inserted by the test first) maps both of anna's legacy ids onto
   it with the "matched an existing account" warning and writes no anna row (that pre-inserted row has
   `email_verified_at` set); a target that already holds `dana@example.test` with `email_verified_at`
   NULL and `email_verified` 1 (the boolean alone is not evidence) is NOT matched: dana's R and F
   users are skipped with `error: true`, `report.errors` contains "unverified target account
   dana@example.test blocks the merge", no dana user row and no `users` ledger entry for her legacy
   ids is written, the pre-inserted row is unchanged and `exitCodeFor` is 1; with the default
   `chunkSize` (cleo and gina land in one batch) gina is WRITTEN with a fresh id, cleo keeps her R id,
   and `report.skipped` has no `users` row at all.

**Files.** `apps/api/scripts/legacy/users.ts`, `apps/api/test/support/legacy-harness.ts`,
`apps/api/test/legacy-users.test.ts`.

**Acceptance.** Tests pass; the users counts and collisions match `facts.ts`; no code path catches a
PRIMARY KEY error to pick a new id.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/legacy-users.test.ts apps/api/test/legacy-framework.test.ts apps/api/test/legacy-fixtures.test.ts`.

---

### M5-T04 — Household mapping proposal and `--mapping` (pure) (core)

**Goal.** The decision function of decision 10, the mapping validator and the mapping-file parser,
pure and exhaustively unit-tested; no database.

**Read.** This plan §1.5 decision 10, §1.6 (`HouseholdDecision`, `DecisionReason`,
`MappingOverride`); SPEC D12, §6.3; ADR 0004 (slot 1 anchors the balance).

**Work.**
1. `apps/api/scripts/legacy/mapping.ts`:
   ```ts
   export interface GroupInfo { id: string; name: string; createdAt: number; memberIds: string[]; recipeCount: number }
   export interface FinanceHouseholdInfo { id: string; name: string; createdAt: number; createdBy: string;
     members: { userId: string; slot: 1 | 2; displayName: string; joinedAt: number }[] }
   export interface ProposalEntry { financeHouseholdId: string; decision: "merge" | "new" | "skip";
     groupId?: string; reason: DecisionReason; addMembers: string[] /* user ids */ }
   export class MappingError extends Error { readonly exitCode = 2 }
   export interface KnownIds { groupIds: Set<string> /* R groups.id */; financeIds: Set<string> /* F households.id */ }
   export function validateMappingOverride(override: MappingOverride, known: KnownIds): void // throws MappingError
   export function parseMappingFile(text: string, known: KnownIds): MappingOverride // JSON + shape, then validateMappingOverride
   export function proposeHouseholdMapping(groups: GroupInfo[], finance: FinanceHouseholdInfo[],
     options?: { override?: MappingOverride; alreadyMapped?: Map<string, string /* target id */> }): ProposalEntry[]
   ```
   All user ids are UNIFIED ids (after T03's maps); group ids (`GroupInfo.id`, override values,
   `ProposalEntry.groupId`) and finance household ids are LEGACY ids (decision 10, "Where the mapping
   checks live"). `validateMappingOverride` holds every id and duplicate check; `parseMappingFile`
   only parses (invalid JSON, a top-level key other than `finance`, `finance` not an object) and
   then calls it, so the file path and the raw-object path cannot disagree. Output order = input
   order of `finance`. Pure: no I/O, no `Date`.
2. `apps/api/test/legacy-mapping.test.ts`: only-group; most-recipes over two; tie (equal recipes →
   oldest group, reason `tie-oldest`); no-group → new; solo member in one group → merge; zero members →
   skip; two finance households qualifying for the same single group → the older merges, the other
   `group-taken` → new; two qualifying for G1 and G2 → the second falls back to G2 (`most-recipes`
   among the rest); override to a group lacking a member → `mapping` + `addMembers`; override `"new"`;
   override entries are processed first and take their group before proposals; `alreadyMapped` wins
   over an override (a warning is the caller's job: the entry carries reason `already-migrated`);
   `parseMappingFile` errors: invalid JSON, extra top-level key, unknown finance id, unknown group id,
   non-string value, two entries naming one group — each `MappingError` with a message naming the
   offending id; `validateMappingOverride` on raw objects: unknown finance id, unknown group id,
   non-string value and two entries naming one group each throw `MappingError` with the same message
   as through `parseMappingFile`, two `"new"` entries are accepted, an empty override is accepted.

**Files.** `apps/api/scripts/legacy/mapping.ts`, `apps/api/test/legacy-mapping.test.ts`.

**Acceptance.** Tests pass; `validateMappingOverride` is exported and `parseMappingFile` calls it; the
proposal function is deterministic (same inputs in any array order of `groups`
give the same result).

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/api/test/legacy-mapping.test.ts`.

---

### M5-T05 — Households, members, invites, modules, participants, settings, ADR 0005 (core)

**Goal.** `migrateHouseholds(ctx)`: Table M rows 6–14 and decisions 10–11 on the database, the
proposal in the report, F's `invites` in "Not migrated by design"; ADR 0005 and its SPEC sentences.

**Read.** This plan §1.5 decisions 7, 8, 9 (the claimed-id set), 10 (incl. "Where the mapping checks
live"), 11, 14 (plan payers and income persons), §1.6, §2 rows 6–14, §3; SPEC D1, D2, D3, §4
(households, household_members, household_invites, household_modules rows), §6.3, §6.4; ADRs 0001–0004
(shape and wording; 0004 in detail); H/CLAUDE.md "A `household_modules` row is the enabled state",
"Participants and the gate", "Enabling finance needs two participants", "A seated participant cannot
leave while the ledger has rows"; `F/apps/api/src/services/households/households.service.ts` (lines
40-80: the creator takes slot 1 and becomes the plan payer) and `members.service.ts` `removeMember`
(lines 168-183: only a leaver who paid is refused); `H/apps/api/src/modules/finance/{schema,setup}.ts`
(`finance_participants`, `finance_settings`, why `ensureFinanceHousehold` covers a later enable);
`H/apps/api/src/core/services/households/modules.ts` (what `initializeHousehold` would do, and why the
migration does not call it); T02's library, T03's `users.ts` and harness, T04's `mapping.ts`
(`validateMappingOverride`, `proposeHouseholdMapping`).

**Work.**
1. `apps/api/scripts/legacy/households.ts`: `migrateHouseholds(ctx)`, in exactly this order; nothing is
   written before step c:
   a. **Validate.** If `ctx.mapping` is set, `validateMappingOverride(ctx.mapping, known)` with `known`
      read from the legacy snapshots (R `SELECT id FROM groups`, F `SELECT id FROM households`). A
      `MappingError` propagates before any write (and before any target read).
   b. **Propose (reads only).** Build `GroupInfo[]` from R `groups` + `group_members` (`id` = the R
      group id, member ids through `ctx.ids.users.recipe`, recipe counts from R `recipes`) and
      `FinanceHouseholdInfo[]` from F `households` + `household_members` (through
      `ctx.ids.users.finance`); load `alreadyMapped` from the ledger (`loadAll(households, finance)`);
      call `proposeHouseholdMapping(…, { override: ctx.mapping, alreadyMapped })`. The proposal uses
      legacy group ids only, so it needs nothing from step c.
   c. **Recipe households.** R `groups` → `households` (id-taken rule with an in-run claimed set of
      household ids, as decision 9 does for users), fill `ctx.ids.households.recipe`; `group_members`
      → `household_members`; `group_invites` → `household_invites`; `household_modules` `recipe` per
      group household (`writeEntries`, ledger key `<G.id>`).
   d. **Decisions.** Push one `HouseholdDecision` per proposal entry (group ids translated through
      `ctx.ids.households.recipe`, e-mails and names resolved) and a warning per ignored override.
      Per entry: `new` → household row (id-taken rule; the claimed set already holds the ids of step
      c, which is what re-keys FH3) + members (decision 10 roles: FH4's owner is gina, its `created_by`
      fritz's unified id); `merge` → ledger-only decision row + `addMembers` rows (`member`); `skip` →
      nothing (T07 skips its rows). Fill `ctx.ids.households.finance` for merge and new.
   e. **Finance seats.** Per merged/new household: `finance_participants` (slot re-seat rule of
      decision 11), `finance_settings`, `household_modules` `finance`; the solo warning.
   f. Finance-only users' `active_household_id` UPDATE (decision 11, `IS NULL` guard; counted as
      written only when a row changed).
   g. `notMigrated`: F `invites` count.
2. **ADR 0005** `docs/adr/0005-legacy-migration-ledger-states.md` (date 2026-10-15, context, decision,
   consequences; the shape of 0001–0004), committed TOGETHER with this task's code and the SPEC edits
   below (H/CLAUDE.md: "the ADR edits the SPEC text in the same commit").
   - Context: toon-finance's own code produces ledger states H's runtime refuses while the ledger has
     rows. F's `removeMember` lets a member who never paid leave, so a two-person ledger with rows can
     shrink to one member, who may sit in slot 2; F's create path makes the creator the plan payer and
     F's leave path never moves the payer or an income's person. D2 says finance is enabled when its two
     slots are assigned (`onEnable` answers `422 finance_participants_required`); D3 and ADR 0004 refuse
     any slot change while the ledger has rows and re-seat a survivor only after an empty-ledger leave;
     M4 finding B requires the plan payer and an income's person to be participants.
   - Decision: the legacy migration, and only it, (1) writes the `finance` `household_modules` row for a
     household with ONE participant; (2) re-seats a lone slot-2 participant in slot 1 although the
     ledger has rows (slot 1 anchors the balance and must resolve; the move changes no identity, and
     decision 14's invariant is identity-based); (3) re-points a plan payer who is not a participant to
     the slot-1 participant (ADR 0004's leave rule applied to data that predates it); (4) keeps an
     income naming a non-participant, with a warning. Each case is a warning in the report, never an
     error. This is the smallest deviation available: refusing would leave real ledgers unmigratable,
     and `--mapping` cannot repair them.
   - Consequences: such a household behaves as ADR 0004's one-seat ledger (a booking that needs the
     other slot answers `409 conflict`; `PUT …/participants` seats the second participant because
     nobody leaves); the runtime rules (`onEnable`, `assignParticipants`, the plan service's
     participant checks) are unchanged; an income naming a non-participant keeps the plan
     `plan_incomplete` until an admin deletes or replaces it; `docs/migration.md` lists the four cases.
   - SPEC edits (only these; T10 owns the rest of the SPEC): D2's last sentence gains "(a household
     migrated from a one-person toon-finance ledger keeps its one seat, ADR 0005)"; D3 gains one sentence
     "The legacy migration re-seats a lone slot-2 participant in slot 1 and re-points a plan payer who is
     not a participant to slot 1 (ADR 0005)."; §6 step 4 gains "a one-member finance household keeps
     one seat, in slot 1 (ADR 0005)".
3. `apps/api/test/legacy-households.test.ts` (harness, after `migrateUsers`): 5 households with the
   ids of `facts.ts` (FH3 got a fresh id ≠ G2's); decisions equal `facts.ts`; G1's members unchanged
   (FH1 merged, nobody added); FH3's household: emil `owner`, fritz `member`; FH4: gina `owner`,
   `households.created_by` = fritz's target id, seat slot 1 (re-seated), solo warning; FH5 skipped
   `no-members`; `household_modules` = recipe ×3 + finance ×4 (FH4' included, with one seat) and none
   `recipe` on FH3'/FH4'; participants 7 with F's display names and `joined_at`; `finance_settings` 4
   with F's locales; emil/fritz/gina have `active_household_id` set, anna keeps G1; a second run writes
   0 rows and produces the same decisions with reason `already-migrated`; a run with `mapping = { FH2:
   G1 }` adds dana to G1 as `member` and reports `addMembers`. **Mapping rejected before any write:**
   the test passes a RAW `MappingOverride` (`createLegacyRun({ mapping: { [FH1]: G1, [FH2]: G1 } })`,
   then `migrateUsers`, then `migrateHouseholds`; the file path through `parseMappingFile` is T04's and
   T08's test): `migrateHouseholds` throws `MappingError`, and the row counts of `households`,
   `household_members`, `household_invites`, `household_modules`, `finance_participants`,
   `finance_settings` and `legacy_ids` are equal after the call to before it; the same with an unknown
   finance id (`{ "no-such-id": "new" }`).

**Files.** `apps/api/scripts/legacy/households.ts`, `apps/api/test/legacy-households.test.ts`,
`docs/adr/0005-legacy-migration-ledger-states.md`, `docs/SPEC.md` (the three sentences of Work 2 only).

**Acceptance.** Tests pass; no household-creation hook of the modules runs (no finance categories
exist after this step: `finance_categories` count 0); `migrateHouseholds` writes nothing before its
proposal exists; ADR 0005 and the SPEC D2/D3/§6.4 sentences are in this task's commit.

**Verify.** `cd H && bun run typecheck`;
`cd H && bun test apps/api/test/legacy-households.test.ts apps/api/test/legacy-users.test.ts apps/api/test/legacy-mapping.test.ts`;
`cd H && test -f docs/adr/0005-legacy-migration-ledger-states.md && grep -q "ADR 0005" docs/SPEC.md`.

---

### M5-T06 — Recipe module rows and the uploads copy (build)

**Goal.** `migrateRecipe(ctx)` (Table M rows 15–31 + the fold backfill call) and
`migrateUploads(ctx)` (decision 13).

**Read.** This plan §1.5 decisions 7, 8, 12, 13, §2 rows 15–31, §3; SPEC §4 (recipe module and
uploads paragraph), §6.5; R/CLAUDE.md: the fold columns gotcha, "`/uploads/:filename` needs a
signature", the thumbnail paragraph (`<name>.thumb.webp`), the shopping-list `mutationId` rule (why
`shopping_mutations` is copied); H/CLAUDE.md "Fold columns and the backfill", "Uploads are signed,
not cookie-checked"; `H/apps/api/src/modules/recipe/{schema,migrate}.ts`;
`H/apps/api/src/core/services/media/{references,thumbnails}.ts`; `H/apps/api/src/lib/uploadUrls.ts`;
`H/apps/api/test/support/files.ts` (why tests never touch `env.uploadDir`); T02–T05 code and the
harness.

**Work.**
1. `apps/api/scripts/legacy/recipe.ts`: one `CopySpec` per row 15–31 in Table M order, transforms
   built from `renameColumns` + the maps + `normalizeStoredUploadUrl` + `foldText`; composite ledger
   keys for rows 19 and 21; after the copies `const filled = await backfillFoldedColumns(ctx.target.db)`
   and a warning if `filled > 0`.
2. `apps/api/scripts/legacy/uploads.ts`: `collectLegacyUploadReferences(recipe)` (filenames via
   `filenameOf` over the six sources of decision 13) and `migrateUploads(ctx)` filling
   `report.uploads` (`copy: false` fills `wouldCopy`, never touches the target dir).
3. `apps/api/test/legacy-recipe.test.ts` (harness, after users + households): per-table counts equal
   `facts.ts`; recipe ids and `household_id`s kept; folds equal `foldText` (the "Äpfel" ingredient's
   `name_fold`); the signed avatar and the group image are bare `/uploads/…`, the external hero URL is
   untouched; cards belong to the mapped users; the draft's JSON is byte-equal; uploads with
   `copy: true` → 7 files in the temp target with equal sizes, `<hero>.jpg.thumb.webp` included,
   `missingReferenced` = [`<missing>.jpg`]; a pre-existing target file with a different size is a
   conflict error and keeps its bytes; with `copy: false` the target dir stays empty and `wouldCopy`
   is 7; a second run of both steps writes 0 rows and copies 0 files (`alreadyPresent` 7);
   `backfillFoldedColumns` returned 0.

**Files.** `apps/api/scripts/legacy/{recipe,uploads}.ts`, `apps/api/test/legacy-recipe.test.ts`.

**Acceptance.** Tests pass; `env.uploadDir` is never written (the test asserts its file list is
unchanged).

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/api/test/legacy-recipe.test.ts`;
`cd H && bun test apps/api/test/legacy-`.

---

### M5-T07 — Finance ledger rows and the balance invariant (build)

**Goal.** `migrateFinance(ctx)` (Table M rows 32–40) and `verifyBalances(ctx)` (decision 14), with
the balance invariant test.

**Read.** This plan §1.5 decisions 7, 8, 10, 11, 14 (incl. "Plan payers and income persons"), §2
rows 32–40, §3; ADR 0005 (T05); `F/apps/api/src/services/households/households.service.ts` lines 72-80
and `members.service.ts` lines 168-183 (why non-participant payers and incomes exist in F data);
`H/apps/api/src/modules/finance/services/plan/period-scan.ts` (`isPlanComputable`: why such an income
is harmless); SPEC D3, D13, §4 (finance module paragraph), §6.6; F/CLAUDE.md gotchas 31–33 (`halfForOther`, per-transaction halving, plan
rounding), 35 (booked periods immutable: the copy keeps `plan_period` and `last_booked_period`), 36–38
(`expectedBalanceCents`, the balance sign, `viewerBalanceCents`), 9/10/46 (`mutation_claims`: why
claims are copied), 37 (`origin` has no default), 45 (`isPeriodBooked`); `F/docs/ledger-spec.md` §2.3
and §6.6 (`sammelbuchung`); H/CLAUDE.md "Finance TS identifiers carry a `finance` prefix", "Plan
payer and income person must be participants"; `H/apps/api/src/modules/finance/schema.ts`,
`services/ledger/{balance.service,aggregateExclusion}.ts`, `services/participants/participants.service.ts`
(`slot1UserId`); `packages/shared/src/modules/finance/ledger.ts`; T02–T05 code and the harness.

**Work.**
1. `apps/api/scripts/legacy/finance.ts`: one `CopySpec` per row 32–40 (aliased imports, e.g.
   `import { financeTransactions } from "../../src/db/schema.ts"`); a row whose F household is not in
   `ctx.ids.households.finance` is skipped with the decision's reason (`error: false` for a `skip`
   decision, `error: true` otherwise); `transaction_tags` follow their transaction (precompute the
   skipped transaction ids from the legacy DB); `fixed_cost_plans` ledger key = F household id. The `fixed_cost_plans` transform reads the
   household's TARGET participants (written by T05) and re-points a `payer_id` (after the user map)
   that is not one of them to the slot-1 participant, with decision 14's warning; the `incomes`
   transform keeps a `person_id` (after the user map) that is not a participant and records decision
   14's warning: no skip, no error.
2. `apps/api/scripts/legacy/balance.ts`: `legacyBreakdown(finance, financeHouseholdId,
   person1LegacyId)` (pure over F rows with `computeBreakdown`), `verifyBalances(ctx)` filling
   `report.balances` and `report.errors` per decision 14, plus the after-copy check that every migrated
   plan payer is a participant of its household (an error there means the transform is wrong);
   incomes naming a non-participant are not errors.
3. `apps/api/test/legacy-finance.test.ts` (harness, users + households + finance):
   - counts per table equal `facts.ts`; FH5's plan row is skipped with "no members", `error: false`;
     categories keep `is_system` / `is_hidden` as 0/1; the `-101` transaction and its `SPLIT_EQUAL` mode
     are intact; the `sammelbuchung` tag and its link exist; the plan's `enabled` and
     `last_booked_period` are F's; `mutation_claims` keep their `transaction_id`.
   - **Balance invariant** (`describe("balance invariant")`): for each of FH1–FH4 the test computes
     the legacy balance ITSELF from the fixture DB with `computeBreakdown` (independent of
     `balance.ts`) and asserts it equals `getBalance(target.db, hh, slot1, 1, true).balanceCents` and
     equals `verifyBalances`'s row; all four rows `ok`; FH4's comparison uses gina (re-seated) as
     person 1; `getBalance(…, false)` (aggregates excluded) differs from it for FH1 exactly by the
     `sammelbuchung` row's delta.
   - Tamper: change one migrated `finance_transactions.amount_cents` in the target, run
     `verifyBalances` again → that household `FAIL`, one error, `exitCodeFor` = 1.
   - **Non-participants (decision 14, ADR 0005):** FH4''s `finance_fixed_cost_plans.payer_id` is
     gina's target id (F had fritz) and `report.warnings` contains the re-point warning naming FH4;
     FH4's income that names fritz exists in `finance_incomes` with `person_id` = fritz's target id,
     and a warning names it; after the whole finance step `report.errors` is empty and `exitCodeFor`
     is 0; then setting the migrated FH4 plan's `payer_id` to fritz's target id in the target and
     running `verifyBalances` again records exactly one error.
   - A second `migrateFinance` writes 0 rows.

**Files.** `apps/api/scripts/legacy/{finance,balance}.ts`, `apps/api/test/legacy-finance.test.ts`.

**Acceptance.** Tests pass, the balance invariant describe block included; the fixture run has no
error from FH4's departed payer or its income; no finance service file changes.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/api/test/legacy-finance.test.ts`;
`cd H && bun test apps/api/test/legacy-`; `cd H && bun test apps/api/test/finance`.

---

### M5-T08 — Orchestrator, CLI, package scripts, end-to-end and subprocess tests (build)

**Goal.** `runLegacyMigration` wiring the steps, the CLI of decisions 5, 6, 15, 16, the
`migrate:legacy` scripts, and the tests that prove the exit criteria on the fixtures.

**Read.** This plan §1.5 decisions 3–7, 15–18, §1.6; SPEC D12, §6 (CLI line), §7; `H/apps/api/scripts/
{migrate,finance-import-xlsx}.ts` (bootstrap, `import.meta.main`, argv style), `H/apps/api/test/
finance-import-xlsx.test.ts` (the subprocess test near line 575); `H/apps/api/src/env.ts`
(`REPO_ROOT`, `loadRootDotEnv`, `resolveDatabaseUrl`, the `NODE_ENV=test` override, `uploadDir`: READ
them to mirror their rules, never import the file from the CLI); H/CLAUDE.md "API import cycle" and
`apps/api/test/import-order.test.ts`; `H/package.json`, `apps/api/package.json` (how `uploads:gc` /
`finance:import-xlsx` forward args); T02–T07 code.

**Work.**
1. `apps/api/scripts/legacy/run.ts`: `runLegacyMigration(options: { mode; recipe?; finance?;
   target; uploads; mapping?; chunkSize? }): Promise<Report>` — creates the context and report, fills
   `report.inputs`, runs `migrateUsers` → `migrateHouseholds` → `migrateRecipe` (if recipe) →
   `migrateUploads` (if `uploads.sourceDir`) → `migrateFinance` (if finance) → `verifyBalances`;
   returns the report. Before `migrateUsers` it calls `validateMappingOverride(options.mapping,
   known)` (known ids from the opened legacy DBs) when a mapping is given, so an in-process caller with
   a bad raw override writes nothing either. A `MappingError` / `LegacyInputError` propagates (the CLI
   maps it to exit 2).
2. `apps/api/scripts/migrate-legacy.ts`, in exactly this order. Statically it imports only `node:`
   builtins and types; it NEVER imports `src/env.ts` (statically or dynamically, before or after the
   redirect: decision 5); no dynamic import happens before step c's redirect.
   a. `const REPO_ROOT = resolve(import.meta.dir, "../../..")`, computed here (not env.ts's export);
      argv parsing (decision 16; `--help` prints the usage block that `docs/migration.md` quotes);
      input paths resolved against `REPO_ROOT`; usage validation (exit 2; `--mapping` without
      `--finance-db` included).
   b. `resolveCliEnv(process.env, REPO_ROOT)` (exported; decision 16's `.env` policy): `DATABASE_URL`
      required and `file:` only, absolute `uploadDir`; exit 2 with decision 16's message otherwise.
      Header lines `[migrate:legacy] mode: dry-run (nothing is written to <target>)` or
      `[migrate:legacy] mode: apply (target <target>)`, then `[migrate:legacy] uploads: <dir>`.
   c. Scratch dir (`mkdtemp`); snapshot the target (`<db>` and `<db>-wal` when present, never `-shm`)
      into `<scratch>/target.db`, or start from nothing when it does not exist; then
      `process.env.DATABASE_URL = "file:<scratch>/target.db"` and `process.env.SESSION_SECRET ||=` a
      placeholder.
   d. Dynamic imports, in this order: `../src/db/client.ts`, `../src/db/migrate.ts` (the order of
      `scripts/migrate.ts`; decision 5 "Import order"), then `./legacy/sources.ts`, `./legacy/mapping.ts`,
      `./legacy/report.ts`, `./legacy/run.ts`.
   e. `openLegacy` of each input (exit 2 on `LegacyInputError`); if `--mapping` is given, read the file
      and call `parseMappingFile(text, known)` with `known` from the snapshots (`SELECT id FROM groups`,
      `SELECT id FROM households`). A `MappingError` exits 2 HERE, before pass 1, so nothing is written
      anywhere (not even to the scratch target).
   f. Pass 1 (decision 5): `runMigrations` on the scratch target, then `runLegacyMigration` with
      `uploads = { sourceDir, targetDir: uploadDir, copy: false }`; print `renderReport`; dry-run →
      exit by `exitCodeFor`.
   g. `--apply`: stop on errors (decision 6, `Nothing was written.`), else `createDatabase({ url:
      realTarget })`, `await ready`, `runMigrations(real.db)`, pass 2 with `uploads.copy = true` into
      `uploadDir` (the CLI's own value, never `env.uploadDir`), print its report.
   h. `--report <file>` writes `reportToJson` of the last pass; a `finally` closes every client and
      removes the scratch dir.
   The entry is `if (import.meta.main) await main();`, so importing the file runs nothing.
3. Scripts: `apps/api/package.json` `"migrate:legacy": "bun scripts/migrate-legacy.ts"`; root
   `package.json` `"migrate:legacy": "bun --filter @toon/api migrate:legacy --"` (after
   `finance:import-xlsx`).
4. `apps/api/test/import-order.test.ts`: add `./scripts/legacy/run.ts`, `./scripts/legacy/households.ts`,
   `./scripts/legacy/finance.ts` and `./scripts/legacy/balance.ts` to the entry list (each loads first
   in a fresh process under the file's existing `NODE_ENV=test` env, i.e. against `file::memory:`), with
   a comment naming M5. The subprocess cases below are the guard for the CLI's own order.
5. `apps/api/test/legacy-cli.test.ts`:
   - in-process `runLegacyMigration` on the harness: one full `apply` gives every `EXPECTED` count, 4
     balances OK, `exitCodeFor` 0; a second full run writes 0 rows and copies 0 files; a run with
     `chunkSize: 3` interrupted after the recipe step (call the steps up to `migrateRecipe`, then the
     full `runLegacyMigration`) completes with the same final counts (resume).
   - subprocess (`Bun.spawnSync`, cwd = repo root, env of decision 18, target and upload dir in a
     temp dir): (a) dry-run with the target absent → exit 0, stdout has `== Household mapping
     proposal ==`, the five decisions, `== Finance balance per household ==` with four `OK`, the dry-run
     final line, and the target file still does not exist and the upload dir is empty; the fixture
     files' sha256 are unchanged; (b) `--apply` → exit 0, `applied:` line, target holds 7 users;
     (c) second `--apply` → exit 0, stdout ends with `[migrate:legacy] already migrated: nothing
     written.`, target sha256 of `users` count etc. unchanged (compare `countRows` of every table);
     (d) dry-run against that migrated target → target main file sha256 unchanged, final line
     "already migrated, nothing would be written"; (e) `--mapping` naming one group twice → exit 2,
     target unchanged; (f) `--report <tmp>/r.json` → valid JSON with `balances.length === 4`;
     (g) `DATABASE_URL=libsql://example.invalid` → exit 2. In (a) and (d) also assert that no
     `<target>-wal` exists after the dry run (a dry run that touched the real target would leave one).
   - `resolveCliEnv` in-process (import `migrate-legacy.ts`; `import.meta.main` is false, so nothing
     runs): a temp dir as `repoRoot` with a `.env` holding `DATABASE_URL=file:./x.db` and
     `UPLOAD_DIR=./up`, and a process env without them → `file:<tmp>/x.db` and `<tmp>/up`; a
     process-env `DATABASE_URL` wins over `.env`; `.env.local` fills a key `.env` lacks; neither →
     the exit-2 error with decision 16's message; `libsql://…` → the exit-2 error; with `NODE_ENV:
     "test"` the `.env` is ignored; `process.env` is unchanged after every call.
   - Source guard (textual; the subprocess cases are the behavioural proof): in `migrate-legacy.ts` the
     first `import(` comes after `process.env.DATABASE_URL =`, the first dynamic import names
     `../src/db/client.ts`, and the file never contains `src/env`.
   Keep it to at most seven spawns (each runs the migrations).

**Files.** `apps/api/scripts/migrate-legacy.ts`, `apps/api/scripts/legacy/run.ts`,
`apps/api/test/legacy-cli.test.ts`, `apps/api/test/import-order.test.ts`, `apps/api/package.json`,
`package.json`.

**Acceptance.** Tests pass; the three exit-criteria commands of Verify pass by hand too.

**Verify.** `cd H && bun run typecheck`; `cd H && bun test apps/api/test/legacy-`;
`cd H && bash -c 'D=$(mktemp -d) && export NODE_ENV=development DATABASE_URL=file:$D/target.db UPLOAD_DIR=$D/uploads && F=apps/api/test/fixtures/legacy && bun run migrate:legacy -- --recipe-db $F/recipe.db --recipe-uploads $F/uploads --finance-db $F/finance.db > $D/dry.log 2>&1 && test ! -e $D/target.db && grep -q "Nothing was written" $D/dry.log && bun run migrate:legacy -- --recipe-db $F/recipe.db --recipe-uploads $F/uploads --finance-db $F/finance.db --apply > $D/apply1.log 2>&1 && grep -q "applied:" $D/apply1.log && bun run migrate:legacy -- --recipe-db $F/recipe.db --recipe-uploads $F/uploads --finance-db $F/finance.db --apply > $D/apply2.log 2>&1 && grep -q "already migrated: nothing written" $D/apply2.log'`;
`cd H && bash -c '! grep -nE "^import [^t].*from \"(\.\./src|\./legacy)/" apps/api/scripts/migrate-legacy.ts'`;
`cd H && bash -c '! grep -n "src/env" apps/api/scripts/migrate-legacy.ts'`;
`cd H && bun test apps/api/test/import-order.test.ts`.

---

### M5-T09 — `docs/migration.md` with the cutover order (build)

**Goal.** The operator's document for the one-off migration (SPEC §3 lists it; §6 "Cutover order").

**Read.** This plan §1 (all), §2, §3 (for the example output), decisions 3–16; SPEC D11, D12, §6, §9;
`R/docs/deployment.md` §11 "Erstes Backup" and the backup/rollback sections (the `docker run --rm -v
toon-recipe_toon-data:/data …` pattern); `R/docker-compose.yml` and `F/docker-compose.yml` (volume
`toon-data` at `/app/data`, `DATABASE_URL=file:/app/data/local.db`, R's `UPLOAD_DIR=/app/data/uploads`);
`/home/erics/software/toon-edge/README.md` (what is retired); H/CLAUDE.md "Obligations" (M6 owns
`docs/deployment.md` and the redirects).

**Work.** Write `docs/migration.md` (English, D15) with: purpose and scope (one-off, idempotent, not a
sync); what is migrated and what is not (Table M condensed; sessions, F invites, F reset tokens;
everyone logs in again); the user rule (decision 9, incl. the OAuth-only case, the "unverified target account <email>
blocks the merge" error and its fix (confirm or delete that account in the new app, run again), and
"finance-only accounts start unconfirmed: they confirm their address before writing when mail is
configured, or an admin runs `bun run auth:reset-password <email>`"); the household rule and the mapping file format
with an example; modules and participants (solo ledgers kept with one seat in slot 1, plan payers
who left re-pointed to slot 1, incomes naming a non-participant kept with a warning: the four cases of
ADR 0005; recipe not enabled on finance-only households, how to enable it); uploads; the report sections and final lines (decision 15) and exit
codes; **preparing the inputs** (`migration-in/` layout of §1.4; copying a volume WITH its `-wal`;
the schema-version error and its fix); where the target comes from (`DATABASE_URL` / `UPLOAD_DIR` in the process environment or the
repo's root `.env`, process wins; the header line shows the resolved target, decision 16); the
commands (dry-run, read the report, `--mapping`, `--apply`,
the second `--apply` that must say "already migrated"); what to do on a failure (nothing was written
on a failed dry pass; restore the target from the copy taken before `--apply` for a failed real
pass); **Cutover order** (SPEC §6 expanded with concrete commands: stop both old stacks with `docker
compose down` WITHOUT `-v`; copy `toon-recipe_toon-data` and `toon-finance_toon-data` out with
`docker run --rm -v <volume>:/data -v "$PWD/migration-in/<app>:/out" alpine cp -a /data/. /out/`;
dry-run; read; `--apply` into `migration-out/` (`DATABASE_URL=file:./migration-out/toon.db
UPLOAD_DIR=./migration-out/uploads`); copy the result into the new stack's volume; start the new stack;
verify both old hostnames redirect and the new site serves; then remove the old stacks and
toon-edge; keep the old volumes until the owner deletes them), with a note that M6's
`docs/deployment.md` "Cutover from toon-edge" links here and supplies the image/volume names of the
new stack. Mark the example output block "abridged, from the fixture run" (T10 replaces it with the
real one).

**Files.** `docs/migration.md`.

**Acceptance.** Every flag of decision 16 and every heading of decision 15 appears; the cutover order
has numbered steps in SPEC §6's order; no German prose (German appears only as quoted content, e.g.
a household name).

**Verify.** `cd H && test -f docs/migration.md`;
`cd H && bash -c 'for s in -- --recipe-db --recipe-uploads --finance-db --mapping --apply --report "== Household mapping proposal ==" "== Finance balance per household ==" "already migrated: nothing written" "Cutover order" "local.db-wal" "migration-in/" "unverified target account" "ADR 0005" ".env"; do grep -qF -- "$s" docs/migration.md || { echo "missing: $s"; exit 1; }; done'`.

---

### M5-T10 — Integration: gates, fixture and evidence runs, SPEC/CLAUDE sync (build)

**Goal.** Prove the exit criteria on the merged tree, run the evidence runs, fix what they find (each
fix its own commit with the failing check), and bring the docs in line.

**Read.** This whole plan; SPEC §6–§8; H/CLAUDE.md (all); the M4 plan's section 9 for the shape of
an integration record; T01–T09 commits.

**Work.**
1. Gates on the merged tree, each to a log ending in `exit=$?` under `data/m5-t10-*.log`:
   `bun install --frozen-lockfile`, `bun run typecheck`, `bun test`, `bun run build`, `bun run
   i18n:check` (parity OK; leftover hits stay 138 and stay classified: M5 adds no scanned file, so any
   new hit is a finding), `bun run db:migrate` + `bun run seed` (twice) on a fresh `file:` DB.
2. Fixture run by hand in a fresh `mktemp -d` (the three commands of T08's Verify, logs kept under
   `data/m5-t10-fixture-{dry,apply1,apply2}.log`), plus: a dry-run with `--mapping` mapping FH2 to G1
   (reads `addMembers` in the proposal), a run into a SEEDED target (`bun run seed` first: the demo
   household and the migrated ones coexist, no collision), and `bun run uploads:gc -- --dry-run` against
   the migrated target with `UPLOAD_DIR` set (only `orphan.png` is a candidate, and only once it is
   older than the minimum age: report what it says).
3. Owner data: if `migration-in/recipe/local.db` and/or `migration-in/finance/local.db` exist, run
   dry-run, `--apply` (into `migration-out/m5-owner/`) and a second `--apply`; the report must have no
   errors; record counts, decisions, balances and warnings (no names or amounts of real people in the
   committed record: counts, OK/FAIL and ids' first 8 characters only). If absent, write in section 9
   that no owner copy was available and that the fixtures and the dev-DB run are the evidence; the
   owner runs `docs/migration.md` at cutover.
4. Dev-DB evidence run (recipe-only): `cp -p R/data/local.db R/data/local.db-wal R/data/local.db-shm
   migration-in/dev-recipe/` and `cp -rp R/data/uploads migration-in/dev-recipe/uploads` (reading the
   source only; never open the files in `R/data/` themselves), then dry-run, `--apply`, second
   `--apply` with `--recipe-db migration-in/dev-recipe/local.db --recipe-uploads
   migration-in/dev-recipe/uploads` into `migration-out/m5-dev/`; record the report summary (counts,
   warnings, errors: must be none); then start the API on that target (`bun run start` in the
   background with a log ending `exit=$?`), `curl /api/health`, and compare the `recipe_recipes`,
   `households` and `users` counts with the legacy copy's `recipes`, `groups` and `users`; stop the
   API by its pid.
5. Docs: `docs/SPEC.md` §2 (delete the `legacyMigration?` line), §3 (`migrate-legacy.ts,
   legacy/{types,sources,ledger,copy,report,users,mapping,households,recipe,uploads,finance,balance,run}.ts`),
   §6 (the clarifications of section 7 below, written into the numbered steps; T05 already added the
   ADR 0005 sentence to step 4), §7 (the fixture path stays); `docs/migration.md` example output replaced by the real fixture dry-run excerpt and
   any flag/heading corrected; `CLAUDE.md`: Status (M5 done; next M6), "What exists" (the CLI, the
   library, the fixtures, test count), Layout (`apps/api/scripts/legacy/`, fixtures), Commands
   (`bun run migrate:legacy …`, replacing "Arrives later"), the ADR list (0005), Gotchas (inputs are
   snapshots incl. `-wal`; the CLI resolves `DATABASE_URL` / `UPLOAD_DIR` itself (process env, then the
   root `.env`), redirects `DATABASE_URL` before its first dynamic import, imports `src/db/client.ts`
   and `src/db/migrate.ts` first and never `src/env.ts`; the in-run claimed-id set; the verified-only
   e-mail match; subprocess tests need `NODE_ENV=development`;
   fixtures are rebuilt with `build.ts`, checked with `--check`, and `*.db` is un-ignored only there;
   the OAuth-only collision rule), "Not yet present" (drop `migrate:legacy`), Obligations (M5 closed;
   M6 links `docs/migration.md` from `docs/deployment.md`); this plan: status line, section 9
   (integration record: gate numbers, the runs, evidence statement), section 10 (what changed vs
   plan).
6. ADR 0005 exists (T05); check that its text matches what the code does after the fixes of this
   task (correct it in the commit that changes the behaviour). Any further deviation from SPEC §1 gets
   its own ADR in the same commit as the SPEC edit.

**Files.** `CLAUDE.md`, `docs/SPEC.md`, `docs/plans/m5-migration.md`, `docs/migration.md` (corrections
only), plus whatever file a found defect lives in (one commit per fix).

**Acceptance.** All gates green (`bun test` count = 1832 + the new legacy tests, 0 fail); the fixture
dry-run writes nothing, the apply migrates, the second apply says "already migrated: nothing
written"; the balance invariant holds in every run; section 9 records the evidence and says plainly
whether owner data was available.

**Verify.** `cd H && bun install --frozen-lockfile`; `cd H && bun run typecheck`; `cd H && bun test`;
`cd H && bun run build`;
`cd H && bash -c 'mkdir -p data && { bun run i18n:check > data/m5-i18n.log 2>&1; true; } && sed -n "/1\/2 German catalog parity/{n;p;}" data/m5-i18n.log | grep -qx "\[i18n:check\] OK"'`;
T08's three-command fixture check;
`cd H && grep -q "migrate:legacy" CLAUDE.md && grep -q "Status: DONE" docs/plans/m5-migration.md`;
`cd H && bash -c '! grep -nE "legacyMigration" docs/SPEC.md'`;
`cd H && test -f docs/adr/0005-legacy-migration-ledger-states.md && grep -q "0005" CLAUDE.md`.

## 6. Risks

1. **A copy of a WAL database without its `-wal` file silently loses data** (measured, §1.1). Mitigated
   by snapshotting both files (decision 3), the T02 test, and `docs/migration.md` telling the
   operator to copy the whole volume.
2. **Opening a legacy file mutates it** (a WAL checkpoint on close, a journal-mode pragma). Mitigated:
   only snapshots are opened, with a plain client and `query_only`; tests compare sha256.
3. **Importing H's db client opens `DATABASE_URL`.** The CLI redirects it to the scratch file before
   the first dynamic import; the CLI file has no static import of `../src` or `./legacy` (grep in
   section 4); T08's subprocess test proves the target does not even get created by a dry-run.
4. **FKs are enforced on the target**: a wrong step order or a missed id map fails inserts. The copier
   turns that into an error row instead of a crash, the fixture traps (gina's id, FH3's id) catch a
   step that uses raw ids, and the counts must equal `facts.ts`.
5. **The owner's data has shapes the fixtures lack** (long import drafts, many shopping rows, a solo or
   orphaned finance household, users with `active_group_id` pointing at a deleted group). The copier is
   column-set-checked and generic; the schema gate refuses an older schema; skipped rows carry
   reasons; the dev-DB run adds a second real shape. Real production copies remain the owner's run.
6. **Finance-only users start unconfirmed** (SPEC §4) and the ledger routes require a verified e-mail:
   such a participant can read but not book until confirmed (when mail is configured). Documented in
   `docs/migration.md` with the `auth:reset-password` fallback; not changed (D4).
7. **Two finance households wanting one group**, or a `--mapping` that changes between runs: handled by
   decision 10 (taken groups, ledger wins, warnings) and tested in T04/T05.
8. **Balance perspective**: a solo ledger whose member sat in slot 2 is re-seated; the invariant is
   identity-based (decision 14) so it still compares like with like.
9. **Fixture drift and nondeterminism** (salted argon2 hashes, timestamps): constants in `facts.ts`, the
   `--check` comparison of logical dumps, not of bytes.
10. **Test time**: subprocess runs each migrate a fresh DB; T08 caps them at seven.
11. **Owner data unavailable at build time** (likely: it lives in server volumes). The exit criterion is
    then met by the fixtures and the dev-DB run, and section 9 says so; the owner's run at cutover
    follows `docs/migration.md`.
12. **The CLI touching the real target during a dry run** through `env.ts` (frozen `databaseUrl`) or
    through a first import that differs from the proven order (TDZ in the session/modules cycle).
    Mitigated by decision 5 (the CLI resolves its environment itself, never imports `env.ts`, imports
    `client.ts` then `migrate.ts` first), the `src/env` grep, the source-order guard, the new
    `import-order.test.ts` entries and the subprocess assertions that no target file or `-wal` exists
    after a dry run.
13. **Legacy finance data in states the runtime refuses** (one member left, payer or income naming a
    leaver). Handled as warnings by ADR 0005 and decision 14, never as errors, because the operator
    cannot repair the read-only inputs; FH4 carries every case.
14. **A legacy identity merged into a stranger's unconfirmed account**: the e-mail match requires
    `email_verified_at` (decision 9); an unconfirmed match is an error the operator resolves.

## 7. Deviations expected (to be confirmed in "what changed vs plan")

- SPEC §2: `legacyMigration?: LegacyMigrator` leaves the module contract (decision 2); §3's
  `legacy/{recipe,finance}.ts` becomes the file list of decision 1. Not a §1 decision, no ADR.
- SPEC §6 clarifications (refinements, no contradiction of D12): inputs are read from snapshots;
  dry-run runs against a scratch copy of the target; `--apply` runs the dry pass first and writes only
  if it is clean; the collision password rule for OAuth-only recipe accounts (decision 9); the
  `no-members` skip and the `group-taken` fallback (decision 10); an e-mail match onto an existing
  target account only when it is confirmed (decision 9; D4's explicit-linking rule); exit codes 0/1/2;
  relative paths resolve against the repo root and the target comes from the process env or the root
  `.env` (decision 16); R's reset and verification tokens are copied. The slot-2 re-seat is no longer
  listed here: it is ADR 0005.
- **ADR 0005** (T05, D2/D3): the migration writes a `finance` row for a one-participant household,
  re-seats a lone slot-2 participant in slot 1 while the ledger has rows, re-points a plan payer who is
  not a participant to slot 1 and keeps incomes naming a non-participant (decisions 11 and 14). SPEC
  D2, D3 and §6 step 4 change in the same commit.
- No further ADR is expected. A task that has to deviate from SPEC §1 otherwise writes one
  (`docs/adr/0006-…`) and edits the SPEC text in the same commit.

## 8. Out of this milestone

- Dockerfile, compose, Caddyfile, `docs/deployment.md` with "Cutover from toon-edge" and the
  old-hostname/old-path redirects (M6; it links `docs/migration.md`); `docs/API.md`,
  `docs/modules/*.md` (M7).
- Migrating sessions, finance invites and finance reset tokens (SPEC §9); merging two finance ledgers
  into one household; the N-person ledger (D3).
- Syncing legacy edits made after the first apply (the tool never updates a mapped row); a remote
  (`libsql://`) target.
- Running anything against the owner's production servers; the owner's own cutover run.

**Obligations handed on.** M6: `docs/deployment.md` "Cutover from toon-edge" links `docs/migration.md`
and names the new stack's volume and image for the copy-in step; the redirects of H/CLAUDE.md's M6
list. M7: `docs/API.md` notes that migrated finance-only accounts start unconfirmed.

## 9. Integration record

(Written by M5-T10.)

## 10. What changed vs plan

(Written by M5-T10.)
