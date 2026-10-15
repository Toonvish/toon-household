# Migrating toon-recipe and toon-finance into toon-household

This is the operator's guide to `bun run migrate:legacy`, the one-off tool that moves the data of the
two old apps into the household database. It is written for the person doing the cutover. The design
behind it is in `docs/SPEC.md` (D11, D12, §6, §9), the decision record for the odd ledger states is
`docs/adr/0005-legacy-migration-ledger-states.md`, and the plan is `docs/plans/m5-migration.md`.

Contents: [Purpose and scope](#purpose-and-scope) · [What is migrated](#what-is-migrated-and-what-is-not) ·
[The rules](#the-rules) · [Preparing the inputs](#preparing-the-inputs) · [Where the target comes from](#where-the-target-comes-from) ·
[Commands](#commands) · [The report](#the-report) · [Failures](#when-something-fails) · [Cutover order](#cutover-order)

## Purpose and scope

- **One-off and re-runnable, not a sync.** The tool reads the two old libSQL files and the recipe
  uploads directory and writes them into one household database. Every row it writes is recorded in the
  `legacy_ids` table as `(table, legacy_source, legacy_id) -> new_id` in the same write batch. A second
  run skips every row that is already recorded. A legacy row that was edited after its first
  migration is **not** updated: run the migration once, at cutover, with both old apps stopped.
- **Dry-run is the default.** Without `--apply` nothing is written to the target database or the
  target upload directory, not even a database file. The dry run executes the full pipeline against a
  scratch copy of the target, so its counts, skipped rows and balance check are real, not estimates.
- **The old data is never modified.** The tool opens a snapshot of each input (the database file plus
  its `-wal`) and reads it with `PRAGMA query_only = 1`. The files you point it at are byte-identical
  after any run.
- **Either source may be absent.** At least one of `--recipe-db` and `--finance-db` is required, so a
  recipe-only or finance-only migration is possible.
- **Out of scope** (SPEC §9): sessions, finance invites, finance password-reset tokens, and any
  merging of ledgers. Everyone logs in again after the cutover.

## What is migrated, and what is not

Table names are the legacy name on the left and the household name on the right; the full column-level
table is `docs/plans/m5-migration.md` section 2.

| Legacy source | Becomes |
| --- | --- |
| recipe `users`, `oauth_accounts`, `password_reset_tokens`, `email_verification_tokens` | `users`, `oauth_accounts`, `password_reset_tokens`, `email_verification_tokens` |
| recipe `groups`, `group_members`, `group_invites` | `households`, `household_members`, `household_invites` (same ids; `group_id` becomes `household_id`) |
| every recipe table (`tags`, `recipes`, ingredients, steps, collections, meal plan, cook log, import drafts, shopping lists and their items, catalog, bought history, mutations, `cards`) | the `recipe_*` tables of the same meaning; folded search columns are recomputed |
| recipe uploads directory (`<uuid>.<ext>` and `<name>.thumb.webp`) | the target upload directory (files copied, never overwritten) |
| finance `users` | `users` (only for people who have no recipe account) |
| finance `households` | a merge decision, a new `households` row, and `finance_settings` (`default_locale`) |
| finance `household_members` | `finance_participants` (slot, `display_name`, `joined_at` kept), plus `household_members` rows where a household is created or a member added |
| finance `categories`, `tags`, `transactions`, `transaction_tags`, `mutation_claims`, `fixed_cost_items`, `incomes`, `fixed_cost_plans`, `accrual_runs` | `finance_categories`, `finance_tags`, `finance_transactions`, `finance_transaction_tags`, `finance_mutation_claims`, `finance_fixed_cost_items`, `finance_incomes`, `finance_fixed_cost_plans`, `finance_accrual_runs` |
| (new) | one `household_modules` row per module: `recipe` for every household that came from a recipe group, `finance` for every household that received a finance household |

**Not migrated** (the report lists them under "Not migrated by design"): `sessions` of both apps,
finance `invites`, finance `password_reset_tokens`. After the cutover everybody signs in again.

Values that change on the way: `users.email` is trimmed and lower-cased; upload URLs in `avatar_url`,
`image_url` and `cover_image_url` lose their signature and origin and become plain `/uploads/<name>`
paths; ids are kept wherever the target does not already use them. Money stays integer cents.

## The rules

### Users

Users are matched by the normalised e-mail address (`trim` plus lower case).

- **In both apps:** the recipe row wins. It keeps its id, name, avatar, verified flag, verification
  timestamp, password hash and locale. Both legacy ids are recorded in `legacy_ids` and point at it.
  The report lists every such collision.
- **OAuth-only recipe account.** A recipe account without a password stays without one. toon-finance
  never verified e-mail addresses, so carrying its password hash over would let whoever registered that
  address in the finance app sign into the OAuth account. The report notes "finance password not
  carried (recipe account is OAuth-only; use password reset)". The person uses the sign-in provider,
  or you run `bun run auth:reset-password <email>`.
- **Finance-only users** become new users with the finance password hash. They start with the address
  **unconfirmed** (`email_verified = 0`, no verification timestamp). Before they can write anything they
  confirm their address (when mail is configured) or you run `bun run auth:reset-password <email>`
  to give them a reset link.
- **A user id already taken** by the target, or by another user decided in the same run, gets a fresh
  UUID and a warning, so two legacy ids that happen to be equal never collide.
- **An account that already exists in the target.** If somebody registered in the new app first and has
  the same e-mail, the legacy user is merged onto that account **only when it is confirmed** (its
  `email_verified_at` is set; the boolean alone is not evidence). If the account is unconfirmed the run
  reports the error

  ```
  unverified target account <email> blocks the merge
  ```

  The legacy user is skipped, every row that references that user is skipped as "user <id> not
  migrated", and the run exits 1, so `--apply` refuses to write. Handing an unconfirmed account the
  legacy user's households, cards and finance seat would be an account takeover. **Fix:** in the new
  app, confirm that address (sign in as that account and follow the verification mail, or run
  `bun run auth:reset-password <email>` and confirm), or delete the unconfirmed account, then run the
  dry run again. A fresh target database (the cutover below) cannot hit this.

### Households

- **Every recipe group becomes a household with the same id** (a fresh UUID if the id is taken).
- **Each finance household** is proposed one of three outcomes:
  - **merge** into the recipe group that contains all of its members. If several groups do, the one
    with the most recipes wins, then the oldest, then the lowest id. A group is used by at most one
    finance household; a second one that would share it becomes `new` (reason `group-taken`).
  - **new**: a household of its own when no group fits. The finance household's creator becomes the
    owner (the remaining member with the lowest slot when the creator has left), the other member is a
    `member`.
  - **skip**: a finance household with no members; its rows are skipped, not errors.
- **The proposal is printed in every run** (`== Household mapping proposal ==`) and is deterministic.
  Review it before applying.
- **`--mapping <file>` overrides the proposal.** The file is JSON with exactly one top-level key:

  ```json
  {
    "finance": {
      "<finance household id>": "<recipe group id>",
      "<another finance household id>": "new"
    }
  }
  ```

  The ids are the **legacy** ids printed in the proposal table's `Finance household` and
  `Target household` columns (`name (id)`). `"new"` forces a household of its own. A mapped group that
  lacks one of the finance members gets that person added as a `member` (the proposal's Reason column
  shows `mapping (adds <email>)`). The file is validated before anything is written; the run stops
  with exit 2 for a file that is not JSON, has a top-level key other than `finance`, names an unknown
  finance household or an id that is not a recipe group, or maps two finance households onto the same
  group. `--mapping` needs `--finance-db`.
- **A finance household that an earlier run already migrated** keeps its target; a `--mapping` entry
  that disagrees is ignored with a warning.

### Modules and participants (ADR 0005)

The migration writes the `household_modules` rows, `finance_participants` and `finance_settings`
directly. It does not call the runtime's enable path (that would seed default categories next to the
copied ones). A household created from a finance household does not get the `recipe` module; the
owner enables it from the Home screen ("Aktivieren") when wanted.

toon-finance allows ledger states that the household app refuses at runtime, so a real ledger can
arrive in one of four shapes. `docs/adr/0005-legacy-migration-ledger-states.md` (ADR 0005) records the
decision; each case is a **warning**, never an error, and only the migration ever writes these states.

1. **Solo ledger.** A finance household with a single member (the other left; toon-finance only
   blocks a leaver who paid a transaction) keeps **one** participant. Warning: "one participant; seat
   the second with PUT …/finance/participants". The ledger then behaves as a one-seat ledger: a
   booking that needs the other slot answers `409 conflict`. **Action:** an admin seats the second
   participant with `PUT /api/households/<id>/finance/participants` (Settings, participants section).
2. **Lone participant in slot 2.** The single remaining participant is re-seated in slot 1 even though
   the ledger has rows (slot 1 anchors the balance and must always resolve). No identity changes, and
   the balance check below compares from that person's perspective, so it stays exact.
3. **Plan payer who is not a participant.** toon-finance seats the creator as payer of the fixed-cost
   plan and never moves it when the creator leaves. The migration re-points the payer to the slot-1
   participant. Warning: "finance household <id>: plan payer <email> is not a participant; payer set
   to <slot-1 email>". **Action:** check the plan payer on the plan screen.
4. **Income naming a non-participant.** The income row is copied unchanged. Warning: "income <id> of
   finance household <id> names <email>, who is not a participant; the plan stays incomplete until an
   admin deletes or replaces it". Until then the plan reports `plan_incomplete`. **Action:** an admin
   deletes it (`DELETE /api/households/<id>/finance/plan/incomes/<incomeId>`) or replaces it.

### Uploads

Every regular file at the top level of `--recipe-uploads` (originals and `.thumb.webp` derivatives,
referenced or not) is copied to the target upload directory. A file that is absent is copied and its
size verified; one that is present with the same size counts as "already present"; one that is
present with a **different** size is an error and the target file is kept, never overwritten.
Sub-directories and symlinks are skipped with a warning. A file that a row references but the source
directory lacks is a warning (the row is still migrated; the image will 404 as it did before).
Without `--recipe-uploads` the uploads step is skipped with a warning.

### Balances

For every migrated finance household the tool computes the legacy balance from the legacy rows and the
migrated balance from the target database, from the perspective of the person who holds slot 1 in the
target. The balance in cents, the transaction count and the sum of all amounts must be equal, and the
slot-1 person must be the mapped legacy slot-1 person; otherwise the household is `FAIL`, the run
exits 1 and `--apply` writes nothing. Plan payers are re-checked to be participants afterwards.

## Preparing the inputs

The tool never reads a live database. Stop the old apps, copy their data out, and point the tool at the
copies. The layout, relative to the repository root (`migration-in/` and `migration-out/` are in
`.gitignore`; keep these files out of the tree and out of any shared backup):

```
migration-in/recipe/local.db        copy of the toon-recipe database
migration-in/recipe/local.db-wal    only if present
migration-in/recipe/uploads/        its uploads (flat: <uuid>.<ext> and <name>.thumb.webp)
migration-in/finance/local.db       copy of the toon-finance database
migration-in/finance/local.db-wal   only if present
migration-out/                      target database, uploads and reports of a run
```

**Copy the whole volume, including `local.db-wal`.** Both apps run SQLite in WAL mode, so recent
writes may live only in `local.db-wal`. A copy of `local.db` alone silently loses every page that is
still in the WAL. The tool copies `<db>` and `<db>-wal` (never `-shm`) for its own snapshot; it can
only use what you gave it. Both stacks keep the database as `/app/data/local.db` in the volume
`toon-data` (compose project names make that `toon-recipe_toon-data` and `toon-finance_toon-data`),
and toon-recipe keeps its uploads in `/app/data/uploads`.

```bash
mkdir -p migration-in/recipe migration-in/finance migration-out
docker run --rm -v toon-recipe_toon-data:/data:ro -v "$PWD/migration-in/recipe:/out" alpine \
  cp -a /data/. /out/
docker run --rm -v toon-finance_toon-data:/data:ro -v "$PWD/migration-in/finance:/out" alpine \
  cp -a /data/. /out/
ls -la migration-in/recipe migration-in/finance      # local.db, local.db-wal, local.db-shm, uploads/
```

`local.db-shm` may be copied too; it is ignored. Copy while the stacks are stopped (see Cutover
order), so the WAL is complete.

**Schema-version check.** Each input must be at the exact migration the tool was written for
(toon-recipe: 9 migrations, last `0008_shopping_bought`; toon-finance: 2 migrations, last
`0001_material_nebula`). Otherwise the tool stops with exit 2 and writes nothing:

```
legacy recipe database is at migration 7 of 9; start the old app once (it migrates on boot) and copy it again
```

**Fix:** start the old app version once so it migrates its database on boot (this is why you stop the
stacks with `docker compose down` and not by deleting anything), stop it again and copy the volume
again. A message that the database "is newer than" the expected migration means the old app was
upgraded past what this tool knows; do not force it, report it.

## Where the target comes from

The target database is **`DATABASE_URL`** and the upload target is **`UPLOAD_DIR`** (default
`./data/uploads`). Both are read from the process environment **or** from the repository's root
`.env` (and `.env.local`), the same places `bun run dev`, `db:migrate` and `seed` read them. **The
process environment wins** over the file. Relative values (and relative input paths) resolve against
the repository root, not the current directory.

- `DATABASE_URL` must be a local `file:` URL. A `libsql://` target is refused (exit 2).
- A missing `DATABASE_URL` is exit 2 with: `DATABASE_URL is not set (process environment or the
  repo's root .env); point it at the target, e.g. DATABASE_URL=file:./migration-out/toon.db`.
- **A root `.env` that points `DATABASE_URL` at your development database would be your target.**
  That is why the first lines of every run print the resolved target and upload directory:

  ```
  [migrate:legacy] mode: dry-run (nothing is written to /home/you/toon-household/migration-out/toon.db)
  [migrate:legacy] uploads: /home/you/toon-household/migration-out/uploads
  ```

  Read them before `--apply`. When in doubt, set both variables on the command line; that overrides
  the file.

## Commands

All commands run from the repository root, after `bun install --frozen-lockfile`. The two example
variables below are the ones used throughout this guide.

```bash
export DATABASE_URL=file:./migration-out/toon.db
export UPLOAD_DIR=./migration-out/uploads
```

The synopsis (`--help` prints it):

```
bun run migrate:legacy -- [--recipe-db <file>] [--recipe-uploads <dir>] [--finance-db <file>]
                          [--mapping <json>] [--apply] [--report <file>] [--help]
```

| Flag | Meaning |
| --- | --- |
| `--recipe-db <file>` | the copied toon-recipe `local.db` |
| `--recipe-uploads <dir>` | the copied recipe uploads directory (requires `--recipe-db`) |
| `--finance-db <file>` | the copied toon-finance `local.db` |
| `--mapping <json>` | household overrides, see [Households](#households) (requires `--finance-db`) |
| `--apply` | write for real; without it nothing is written |
| `--report <file>` | also write the report of the last pass as JSON |
| `--help` | print the usage block |

1. **Dry run** (the default). Writes nothing. Exit 0 means a clean report.

   ```bash
   bun run migrate:legacy -- \
     --recipe-db migration-in/recipe/local.db --recipe-uploads migration-in/recipe/uploads \
     --finance-db migration-in/finance/local.db --report migration-out/dry-run.json
   ```

2. **Read the report** (next section), top to bottom. Pay attention to the household proposal, the
   collisions, the warnings, the errors and the balance table.
3. **Override the proposal** if a finance household should land elsewhere. Write the mapping file and
   run the dry run again with `--mapping`:

   ```bash
   bun run migrate:legacy -- \
     --recipe-db migration-in/recipe/local.db --recipe-uploads migration-in/recipe/uploads \
     --finance-db migration-in/finance/local.db --mapping migration-in/mapping.json
   ```

4. **Apply.** The tool first repeats the dry pass; if that reports any error it stops with exit 1 and
   `Nothing was written.` Otherwise it creates the target (running every schema migration on it),
   copies the rows in dependency order in transactions of 500 rows, copies the uploads, and re-checks
   the balances.

   ```bash
   bun run migrate:legacy -- \
     --recipe-db migration-in/recipe/local.db --recipe-uploads migration-in/recipe/uploads \
     --finance-db migration-in/finance/local.db --mapping migration-in/mapping.json \
     --apply --report migration-out/apply.json
   ```

5. **Run `--apply` a second time** with the same arguments. It must write nothing and end with
   `[migrate:legacy] already migrated: nothing written.` That proves the first run was complete.

## The report

The report is plain English text on stdout; `--report <file>` writes the same content as JSON with the
totals and the exit code. Sections, always in this order:

| Heading | Content |
| --- | --- |
| `== Inputs ==` | mode, target, and per source the path, the schema version and the row count of each table |
| `== Household mapping proposal ==` | the table `Finance household / Members / Decision / Target household / Reason` |
| `== Users ==` | counts, and every e-mail that exists in both apps (which id, which password) |
| `== Rows per table ==` | read, written, already migrated and skipped, per table and source, with totals |
| `== Skipped rows ==` | every row not migrated, with its reason; an error is marked as such |
| `== Not migrated by design ==` | sessions, finance invites, finance reset tokens |
| `== Uploads ==` | source files, copied (or "would copy" in a dry run), already present, bytes, conflicts, referenced-but-missing, ignored entries |
| `== Finance balance per household ==` | legacy and migrated balance, transaction count and amount sum, and `OK` or `FAIL` |
| `== Warnings ==` | the ADR 0005 cases, matched accounts, taken ids, missing uploads |
| `== Errors ==` | anything that makes the run fail |

Then exactly one final line:

| Situation | Final line |
| --- | --- |
| dry run, something to write | `[migrate:legacy] dry run complete: <n> rows would be written, <m> files would be copied. Nothing was written.` |
| dry run, nothing to write | `[migrate:legacy] dry run complete: already migrated, nothing would be written. Nothing was written.` |
| apply | `[migrate:legacy] applied: <n> rows written, <m> files copied.` |
| apply, nothing to write | `[migrate:legacy] already migrated: nothing written.` |
| any error | `[migrate:legacy] FAILED: <k> error(s), see Errors above.` (after a failed dry pass of `--apply` also `Nothing was written.`) |

Money is printed as integer cents (`-1234 ct`), never as a float.

**Exit codes.** `0` success. `1` the run found errors (balance mismatch, a failed insert, an upload
conflict, an unverified target account). `2` usage, mapping or input error (missing file, wrong schema
version, remote target, bad mapping), detected before anything is written.

Example output, **abridged, from the real dry run of the fixtures** (`apps/api/test/fixtures/legacy/`,
invented people and amounts; the target path is that run's temporary directory; your numbers differ):

```
[migrate:legacy] mode: dry-run (nothing is written to /tmp/tmp.idwYBnLkxF/target.db)
[migrate:legacy] uploads: /tmp/tmp.idwYBnLkxF/uploads

== Household mapping proposal ==
Finance household                                         Members                                Decision  Target household                                         Reason
--------------------------------------------------------  -------------------------------------  --------  -------------------------------------------------------  ------------
Kasse Anna & Ben (00000005-0000-4000-8000-000000000001)   anna@example.test, ben@example.test    merge     Familie Beispiel (00000002-0000-4000-8000-000000000001)  most-recipes
Kasse Cleo & Dana (00000005-0000-4000-8000-000000000002)  cleo@example.test, dana@example.test   merge     WG Gartenstraße (00000002-0000-4000-8000-000000000003)   only-group
Emil & Fritz (00000002-0000-4000-8000-000000000002)       emil@example.test, fritz@example.test  new       Emil & Fritz (483d9d2b-b12a-4435-8dcb-38804ff89f8a)      no-group
Gina allein (00000005-0000-4000-8000-000000000004)        gina@example.test                      new       Gina allein (00000005-0000-4000-8000-000000000004)       no-group
Leer (00000005-0000-4000-8000-000000000005)               -                                      skip      -                                                        no-members

== Users ==
Recipe users: 4
Finance users: 7
Target users: 7
Collisions (same e-mail in both apps):
E-mail             Recipe id                             Finance id                            Target id                             Password  Note
-----------------  ------------------------------------  ------------------------------------  ------------------------------------  --------  -------------------------------------------------------------------------------
anna@example.test  00000001-0000-4000-8000-000000000001  00000006-0000-4000-8000-000000000001  00000001-0000-4000-8000-000000000001  recipe
ben@example.test   00000001-0000-4000-8000-000000000002  00000006-0000-4000-8000-000000000002  00000001-0000-4000-8000-000000000002  none      finance password not carried (recipe account is OAuth-only; use password reset)
cleo@example.test  00000001-0000-4000-8000-000000000003  00000006-0000-4000-8000-000000000003  00000001-0000-4000-8000-000000000003  recipe
dana@example.test  00000001-0000-4000-8000-000000000004  00000006-0000-4000-8000-000000000004  00000001-0000-4000-8000-000000000004  recipe

== Rows per table ==
Table                         Source   Read  Written  Already migrated  Skipped
----------------------------  -------  ----  -------  ----------------  -------
users                         recipe   4     4        0                 0
users                         finance  7     7        0                 0
oauth_accounts                recipe   1     1        0                 0
...
households                    finance  5     4        0                 1
Total                                  242   240      0                 2

== Skipped rows ==
Table                     Source   Legacy id                             Error  Reason
------------------------  -------  ------------------------------------  -----  --------------------------------------------------------------------------
households                finance  00000005-0000-4000-8000-000000000005  no     finance household 00000005-0000-4000-8000-000000000005 skipped: no members
finance_fixed_cost_plans  finance  00000005-0000-4000-8000-000000000005  no     finance household 00000005-0000-4000-8000-000000000005 skipped: no members

== Uploads ==
Source files: 7
Would copy: 7
Already present: 0
Bytes copied: 0
Conflicts: (none)
Referenced but missing:
  00000009-0000-4000-8000-000000000006.jpg
Ignored entries: (none)

== Finance balance per household ==
Finance household                                         Target household                      Slot 1             Legacy balance  Migrated balance  Legacy tx  Migrated tx  Legacy sum  Migrated sum  Result
--------------------------------------------------------  ------------------------------------  -----------------  --------------  ----------------  ---------  -----------  ----------  ------------  ------
Kasse Anna & Ben (00000005-0000-4000-8000-000000000001)   00000002-0000-4000-8000-000000000001  anna@example.test  119486 ct       119486 ct         13         13           166995 ct   166995 ct     OK
Kasse Cleo & Dana (00000005-0000-4000-8000-000000000002)  00000002-0000-4000-8000-000000000003  cleo@example.test  1675 ct         1675 ct           6          6            14651 ct    14651 ct      OK
Emil & Fritz (00000002-0000-4000-8000-000000000002)       483d9d2b-b12a-4435-8dcb-38804ff89f8a  emil@example.test  1900 ct         1900 ct           4          4            9998 ct     9998 ct       OK
Gina allein (00000005-0000-4000-8000-000000000004)        00000005-0000-4000-8000-000000000004  gina@example.test  2500 ct         2500 ct           2          2            3500 ct     3500 ct       OK

== Warnings ==
- user gina@example.test (finance id 00000001-0000-4000-8000-000000000003): the id is already taken in the target, new id 354d7981-a3b9-4988-8645-b61a4d7d6927
- finance household 00000002-0000-4000-8000-000000000002 (Emil & Fritz): the id 00000002-0000-4000-8000-000000000002 is already taken in the target, new id 483d9d2b-b12a-4435-8dcb-38804ff89f8a
- finance household 00000005-0000-4000-8000-000000000004 (Gina allein): one participant; seat the second with PUT …/finance/participants (gina@example.test is the only participant)
- finance household 00000005-0000-4000-8000-000000000004 (Gina allein): the only participant gina@example.test sat in slot 2 and is re-seated in slot 1 (ADR 0005)
- uploads: 00000009-0000-4000-8000-000000000006.jpg is referenced by a legacy row but missing in /home/erics/software/toon-household/apps/api/test/fixtures/legacy/uploads
- income 00000007-0000-4000-8000-000000000024 of finance household 00000005-0000-4000-8000-000000000004 names fritz@example.test, who is not a participant; the plan stays incomplete until an admin deletes or replaces it
- finance household 00000005-0000-4000-8000-000000000004: plan payer fritz@example.test is not a participant; payer set to gina@example.test

== Errors ==
(none)

[migrate:legacy] dry run complete: 240 rows would be written, 7 files would be copied. Nothing was written.
```

Notes on reading it:

- `bun run migrate:legacy` goes through `bun --filter`, which prefixes every output line with
  `@toon/api migrate:legacy: `. The excerpt above has the prefix removed; the `--report` JSON never
  has it. The exit code of the script is the exit code of the command.
- A household or user whose id was already taken gets a fresh random UUID **per pass**. The dry run
  shows one (`483d9d2b-...` above) and the `--apply` pass writes another; the final report of the apply
  names the one that was written.
- A dry run against a target that already holds the migrated rows says `already migrated, nothing would
  be written.` in its last line.

## When something fails

- **Exit 2** (usage, mapping, input): nothing was written anywhere. Fix the cause the message names
  (path, schema version, mapping file, `DATABASE_URL`) and run again.
- **A failed dry pass** (exit 1, with or without `--apply`): the target database and the target upload
  directory are untouched; the pass ran on a scratch copy. Read `== Errors ==` and `== Skipped rows ==`,
  fix the cause (for example the unverified-account case above, or a mapping that sends a household
  somewhere the proposal cannot), and run again. Do not apply while errors remain.
- **A failed real pass** (rare, since the dry pass of the same run came out clean): the target may be
  partly written. Restore the target from the copy you took before `--apply` (below), or, for a fresh
  target in `migration-out/`, delete `migration-out/` and start again. Because every row is recorded in
  `legacy_ids` in the same batch as the row, a run that is simply re-run resumes from the first
  unmapped row and is safe; restoring is for when you would rather start from a known state.
- **A skipped row that is an error** (insert failed, upload size conflict) stops `--apply`. A skipped
  row that is not an error (for example a finance household without members) is listed and is fine.
- **Before applying to a target that already exists** (anything but a fresh `migration-out/`), copy
  it first, with the `-wal`:

  ```bash
  cp -a migration-out/toon.db* migration-out/uploads /safe/place/
  ```

## Cutover order

The order of SPEC §6, with commands. The new stack's own volume and image names come from the
deployment document written in milestone M6 (`docs/deployment.md`, "Cutover from toon-edge", which
links back here). The commands below use `<new-volume>` for the new stack's `toon-data` volume
(`<compose project>_toon-data`) and assume its database is `/app/data/local.db` and its uploads are
`/app/data/uploads` inside the container, as in both old stacks; check them against that document.
The old volumes stay untouched until you delete them yourself, so every step before the last is
reversible by starting the old stacks again.

1. **Stop both old stacks, without `-v`.** `-v` would delete the volumes you are about to copy.
   The shared toon-edge proxy holds ports 80 and 443 that the new stack's own Caddy needs, so stop it
   too (it stays on disk until step 9).

   ```bash
   (cd /opt/toon-recipe  && docker compose down)
   (cd /opt/toon-finance && docker compose down)
   (cd /opt/toon-edge    && docker compose down)
   ```

2. **Copy both volumes out** into `migration-in/`, WAL included (see [Preparing the
   inputs](#preparing-the-inputs)):

   ```bash
   mkdir -p migration-in/recipe migration-in/finance migration-out
   docker run --rm -v toon-recipe_toon-data:/data:ro  -v "$PWD/migration-in/recipe:/out"  alpine cp -a /data/. /out/
   docker run --rm -v toon-finance_toon-data:/data:ro -v "$PWD/migration-in/finance:/out" alpine cp -a /data/. /out/
   ```

   Check for the schema-version error here. If it appears, start that one old stack once, stop it and
   copy again.

3. **Dry run** against a fresh target. Nothing is written.

   ```bash
   export DATABASE_URL=file:./migration-out/toon.db UPLOAD_DIR=./migration-out/uploads
   bun run migrate:legacy -- --recipe-db migration-in/recipe/local.db \
     --recipe-uploads migration-in/recipe/uploads --finance-db migration-in/finance/local.db \
     --report migration-out/dry-run.json
   ```

4. **Read the report.** Review the household proposal (add `--mapping` and run step 3 again if
   needed), the collisions, every warning (the four ADR 0005 cases), and make sure `== Errors ==` is
   `(none)` and every balance row says `OK`. Fix and repeat until the dry run exits 0.

5. **Apply** into `migration-out/`, then apply again to prove it is complete:

   ```bash
   bun run migrate:legacy -- --recipe-db migration-in/recipe/local.db \
     --recipe-uploads migration-in/recipe/uploads --finance-db migration-in/finance/local.db \
     --apply --report migration-out/apply.json
   bun run migrate:legacy -- --recipe-db migration-in/recipe/local.db \
     --recipe-uploads migration-in/recipe/uploads --finance-db migration-in/finance/local.db --apply
   # the second run must end with: [migrate:legacy] already migrated: nothing written.
   ```

6. **Copy the result into the new stack's volume**, before that stack has ever started (a started
   stack would have created its own empty database). Rename the database to the name the new stack's
   `DATABASE_URL` uses, and copy the `-wal` with it if one exists.

   ```bash
   docker volume create <new-volume>
   docker run --rm -v <new-volume>:/data -v "$PWD/migration-out:/in:ro" alpine sh -c \
     'cp /in/toon.db /data/local.db && { [ ! -f /in/toon.db-wal ] || cp /in/toon.db-wal /data/local.db-wal; } && cp -a /in/uploads /data/uploads && chown -R 1000:1000 /data'
   ```

   The `chown` is required. Docker only seeds a named volume with the image's `/app/data` contents
   and ownership when the volume is empty at its first mount; this one is pre-filled, so everything
   the root container wrote stays owned by root. The app image runs as `USER bun` (uid 1000, as both
   source images do), and without the `chown` it cannot write the database, the `-wal` or `-shm`
   files or `uploads/`: the WAL pragma and the migrations fail at boot and image uploads fail.
   Check the uid against the new image (`docker run --rm --entrypoint id <image>`) and use that uid
   if it is not 1000.

7. **Start the new stack** (`docker compose pull && docker compose up -d` in the new stack's
   directory), with `RECIPE_HOSTNAME` and `FINANCE_HOSTNAME` set so the old hostnames redirect to
   `TOON_HOSTNAME` (SPEC D11). Point the DNS of the old hostnames at the new host if they do not
   already resolve there.

8. **Verify.** Both old hostnames answer with a permanent redirect to the new one, the new site
   serves, and the data is there:

   ```bash
   curl -sI https://<old-recipe-hostname>/  | head -n 3     # 301, Location: https://<new-hostname>/
   curl -sI https://<old-finance-hostname>/ | head -n 3     # 301, Location: https://<new-hostname>/
   curl -s https://<new-hostname>/api/health                # {"modules":["recipe","finance"], ...}
   ```

   Sign in (each person uses the e-mail and password they had; OAuth-only recipe accounts use their
   provider; finance-only accounts need the address confirmation or a password-reset link from
   `bun run auth:reset-password <email>`). Open a recipe, the meal plan, a shopping list, and the
   finance overview: the balance must equal the migrated balance in the report. Act on the ADR 0005
   warnings (seat the second participant of a solo ledger, check the plan payer, remove an income that
   names someone who is not a participant).

9. **Retire the old stacks.** Once everything has been checked, remove the old stacks and toon-edge
   from the server: the directories `/opt/toon-recipe`, `/opt/toon-finance` and `/opt/toon-edge`, their
   deploy keys and workflows, and the `toon-edge` Docker network. **Keep the old volumes**
   (`toon-recipe_toon-data`, `toon-finance_toon-data`) and `migration-in/` as your backup until you
   decide to delete them with `docker volume rm`. Delete the old hostname redirects (unset
   `RECIPE_HOSTNAME` / `FINANCE_HOSTNAME`) when bookmarks have had time to move.
