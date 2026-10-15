# Legacy migration fixtures

Small, anonymised databases in the two source schemas, used by the `migrate:legacy` tests
(plan `docs/plans/m5-migration.md` section 3, SPEC section 7). Every name, e-mail and amount is
invented.

| Path | What it is |
| --- | --- |
| `migrations/recipe/` | Verbatim copy of toon-recipe's `apps/api/drizzle/` (9 migrations plus `meta/_journal.json`, no snapshots), source commit `928582f`. |
| `migrations/finance/` | Verbatim copy of toon-finance's `apps/api/drizzle/` (2 migrations plus `meta/_journal.json`, no snapshots), source commit `cbdec67`. |
| `facts.ts` | The single facts file: ids, e-mails, plain passwords with their precomputed argon2id hashes, the traps, and the expected counts. The tests read it. |
| `build.ts` | The deterministic builder (`buildLegacyFixtures`, `dumpDatabase`) and the `--check` mode. |
| `recipe.db`, `finance.db` | The built databases (rollback-journal mode, 1 KiB pages, tracked by git; `.gitignore` has an exception for them). |
| `uploads/` | The files the recipe rows refer to (tiny deterministic bytes), plus one unreferenced `orphan.png`. |

## Rules

- The files under `migrations/` are copies. **Never edit them.** When a source repo gets a new
  migration the fixtures are rebuilt from a new copy and the facts are re-derived on purpose.
  Compare with the sources (read-only):
  `diff -r -x '*_snapshot.json' /home/erics/software/toon-recipe/apps/api/drizzle apps/api/test/fixtures/legacy/migrations/recipe`
  and the same for toon-finance.
- The databases are built, not hand-edited. Change `facts.ts` or `build.ts`, rebuild, commit both.
- Passwords are hashed once (`bun -e 'console.log(await Bun.password.hash("<pw>", { algorithm: "argon2id" }))'`)
  and pasted into `facts.ts`: the hash is salted, so hashing at build time would break determinism.

## Rebuild and check

```
bun run apps/api/test/fixtures/legacy/build.ts          # rewrite recipe.db, finance.db and uploads/
bun run apps/api/test/fixtures/legacy/build.ts --check  # rebuild into a temp dir, compare a logical dump
```

`--check` compares the schema SQL and every row of every table (ordered by rowid) of both databases
and the bytes of every upload; it exits 1 with the first difference. `apps/api/test/legacy-fixtures.test.ts`
runs the same comparison and asserts the traps.

## The traps the fixtures contain

- gina's toon-finance id equals cleo's toon-recipe id.
- Finance household FH3's id equals recipe group G2's id.
- FH4 has one member, gina, in slot 2; its creator and plan payer is fritz (not a member: he left
  before paying anything), and one of its two incomes names fritz.
- FH5 has no members.
