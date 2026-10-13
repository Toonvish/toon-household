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
4. `docs/adr/` — one record per deviation from SPEC §1 (`NNNN-slug.md`: date, context, decision,
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

Nothing is built yet (2026-10-13): the repo holds the spec, this file and the workflow. M0 creates
the monorepo; this section and the sections below are rewritten by the workflow's docs step after
every milestone.

## Commands

To be written by M0. They will be toon-recipe's: `bun run dev`, `bun run typecheck`, `bun test`,
`bun run build`, `bun run i18n:check`, `bun run db:migrate`, `bun run seed`, plus
`bun run migrate:legacy` (M5) and `bun run plan:run` (M3).

## Conventions

Until M0 replaces this section, the conventions are toon-recipe's `CLAUDE.md` "Conventions" plus
toon-finance's "Konventionen" (money is integer cents everywhere; no float touches a user amount),
with these household-wide rules from SPEC: tables prefixed per module, API paths under
`/api/households/:householdId/<module>/`, query keys `["toon","household",id,"<module>",…]`,
German UI strings byte-identical to the sources, docs in English, commit messages ending with the
harness's `Co-Authored-By` line, no pushes from agent sessions.
