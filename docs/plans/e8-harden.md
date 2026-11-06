# E8 — harden (plan)

**Status: DONE (2026-11-06), integrated by E8-T12; integration record in section 9, deviations in section 10.** Base commit `4bc9512fc`. No new ADR: every deviation sits inside ADR 0014's scope ("Status after E8").

E8 is the last milestone of the Effect migration (`docs/EFFECT.md` §4 E8). It changes how the code is written and how it is
documented, never what it does: every `docs/API.md` row, every German string, every table and migration, every pinned output line
and every assertion of the 15191-test suite survive (E3). Its job, in the words of §4: the review findings of E0 to E7 closed,
CLAUDE.md as built, `docs/API.md` conventions where an implementation note changed (never a row), the module docs with the service
names, the pattern files refreshed from what the code does, `docs/open-work.md`, §3 of `docs/EFFECT.md` made to match the tree, the
idioms test with every E12 rule grep can see switched on and its allow lists minimal, and this file's record of the final gates, the
walkthrough and the boot-and-shutdown proof.

## 1. Context

### 1.1 The tree

HEAD `4bc9512fc` ("E7 docs sync after review"), branch `main`, clean. Bun 1.4.3 on the host (`.bun-version` 1.4.2; nothing depends on
the difference). `effect` and `@effect/platform-bun` 4.0.5, vendored `repos/effect` at the tag (E2). Hono is gone (E7, ADR 0015); the
API is `effect/http-api` on `BunHttpServer`. Two modules (`recipe`, `finance`), both `ApiModule`s with Effect hooks and a `layer`.

### 1.2 Baseline gates (measured for this plan, 2026-11-06)

| Gate | Result |
| --- | --- |
| `bun test` | **15191 pass, 1 skip, 0 fail**, 386140 `expect()` calls, `Ran 15192 tests across 181 files. [63.74s]`, no `(fail)` line. **baseline_tests = 15191** (equal to E7's record) |
| `bun run typecheck` | `[typecheck] OK`, exit 0 |
| `bun run i18n:check` | parity `OK`, then `FAILED — 148 possible German literal(s)`, exit 1 by design (the 148 classified at E7, plan e7 9.2) |
| `bun test apps/api/test/effect-idioms.test.ts` | 43 pass, 15 `describe`s (rules (1) to (14) plus the scan-coverage check) |
| `git status --porcelain repos/` | empty |
| Bundle | 419.99 kB gzipped over 84 JS chunks (E6 9.2, E7 9.3). E8 changes nothing under `apps/web`; E8-T12 re-measures and must find the same number |

### 1.3 The open findings E8 closes

The workflow persists only the medium and high findings of a review; every one of those was fixed in its milestone (E1 to E7 records,
section 9 and 10). The low ones (E2 9.5: "idiom and record gaps") were not persisted, so E8 re-audits by measurement (1.5) instead of
by list. What the records left open, with the task that closes each:

| # | Finding | Source | Closed by |
| --- | --- | --- | --- |
| F1 | 19 test-only Promise or synchronous doors still live in `apps/api/src` and `apps/api/scripts`, 18 under `/* legacy bridges */` headers plus the finance `nowMs()` (census 1.4) | ADR 0014 "Status after E5's integration", "Survivors after E5 (all removed by E8 …)"; CLAUDE.md "Bridges until E8" | T01, T04, T05, T06 (P1) |
| F2 | The legacy `ApiError` class and its ten static helpers stay in `apps/api/src/lib/errors.ts` for 17 test files | CLAUDE.md "The error family and the one boundary mapper" ("stay for the tests … until E8") | T01, T04, T05 (P4) |
| F3 | `nowMs()` in `apps/api/src/modules/finance/lib/clock.ts` survives for two test importers, `apps/api/test/support/finance-harness.ts` and `apps/api/test/finance-clock.test.ts` (line 28; its case "the synchronous nowMs keeps its override seam", lines 105 to 115); it is the one entry of idioms rule (11)'s `ALLOW_NOW_MS` | plan e4 P12; the idioms test | T01 (door), T04 (imports), T06 (P1) |
| F4 | CLAUDE.md "Bridges until E8" lists `requireUser`, `requireMembership` and `requireFinanceParticipantContext`, which E7 deleted; `apps/api/src/lib/types.ts` and `apps/api/src/modules/finance/middleware.ts` still describe them | measured (`grep -rnw requireFinanceParticipantContext apps/api` finds comments only) | T03, T11 |
| F5 | 82 comment lines in 32 files name Hono, a dozen of them describe "the Hono section at the end (until E7-T12 deletes it)", which no longer exists | `docs/open-work.md` O-10; plan e7 10 F6 | T03 (and T02, T05 for the files they own) (P6) |
| F6 | "E8 decides" whether `apps/api/src/db/client.ts` keeps creating the process-wide client at import; `docs/EFFECT.md` §3.2 still says `env.ts` "re-exports until E7 removes it" | ADR 0014 "Status after E5's integration"; `docs/EFFECT.md` E5; open-work O-7 | P3; T10 records it |
| F7 | The test seams (`setMailer` …) were to be "removed by the milestone that moves its last caller"; their callers are tests that stay | `docs/EFFECT.md` E7; ADR 0014 | P2; T05 renames the section headers, T10 records |
| F8 | Idiom gaps found by measurement (1.5): six hand-written object guards, one `Date.now()` on the request path, an `Effect.runSync` inside the synchronous `createAuthorization` that two Effect handlers call | E2 9.5 (low findings not persisted); E12 | T02 (P5) |
| F9 | E12 idioms grep can see that the idioms test does not pin (span names, `.pipe` on `Effect.fn`, `return yield*`, tagged errors, `Predicate`, the Clock on the request path, runs only at the edges, v3 API names) | `docs/EFFECT.md` E12, §4 E8 exit | T07 (P7) |
| F10 | Pattern files carry stale lines (Hono in the present tense, bridges "until E8") and some "In this repo" sections predate E5 to E7 | E5 10 item 16, E7 docs sync | T08, T09 |
| F11 | `docs/EFFECT.md` §3 does not match the tree (no `http/`, `infra.ts`, `core/health.ts`, the layers; `Database` placed in `db/client.ts`; the web clients at `modules/<id>/api.ts`) | measured | T10 |
| F12 | `docs/API.md` implementation notes still say "Zod refinement" and name the lower-case `requireFinanceParticipant` | measured (`grep -n "Zod\|requireFinanceParticipant" docs/API.md`) | T10 |
| F13 | `apps/api/test/docs-paths.test.ts` does not scan `docs/EFFECT.md` and `agent-patterns/*.md`, nor paths under `agent-patterns/` and `repos/effect/`; nothing pins that CLAUDE.md names `docs/EFFECT.md`, `repos/effect/LLMS.md` and `agent-patterns/` | the E8 exit criterion | T11 |
| F14 | `apps/api/test/mail.test.ts` line 107 says "E8 removes it" of the `trySendMail` door and its case; removing the case would drop the pass count | plan e2 P1 | T04 keeps the case, rewords the comment (P1) |
| F15 | `GET /api/health`'s handler runs `runtime.runPromise(healthResponse)` inside the handler; `apps/api/test/runtime.test.ts` (b) pins exactly that call (E0) | measured | kept; rule (20) allow list with the reason (P7); T10 records it in open-work |

### 1.4 The bridge census (F1, F2)

Measured with an import-statement scan of `apps/api/test` (multi-line imports included). 77 test files import at least one of these
names: the 76 of the first census plus `apps/api/test/support/finance-harness.ts`, whose `nowMs` import now moves in T04 too
(`apps/api/test/finance-clock.test.ts`, already among the 76, is the `nowMs` importer the first census missed); 38 of them import only
`runMigrations`.

| Door | Today in | Convention | Test importers |
| --- | --- | --- | --- |
| `runMigrations(database = db)` | `apps/api/src/db/migrate.ts` | Promise over `migrateDatabase` | 58 files incl. `apps/api/test/support/legacy-harness.ts` |
| `ApiError` (class, ten statics) | `apps/api/src/lib/errors.ts` | class | 17 files incl. `apps/api/test/import/helpers.ts` |
| `createSession(database, userId, fingerprint?)` | `apps/api/src/core/services/auth/sessions.ts` | Promise, `runtime.runPromise` | `middleware`, `import/routes`, `import/ocr-disabled`, `import/url-import-local` |
| `claimPlaceholderUser(database, userId, input)` | `apps/api/src/core/services/auth/users.ts` | Promise | `placeholders` |
| `checkRateLimit(key, rule)` | `apps/api/src/core/services/auth/rateLimit.ts` | synchronous, `Effect.runSync(checkIn(…))` | `auth`, `rate-limiter` |
| `trySendMail(message)` | `apps/api/src/core/services/mail/index.ts` | Promise | `mail` |
| `createDraft(db, input)` | `apps/api/src/modules/recipe/services/import/drafts.ts` | Promise | `import/ocr-disabled` |
| `importFromText(rawText, options)` | `apps/api/src/modules/recipe/services/import/ocr/index.ts` | synchronous | `import/ocr-disabled`, `import/ocr-segment` |
| `fetchHtml(url, options)` | `apps/api/src/modules/recipe/services/import/url/fetch.ts` | Promise | `import/ssrf`, `import/import-http` |
| `assertPublicUrl(input, options)` | `apps/api/src/modules/recipe/services/import/url/ssrf.ts` | Promise | `import/ssrf` |
| `assignParticipants`, `updateParticipantDisplayName` | `apps/api/src/modules/finance/services/participants/participants.service.ts` | Promise over `runFinanceBridge` | `finance-module` |
| `runFinanceBridge(effect, executor)` | `apps/api/src/modules/finance/bridge.ts` (the whole file) | Promise | `finance-clock`, `finance-security` |
| `runLegacy(effect)` | `apps/api/scripts/legacy/io.ts` (re-exported by `run.ts`) | Promise | `legacy-io`, `legacy-finance`, `legacy-framework`, `legacy-recipe`, `finance-scheduler` |
| `runLegacyMigration`, `migrateUsers`, `migrateHouseholds`, `migrateRecipe`, `openLegacy` | `apps/api/scripts/legacy/{run,users,households,recipe,sources}.ts` | Promise over `runLegacy` | the `legacy-*` tests, `finance-scheduler`, `web-contract-legacy`, `support/legacy-harness.ts` |
| `nowMs()` | `apps/api/src/modules/finance/lib/clock.ts` | synchronous (the override, else `Date.now()`) | `support/finance-harness.ts` (line 23), `finance-clock` (line 28, the case at lines 105 to 115) |

Already gone (E7): `requireUser`, `requireMembership`, `requireFinanceParticipantContext`. The test SEAMS (P2) are not in this table.

### 1.5 Idiom measurements (F8, F9), on HEAD

| Pattern | Scope | Hits |
| --- | --- | --- |
| `Effect.fn(` without a string-literal name | api src, scripts | 0 (512 `Effect.fn`/`fnUntraced` calls; one names its span with a TEMPLATE literal, ``Effect.fn(`recipe.imports.${name}`)`` at `apps/api/src/modules/recipe/routes/imports.ts:97`, which counts as a literal name) |
| `.pipe(` applied to an `Effect.fn(…)(…)` result (paren-balanced scan) | api, web, shared src | 0 |
| a declared function whose body only returns `Effect.gen(` | api src, scripts | 0 (6 inline callbacks inside combinators, idiomatic) |
| `yield* new X(` / `yield* Effect.fail(` without `return` | api, web, shared src | 0 |
| `class … extends Error` | api src, scripts | 1: `apps/api/scripts/finance-import/amounts.ts` (pure parser, plan e5 deviation 5) |
| `instanceof <X>Error` (not the builtin `Error`) | api src, scripts | 1: `apps/api/scripts/finance-import-xlsx.ts:178` (the pure extraction loop catching the pure parser) |
| `typeof x === "object" && x !== null` guards | api src, scripts | 6 (T02 table) |
| `Date.now(` / `new Date()` on the request path (`http/`, `middleware/`, `routes/`) | api src | 1: `apps/api/src/modules/recipe/routes/shopping.ts:67` |
| `Effect.run*` / `runtime.run*` (regex `\b(Effect\|runtime)\.run\w*\(`, every `…With` variant included) | api src | 24 lines in 17 files, among them `Effect.runPromiseExitWith(inner)` in `apps/api/src/db/database.ts:115` (the drizzle transaction callback); after T02, T05 and T06 the six files of rule (20)'s allow list only (P7) |
| v3 names (`Effect.catchAll`, `Either.`, `.annotations(`, `FiberRef`, …) | everything scanned | 0 |

## 2. Decisions (binding for the tasks)

**P1 — A test-only door leaves `src` for test support (E7, E9, E12; ADR 0014).** Every door of 1.4 (19, `nowMs` included) moves, with its NAME, SIGNATURE,
CALLING CONVENTION (Promise stays Promise, synchronous stays synchronous, rejection value unchanged) and doc comment, to ONE file under
`apps/api/test/support/bridges/` that mirrors ONE source module (table below). A door file imports only the source module it mirrors and
what the old bridge body imported (`src/runtime.ts`, `src/db/database.ts`, `src/db/client.ts`, `src/modules/finance/layer.ts`, a sibling
door), so a test's import graph does not grow. A test file changes its import SPECIFIERS only (T04's table); its assertions, test names and
bodies are untouched (the one comment of F14 aside). `src` keeps the `Effect` forms; a private helper a door needs gets the `export`
keyword and nothing else (T01's list). After T05 and T06 no `legacy bridge` section is left under `apps/api/src` or `apps/api/scripts`, and
idioms rule (20) pins it.

| Door file (`apps/api/test/support/bridges/`) | Exports | Mirrors |
| --- | --- | --- |
| `migrate.ts` | `runMigrations` | `apps/api/src/db/migrate.ts` |
| `api-error.ts` | `ApiError` | `apps/api/src/lib/errors.ts` |
| `sessions.ts` | `createSession` | `apps/api/src/core/services/auth/sessions.ts` |
| `users.ts` | `claimPlaceholderUser` | `apps/api/src/core/services/auth/users.ts` |
| `rate-limit.ts` | `checkRateLimit` | `apps/api/src/core/services/auth/rateLimit.ts` |
| `mail.ts` | `trySendMail` | `apps/api/src/core/services/mail/index.ts` |
| `recipe-drafts.ts` | `createDraft` | `apps/api/src/modules/recipe/services/import/drafts.ts` |
| `recipe-ocr.ts` | `importFromText` | `apps/api/src/modules/recipe/services/import/ocr/index.ts` |
| `recipe-fetch.ts` | `fetchHtml` | `apps/api/src/modules/recipe/services/import/url/fetch.ts` |
| `recipe-ssrf.ts` | `assertPublicUrl` | `apps/api/src/modules/recipe/services/import/url/ssrf.ts` |
| `finance-bridge.ts` | `runFinanceBridge` | `apps/api/src/modules/finance/bridge.ts` |
| `finance-participants.ts` | `assignParticipants`, `updateParticipantDisplayName`, `type ParticipantAssignmentEntry` (re-exported from the service file) | `apps/api/src/modules/finance/services/participants/participants.service.ts` |
| `legacy-io.ts` | `runLegacy` | `apps/api/scripts/legacy/io.ts` |
| `legacy-run.ts` | `runLegacyMigration` | `apps/api/scripts/legacy/run.ts` |
| `legacy-users.ts` | `migrateUsers` | `apps/api/scripts/legacy/users.ts` |
| `legacy-households.ts` | `migrateHouseholds` | `apps/api/scripts/legacy/households.ts` |
| `legacy-recipe.ts` | `migrateRecipe` | `apps/api/scripts/legacy/recipe.ts` |
| `legacy-sources.ts` | `openLegacy` | `apps/api/scripts/legacy/sources.ts` |
| `finance-clock.ts` | `nowMs` | `apps/api/src/modules/finance/lib/clock.ts` |

The one door that is not a verbatim copy is `finance-clock.ts`: `nowMs` reads the module-private `override`, so the door is
`export function nowMs(): number { return Effect.runSync(financeTimeMillis); }` over the exported `financeTimeMillis` (the override when one
is set, else `Clock.currentTimeMillis` under the default services, which is `Date.now()`): the same value in both states, synchronous as
before. `apps/api/test/support/finance-harness.ts` and `apps/api/test/finance-clock.test.ts` import it from there (T04), so the case "the
synchronous nowMs keeps its override seam" keeps its assertions and runs against the door.

The migration is staged so every task leaves the tree green: T01 ADDS the door files beside the src bridges; T04 points the tests at them;
T05 and T06 delete the src bridges. A door is a test helper, not application code: it is never imported from `apps/api/src`,
`apps/api/scripts` or `apps/web` (T07's rule (20) and the T05/T06 greps).

**P2 — The test seams stay in `src`, named as seams (E7, E9; ADR 0009).** `setMailer`, `getMailer`, `isMailerOverridden`,
`resetRateLimits`, `setVerifiedEmailRequired`, `setImportDbForTests`, `setImportGuardForTests`, `setRemoteImageDownloaderForTests` and
`setClockForTest` mutate module-level state that the services of the ONE runtime read at call time. The tests drive the app through the
in-memory handler on that same runtime (one process, one database, ADR 0009), so a test layer cannot reach them; a seam is the smallest
correct mechanism. They keep their names and signatures; T05 renames the section headers of `rateLimit.ts` and `mail/index.ts` from
`legacy bridges` to `test seams: …` with the reason. `docs/EFFECT.md` E7's sentence "each removed by the milestone that moves its last
caller" is amended through ADR 0014 "Status after E8" (T10).

**P3 — The import-time client and `env.ts` stay; E8 decides (E5, E7; ADR 0009, ADR 0014).** `apps/api/src/db/client.ts` keeps creating the
process-wide client at import and `apps/api/src/env.ts` keeps re-exporting the resolved `env`: the tests' shared `db` (ADR 0009: `app.request`
sees only that database), `migrate-legacy.ts`'s pinned import order (`apps/api/test/legacy-cli.test.ts`, `apps/api/test/import-order.test.ts`)
and 23 synchronous `env` readers depend on them, and `Database.layer` already owns the client's lifetime (release closes it, never under
`NODE_ENV=test`). Moving client creation into the layer would change the import-order contract for no observable gain. Recorded in ADR 0014
"Status after E8", `docs/EFFECT.md` E5's sentence and §3.2, open-work O-7 (T10), CLAUDE.md (T11). No code changes.

**P4 — The legacy `ApiError` class leaves `src` (E6).** It moves verbatim (the class, `Symbol.hasInstance` deferring to `isApiError`, the ten
static helpers and whatever instance members it declares) to `apps/api/test/support/bridges/api-error.ts`, extending the `ApiFailure` it
extends today. `isApiError`, `toApiError`, `errorBody`, the boundary and every family member are untouched. `x instanceof ApiError` keeps
meaning `isApiError(x)` in the tests.

**P5 — The idiom fixes are equivalences (E3, E12).** `Predicate.isObject(v)` is `typeof v === "object" && v !== null && !Array.isArray(v)`
(`repos/effect/packages/effect/src/Predicate.ts` line 1071) and `Predicate.isObjectOrArray(v)` is `typeof v === "object" && v !== null`
(line 1038), so T02 replaces each guard by the one with the SAME truth table, never by `hasProperty` (which also admits functions).
`Clock.currentTimeMillis` under the live clock is `Date.now()`. `createAuthorization`'s provider check cannot fail where it is called (both
handlers check the provider first), so turning it into an `Effect.fnUntraced` changes no status.

**P6 — Comment hygiene (O-10).** Under `apps/api/src` and `apps/api/scripts`: (a) a comment that describes a symbol, section or file that
no longer exists ("the Hono section at the end (until E7-T12 deletes it)", `requireUser(c)`, `requireFinanceParticipantContext`, "until E7
replaces Hono", "the plan file is untracked until E7-T13", `runMigrations` after T05) is rewritten to describe the code as it is now, or
deleted; (b) a comment that names where a byte-exact value or behaviour came from (the pre-E7 app's `c.req.queries()` shape, `getPath`
decoding, `secureHeaders` spelling, `c.notFound()` wording, the `logger()` lines, the Hono 4.13.7 regex) keeps the provenance and carries the
literal `pre-E7` on the same line; (c) afterwards `grep -rnIE '\b[Hh]ono\b|\bc\.(req|json)\b' apps/api/src apps/api/scripts | grep -v pre-E7`
prints nothing; (d) a reworded comment contains no German word and never the English word "die" (an `i18n:check` stopword): the count stays
148. Test files keep their comments (they are history), except F14's line. (e) The sentence "has no legacy bridge" in a service that never had
one (`apps/api/src/core/services/auth/{passwords,bootstrap,emailVerification,invites,oauthAccounts}.ts`,
`apps/api/src/core/services/households/invites.service.ts`, `apps/api/src/modules/finance/services/plan/plan.service.ts`) is true and
stays; the `no-bridges` check matches only the colon form `legacy bridges?:` of a section header or bridge heading. The two such comments
that describe code E8 changes are rewritten by the task that owns their file: `apps/api/src/lib/oauth.ts:18` (it names the `Effect.runSync`
T02 removes) and `apps/api/src/db/database.ts:212` ("the legacy bridges (plan e2 P1) honour their old `db` argument": T03 rewords it to
the test doors of `apps/api/test/support/bridges/`, plan e8 P1).

**P7 — The idioms test switches on every E12 rule grep can see (E12).** T07 adds seven `describe`s in the file's shape (comment-free line
scan or a documented multi-line scan, a regex self-check per rule, `file:line: code` failures, pinned allow lists with a reason per entry
and a stale-entry check):

| Rule | Scope | Fails on | Allow list (path → reason) |
| --- | --- | --- | --- |
| (15) `Effect.fn` idioms | non-test `apps/api/src`, `apps/api/scripts`, `apps/web/src`, `packages/shared/src` | (a) `Effect.fn(` whose first argument is not a string literal (a literal is `"…"`, `'…'` OR a template literal `` `…` ``: ``Effect.fn(`recipe.imports.${name}`)`` in `apps/api/src/modules/recipe/routes/imports.ts:97` is a span name and passes); (b) `.pipe(` directly after the closing parenthesis of an `Effect.fn(…)(…)` or `Effect.fnUntraced(…)` call (paren-balanced scan over the file text, strings and comments skipped); (c) a declared function or `const` arrow whose body is only `return Effect.gen(` / `=> Effect.gen(` | empty |
| (16) `return yield*` when raising | same | `yield* new X(` or `yield* Effect.fail(` / `failCause(` / `die(` / `dieMessage(` not preceded by `return` on the line | empty |
| (17) errors are tagged | `apps/api/src`, `apps/api/scripts` | `class X extends Error` (or `TypeError` / `RangeError`); `instanceof X` where `X` ends in `Error` and is not the builtin `Error` | `apps/api/scripts/finance-import/amounts.ts`: the pure workbook parser's error (E3, plan e5 deviation 5); `apps/api/scripts/finance-import-xlsx.ts`: the pure extraction loop that catches it |
| (18) `Predicate` instead of hand-written object guards | `apps/api/src`, `apps/api/scripts` | `typeof x === "object"` paired with `x !== null` on one line, either order | empty (after T02) |
| (19) the Clock on the request path | `apps/api/src/http/`, `apps/api/src/middleware/`, every `routes/` directory under `apps/api/src` | `Date.now(` or `new Date()` with no argument | empty (after T02) |
| (20) Effect runs only at the edges | non-test `apps/api/src` | ONE regex, `\b(Effect\|runtime)\.run\w*\(`: every runner of `repos/effect/packages/effect/src/Effect.ts` (`runPromise`, `runPromiseExit`, `runSync`, `runSyncExit`, `runFork`, `runCallback` and the `…With` forms `runPromiseWith`, `runPromiseExitWith`, `runSyncWith`, `runSyncExitWith`, `runForkWith`, `runCallbackWith`) and every `runtime.run…(` | six entries: `apps/api/src/index.ts`: the boot and the shutdown; `apps/api/src/http/in-memory.ts`: the tests' handler warms the runtime; `apps/api/src/config.ts`: the eager validation at import (`env.ts`); `apps/api/src/core/routes/system.ts`: `runtime.runPromise(healthResponse)` pinned by `apps/api/test/runtime.test.ts` (b) (E0); `apps/api/src/modules/recipe/services/ocr/tesseract.ts`: the Promise `OcrEngine` contract (plan e3); `apps/api/src/db/database.ts`: `Database.transaction`'s drizzle callback runs the inner effect under the open transaction (`Effect.runPromiseExitWith(inner)`, the one way into a Promise-callback API that holds the tx) |
| (21) no Effect 3 API names | `ALL_FILES` (as rules (1) to (4)) | `Effect.catchAll(`, `Effect.catchAllCause(`, `Effect.catchSome(`, `Effect.either(`, `Either.`, `FiberRef`, `.annotations(`, `Effect.zipRight(`, `Effect.zipLeft(`, `Schema.decodeUnknown(` — each name only after T07 confirmed with `grep -n "export const <name>"` in `repos/effect/packages/effect/src/` that v4 has no export of that name with that meaning (a name v4 still has is left out and recorded) | empty |

The `PENDING_RULES` header lists none and says E8 switched on (15) to (21). Never relax a rule to get green: a hit is fixed in the code.

**P8 — The pass count never drops (E3, E9).** Floor 15191 for every task's branch. A list entry whose file a task deletes is REPLACED, not
dropped: `apps/api/test/import-order-effect.test.ts`'s entry `./src/modules/finance/bridge.ts` becomes `./src/modules/finance/http.ts`
(not yet an entry) in T06. No test case is removed: F14's `trySendMail` case and finance-clock's "the synchronous nowMs keeps its override
seam" both run against their doors (P1).

**P9 — Docs as built (E8 exit).** CLAUDE.md keeps its section skeleton (Read order, Fixed decisions, Building it, Vendored reference code,
Status, Layout, Commands, Conventions, Gotchas in use, Retired gotchas, Open work) and is rewritten from the tree, not from the plans: the
Status becomes a short paragraph (all milestones done, the final pass count, where each record lives), Conventions gains "Effect idioms"
(the E12 list mapped to idioms rules (1) to (21)), every gotcha in use names the file or test that pins it, and "Retired gotchas" gains one
entry per gotcha Effect or E8 made obsolete ("Bridges until E8", the `nowMs` allow entry, …) with what remains of it. `docs/API.md` changes
implementation prose only, never a table row. Every pattern file ends with "## 7. In this repo" holding at least one fenced example COPIED
from the current tree with its repo path. `docs/EFFECT.md` §3 lists what exists. `apps/api/test/docs-paths.test.ts` scans `docs/EFFECT.md`
and `agent-patterns/*.md` too, accepts the prefixes `agent-patterns/` and `repos/effect/`, and pins that CLAUDE.md names `docs/EFFECT.md`,
`repos/effect/LLMS.md` and `agent-patterns/`.

**P10 — The final proofs (§5).** E8-T12 runs, on the merged tree, each gate as one log ending `exit=$?`: frozen install, typecheck, the full
`bun test` (count ≥ 15191, 0 fail), build with the bundle sum (419.99 kB expected), `i18n:check` (148, classified line-number-free against
`4bc9512fc`), the idioms and docs tests, `git status --porcelain repos/`; then the boot-and-shutdown check (idle SIGTERM and SIGTERM with a
slow upload in flight, as `docs/plans/e7-http-api.md` 9.4), a curl walkthrough of `docs/plans/m7-harden.md` §9.3 against the built app on a
scratch database, and the local stack test of `docs/deployment.md` (compose project `toon-household-local`, torn down with `down -v`).

### 2.1 What the plan review changed (2026-11-06)

- `nowMs` has two test importers, not one (`apps/api/test/finance-clock.test.ts:28` and its case at lines 105 to 115): it became the 19th
  door (`apps/api/test/support/bridges/finance-clock.ts`, T01), T04 moves both imports (S8, M18), T06 no longer edits the harness (P1, F3).
- T06 deletes `apps/api/src/modules/finance/bridge.ts`, which `CLAUDE.md` (three lines) and `docs/modules/finance.md` (one line) name and
  `apps/api/test/docs-paths.test.ts` checks: T06 rewrites those four mentions in the same commit (section 3, T06).
- `no-bridges` matched the true sentence "has no legacy bridge" in files no task owns: it now matches only `legacy bridges?:` headers;
  the two comments that become false are given to T02 (`oauth.ts`) and T03 (`database.ts:212`) (P6(e)).
- `imports` scanned the door files themselves (`api-error.ts` needs `import type { ApiError as ApiErrorBody } from "@toon/shared"`): it
  skips `apps/api/test/support/bridges/` and counts only specifiers into `src/` or `scripts/`.
- T04 is a Sonnet `build` task (77 files) with an `import-shape` diff check, not a Haiku rewrite.
- T01's door tests follow explicit isolation rules (ADR 0009's one process and one database).
- Rule (20) is one regex over every runner, `…With` forms included, and allow-lists `apps/api/src/db/database.ts` (the transaction
  callback); rule (15)(a) counts a template literal as a span name (`apps/api/src/modules/recipe/routes/imports.ts:97`).
- T08 and T09 write vendored paths as `repos/effect/packages/…` (the 14 bare ones listed) and T09's Bun platform path is
  `repos/effect/packages/platform/bun/src/`; a `paths` pre-check joined `docs/plans/e8-verify.sh`.

## 3. Waves and file ownership

Merged in id order; two tasks of one wave share no file.

| Wave | Tasks | Owns |
| --- | --- | --- |
| 1 | T01 (core), T02 (build), T03 (build) | T01: the 19 new door files and `apps/api/test/bridges-{core,modules}.test.ts`, plus the `export` keyword on private helpers in `rateLimit.ts`, `mail/index.ts`, `url/fetch.ts` (and any other src file T01 lists in its commit body; never a file T02 or T03 owns). T02: the idiom-fix files. T03: the comment-only files of P6 |
| 2 | T04 (build) | the 77 test files of 1.4 (import lines only; `apps/api/test/support/finance-harness.ts` included) |
| 3 | T05 (core), T06 (build) | T05: the core bridge files and `apps/api/test/bridges-core.test.ts`; T06: the module and script bridge files, `apps/api/test/bridges-modules.test.ts`, `apps/api/test/import-order-effect.test.ts`, `apps/api/test/effect-idioms.test.ts` (the `ALLOW_NOW_MS` entry only), and the four inline-code mentions of `apps/api/src/modules/finance/bridge.ts` in `CLAUDE.md` (lines 270, 466, 554) and `docs/modules/finance.md` (line 123) (nothing else in those two docs; T10 and T11 own them later) |
| 4 | T07 (build) | `apps/api/test/effect-idioms.test.ts` |
| 5 | T08, T09, T10 (build) | T08: six pattern files; T09: the other six; T10: `docs/API.md`, both module docs, `docs/open-work.md`, ADR 0014, `docs/EFFECT.md` |
| 6 | T11 (core) | `CLAUDE.md`, `apps/api/test/docs-paths.test.ts`, `README.md`; any path fix the extended docs-paths test demands in a pattern file or `docs/EFFECT.md` |
| 7 | T12 (build) | `docs/plans/e8-harden.md` sections 9 and 10, the Status line of `CLAUDE.md`, the E8 "as built" sentence of `docs/EFFECT.md`, a finding's fix |

## 4. Tasks

**The verification script.** `docs/plans/e8-verify.sh` (written with this plan, the shape of `docs/plans/e5-verify.sh`) holds the checks the
tasks' verify lists call: `tests` (the whole suite, 0 fail, at least 15191 pass), `i18n` (parity OK and exactly 148 hits), `repos`,
`imports` (no test imports a door name, `nowMs` included, from a specifier that reaches into `src/` or `scripts/`; the door files under
`apps/api/test/support/bridges/` and the two door tests are skipped, so `api-error.ts`'s `import type { ApiError as ApiErrorBody } from
"@toon/shared"` is no hit), `import-shape [ref]` (T04: since `ref`, default `4bc9512fc`, every changed line under `apps/api/test` outside the
door files is an import line, a member line of a multi-line import or the M14 comment), `no-bridges core|modules|all` (no door `export
function` and no `legacy bridges?:` header left in its scope; `modules` also wants `apps/api/src/modules/finance/bridge.ts` gone and named
neither in `CLAUDE.md` nor in `docs/modules/finance.md`, and the import-order entry replaced), `guards` (T02), `hono [files]` (P6(c) plus the
stale references), `comments-only <files>` (T03), `paths <docs>` (every inline-code span starting `apps/`, `packages/`, `scripts/`, `docs/`,
`docker/`, `agent-patterns/` or `repos/effect/` exists; a quick pre-check of what T11's extended `apps/api/test/docs-paths.test.ts` asserts),
`patterns <files>` (P9), `api-rows` (no `docs/API.md` row changed since `4bc9512fc`) and `frozen` (the web, the deployment files, the
migrations and the catalogs unchanged since `4bc9512fc`). On HEAD `4bc9512fc`: `i18n`, `repos`, `import-shape`, `api-rows` and `frozen` pass,
`paths` passes on `CLAUDE.md`, `docs/EFFECT.md` and the module docs; `imports`, `guards`, `hono`, `no-bridges` and `patterns` fail with exactly
the findings of 1.3, and `paths agent-patterns/*.md` lists the 14 bare vendored paths and the one missing repo path of T08's and T09's briefs,
which is what the tasks fix. Inside a task worktree, run a check against the worktree with
`E8_ROOT=<worktree root> bash /home/erics/software/toon-household/docs/plans/e8-verify.sh <check>`. A task never edits or commits the
script; T12 commits it with this plan if they are still untracked.

Every task reads first: `docs/EFFECT.md` §1 (E3, E7, E9, E12 at least) and §4 E8; this plan's sections 1 and 2; CLAUDE.md "Gotchas in use"
(at least "One runtime, disposed on shutdown", "One composition point", "Bridges until E8", "The error family and the one boundary mapper",
"The `Database` service and the shared client", "The mail seam", "The idioms test is the E12 gate", "A test that runs `sharp` carries an
explicit time budget", "Long commands"); `repos/effect/LLMS.md` whole before writing Effect code; the pattern files the task names. Every
signature is looked up in `repos/effect/packages/effect/src/`, never recalled. Commit per task; the body names the EFFECT.md decision and
this plan's decision; trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. `git status --porcelain repos/` is empty after
every task.

### E8-T01 — The doors in test support (core)

Create the 19 door files of P1 under `apps/api/test/support/bridges/`, each a faithful copy of its src bridge (the body, the doc comment with
the caller list updated to say "moved from <src path> at E8 (plan e8 P1)", the explicit return type). Do NOT delete anything from src and do
NOT change any test file: both copies coexist until T05/T06. Where a door needs a private helper, add only the `export` keyword to it:
`checkIn` in `apps/api/src/core/services/auth/rateLimit.ts`; `plain` and `makeMailer` in `apps/api/src/core/services/mail/index.ts`;
`guardNow` and `fetchHtmlWith` in `apps/api/src/modules/recipe/services/import/url/fetch.ts`; list any other in the commit body.
`runFinanceBridge`'s door keeps the rejection rule (a `DatabaseError` rejects with its `cause`); the finance-participants door calls the
finance-bridge door. `finance-clock.ts` is P1's one non-verbatim door: `export function nowMs(): number { return
Effect.runSync(financeTimeMillis); }`, importing only `effect` and `apps/api/src/modules/finance/lib/clock.ts` (no `export` keyword is added
in `clock.ts`: `financeTimeMillis` is exported already). `legacy-io.ts` holds `runLegacy`; the five legacy doors import it from `./legacy-io.ts` and the `…Effect` forms from
their script file. `api-error.ts` is P4. Add two door tests, `apps/api/test/bridges-core.test.ts` (the doors `migrate`, `api-error`,
`sessions`, `users`, `rate-limit`, `mail`) and `apps/api/test/bridges-modules.test.ts` (the recipe, finance and legacy doors): for each door
one case that calls the door and the src bridge with the same input and asserts the same outcome (resolved value, or the rejected error's
`_tag` / `code` / identity rule); `checkRateLimit` and `importFromText` called synchronously; `runMigrations` on a fresh temp database each
(`createDatabase` on a scratch `file:` URL, never the shared `db`); `nowMs` with the override pinned (`setClockForTest(<fixed ms>)`, both
equal it) and released (both within `[Date.now() before, Date.now() after]`), `setClockForTest(null)` in `afterEach`.

**Isolation (ADR 0009: every test file runs in ONE process on ONE shared database and ONE module-level rate-limit store).** A door test
leaves nothing behind that a later file could see: `checkRateLimit` is called only with a key unique to this file (e.g.
`bridges-core:<crypto.randomUUID()>`) and a rule object of its own (never `LOGIN_RULE` on a fixed address), and the file calls
`resetRateLimits()` in `afterAll`; `createSession` and `claimPlaceholderUser` run on rows the file creates itself (a fresh user, a fresh
placeholder in a fresh household) and the file deletes them in `afterAll` (households first, so the cascade takes memberships and
sessions; then the users), asserting before and after that the counts of `users`, `households` and `sessions` are back to the values it
recorded in `beforeAll` (the shape of `apps/api/test/legacy-placeholders.test.ts`); `trySendMail` runs under a recording mailer installed
with `setMailer` and released with `setMailer(null)` in `afterAll` (`apps/api/test/support/effect.ts` `recordingMailer`); the clock override
is released after every case; the legacy doors run on the legacy harness's temp databases (`apps/api/test/support/legacy-harness.ts`), never
the shared one. These two files import every src bridge ALIASED
(`import { runMigrations as bridgeRunMigrations } from "../src/db/migrate.ts";`), so T04's `sed` lines never match them and T04's import scan
skips them by name. T05 rewrites `bridges-core.test.ts` and T06 `bridges-modules.test.ts` to compare each door with its `Effect` form instead
(case count kept).

Read: plan P1, P4; ADR 0014 "Status after E5's integration"; each bridge section in its src file; `apps/api/test/support/effect.ts`;
`apps/api/test/legacy-placeholders.test.ts` (the count-restoring `afterAll`); `apps/api/test/rate-limiter.test.ts` (the limiter's keys);
`agent-patterns/effect-testing.md`, `agent-patterns/effect-services.md`; CLAUDE.md "Bridges until E8" (the calling-convention rule: a
synchronous export stays synchronous).

### E8-T02 — The idiom fixes (build)

Exactly these edits (P5), plus P6 for the Hono comments of the files this task owns:

| File | Old | New |
| --- | --- | --- |
| `apps/api/src/modules/recipe/services/import/url/schema-map.ts` (line 31) | `typeof value === "object" && value !== null && !Array.isArray(value)` | `Predicate.isObject(value)` |
| `apps/api/src/modules/recipe/services/import/url/jsonld.ts` (line 155) | same | `Predicate.isObject(value)` |
| `apps/api/src/core/services/households/validation.ts` (line 22) | `rawBody !== null && typeof rawBody === "object"` | `Predicate.isObjectOrArray(rawBody)` |
| `apps/api/scripts/legacy/uploads.ts` (line 43) | `typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)` | `Predicate.isObject(parsed)` (the rest of the expression unchanged) |
| `apps/api/scripts/legacy/recipe.ts` (line 89) | `typeof value === "object" && value !== null && "skip" in value` | `Predicate.isObjectOrArray(value) && "skip" in value` |
| `apps/api/scripts/legacy/mapping.ts` (line 70) | `typeof value === "object" && value !== null && !Array.isArray(value)` | `Predicate.isObject(value)` |
| `apps/api/src/modules/recipe/routes/shopping.ts` | `parseSinceQuery(raw)` reads `Date.now()` | `parseSinceQuery(raw, now)`; its one caller (the `GET /?since` handler) passes `yield* Clock.currentTimeMillis` |
| `apps/api/src/lib/oauth.ts` | `createAuthorization(provider, settings)`: a function running `Effect.runSync(checkProviderConfigured(…))` | `export const createAuthorization = Effect.fnUntraced(function* (provider, settings = env): Effect.fn.Return<OAuthStart, ApiFailure> { yield* checkProviderConfigured(provider, settings); … })` |
| `apps/api/src/lib/oauth.ts` (header comment, lines 16 to 18: `createAuthorization` listed among the plain pure helpers) | the sentence saying `createAuthorization` refuses an unconfigured provider synchronously with `Effect.runSync` over the same check | the sentence says what the code now does (`createAuthorization` is an `Effect.fnUntraced` that fails with the same refusal and is yielded by the two OAuth start handlers); "has no legacy bridge" may stay (P6(e)) |
| `apps/api/src/core/routes/auth.ts` (the two OAuth start handlers) | `const start = createAuthorization(provider);` | `const start = yield* createAuthorization(provider);` |

`Predicate` comes from `"effect"` (merge into the file's existing `effect` import). A type guard whose return type is `value is Record<string,
unknown>` keeps that signature. Nothing else in these files changes except P6 comments.

Read: P5, P6; `repos/effect/packages/effect/src/Predicate.ts` (`isObject`, `isObjectOrArray`); `agent-patterns/effect-core.md`,
`agent-patterns/effect-datetime-clock.md`; `docs/modules/recipe.md` 4a and the recipe import gotchas (the URL import guard);
`apps/api/test/oauth-callback.test.ts`, `apps/api/test/shopping.test.ts` (the `since` clamp).

### E8-T03 — Comment hygiene (build)

P6 over these files and only these: `apps/api/src/http/{request,app,middleware,global,response,in-memory,cookies,server,context}.ts`,
`apps/api/src/middleware/{cors,securityHeaders,requestLog,session,household,verifiedEmail,module,originGuard}.ts`, `apps/api/src/runtime.ts`,
`apps/api/src/modules/mount.ts`, `apps/api/src/modules/finance/middleware.ts`, `apps/api/src/lib/{validate,types,cookies,locale,http}.ts`,
`apps/api/src/core/routes/system.ts`, `apps/api/src/modules/recipe/routes/index.ts`, `apps/api/src/modules/recipe/services/shopping/items.service.ts`
(`requireUser(c).id`), `apps/api/src/db/{client,database}.ts` ("until E8 decides" becomes P3's decision; in `database.ts` also line 212,
"the legacy bridges (plan e2 P1) honour their old `db` argument", which becomes the test doors of `apps/api/test/support/bridges/` (plan e8
P1) and the core's own callers, P6(e)). Comments only: `git diff` of the
task shows no changed code line (verify by the comment-only check below).

Read: P3, P6; `docs/open-work.md` O-10; `docs/plans/e7-http-api.md` P4, P8, P10, P11 (the provenance each comment records); CLAUDE.md
"Middleware, APIs and handler layers are TDZ-safe", "Middleware chain order is load-bearing".

### E8-T04 — The tests import the doors (build)

Mechanical, but 77 files and 18 hand-made splits: too many for a Haiku rewrite task (the workflow caps those at about 15 files), so it is
a Sonnet task held to a spelled-out table and a diff-shape check. Run S1 to S8 from the repo root, then apply M1 to M18 by hand, then
nothing else. Do not reorder imports, do not touch another line. `bash docs/plans/e8-verify.sh import-shape` proves the shape (every changed
line under `apps/api/test`, outside the door files and the two door tests, is an import line, a member line of a multi-line import or the M14
comment); `imports` proves completeness.

Single-line substitutions (each `sed -i` exactly as written):

```bash
cd /home/erics/software/toon-household
# S1 runMigrations
sed -i 's#^import { runMigrations } from "\.\./src/db/migrate\.ts";$#import { runMigrations } from "./support/bridges/migrate.ts";#' apps/api/test/*.test.ts
sed -i 's#^import { runMigrations } from "\.\./\.\./src/db/migrate\.ts";$#import { runMigrations } from "../support/bridges/migrate.ts";#' apps/api/test/import/*.ts
sed -i 's#^import { runMigrations } from "\.\./\.\./src/db/migrate\.ts";$#import { runMigrations } from "./bridges/migrate.ts";#' apps/api/test/support/legacy-harness.ts
# S2 ApiError (single-name lines)
sed -i 's#^import { ApiError } from "\.\./src/lib/errors\.ts";$#import { ApiError } from "./support/bridges/api-error.ts";#' apps/api/test/*.test.ts
sed -i 's#^import { ApiError } from "\.\./\.\./src/lib/errors\.ts";$#import { ApiError } from "../support/bridges/api-error.ts";#' apps/api/test/import/*.ts
# S3 createSession
sed -i 's#^import { createSession } from "\.\./src/core/services/auth/sessions\.ts";$#import { createSession } from "./support/bridges/sessions.ts";#' apps/api/test/*.test.ts
sed -i 's#^import { createSession } from "\.\./\.\./src/core/services/auth/sessions\.ts";$#import { createSession } from "../support/bridges/sessions.ts";#' apps/api/test/import/*.ts
# S4 claimPlaceholderUser, runFinanceBridge
sed -i 's#^import { claimPlaceholderUser } from "\.\./src/core/services/auth/users\.ts";$#import { claimPlaceholderUser } from "./support/bridges/users.ts";#' apps/api/test/placeholders.test.ts
sed -i 's#^import { runFinanceBridge } from "\.\./src/modules/finance/bridge\.ts";$#import { runFinanceBridge } from "./support/bridges/finance-bridge.ts";#' apps/api/test/finance-clock.test.ts apps/api/test/finance-security.test.ts
# S5 recipe doors (single-name lines)
sed -i 's#^import { createDraft } from "\.\./\.\./src/modules/recipe/services/import/drafts\.ts";$#import { createDraft } from "../support/bridges/recipe-drafts.ts";#' apps/api/test/import/ocr-disabled.test.ts
sed -i 's#^import { importFromText } from "\.\./\.\./src/modules/recipe/services/import/ocr/index\.ts";$#import { importFromText } from "../support/bridges/recipe-ocr.ts";#' apps/api/test/import/ocr-disabled.test.ts
sed -i 's#^import { fetchHtml } from "\.\./\.\./src/modules/recipe/services/import/url/fetch\.ts";$#import { fetchHtml } from "../support/bridges/recipe-fetch.ts";#' apps/api/test/import/ssrf.test.ts
# S6 legacy doors (single-name lines) in apps/api/test/*.test.ts
sed -i 's#^import { migrateHouseholds } from "\.\./scripts/legacy/households\.ts";$#import { migrateHouseholds } from "./support/bridges/legacy-households.ts";#' apps/api/test/*.test.ts
sed -i 's#^import { migrateRecipe } from "\.\./scripts/legacy/recipe\.ts";$#import { migrateRecipe } from "./support/bridges/legacy-recipe.ts";#' apps/api/test/*.test.ts
sed -i 's#^import { runLegacyMigration } from "\.\./scripts/legacy/run\.ts";$#import { runLegacyMigration } from "./support/bridges/legacy-run.ts";#' apps/api/test/*.test.ts
sed -i 's#^import { migrateUsers } from "\.\./scripts/legacy/users\.ts";$#import { migrateUsers } from "./support/bridges/legacy-users.ts";#' apps/api/test/*.test.ts
sed -i 's#^import { openLegacy } from "\.\./scripts/legacy/sources\.ts";$#import { openLegacy } from "./support/bridges/legacy-sources.ts";#' apps/api/test/*.test.ts
sed -i 's#^import { runLegacy } from "\.\./scripts/legacy/io\.ts";$#import { runLegacy } from "./support/bridges/legacy-io.ts";#' apps/api/test/*.test.ts
# S7 the legacy harness
sed -i 's#^import { openLegacy } from "\.\./\.\./scripts/legacy/sources\.ts";$#import { openLegacy } from "./bridges/legacy-sources.ts";#' apps/api/test/support/legacy-harness.ts
# S8 nowMs in the finance harness (the second nowMs importer, M18 is the first)
sed -i 's#^import { nowMs } from "\.\./\.\./src/modules/finance/lib/clock\.ts";$#import { nowMs } from "./bridges/finance-clock.ts";#' apps/api/test/support/finance-harness.ts
# apps/api/test/bridges-core.test.ts and apps/api/test/bridges-modules.test.ts (T01) are left alone: their aliased imports never match
```

Multi-name imports (by hand; "add after" means a new line directly after the edited import statement):

| # | File | Old | New |
| --- | --- | --- | --- |
| M1 | `apps/api/test/errors.test.ts` | the line `  ApiError,` inside the `import { … } from "../src/lib/errors.ts";` block | line removed; add after the block `import { ApiError } from "./support/bridges/api-error.ts";` |
| M2 | `apps/api/test/finance-clock.test.ts` | `import { ApiError, DatabaseError, NotFound } from "../src/lib/errors.ts";` | `import { DatabaseError, NotFound } from "../src/lib/errors.ts";` + add after `import { ApiError } from "./support/bridges/api-error.ts";` |
| M3 | `apps/api/test/finance-services-local.test.ts` | `import { ApiError, ApiFailure, Conflict } from "../src/lib/errors.ts";` | `import { ApiFailure, Conflict } from "../src/lib/errors.ts";` + add after `import { ApiError } from "./support/bridges/api-error.ts";` |
| M4 | `apps/api/test/module-adapter.test.ts` | `import { ApiError, type ApiErrorFamily, isApiError, NotFound } from "../src/lib/errors.ts";` | `import { type ApiErrorFamily, isApiError, NotFound } from "../src/lib/errors.ts";` + add after `import { ApiError } from "./support/bridges/api-error.ts";` |
| M5 | `apps/api/test/finance-module.test.ts` | the block `import {` / `assignParticipants,` / `type ParticipantAssignmentEntry,` / `updateParticipantDisplayName,` / `} from "../src/modules/finance/services/participants/participants.service.ts";` | the same block with the specifier `"./support/bridges/finance-participants.ts"` |
| M6 | `apps/api/test/import/import-http.test.ts` | the line `  fetchHtml,` in the `… from "../../src/modules/recipe/services/import/url/fetch.ts";` block | line removed; add after the block `import { fetchHtml } from "../support/bridges/recipe-fetch.ts";` |
| M7 | `apps/api/test/import/ocr-segment.test.ts` | the line `  importFromText,` in the `… from "../../src/modules/recipe/services/import/ocr/index.ts";` block | line removed; add after the block `import { importFromText } from "../support/bridges/recipe-ocr.ts";` |
| M8 | `apps/api/test/import/ssrf.test.ts` | the line `  assertPublicUrl,` in the `… from "../../src/modules/recipe/services/import/url/ssrf.ts";` block | line removed; add after the block `import { assertPublicUrl } from "../support/bridges/recipe-ssrf.ts";` |
| M9 | `apps/api/test/legacy-framework.test.ts` | `import { LEGACY_SCHEMAS, LegacyInputError, openLegacy, readAll, snapshotDatabase } from "../scripts/legacy/sources.ts";` | `import { LEGACY_SCHEMAS, LegacyInputError, readAll, snapshotDatabase } from "../scripts/legacy/sources.ts";` + add after `import { openLegacy } from "./support/bridges/legacy-sources.ts";` |
| M10 | `apps/api/test/legacy-households.test.ts` | `import { migrateHouseholds, NO_ACCOUNT_MEMBERS_NOTE, SOLO_SEAT_NOTE } from "../scripts/legacy/households.ts";` | `import { NO_ACCOUNT_MEMBERS_NOTE, SOLO_SEAT_NOTE } from "../scripts/legacy/households.ts";` + add after `import { migrateHouseholds } from "./support/bridges/legacy-households.ts";` |
| M11 | `apps/api/test/legacy-users.test.ts` | `import { migrateUsers, OAUTH_ONLY_NOTE } from "../scripts/legacy/users.ts";` | `import { OAUTH_ONLY_NOTE } from "../scripts/legacy/users.ts";` + add after `import { migrateUsers } from "./support/bridges/legacy-users.ts";` |
| M12 | `apps/api/test/legacy-io.test.ts` | `import { legacyTry, liftTagged, runLegacy } from "../scripts/legacy/io.ts";` | `import { legacyTry, liftTagged } from "../scripts/legacy/io.ts";` + add after `import { runLegacy } from "./support/bridges/legacy-io.ts";` |
| M13 | `apps/api/test/mail.test.ts` | the line `  trySendMail,` in the `… from "../src/core/services/mail/index.ts";` block | line removed; add after the block `import { trySendMail } from "./support/bridges/mail.ts";` |
| M14 | `apps/api/test/mail.test.ts` (line 107, F14) | the comment `// The Promise bridge (its one caller is this test, E8 removes it) has the same contract.` (keep its indentation) | `// The Promise door (its one caller is this test; moved to test/support/bridges/mail.ts at E8, plan e8 P1) has the same contract.` |
| M15 | `apps/api/test/auth.test.ts` | `import { LOGIN_RULE, checkRateLimit, resetRateLimits } from "../src/core/services/auth/rateLimit.ts";` | `import { LOGIN_RULE, resetRateLimits } from "../src/core/services/auth/rateLimit.ts";` + add after `import { checkRateLimit } from "./support/bridges/rate-limit.ts";` |
| M16 | `apps/api/test/rate-limiter.test.ts` | the line `  checkRateLimit,` in the `… from "../src/core/services/auth/rateLimit.ts";` block | line removed; add after the block `import { checkRateLimit } from "./support/bridges/rate-limit.ts";` |
| M17 | `apps/api/test/import/helpers.ts` | covered by S2 (`import { ApiError } from "../../src/lib/errors.ts";`) | nothing more |
| M18 | `apps/api/test/finance-clock.test.ts` (line 28) | `import { financeTimeMillis, nowMs, setClockForTest } from "../src/modules/finance/lib/clock.ts";` | `import { financeTimeMillis, setClockForTest } from "../src/modules/finance/lib/clock.ts";` + add after `import { nowMs } from "./support/bridges/finance-clock.ts";` |

After S1 to S8 and M1 to M18 the import scan of the verify list must print nothing. If it lists a file, apply the same pattern (specifier
swap for a single-name line, split for a multi-name line); if a case is not covered by a pattern, stop and report it instead of designing.

Read: P1, P8; this task only. CLAUDE.md "Tests" convention (`apps/api/test/`, never `tests/`). Verify: `imports`, `import-shape`,
typecheck, the import-order, legacy-cli, finance-clock and door tests, then the whole suite.

### E8-T05 — The core bridges leave `src` (core)

Delete from src, with their bridge sections, every core door T04 redirected: `runMigrations` (`apps/api/src/db/migrate.ts`; `migrateDatabase`
stays), `createSession` (`sessions.ts`), `claimPlaceholderUser` (`users.ts`), `checkRateLimit` (`rateLimit.ts`; `checkIn` stays exported),
`trySendMail` (`mail/index.ts`; the `MailerService` method of that name stays), and the `ApiError` class with its statics from
`apps/api/src/lib/errors.ts` (P4). Rename the remaining sections of `rateLimit.ts` and `mail/index.ts` to `/* test seams: … */` with P2's
reason. Rewrite the comments in these files and in `apps/api/src/modules/index.ts`, `apps/api/src/modules/types.ts`,
`apps/api/src/modules/recipe/migrate.ts` that name a deleted symbol (`runMigrations` becomes `migrateDatabase`, "the legacy `ApiError`
included" goes), plus P6 for the Hono comments of the files this task owns. Rewrite `apps/api/test/bridges-core.test.ts` so each case
compares the door with the `Effect` form it wraps (run through `runTest` or `Effect.runPromise` / `Effect.runSync` as the door does); it keeps
its case count. Remove imports the deletions leave unused.

Read: P1, P2, P4, P6, P8; `apps/api/src/lib/errors.ts` whole; ADR 0014; `agent-patterns/effect-errors.md`, `agent-patterns/effect-services.md`;
CLAUDE.md "The error family and the one boundary mapper", "The mail seam", "Catch-all stays catch-all".

### E8-T06 — The module and script bridges leave `src` (build)

Delete the recipe doors (`createDraft` from `drafts.ts`, `importFromText` from `ocr/index.ts`, `fetchHtml` from `url/fetch.ts`, `assertPublicUrl`
from `url/ssrf.ts`), the finance doors (`assignParticipants`, `updateParticipantDisplayName` from `participants.service.ts`; the whole
`apps/api/src/modules/finance/bridge.ts`), the legacy doors (`runLegacyMigration`, `migrateUsers`, `migrateHouseholds`, `migrateRecipe`,
`openLegacy` from their files; `runLegacy` from `io.ts` and its re-export line in `run.ts`), and `nowMs()` from
`apps/api/src/modules/finance/lib/clock.ts` (F3: both importers, `apps/api/test/support/finance-harness.ts` and
`apps/api/test/finance-clock.test.ts`, take it from the door `apps/api/test/support/bridges/finance-clock.ts` since T04, so neither file is
touched here). In `apps/api/test/effect-idioms.test.ts` set
`ALLOW_NOW_MS` to `{}` and fix its comment (the stale-entry check would fail otherwise). In `apps/api/test/import-order-effect.test.ts`
replace the entry `./src/modules/finance/bridge.ts` by `./src/modules/finance/http.ts` (P8). Rewrite the comments that name a deleted symbol
(`accrual.service.ts` line 15, `finance/layer.ts`, `clock.ts`'s header, `io.ts`'s header, the `@throws … instanceof ApiError` doc). Rewrite
`apps/api/test/bridges-modules.test.ts` so each case compares the door with the `Effect` form it wraps (case count kept; the `nowMs` case
compares the door with `Effect.runSync(financeTimeMillis)` / `Effect.runPromise(financeTimeMillis)` under a pinned and a released override).
Rule (12)(c) (no `await` under `scripts/legacy/`) keeps holding.

**The docs that name the deleted file.** `apps/api/test/docs-paths.test.ts` requires every inline-code path of `CLAUDE.md` and
`docs/modules/*.md` to exist, so the commit that deletes `apps/api/src/modules/finance/bridge.ts` also rewrites its four mentions, and only
those: `CLAUDE.md` line 270 (Layout, "Finance services (E4)"), line 466 ("Bridges until E8": the finance Promise bridge) and line 554 ("Hooks
are Effects": "every finance bridge through `runFinanceBridge`, …"), and `docs/modules/finance.md` line 123. Each names the door instead,
`apps/api/test/support/bridges/finance-bridge.ts` (`runFinanceBridge`, moved there at E8, plan e8 P1), with the smallest rewording that keeps
the sentence true; T10 and T11 rewrite those docs as a whole later. `bash docs/plans/e8-verify.sh no-bridges modules` greps for the old path
in both files and `bun test apps/api/test/docs-paths.test.ts` is in this task's verify, so wave 3 and every later task keep a green
docs-paths test.

Read: P1, P8; ADR 0014 tables; `apps/api/test/docs-paths.test.ts` (what it scans); `docs/modules/recipe.md` 4a ("Import route tests use real sessions", the URL import guard gotcha),
`docs/modules/finance.md` 4a ("The `start` hook and the clock"); CLAUDE.md "The CLI never imports `src/env.ts`…" (the legacy library's
import order: no new static import in `scripts/legacy/*`), "Hooks are Effects; both manifests are `ApiModule`s"; `agent-patterns/effect-testing.md`.

### E8-T07 — Idioms rules (15) to (21) (build)

Add the seven `describe`s of P7 to `apps/api/test/effect-idioms.test.ts`, each with a regex self-check (a positive and a negative example)
like rule (11)'s (rule (15)(a): a template-literal name such as ``Effect.fn(`recipe.imports.${name}`)`` is a NEGATIVE example, it passes;
rule (20): `Effect.runPromiseExitWith(x)(y)` and `Effect.runSyncWith(ctx)(e)` are POSITIVE examples, the single regex
`\b(Effect|runtime)\.run\w*\(` catches every `…With` runner, and `runtime.context()` is a negative one), the allow lists of P7 with a stale-entry test where the list is non-empty, and the header's `PENDING_RULES` comment updated
("E8 switched on rules (15) to (21)"). Update rule (12)'s comment that says the Promise bridges return `runLegacy(...)` (they are test doors
now). The multi-line scans of (15)(b) and (15)(c) are functions in the file, documented; they skip comments and string literals. If a rule
finds a hit in the tree, fix the CODE in this task (a two-line fix) and say so in the commit body; never widen a rule's allow list beyond P7.
Expected on the merged tree of wave 3: rule (20) finds exactly the six allow-listed files (`index.ts`, `http/in-memory.ts`, `config.ts`,
`core/routes/system.ts`, `ocr/tesseract.ts`, `db/database.ts`), every other rule nothing outside its allow list.

Read: P7; `apps/api/test/effect-idioms.test.ts` whole; `apps/web/src/styles/design-system.test.ts` (the shape); `repos/effect/LLMS.md`
"Writing `Effect` code", "Using Effect.fn and Effect.fnUntraced", "Runtime type guards"; `repos/effect/migration/v3-to-v4.md` (the v3 names for
rule (21)); `agent-patterns/effect-core.md`, `agent-patterns/effect-errors.md`; CLAUDE.md "The idioms test is the E12 gate".

### E8-T08 — Pattern files, part 1 (build)

`agent-patterns/effect-{core,services,errors,testing,config,datetime-clock}.md`: read each against the code; correct every line the code
contradicts (Hono in the present tense, bridges "until E8", `runMigrations` / `nowMs` / `ApiError` as src exports, `requireUser(c)`); keep
sections 1 to 6 as distilled reference (fix only what is wrong, and look each signature up in `repos/effect/packages/effect/src/`); make
"## 7. In this repo" current: at least ONE fenced example copied from the tree with its repo path above it, plus a short "where it lives"
list (services: `apps/api/src/runtime.ts`, `apps/api/src/core/services/layer.ts`, a module `layer.ts`; testing: `apps/api/test/support/effect.ts`,
`apps/api/test/support/bridges/`; errors: `apps/api/src/lib/errors.ts`, `apps/api/src/http/response.ts`; config: `apps/api/src/config.ts`;
datetime-clock: `apps/api/src/modules/finance/lib/clock.ts`, a `TestClock` test). Every repo path named must exist (T11 will make
`docs-paths.test.ts` check it, with the prefixes `apps/`, `packages/`, `agent-patterns/` and `repos/effect/`): a path into the vendored
source is ALWAYS written from the repo root, `repos/effect/packages/...`, never bare `packages/effect/...` (a bare one reads as this repo's
`packages/` and fails). Today these spans in T08's files fail that way and are rewritten (`bash docs/plans/e8-verify.sh paths <file>` lists
them): `agent-patterns/effect-config.md:22` `packages/platform/bun/src/BunServices.ts`; `agent-patterns/effect-core.md:19`
`packages/platform/bun/src/BunRuntime.ts`; `agent-patterns/effect-errors.md:29` `packages/effect/src/Schema.ts`;
`agent-patterns/effect-testing.md` lines 19, 41, 57, 72, 89, 104, 124 (`packages/effect/src/testing/index.ts`, `…/Effect.ts`,
`…/testing/TestClock.ts`, `…/testing/TestConsole.ts`, `…/Layer.ts`, `…/ManagedRuntime.ts`, `…/testing/TestSchema.ts`), each prefixed
`repos/effect/`; and two repo paths: `agent-patterns/effect-services.md:270` `apps/api/src/core/services/auth/index.ts` (the E2 barrel, named
as deleted inside the "As built (E2)" paragraph on legacy bridges, which E8 makes history anyway: rewrite the paragraph to say where the
doors live now and mention the old barrel without a backticked path), `agent-patterns/effect-core.md:312`
`apps/api/src/modules/finance/bridge.ts` (deleted by T06: `apps/api/test/support/bridges/finance-bridge.ts`). The Bun platform package is
vendored at `repos/effect/packages/platform/bun/src/` (there is no `repos/effect/packages/platform-bun/`).

Read: the six files; `repos/effect/LLMS.md`; the code each example comes from; `docs/EFFECT.md` §2.2.

### E8-T09 — Pattern files, part 2 (build)

`agent-patterns/effect-{schema,stream,http-client,http-api,http-server-bun,cli}.md`, exactly as T08, the path rule included (vendored paths
as `repos/effect/packages/...`; the Bun platform is `repos/effect/packages/platform/bun/src/`, NOT `packages/platform-bun/`). Today these spans
in T09's files fail and are rewritten: `agent-patterns/effect-http-api.md:28` `packages/effect/package.json`,
`agent-patterns/effect-http-client.md:30` `packages/platform/bun/src/BunHttpClient.ts` and `agent-patterns/effect-http-client.md:78`
`packages/effect/test/HttpClient.test.ts`, each prefixed `repos/effect/` (examples from
`packages/shared/src/core/schemas/checks.ts`, `apps/api/src/modules/recipe/services/ocr/`, `apps/api/src/modules/recipe/services/import/url/fetch.ts`
or `apps/web/src/lib/api-client.ts`, an `X.api.ts` and its handlers, `apps/api/src/http/server.ts`, `apps/api/scripts/support/main.ts`).

Read: the six files; `repos/effect/packages/effect/SCHEMA.md` (in chunks), `repos/effect/packages/effect/HTTPAPI.md`; the vendored source
under `repos/effect/packages/effect/src/` (`Schema.ts`, `Stream.ts`, `http/`, `http-api/`) and `repos/effect/packages/platform/bun/src/`
(`BunHttpServer.ts`, `BunRuntime.ts`); the code.

### E8-T10 — Reference docs as built (build)

- `docs/EFFECT.md`: §3 rewritten to list what exists (3.1 shared, 3.2 api with `runtime.ts`, `config.ts`, `env.ts` (P3), `infra.ts`,
  `db/{client,database,migrate,schema}.ts`, `http/*`, `middleware/*`, `lib/*`, `core/{health.ts,routes,services}`, `modules/{index,types,mount}.ts`
  and a module's `{index,layer,schema,http?,middleware?,routes/,services/,seed}.ts`; 3.3 web with `apps/web/src/lib/{runtime,api-client,api}.ts`
  and `apps/web/src/modules/<id>/lib/api.ts`; 3.4 scripts with `apps/api/scripts/support/main.ts`); E5's sentence and E7's test-seam sentence
  amended per P2 and P3 (through ADR 0014 in the same commit); E12's grep list extended by rules (15) to (21); an "As built (E8)" paragraph
  under §4 or E12 naming the doors, the seams, the client decision and the rules (no pass count: T12 adds it).
- `docs/adr/0014-transitional-core-bridges.md`: "Status after E8" (the doors and where they live, the seams kept and why, the client and
  `env.ts` decision, the legacy `ApiError` moved, the ADR closed).
- `docs/API.md`: implementation prose only ("Zod refinement" → "a schema check", `requireFinanceParticipant` → `RequireFinanceParticipant`,
  any other identifier in a convention or note that `grep -rn` no longer finds in `apps/api/src`); no table row changes (`git diff` shows
  no changed line starting with `|`).
- `docs/modules/recipe.md` and `docs/modules/finance.md`: the service tables (recipe 1.2, finance 1.3) checked name by name against the
  `Context.Service` classes and the `layer.ts` files; bridge mentions replaced by the doors; the 4a/4b rows that name a deleted symbol updated.
- `docs/open-work.md`: O-10 retired (by T03), O-7 updated (P3: decided at E8), a new observation for F15 (`/api/health` runs on the runtime
  inside its handler, pinned by `apps/api/test/runtime.test.ts` (b)), O-5's count re-stated if it changed.

Every path written into `docs/EFFECT.md` must exist (T11 adds it to `apps/api/test/docs-paths.test.ts`; `bash docs/plans/e8-verify.sh
paths docs/EFFECT.md docs/modules/recipe.md docs/modules/finance.md docs/API.md docs/open-work.md` is the pre-check); a brace group such as
`db/{client,database,migrate,schema}.ts` is expanded by the test, so each member must exist. `docs/modules/finance.md` line 123 already names
the door (T06).

Read: P2, P3, P9; the current files; `docs/plans/e7-http-api.md` section 10; the tree (`ls -R apps/api/src | head`, the `layer.ts` files).

### E8-T11 — CLAUDE.md as built, the docs-paths guard (core)

Rewrite `CLAUDE.md` per P9 from the tree: Read order (unchanged items, `docs/EFFECT.md` and `repos/effect/LLMS.md` and `agent-patterns/`
named), Fixed decisions (ADR list unchanged, ADR 0014's E8 status in one clause), Building it (the migration is done; the workflow file stays
for history), Vendored reference code (unchanged rules), Status (short: M0 to M7 and E0 to E8 done, where each record lives; T12 writes the
final count), Layout (as built, with `apps/api/test/support/bridges/`), Commands (unchanged unless wrong), Conventions (+ "Effect idioms":
E12 item → idioms rule number), Gotchas in use (each names the file or test that pins it; "Bridges until E8" replaced by "Test-only doors
live in `apps/api/test/support/bridges/`" and "The test seams stay in src"; "The `Database` service and the shared client" states P3 as
decided; "The error family" without the legacy class), Retired gotchas (+ "Bridges until E8", + the `nowMs` survivor, each with what
remains), Open work (pointer). Length: no longer than today. Then extend `apps/api/test/docs-paths.test.ts`: `DOCS` += `docs/EFFECT.md` and
every `agent-patterns/*.md`; `PATH_PREFIXES` += `agent-patterns/`, `repos/effect/`; one new test that CLAUDE.md contains `docs/EFFECT.md`,
`repos/effect/LLMS.md` and `agent-patterns/`. Fix every path the extended test reports (in whichever doc; a path that names something absent
on purpose goes to `ALLOW_MISSING` with a reason). T08, T09 and T10 ran `e8-verify.sh paths` on their files, so the report should be short;
brace groups and line-split spans are what that pre-check leaves to the test. `README.md` only if it names something that no longer exists.

Read: P1 to P9; today's CLAUDE.md whole; `docs/plans/e7-http-api.md` section 10 (the last as-built pass); the docs-paths test whole.

### E8-T12 — Integration: the final gates, the walkthrough, the boot-and-shutdown proof, the record (build)

P10, on the merged tree, each long command in the background with one log ending `exit=$?`. Record in section 9 of this file: 9.1 the gates
table (as `docs/plans/e7-http-api.md` 9.1), 9.2 `i18n:check` classified (148; compare line-number-free with a worktree of `4bc9512fc`; a new
hit is classified or fixed), 9.3 the bundle (sum of the `gzip:` column of the JS chunks: 419.99 kB expected; `git diff --stat 4bc9512fc HEAD --
apps/web` empty), 9.4 boot and shutdown (`DATABASE_URL=file:<scratch>/e8.db`, `bun run db:migrate && bun run seed`, the server as the image
runs it with `WEB_DIST_DIR`; the boot line; idle SIGTERM with the three lines `[api] SIGTERM — stopping modules …`, `[db] database closed`,
`[api] runtime disposed`, exit 0, the time; SIGTERM with a slow upload in flight, about 5 s), 9.5 the walkthrough (the rows of
`docs/plans/m7-harden.md` §9.3: health, CSP hash at two origins, origin guard 403 / 201, logins, `/me` with and without cookie, register 201,
households, a foreign household 403/404, a recipe read, a finance read, 11 bad logins → 429), each status compared with its `docs/API.md` row,
9.6 the local stack test (`docs/deployment.md` "Local stack test", project `toon-household-local`, health through the Caddy, the old hostnames'
301 and `/sw.js`, `docker compose stop app` and its log lines, `down -v`, no `toon-household(-local)_` volume left), 9.7 the exit criteria
each with its proof. Section 10: what changed vs plan. Then CLAUDE.md's Status sentence and `docs/EFFECT.md`'s "As built (E8)" get the final
count. A finding gets a fix commit and a line in section 10.

Read: this plan whole; `docs/plans/e7-http-api.md` section 9 (the shape); `docs/deployment.md` "Local stack test"; CLAUDE.md "Long
commands", "Headless runs" (pid kill, never `pkill -f`), "The local stack is the compose project `toon-household-local`".

## 5. Acceptance summary (exit criterion → where it is proven)

| Exit criterion (§4 E8) | Proof |
| --- | --- |
| gates green on the final tree | T12 9.1 |
| pass count not below E7's (15191) | every task's verify; T12 9.1 |
| CLAUDE.md names no missing file, and names `docs/EFFECT.md`, `repos/effect/LLMS.md`, `agent-patterns/` | `apps/api/test/docs-paths.test.ts` (T11) |
| the idioms test has every E12 rule on, allow lists minimal | rules (1) to (21), T07; allow lists of P7, (11) empty (T06) |
| review findings closed | 1.3's table, each row's task; T12 9.7 |
| `docs/plans/e8-harden.md` holds the gate logs and the walkthrough | T12 sections 9 and 10 |

## 6. Risks

1. **A door changes a test's import graph** (a fresh-process or import-order test sees a module loaded earlier). Mitigation: one door per
   source module, importing only what the bridge imported (P1); `apps/api/test/import-order*.test.ts` and `apps/api/test/legacy-cli.test.ts`
   in T04's and T06's verify.
2. **A door is not a faithful copy** (a rejection value, a synchronous throw turned into a rejection). Mitigation: T01's door test compares
   door and bridge on the same inputs while both exist; the pinned tests themselves run against the doors in T04 before any deletion.
3. **T04 misses a multi-line import**, and T05/T06 fail typecheck. Mitigation: the import scan in T04's verify; T05/T06 run typecheck first.
4. **Parallel worktrees edit one file.** Mitigation: section 3's ownership; T01 adds `export` only in files no wave-1 sibling owns; wave 3
   depends on every wave-1 task.
5. **A reworded comment adds an `i18n:check` hit** ("die" is a stopword). Mitigation: P6(d); the count check in T03's, T05's and T06's verify.
6. **The pass count dips** when a list entry's file is deleted. Mitigation: P8 (replace, never drop); T01's new door test adds cases.
7. **A new idioms rule is too broad** and finds false positives in a later edit (e.g. rule (19) on a pure formatter). Mitigation: the scope
   and allow lists of P7, a self-check per regex, the multi-line scans documented; a false positive is fixed by narrowing the regex in the
   same file with a recorded reason, never by an allow entry for a real violation.
8. **The extended docs-paths check finds many broken paths in the pattern files** (measured: 14 bare vendored `packages/…` paths and one
   deleted barrel in seven pattern files). Mitigation: T08/T09 are given the list and the rule (`repos/effect/packages/…`) and run
   `e8-verify.sh paths` on their files; T11 owns the
   fixes that remain.
9. **Load on the host** (parallel worktrees ran `bun test` at 354 s once). Mitigation: verify runs the full suite once per task; the sharp
   tests carry their time budget.
10. **Deleting a file a living doc names breaks `apps/api/test/docs-paths.test.ts` for every later task.** Mitigation: T06 rewrites the four
   mentions of `apps/api/src/modules/finance/bridge.ts` in the same commit (`no-bridges modules` greps for them); T05 deletes no file.
11. **A door test leaks state into a later file** (one process, one database, one rate-limit store). Mitigation: T01's isolation rules
   (unique keys plus `resetRateLimits`, own rows deleted with counts asserted, the mailer and clock seams released).

## 7. Deviations expected (each recorded in section 10 when it happens)

- **D1 — Doors move instead of disappearing** (P1): ADR 0014 said E8 removes them "with the pinned tests or E9's layer-based test support";
  E8 removes them from `src` and keeps their callers' assertions by moving the doors into test support, the layer-based support of E9.
- **D2 — The test seams stay** (P2): `docs/EFFECT.md` E7 amended through ADR 0014.
- **D3 — The import-time client and `env.ts` stay** (P3): `docs/EFFECT.md` E5 and §3.2 amended through ADR 0014.
- **D4 — `runtime.runPromise` inside the health handler stays** (F15): pinned by `apps/api/test/runtime.test.ts` (b).
- **D5 — An import-order entry is replaced** (P8).
- **D6 — `nowMs` moves as a door that is not a verbatim copy** (P1): the module-private `override` cannot be read from test support, so the
  door is `Effect.runSync(financeTimeMillis)`, the same value in both clock states.

No new ADR is expected: every deviation is inside ADR 0014's scope, which gets its final status section.

## 8. Out of this milestone

Declared payload and success schemas per endpoint and a typed `HttpApiClient` (open-work X-5, X-6); the request log format (X-7); the
unused web facades `importFromImage` / `importFromPdf` (O-8: a web change, and E8 leaves `apps/web` untouched); `@effect/sql-libsql`,
`@effect/atom-react`, OpenTelemetry export (EFFECT §6); creating the database client inside `Database.layer` (P3); rewording comments in test
files (history); any `docs/API.md` row, German string, table, migration, UI or copy change; the owner actions of `docs/open-work.md` (the
production decode sweep A11, the cutover items).

## 9. Integration record

Written by E8-T12 on the merged tree (HEAD `36c178de8`, the E8-T11 commit, plus the T12 commit). Host: Bun 1.4.3, Docker 29.9.2, load average 1.7 to 2.8 while the gates ran. Every long command
below ran in the background or foreground with one log ending `exit=<code>`; the logs live in the session scratchpad and are not committed (a record of a run names counts and OK/FAIL, never a
token or a secret: the session cookies and the `SESSION_SECRET` of the scratch runs are not written down).

### 9.1 The gates

| Gate | Result |
| --- | --- |
| `bun install --frozen-lockfile` | `Checked 438 installs across 627 packages (no changes)`, `exit=0` |
| `bun run typecheck` | the five projects, `[typecheck] OK`, `exit=0` |
| `bash docs/plans/e8-verify.sh tests` (`bun test`) | **15236 pass, 1 skip, 0 fail, 386572 `expect()` calls, `Ran 15237 tests across 183 files. [63.38s]`**, `exit=0`; no `(fail)` line, no `Unhandled error` block. Floor 15191 in 181 files (1.2): +45 tests, +2 files |
| `bun run build` | `exit=0`, 84 JS chunks, 419.99 kB gzipped, PWA `precache 104 entries (1507.36 KiB)` (9.3) |
| `bash docs/plans/e8-verify.sh i18n` | `[i18n:check] OK` for parity, `FAILED — 148 possible German literal(s)`, exit 1 by design (9.2) |
| `bun test apps/api/test/effect-idioms.test.ts apps/api/test/docs-paths.test.ts apps/api/test/api-doc.test.ts apps/api/test/http-contract.test.ts` | **161 pass, 0 fail** in 4 files (idioms 66 in 22 `describe`s, rules (1) to (21) plus the scan-coverage check; docs-paths 8; api-doc 9; http-contract 78), `exit=0` |
| `bash docs/plans/e8-verify.sh repos` | `OK repos clean`; `git status --porcelain repos/` prints nothing |
| `bash docs/plans/e8-verify.sh hono` | `OK hono/stale comments` (no comment names Hono without `pre-E7`, no stale reference) |
| `bash docs/plans/e8-verify.sh no-bridges all` | `OK no-bridges (all)` (no door `export function`, no `legacy bridges?:` header, no import of a door from `src`, `scripts`, `apps/web/src` or `packages`) |
| `bash docs/plans/e8-verify.sh imports` | `OK imports: every door name comes from test/support/bridges/` |
| `bash docs/plans/e8-verify.sh api-rows` | `OK docs/API.md rows unchanged` (no table row changed since `4bc9512fc`) |
| `bash docs/plans/e8-verify.sh frozen` | `OK frozen paths unchanged` (`apps/web`, `Dockerfile`, `docker-compose.yml`, `docker/`, `.dockerignore`, the migrations, every catalog) |
| `bash docs/plans/e8-verify.sh guards` and `paths` over `CLAUDE.md`, `docs/EFFECT.md`, both module docs and every `agent-patterns/*.md` | `OK guards`, `OK paths` |

Pass count: **15236 against the floor of 15191**. The 45 added tests are the door tests (`apps/api/test/bridges-core.test.ts` 6 cases and `apps/api/test/bridges-modules.test.ts` 13, 19 in all, E8-T01; the cases compare each
door with its Effect form), the 23 cases of rules (15) to (21) of the idioms test (E8-T07: 43 before E8 to 66) and the three added `docs-paths` cases (E8-T11); no test case was removed (P8: F14's `trySendMail` case and
`apps/api/test/finance-clock.test.ts`'s "the synchronous nowMs keeps its override seam" run against their doors).

### 9.2 `i18n:check`, classified

148 hits, the same as E7's record. The same command on a detached worktree of the base `4bc9512fc` (`I18N_CHECK_BASE=4bc9512fc`) also reports 148, and the two lists, normalised line-number-free (the `file:line:` prefix reduced to
`file:`, the quoted text kept, sorted), are identical (`diff` prints nothing). So E8 added no hit: the comments it reworded (P6(d)) contain no German word and never "die". The 148 are the classes of
`docs/plans/e7-http-api.md` 9.2: German quoted in comments, the recipe content vocabulary (ten lines, `apps/api/src/modules/recipe/services/import/html/entities.ts` and the recipe web display strings), and the three `Effect.die` stopword hits
of `apps/api/src/modules/mount.ts`. No hit is suppressed or added to an allow list.

### 9.3 The bundle

`bun run build` on the final tree: **84 JS chunks, 419.99 kB gzipped in total** (the sum of the `gzip:` column of the `.js` lines of the build log), CSS 12.92 kB (12.52 + 0.40), PWA `precache 104 entries (1507.36 KiB)`: identical to
E6's and E7's records. `git diff --stat 4bc9512fc HEAD -- apps/web` is empty (`frozen` above).

### 9.4 Boot and shutdown on a scratch database

`DATABASE_URL=file:<scratch>/e8.db`, a random `SESSION_SECRET`, `UPLOAD_DIR` in the scratch directory, `bun run db:migrate && bun run seed` (`exit=0`, ends `[db] database closed`), then the server as the image runs it
(`bun apps/api/src/index.ts` from the repo root, `WEB_DIST_DIR=<repo>/apps/web/dist`), started once per check below and stopped by the pid the socket listed (`ss -ltnp`), never by a `pkill -f` pattern. A first attempt took its pid from
`pgrep -f 'bun apps/api/src/index.ts'`, which matched the shell running the command (CLAUDE.md "Headless runs" warns of exactly this); the shell died, the server kept running and was stopped by its listening pid.

- **Boot line.** `[api] toon-household API on http://localhost:3001 (db: file, origins: http://localhost:5173, mail: console, web: <repo>/apps/web/dist)`, the pre-E7 line; `GET /api/health` 200 with the security and CORS headers.
- **SIGTERM, idle.** Line order `[api] SIGTERM — stopping modules …`, `[db] database closed`, `[api] runtime disposed`; process exit status 0 (`exit=0` written by the wrapper); stopped after **12 ms** (23 ms on an earlier run
  that also ended after the walkthrough of 9.5).
- **SIGTERM with a request in flight.** `IMPORT_OCR_ENABLED=1`, a 200 kB file, `curl --limit-rate 2k -F file=@big.png …/recipe/imports/image` with a seeded session (the handler waits in `readUploadedFile`), SIGTERM sent 3 s later:
  the process was gone after **5028 ms**, exit status 0, lines `[api] SIGTERM — stopping modules …`, `[db] database closed`, `[api] runtime disposed`; the upload's client saw the connection close (curl `000`). The bound of E7's fix
  (`Effect.runForkWith(await runtime.context())` for the server fiber, ADR 0015 decision 4) holds on the E8 tree.

### 9.5 The walkthrough (`docs/plans/m7-harden.md` §9.3), against the built app on the scratch database

Each status compared with the `docs/API.md` row it belongs to. All matched; no doc or code fix was needed.

| Section of `docs/API.md` | Request | Result | Documented |
| --- | --- | --- | --- |
| Health | `GET /api/health` | 200 | 200 |
| Security | CSP of `/`, `/api/health` and `/uploads/nope.png` at `http://127.0.0.1:3001` AND `http://localhost:3001` | each carries exactly `'sha256-5v9mXqu719mluDFYJo1wOcX4/ocZqZ97UKW4cHX3XZs='`, which is the SHA-256 (base64) of the inline script of `apps/web/dist/index.html` computed independently; statuses 200, 200, 404 at both | yes |
| Security | `POST …/finance/transactions` with `Origin: https://evil.example` | 403 | 403 `forbidden` |
| Security | same with `Sec-Fetch-Site: cross-site` | 403 | 403 |
| Security | same with `Origin: http://localhost:5173` (in `WEB_ORIGIN`) and a valid body | 201 | passes the guard, 201 |
| Auth | `POST /api/auth/login` as demo, robin, kim | 200, 200, 200 | 200 |
| Auth | login with a wrong password / with a body not declared JSON | 401 / 400 | 401 / 400 |
| Auth | `GET /api/auth/me` and `GET /api/auth/sessions` with the cookie; `GET /api/auth/me` without | 200, 200; 401 | 200; 401 |
| Auth | `POST /api/auth/register` (new user, own household name) | 201 | 201 |
| Households | `GET /api/households` (demo: one household, `role` owner, `memberCount` 3, `modules` `["recipe","finance"]`), `GET /api/households/:id` | 200, 200 | 200 |
| Households | recipes of an unknown household id / of the new user's household as demo | 404 / 403 | 404 / 403 |
| Uploads | `GET /uploads/nope.jpg` (unsigned) | 404 | 404 |
| Recipe | `GET …/recipe/recipes?limit=1`, `GET …/recipe/shopping-lists`, `GET /api/recipe/cards` with and without the cookie | 200, 200, 200 / 401 | 200 / 401 |
| Finance | `GET …/finance/balance` as demo and as robin | 200, 200 | 200 |
| Finance | `GET …/finance/balance` as kim (no seat) | 403 `finance_not_participant` | 403 `finance_not_participant` |
| Finance | `GET …/finance/participants` as kim | 200 | 200 |
| Auth | eleven bad logins in a row (a fresh address key) | ten 401, the eleventh **429** with `retry-after: 60` | 429 `rate_limited` with `Retry-After` |

Two requests of my own script were wrong the first time (the register body used `displayName`, the schema's field is `name`; the transaction body lacked `kind`) and answered 422, which is the documented validation answer; they
were corrected and re-run, and the table holds the re-run results.

### 9.6 The local stack test (`docs/deployment.md` "Local stack test")

`docker build -t toon-household:local . > build.log 2>&1; echo "exit=$?" >> build.log` on the final tree: `exit=0`, 404 MB image (the web-build stage's `! grep -rqF 'localhost:3001' apps/web/dist` passed; the build reused 19 cached
layers of the dependency stages, the layers that copy the sources were rebuilt from this tree). Ports 80 and 443 free, no `toon-household(-local)_*` volume before. Compose project `toon-household-local`: `docker compose -p
toon-household-local --env-file .env.local-stack config -q` exit 0, `up -d`, `app Up (healthy)`, `caddy Up`.

- **Health through the Caddy:** the CA fetched over plain HTTP from `/toon-root-ca.crt`, then `curl --resolve haushalt.test:443:127.0.0.1 --cacert root.crt https://haushalt.test/api/health`:
  `{"ok":true,"status":"ok","version":"0.1.0",…,"modules":["recipe","finance"],"features":{"verifiedEmailRequired":false,"ocrImport":false,"pdfImport":false}}`; `GET /` 200 `text/html; charset=utf-8`; the health answer
  carries the app's CSP, `x-frame-options: DENY` and the Caddy's `strict-transport-security: max-age=0` (`TOON_HSTS_MAX_AGE=0` in `.env.local-stack`).
- **Old hostnames:** `HTTP/2 301` with `https://rezepte.test/plan` to `https://haushalt.test/recipe/plan`, `https://rezepte.test/` to `/recipe`, `https://finanzen.test/transactions` to `/finance/transactions`, `https://finanzen.test/` to
  `/finance`; `/sw.js` on both answers `200 text/javascript; charset=utf-8`, 501 B, the retiring worker (ADR 0008).
- **Register and a read through the Caddy:** `POST /api/auth/register` 201, `GET /api/auth/me` 200.
- **The real container's SIGTERM:** `docker compose stop app` took **243 ms**; the container log ends `[api] SIGTERM — stopping modules …`, `[db] database closed`, `[api] runtime disposed`; `docker inspect` exit code 0.
- **Tear-down:** `docker compose -p toon-household-local --env-file .env.local-stack down -v` removed the three `toon-household-local_*` volumes and the network; `docker volume ls -q | grep -E '^toon-household(-local)?_'`
  printed nothing (0 lines); the repo-root `build.log` was removed; `git status --short` shows only the two plan files this commit adds.
- **The deployment files are untouched:** `bash docs/plans/e8-verify.sh frozen` (the `Dockerfile`, `docker-compose.yml`, `docker/` and `.dockerignore` unchanged since `4bc9512fc`).

### 9.7 Exit criteria (section 5; `docs/EFFECT.md` §4 E8) and the findings of 1.3

| Exit criterion | Proof on the final tree |
| --- | --- |
| gates green on the final tree | 9.1 |
| pass count not below E7's (15191) | 15236 in 183 files (9.1) |
| CLAUDE.md names no missing file, and names `docs/EFFECT.md`, `repos/effect/LLMS.md`, `agent-patterns/` | `apps/api/test/docs-paths.test.ts` (8 pass; it scans `CLAUDE.md`, `docs/API.md`, `docs/EFFECT.md`, both module docs, `docs/open-work.md` and every `agent-patterns/*.md`, and pins the three names), inside the 161 of 9.1 |
| the idioms test has every E12 rule on, allow lists minimal | `apps/api/test/effect-idioms.test.ts`, 66 pass: rules (1) to (21); rule (11)'s `ALLOW_NOW_MS` is `{}`; rule (17) has two entries and rule (20) six, each with its reason and a stale-entry check (P7) |
| review findings closed | the table below |
| `docs/plans/e8-harden.md` holds the gate logs and the walkthrough | sections 9 and 10 (this file) |
| `docs/API.md` conventions updated, never a row | `api-rows` OK (9.1); `grep -c Zod docs/API.md` prints 0 |
| `apps/web`, the Dockerfile, the compose file, the Caddyfile, the migrations and the catalogs unchanged | `frozen` OK (9.1) |
| bounded stop with a request in flight | 9.4: 5028 ms, exit 0 |

| # | Finding (1.3) | Closed by |
| --- | --- | --- |
| F1 | 19 test-only doors in `src` and `scripts` | `86cbfc6ba` E8-T01 (the doors), `eca4a9ac5` E8-T04 (the 77 tests import them), `8bba9c407` E8-T05 (core), `612801c86` E8-T06 (modules and scripts); `no-bridges all` and rule (20) |
| F2 | the legacy `ApiError` class in `src` | `86cbfc6ba` (`apps/api/test/support/bridges/api-error.ts`), `eca4a9ac5`, `8bba9c407` |
| F3 | finance `nowMs()` and its `ALLOW_NOW_MS` entry | `86cbfc6ba` (door `finance-clock.ts`), `eca4a9ac5` (both importers), `612801c86` (deleted; allow list `{}`) |
| F4 | CLAUDE.md and comments naming the deleted `requireUser`, `requireMembership`, `requireFinanceParticipantContext` | `ff8560a21` E8-T03, `36c178de8` E8-T11 |
| F5 | 82 Hono comment lines in 32 files | `ff8560a21` E8-T03 (with `da8a8c933` E8-T02 for its files); `hono` check OK |
| F6 | "E8 decides" the import-time client and `env.ts` | decided in P3 (they stay): `7c8df7556` E8-T10 (ADR 0014 "Status after E8", `docs/EFFECT.md` E5 and §3.2, open-work O-7), `36c178de8` |
| F7 | the test seams "removed by the milestone that moves its last caller" | `8bba9c407` (section headers renamed to `test seams`), `7c8df7556` (ADR 0014, `docs/EFFECT.md` E7) |
| F8 | six object guards, one `Date.now()` on the request path, an `Effect.runSync` in `createAuthorization` | `da8a8c933` E8-T02, plus one more guard found by rule (18) in `c920f795d` (section 10 F2) |
| F9 | E12 idioms grep can see but the test did not pin | `c920f795d` E8-T07 (rules (15) to (21)) |
| F10 | stale pattern-file lines | `2944d8154` E8-T08, `de945c086` E8-T09 |
| F11 | `docs/EFFECT.md` §3 not matching the tree | `7c8df7556` E8-T10 |
| F12 | `docs/API.md` notes saying "Zod" and `requireFinanceParticipant` | `7c8df7556` E8-T10 |
| F13 | the docs-paths test did not scan `docs/EFFECT.md` and `agent-patterns/*.md` | `36c178de8` E8-T11 |
| F14 | `apps/api/test/mail.test.ts` "E8 removes it" | `eca4a9ac5` E8-T04 (comment reworded, the case kept) |
| F15 | `runtime.runPromise(healthResponse)` inside the health handler | kept on purpose (pinned by `apps/api/test/runtime.test.ts` (b)); rule (20) allow entry with the reason (`c920f795d`); open-work in `7c8df7556` |

## 10. What changed vs plan

- **D1 — Doors moved instead of disappearing (P1), as planned.** The 19 doors live in `apps/api/test/support/bridges/` with their old names, signatures and calling conventions; `apps/api/src` and `apps/api/scripts` hold the
  Effect forms only. ADR 0014 "Status after E8" records it. T01 added the door files beside the src bridges, T04 changed the import specifiers of 77 test files (no assertion changed, `import-shape` checked it), T05 and T06 deleted
  the bridges.
- **D2 — The test seams stayed (P2).** `setMailer`, `getMailer`, `isMailerOverridden`, `resetRateLimits`, `setVerifiedEmailRequired`, `setImportDbForTests`, `setImportGuardForTests`,
  `setRemoteImageDownloaderForTests` and `setClockForTest` keep their names; the section headers of `rateLimit.ts` and `mail/index.ts` say `test seams`. `docs/EFFECT.md` E7's sentence was amended through ADR 0014.
- **D3 — The import-time client and `env.ts` stayed (P3).** `apps/api/src/db/client.ts` still creates the process-wide client at import and `Database.layer` owns its lifetime; recorded in ADR 0014, `docs/EFFECT.md` E5 and §3.2,
  open-work O-7.
- **D4 — `runtime.runPromise` inside the health handler stayed (F15).** Rule (20)'s allow list has six entries, each with its reason.
- **D5 — An import-order entry was replaced (P8).** `apps/api/test/import-order-effect.test.ts` lists `./src/modules/finance/http.ts` where it listed the deleted `./src/modules/finance/bridge.ts`; no case was dropped.
- **D6 — `nowMs` moved as a door that is not a verbatim copy (P1).** The door is `Effect.runSync(financeTimeMillis)`, the same value with and without the override; `apps/api/test/finance-clock.test.ts` keeps its case.
- **F1 — The pass count rose from 15191 to 15236** (+45 tests, +2 files: 19 door tests, 23 idioms cases, 3 docs-paths cases), where the plan only promised not to drop below the floor.
- **F2 — The new rules found one more hand-written object guard.** Rule (18) (E8-T07) flagged `storedFilenameOf` in `apps/api/src/modules/recipe/services/import/drafts.ts`, which T02's measurement (six guards) had missed;
  `c920f795d` fixed it with `Predicate.isObjectOrArray` (the same truth table, P5) in the same commit as the rule, as the plan's "a hit is fixed in the code" demands. No allow entry was added.
- **F3 — The first pid of the in-flight check was wrong.** `pgrep -f` matched the shell (9.4); the check was repeated by the listening pid. No code or file was touched.
- **F4 — No finding of this task needed a fix commit.** Every gate passed on the first run of the merged tree; the only corrections were two request bodies of the walkthrough script (9.5), which is test tooling in the
  scratch directory, not the tree.
- **No new ADR.** Every deviation sits inside ADR 0014's scope ("Status after E8"); `docs/adr/0015-http-api-deviations.md` is unchanged.
- **Not done, by plan section 8:** declared payload and success schemas and a typed `HttpApiClient` (open-work X-5, X-6), the request log format (X-7), the unused web facades (O-8), creating the database client inside `Database.layer`,
  and the owner actions of `docs/open-work.md` (the production decode sweep A11, the cutover items). The milestone changed no `docs/API.md` row, German string, table, migration, `apps/web` file, Dockerfile, compose file or Caddyfile.
