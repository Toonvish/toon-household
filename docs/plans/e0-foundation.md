# E0 — foundation: plan

**Status: DONE (2026-10-16).** Planned and revised after the plan review the same day. Base commit `d88de1d73` (the Learn
phase's last pattern file); the first plan commit is `669ef34b1`. Section 9 is the integration record and section
10 is what changed vs plan (both written by E0-T08). The revision spells out the lockfile diff `bun add` really
produces (E0-T02, P3), makes E0-T08's record checks read section 9 only and look for measured values (P13), writes
the thumbnail-timeout rule into E0-T08's verify (P12) and proves the `repos/` fence on Bun 1.4.2, the version CI
and the image use (P1).

E0 is the first milestone of the Effect migration (`docs/EFFECT.md` §4): it vendors and fences off the Effect
source (E2), installs the two Effect packages pinned (E1), builds the one `ManagedRuntime` and proves it boots,
serves `/api/health` and is disposed on shutdown (E7), switches on the E12 idioms gate with the rules that
already hold, and records the framework decision (ADR 0012) and the two owner decisions it defers. It changes
no behaviour: every `docs/API.md` row, German string, table, migration and pinned output line stays as it is.

Exit (`docs/EFFECT.md` §4 E0): gates green; `bun test` runs no test under `repos/`; the `docker build` context
excludes `repos/`; the `git subtree` commit is present; CLAUDE.md points at `repos/effect/LLMS.md`; the idioms
test exists and passes; `/api/health` is served through the runtime and the shutdown path is exercised once in
the record.

## 1. Context

### 1.1 State of the tree at plan time (`d88de1d73`, measured by the planner on 2026-10-16)

- **Vendored source present.** `repos/effect` is a squashed `git subtree` of `https://github.com/Effect-TS/effect.git`:
  squash commit `e54b8022a` ("Squashed 'repos/effect/' content from commit 7f524e25c", body
  `git-subtree-dir: repos/effect`, `git-subtree-split: 7f524e25cfb49a71ac39b0f44278d08d40dda5de`), merged by
  `60828f2e6` ("Merge commit 'e54b8022a…' as 'repos/effect'"). `git ls-remote` at plan time:
  `7f524e25cfb49a71ac39b0f44278d08d40dda5de refs/tags/effect@4.0.5`, so the split IS the release tag of the
  version E1 installs. `repos/effect/packages/effect/package.json` says `"version": "4.0.5"`.
  `repos/effect/LLMS.md`, `repos/effect/ai-docs/src/`, `repos/effect/migration/` exist. `git status --porcelain`
  clean.
- **Pattern files present and committed.** `agent-patterns/effect-core.md` (`4e042a879`),
  `agent-patterns/effect-schema.md` (`d88de1d73`), `agent-patterns/effect-services.md` (`8975d79a3`),
  `agent-patterns/effect-errors.md` (`85ab1d6b9`), `agent-patterns/effect-testing.md` (`a51395d75`): the five
  topics §2.2 names for E0. Nothing to write; E0-T05 corrects a line the code proves wrong.
- **Nothing fences `repos/` off yet.** No `bunfig.toml`; `.dockerignore` has no `repos` line; no `.vscode/`
  directory (and `.gitignore` does not ignore it); `apps/web/vite.config.ts` has `server: { port: 5173, host:
  true, proxy }` with no `watch`. `repos/effect` holds **582** `*.test.ts(x)` files (vitest), so a bare
  `bun test` at the root would discover them today. The planner's baseline therefore ran
  `bun test --path-ignore-patterns='repos/**'` (the CLI form of the bunfig key E0-T01 adds).
- **Probe:** a scratch tree with a failing `repos/x/b.test.ts`, a passing `apps/a.test.ts` and
  `bunfig.toml` `[test] pathIgnorePatterns = ["repos/**"]` ran 1 pass / 0 fail under Bun 1.4.3;
  `bun test repos` there printed "The following filters did not match any test files" and exited 1. Without
  the bunfig the same command ran and failed the `repos/` test. That message is the cheap proof the verify
  commands use (`bun test repos` exits 1 either way, so a verify pipes it into `grep -q`). The planner
  repeated the probe on **Bun 1.4.2** (`oven/bun:1.4.2-debian`, banner `bun test v1.4.2 (744846f84)`) at
  revision time: the control tree ran 1 pass / 0 fail, and `bun test repos` printed "The following filters did
  not match any test files: repos" and exited 1. So the key holds on the CI version; E0-T08 re-proves it on the
  real repo.
- **No Effect installed.** None of the four `package.json` names `effect` or `@effect/*`; no source file
  imports either (grep over `apps`, `packages`, `scripts` for `repos/`, `effect/unstable`, `@effect/`,
  `Context.Tag`, `from "effect`: empty). npm at plan time: `effect@4.0.5` and `@effect/platform-bun@4.0.5`
  exist (`latest` = `4.0.5`); `@effect/platform-bun@4.0.5` depends on `@effect/platform-node-shared ^4.0.5`.
- **Lockfile probe (the review's, repeated by the planner).** The three `bun add --exact --lockfile-only` of
  E0-T02 on a scratch copy of the four `package.json` and `bun.lock` (Bun 1.4.3) change exactly the three
  workspace `package.json` and `bun.lock` (+18/-2). Besides the four workspace dependency lines and the new
  entries `effect`, `@effect/platform-bun` and `@effect/platform-node-shared`, Bun re-hoists two existing
  packages, because `@effect/platform-node-shared@4.0.5` wants `ws ^8.22.0` and `@types/ws ^8.18.2`: the
  top-level `"ws": ["ws@8.21.3", …]` becomes `ws@8.22.0` and `"@types/ws": ["@types/ws@8.18.1", …]` becomes
  `@types/ws@8.18.2`, and the old versions move to the new nested keys `"@libsql/isomorphic-ws/ws":
  ["ws@8.21.3", …]` and `"@libsql/isomorphic-ws/@types/ws": ["@types/ws@8.18.1", …]`. `@libsql/isomorphic-ws` is
  the only package in `bun.lock` that depends on `ws` or `@types/ws`, so no existing consumer resolves a
  different version: the two `-` lines are expected (P3) and anything else is not. `bun.lock` at `669ef34b1`
  equals `d88de1d73`'s.
- **`/api/health`** is an inline Hono handler in `apps/api/src/index.ts` building
  `{ ok, status, version, time: new Date().toISOString(), database, modules, features }`; tests that read it:
  `apps/api/test/smoke.test.ts` ("GET /api/health"), `apps/api/test/finance-module.test.ts` ("(f) health"),
  `apps/api/test/verified-email-gate.test.ts` ("/api/health advertises the state either way"),
  `apps/api/test/security.test.ts` (headers on `/api/health`), `apps/api/test/static-web.test.ts` (its own
  bare app). Shutdown: `if (!env.isTest)` SIGTERM/SIGINT handlers log `[api] ${signal} — stopping modules …`,
  run every module's `shutdown()` with `Promise.allSettled`, then `process.exit(0)`.
- **Tooling.** Bun 1.4.3 on this machine, `.bun-version` says 1.4.2 (CI and the Dockerfile use the latter);
  TypeScript `^7.0.2`, `skipLibCheck: true`; Docker available. "Building it" in CLAUDE.md already describes
  `.claude/workflows/migrate-effect.js`; read-order item 2b already names `docs/EFFECT.md`.
- **SPEC wording.** Of D4, D7, D8, D9 and D10 only D10 names Zod ("finance's generic Zod validation
  messages", ADR 0002) and none names Hono. Hono appears in the SPEC intro ("Bun.serve + Hono", a description
  of the sources' stack) and in SPEC §2's `ApiModule` interface (`householdRouter?: Hono`,
  `userRouter?: Hono`), which `docs/EFFECT.md` E8 rewrites in E7's commit.

### 1.2 Baseline

`bun test --path-ignore-patterns='repos/**'` at `d88de1d73`, 2026-10-16 10:41, load average 44 to 50 (other
agents running): **2440 pass, 2 fail, 2442 tests in 139 files, 12991 expect() calls, 122.7 s**. The two
failures are `apps/api/test/thumbnails.test.ts` "builds a downscaled WebP on first request and caches it on
disk" and "never enlarges: a small original comes back at its own size", both "timed out after 5000ms" in
sharp; the file alone right after: **11 pass, 0 fail, 0.66 s**. They are load-induced, not a defect.

- `baseline_tests` = **2440** (the measured pass count).
- The green count of the same tree is **2442** (CLAUDE.md "Status" still says 2434 in 138 files: the
  `recipe-remote-image` file landed after M7's record). E0's target: at least 2442 plus the tests E0 adds
  (section 9 records the number; a thumbnail timeout under load is re-run alone and recorded, never ignored).

### 1.3 Bundle size

E0 imports `effect` nowhere in `apps/web`, so the bundle cannot change. E0-T08 records the gzipped size of
`apps/web/dist/assets/*.js` as the pre-Effect baseline that E6's "bundle size before and after" compares with.

## 2. Decisions (binding for the tasks)

| # | Decision | Serves |
| --- | --- | --- |
| P1 | The one test-discovery fence is the root `bunfig.toml` `[test] pathIgnorePatterns = ["repos/**"]`. Proof per task: `bun test repos` prints "did not match any test files"; proof at the end: the full `bun test` log has no line starting with `repos/` and its file count equals the repo's own test files; and, because CI and `release.yml` run Bun **1.4.2** (`.bun-version`) while this machine runs 1.4.3, E0-T08 repeats the proof on 1.4.2 inside `oven/bun:1.4.2-debian` (the image the Dockerfile builds on): `docker run --rm -v "$PWD":/w:ro -w /w oven/bun:1.4.2-debian bun test repos` prints "did not match any test files", plus a control tree (a failing `repos/x/b.test.ts`, a passing `apps/a.test.ts`, the same bunfig) that runs 1 pass / 0 fail on 1.4.2. | E2 |
| P2 | `.dockerignore` gains the line `repos`; `.vscode/settings.json` is created and committed (`search.exclude` and `typescript.preferences.autoImportFileExcludePatterns` with `repos/**`, `files.watcherExclude` with `**/repos/**`); `apps/web/vite.config.ts` gets `server.watch.ignored: ["**/repos/**"]`. The `Dockerfile` is not touched (it never `COPY`s the root). | E2 |
| P3 | `effect` is added with `bun add --exact effect@4.0.5` in `packages/shared`, `apps/api` and `apps/web`; `@effect/platform-bun` with `bun add --exact @effect/platform-bun@4.0.5` in `apps/api` only, as a runtime `dependency` (E7 and E10 need it in the image). No root dependency. `packages/shared` and `apps/web` import nothing from `effect` in E0 (E1, E6 do). The expected `bun.lock` diff is the one of section 1.1 "Lockfile probe": `+` lines only for the four workspace dependency lines, blank separator lines and the keys `effect`, `@effect/platform-bun`, `@effect/platform-node-shared`, `ws`, `@types/ws`, `@libsql/isomorphic-ws/ws`, `@libsql/isomorphic-ws/@types/ws`; exactly two `-` lines, the old top-level `"ws": ["ws@8.21.3"` and `"@types/ws": ["@types/ws@8.18.1"`; the nested `@libsql/isomorphic-ws/*` keys keep 8.21.3 and 8.18.1. That re-hoist is ALLOWED (no existing consumer moves); any other `-` line, or a `+` line under another key, is a stop. | E1 |
| P4 | `apps/api/src/runtime.ts` exports `AppLayer` (`Layer.empty`, the slot E2 fills with the core layers and each module's `layer`), `appMemoMap = Layer.makeMemoMapUnsafe()` and `runtime = ManagedRuntime.make(AppLayer, { memoMap: appMemoMap })`. It imports only `effect`. Nothing runs at module scope (`ManagedRuntime.make` builds lazily on the first run); no other application file calls `ManagedRuntime.make`. | E7, E12 |
| P5 | The health payload moves to `apps/api/src/core/health.ts` as one constant `export const healthResponse: Effect.Effect<HealthResponse> = Effect.gen(function* () { … })` (inline `Effect.gen`, no wrapper function), `time` from `DateTime.formatIso(yield* DateTime.now)` (`repos/effect/packages/effect/src/internal/dateTime.ts:1261`: `toDateUtc(self).toISOString()`, the same format as today), the registry and the feature flags read INSIDE the generator body (CLAUDE.md "API import cycle"). The key order of the object stays `ok, status, version, time, database, modules, features`, every value computed exactly as today. The route becomes `app.get("/api/health", async (c) => c.json(await runtime.runPromise(healthResponse)))`, same position in the mount order. | E7, E12, D8 |
| P6 | Shutdown (still `if (!env.isTest)` in `apps/api/src/index.ts`): the existing guard, the existing line `[api] ${signal} — stopping modules …`, every module's `shutdown()` as now, THEN `await runtime.dispose()` and the new English line `[api] runtime disposed`; a rejected dispose logs `[api] runtime dispose failed:` with the error; `process.exit(0)` last in every case. Proved once by a real boot in the record (E0-T08), not by an in-process test (bun's runner owns the process). | E7, E5 (the scope that will close the DB) |
| P7 | `apps/api/test/effect-idioms.test.ts` copies the shape of `apps/web/src/styles/design-system.test.ts` (walk, comment-free code lines, `report(rule, hits)` with `file:line`, one `describe` per rule, a pinned allow list per rule) and switches on only the rules that hold at E0 (section 5, E0-T06). The rules later milestones switch on are listed in a `PENDING_RULES` comment block naming the milestone (E1 no `zod`, E2 no `throw new ApiError` and no `Date.now()` / `new Date()` in services, E7 no `hono`), never as skipped or `todo` tests. | E12, E9 |
| P8 | The subtree is verified, not re-added: the record quotes `git log --format='%h %s' -3 -- repos/effect` and the `git-subtree-split` line, and a test pins `repos/effect/packages/effect/package.json` `version` equal to the installed `effect` version (so a version bump without `git subtree pull` fails). No test reads git history (CI checks out with depth 1). | E2 |
| P9 | ADR 0012 amends SPEC wording only where a D-decision names Zod or Hono: D10's ADR 0002 sentence, plus one sentence after the §1 preamble. D4, D7, D8 and D9 are recorded as unchanged with the E-decision that implements each. SPEC §2's `Hono` interface and the intro's "Bun.serve + Hono" stay until E7, which rewrites §2 in its own commit (`docs/EFFECT.md` E8); the ADR says so. Catalog key names (`server.zod.*`, `server.validation.*`) are identifiers and keep their names. | E1–E12 vs D4, D7–D10 |
| P10 | `apps/api/test/docs-paths.test.ts` is not widened: `repos/`, `agent-patterns/` and `.vscode/` are outside its `PATH_PREFIXES`; `bunfig.toml` is already one of its `ROOT_FILES`, so CLAUDE.md may name it only once E0-T01 has created it. | M7 decision 5 |
| P11 | Commits: one or more per task, message `E0-Tnn: …`, body naming the EFFECT.md decision or the file served, ending with the harness's `Co-Authored-By` line (CLAUDE.md "Conventions"). `git status --porcelain repos/` is empty after every task. No push. | CLAUDE.md |
| P12 | The full-suite verify of E0-T08 tolerates exactly one known flake and nothing else: when `bun test` exits non-zero, it passes only if every `(fail)` line is a test of `describe("GET /uploads/<name>.thumb.webp")` in `apps/api/test/thumbnails.test.ts` (a sharp timeout under load, section 1.2), the summary's fail count equals the number of those lines, no "Unhandled error" appears, and `bun test apps/api/test/thumbnails.test.ts` alone then passes; the load average is printed with it. A thumbnail timeout under load is NOT a defect: no fix round raises a timeout or edits `thumbnails.test.ts`. The full test log is captured before any `docker build` starts, and no docker command runs while a `bun test` runs. | §1.2, CLAUDE.md "Long commands" |
| P13 | E0-T08's record checks read section 9 alone (`sed -n '/^## 9[.]/,/^## 10[.]/p'`) and look for measured values that no other part of this plan contains: the "transferring context: <size>" line of the probe build, the health body with a real `"time":"20…"`, the boot log's `[api] runtime disposed` and `server_exit=0`, `git-subtree-split: 7f524e25c…`, a `Ran N tests across M files` summary, the Bun 1.4.2 banner `bun test v1.4.2`, and the status line `**Status: DONE`. | §5 exit criteria |

## 3. Waves

| Wave | Tasks (parallel worktrees, merged in id order) |
| --- | --- |
| 1 | E0-T01 fences (rewrite), E0-T02 dependencies (rewrite), E0-T03 open-work rows (rewrite), E0-T04 ADR 0012 (build) |
| 2 | E0-T05 runtime and health (core; after T02), E0-T06 idioms test (build; after T01, T02) |
| 3 | E0-T07 CLAUDE.md (build; after T01–T06) |
| 4 | E0-T08 integration record (build; after all) |

File ownership: T01 `bunfig.toml`, `.dockerignore`, `.vscode/settings.json`, `apps/web/vite.config.ts`,
`apps/api/test/deploy-dockerfile.test.ts`; T02 the four `package.json` (root untouched in practice) and
`bun.lock`; T03 `docs/open-work.md`; T04 `docs/adr/0012-effect-application-framework.md`, `docs/SPEC.md`; T05
`apps/api/src/runtime.ts`, `apps/api/src/core/health.ts`, `apps/api/src/index.ts`,
`apps/api/test/runtime.test.ts`, `apps/api/test/import-order.test.ts`, `agent-patterns/effect-services.md`,
`agent-patterns/effect-testing.md`; T06 `apps/api/test/effect-idioms.test.ts`; T07 `CLAUDE.md`; T08 this plan
file and the "Status" paragraph of `CLAUDE.md`.

Every worktree runs `bun install --frozen-lockfile` before its verify commands (worktrees share no
`node_modules`). Implementers read this plan at `/home/erics/software/toon-household/docs/plans/e0-foundation.md`.

## 4. Tasks

### E0-T01 — Fence `repos/` off: test discovery, image, editor, Vite (rewrite)

Read: `docs/EFFECT.md` E2 and §2.4; section 2 P1, P2 of this plan; `.dockerignore`; `apps/web/vite.config.ts`
(the `server:` line near the end); `apps/api/test/deploy-dockerfile.test.ts` (`describe(".dockerignore"`).
Gotcha: CLAUDE.md "Long commands" (none here). Touch NO other line.

| # | File | Old | New |
| --- | --- | --- | --- |
| 1 | `bunfig.toml` (new, repo root) | — | exactly the four lines: `# bun test never discovers the vendored Effect source (docs/EFFECT.md E2): repos/effect` / `# carries about 580 vitest files of its own, which are reference material, not this repo's tests.` / `[test]` / `pathIgnorePatterns = ["repos/**"]` |
| 2 | `.dockerignore` | file ends with the line `# the legacy migration fixtures live under apps/api/test (excluded above)` | append, after that line, two lines: `# the vendored Effect source (docs/EFFECT.md E2): read-only reference for agents, never built or shipped` / `repos` |
| 3 | `.vscode/settings.json` (new) | — | `{` / `  "search.exclude": { "repos/**": true },` / `  "files.watcherExclude": { "**/repos/**": true },` / `  "typescript.preferences.autoImportFileExcludePatterns": ["repos/**"]` / `}` plus a final newline |
| 4 | `apps/web/vite.config.ts` | `    server: { port: 5173, host: true, proxy },` | two lines: `    // The vendored Effect source is never watched (docs/EFFECT.md E2).` / `    server: { port: 5173, host: true, proxy, watch: { ignored: ["**/repos/**"] } },` (the `preview:` line stays as it is) |
| 5 | `apps/api/test/deploy-dockerfile.test.ts` | inside `describe(".dockerignore", () => {`, after the closing `});` of `test("keeps the migration inputs, outputs and worktrees out of the context", …)` | insert a new test: `  test("keeps the vendored Effect source out of the context (docs/EFFECT.md E2)", () => {` / `    expect(ignored.has("repos")).toBe(true);` / `  });` |

Commit: `E0-T01: fence repos/ off from bun test, the image, the editor and Vite` (body: "docs/EFFECT.md E2").

### E0-T02 — Install `effect` and `@effect/platform-bun` at 4.0.5, pinned (rewrite)

Read: `docs/EFFECT.md` E1; section 2 P3. Run exactly, from the worktree root, each with its own log under the
scratchpad ending in `exit=$?` (CLAUDE.md "Long commands"; a cold cache downloads):

| # | Directory | Command | Expected `package.json` change |
| --- | --- | --- | --- |
| 1 | `apps/api` | `bun add --exact effect@4.0.5 @effect/platform-bun@4.0.5` | `"dependencies"` gains `"@effect/platform-bun": "4.0.5"` and `"effect": "4.0.5"` (alphabetical; no `^`) |
| 2 | `packages/shared` | `bun add --exact effect@4.0.5` | `"dependencies"` gains `"effect": "4.0.5"` |
| 3 | `apps/web` | `bun add --exact effect@4.0.5` | `"dependencies"` gains `"effect": "4.0.5"` |
| 4 | root | `bun install --frozen-lockfile` | none (must exit 0) |

Then check `git diff --stat`: only the three `package.json` and `bun.lock` change (bun.lock about +18/-2).

**Expected `bun.lock` diff (P3, section 1.1 "Lockfile probe"), ALLOWED:**

| Lines | What |
| --- | --- |
| `+        "@effect/platform-bun": "4.0.5",` and three `+        "effect": "4.0.5",` | the workspace entries of `apps/api`, `apps/web`, `packages/shared` |
| `+    "effect": ["effect@4.0.5", …]`, `+    "@effect/platform-bun": ["@effect/platform-bun@4.0.5", …]`, `+    "@effect/platform-node-shared": ["@effect/platform-node-shared@4.0.5", …]` and blank `+` lines | the new packages |
| `-    "ws": ["ws@8.21.3", …]` → `+    "ws": ["ws@8.22.0", …]` | re-hoist: node-shared wants `ws ^8.22.0` |
| `-    "@types/ws": ["@types/ws@8.18.1", …]` → `+    "@types/ws": ["@types/ws@8.18.2", …]` | re-hoist: node-shared wants `@types/ws ^8.18.2` |
| `+    "@libsql/isomorphic-ws/ws": ["ws@8.21.3", …]`, `+    "@libsql/isomorphic-ws/@types/ws": ["@types/ws@8.18.1", …]` | libsql's only consumer keeps its versions as nested keys |

**Stop and report blocked with the diff** if there is any other `-` line, a `+` line under any other key, or
the two nested `@libsql/isomorphic-ws/*` keys are missing or name other versions. The check, from the worktree
root (prints `0` twice and `nested-ok`):

```
git diff 669ef34b1 -- bun.lock | grep '^-' | grep -v '^---' | grep -vE '^-    "(ws": \["ws@8\.21\.3"|@types/ws": \["@types/ws@8\.18\.1")' | wc -l
git diff 669ef34b1 -- bun.lock | grep '^+' | grep -v '^+++' | grep -vE '^\+$|^\+ +"(effect|@effect/platform-bun|@effect/platform-node-shared|ws|@types/ws|@libsql/isomorphic-ws/ws|@libsql/isomorphic-ws/@types/ws)": ' | wc -l
grep -qF '"@libsql/isomorphic-ws/ws": ["ws@8.21.3"' bun.lock && grep -qF '"@libsql/isomorphic-ws/@types/ws": ["@types/ws@8.18.1"' bun.lock && echo nested-ok
```

Do NOT edit `bun.lock` by hand, do NOT edit any source file, do NOT add an import. Commit: `E0-T02: effect and
@effect/platform-bun 4.0.5, pinned exactly` (body: "docs/EFFECT.md E1; bun.lock re-hoists ws 8.22.0 and
@types/ws 8.18.2 for @effect/platform-node-shared, libsql keeps 8.21.3 and 8.18.1 nested").

### E0-T03 — `docs/open-work.md`: two owner decisions (rewrite)

Read: `docs/EFFECT.md` E1, E5, E11, §6; `docs/open-work.md` "Owner decisions". Touch no other line.

| # | Old | New |
| --- | --- | --- |
| 1 | `Each one changes copy or drawn screens that the sources shipped, so an agent does not take it` / `unprompted.` | `Each one changes copy or drawn screens that the sources shipped, or a fixed decision of` / `` `docs/EFFECT.md`, so an agent does not take it unprompted. `` (rewrap the paragraph to the file's ~110-column width; the words are exactly these) |
| 2 | after the row starting `\| D-4 \|` | add row D-5: `` \| D-5 \| Raw SQL through `@effect/sql-libsql` (Effect's SQL client, `Model.Class` repositories) beside or instead of drizzle's query builder. `docs/EFFECT.md` E5 keeps drizzle as the schema, migration and query source, and E1 installs no `@effect/sql-*` package. \| The `Database` service of milestone E2 (`apps/api/src/db/client.ts`), the queries of every service, the D7 pragmas on a second client. Needs an ADR (EFFECT E1 and E5, SPEC D7). \| `docs/EFFECT.md` E1, E5 and §6 \| The ADR exists, the package is pinned at the `effect` version, and `apps/api/test/db-pragmas.test.ts` passes on the new client. \| `` |
| 3 | after row D-5 | add row D-6: `` \| D-6 \| `@effect/atom-react` for web state in place of, or beside, TanStack Query. `docs/EFFECT.md` E11 keeps TanStack Query and the router, because the persisted TanStack cache is the offline ledger and the outbox (SPEC D9). \| `apps/web/src/lib/query-client.ts`, `apps/web/src/lib/persist.ts`, every `queries.ts`, the offline outboxes of both modules, `PERSIST_BUSTER`. Needs an ADR (EFFECT E11, SPEC D9). \| `docs/EFFECT.md` E11 and §6 \| The ADR exists and says how the offline outbox and the persisted cache survive; the headless offline replays of CLAUDE.md pass. \| `` |

Do not name `docs/adr/0012-…` (written in parallel by E0-T04; docs-paths would fail on this branch). Commit:
`E0-T03: open-work owner decisions for @effect/sql-libsql and @effect/atom-react` (body: "docs/EFFECT.md E5, E11, §6").

### E0-T04 — ADR 0012 "Effect is the application framework", SPEC wording (build)

Read: `docs/EFFECT.md` whole (§1 E1–E12 above all, §6); `docs/SPEC.md` §1 (D4, D7, D8, D9, D10) and §2;
`docs/adr/0002-finance-validation-wording-from-the-core.md`, `docs/adr/0009-test-suite-on-a-temp-file-db.md`
(format: title line `# 0012: …`, `Date:`, `## Context`, `## Decision`, `## Consequences`); CLAUDE.md "Fixed
decisions" (ADRs edit SPEC text in the same commit).

Write `docs/adr/0012-effect-application-framework.md`, title `# 0012: Effect is the application framework
(records E1–E12; amends the wording of D10)`, date 2026-10-16. Context: the owner's decision of 2026-10-16,
`docs/EFFECT.md`, "changes how the code is written, not what it does". Decision: one bullet per E1–E12 (one or
two sentences each, no new rule), then a table "SPEC decision → status under Effect" for D4 (unchanged:
argon2id via `Bun.password`, OAuth linking, the confirmation gate, signed uploads; E7 turns them into services
`OAuthProviders`, `RateLimiter`, `Uploads`), D7 (unchanged: drizzle schema and migrations, WAL +
`synchronous = FULL`, the busy timeout; E5 makes the connection a scoped `Database` service), D8 (unchanged:
paths, error envelope, codes, middleware names and order; E6 maps errors once, E8 moves the chain to
`HttpApiMiddleware` with the same names and order at E7), D9 (unchanged: TanStack Query, persisted cache,
outboxes, `PERSIST_BUSTER`; E11 changes only the fetch layer; `@effect/atom-react` is an owner decision), D10
(unchanged rule; the generic validation messages come from Effect `Schema` after E1 and keep the core's
wording, E4; catalog keys `server.zod.*` and `server.validation.*` keep their names). Consequences: the SPEC
edits below; SPEC §2's `Hono` interface and the intro's stack sentence stay until E7 rewrites §2 (EFFECT E8);
deviations from E1–E12 follow the same ADR rule.

SPEC edits in the same commit, exactly:

| # | Old (in `docs/SPEC.md`) | New |
| --- | --- | --- |
| 1 | `A second recorded exception (ADR 0002): finance's generic Zod validation messages render the core's wording;` | `A second recorded exception (ADR 0002): finance's generic validation messages (Zod's in toon-finance, Effect` / `` `Schema`'s here from milestone E1 of `docs/EFFECT.md` on, ADR 0012) render the core's wording; `` |
| 2 | the paragraph `These were taken with the owner and are not re-litigated by any agent. …` / `… is recorded in the plan and` / `` in `docs/adr/`. `` | append, as a new paragraph after it: `` Effect 4 is the application framework underneath these decisions (`docs/EFFECT.md` E1–E12, ADR 0012); it `` / `changes none of them.` |

Nothing else in `docs/SPEC.md` changes. Commit: `E0-T04: ADR 0012, Effect is the application framework`
(body: "docs/EFFECT.md E1–E12; amends the wording of SPEC D10").

### E0-T05 — `runtime.ts`, `/api/health` through the runtime, dispose on shutdown (core)

Read first: `repos/effect/LLMS.md` (whole); `agent-patterns/effect-services.md` §3.2, §6;
`agent-patterns/effect-core.md` §2; `agent-patterns/effect-testing.md` §2.5, §4;
`repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts` (the Hono bridge and the dispose on signals);
`repos/effect/packages/effect/src/ManagedRuntime.ts` (`make` at line ~291, `isManagedRuntime`, `memoMap`,
`dispose`, the `"ManagedRuntime disposed"` defect at line ~355); `repos/effect/packages/effect/src/Layer.ts`
(`empty`, `makeMemoMapUnsafe`); `repos/effect/packages/effect/src/DateTime.ts` (`now`, `formatIso`).
Repo: `apps/api/src/index.ts` (health route, shutdown block, the boot block), `apps/api/test/smoke.test.ts`,
`apps/api/test/import-order.test.ts`, `packages/shared/src/core/schemas/common.ts` (`HealthResponse`).
CLAUDE.md gotchas: "API import cycle: read the registry inside functions …" (read `API_MODULES` only inside
the generator body), "Middleware chain order is load-bearing" (the health route keeps its place: after the
origin guard, before `/uploads`), "Retired gotchas" (tests share one process; no signal handler under test).
Decisions P4, P5, P6.

Build:
1. `apps/api/src/runtime.ts` per P4, with a header comment: what `AppLayer` will hold (E2: `AppConfig`,
   `Database`, `Mailer`, `Uploads`, `RateLimiter`, `OAuthProviders`; E3/E4: each module's `layer`), why the
   memo map is shared (`10_managed-runtime.ts`), that `index.ts` disposes it on SIGTERM/SIGINT, that nothing
   may run it at module scope. Type `AppLayer` so E2 can widen it (`Layer.Layer<never>` today).
2. `apps/api/src/core/health.ts` per P5, with the health doc comment moved from `index.ts`.
3. `apps/api/src/index.ts`: the route per P5, the shutdown per P6. The import of `isVerifiedEmailRequired`
   moves to `core/health.ts` if `index.ts` no longer uses it. Nothing else changes (mount order, boot block,
   `export default`).
4. `apps/api/test/runtime.test.ts` (new): (a) `ManagedRuntime.isManagedRuntime(runtime)` and
   `runtime.memoMap === appMemoMap`; (b) `spyOn(runtime, "runPromise")`, `app.request("/api/health")` → 200,
   the spy was called once with `healthResponse`, the body equals the existing smoke expectations
   (`ok`, `status`, `database: "file"`, `modules: ["recipe","finance"]`, `HealthResponseSchema.parse` passes)
   and `time` round-trips (`new Date(body.time).toISOString() === body.time`); restore the spy;
   (c) `runtime.runPromise(healthResponse)` returns an object whose keys are, in order, `ok, status, version,
   time, database, modules, features`; (d) a throwaway `ManagedRuntime.make(AppLayer)` (no shared memo map)
   runs `healthResponse`, `await rt.dispose()`, and a further `rt.runPromise(healthResponse)` rejects (assert
   what `ManagedRuntime.ts` makes it reject with). Never dispose the shared `runtime` in a test.
5. `apps/api/test/import-order.test.ts`: add `"./src/runtime.ts"` and `"./src/core/health.ts"` to the entry
   list (after `"./src/index.ts"`), comment `// E0: the runtime and the health effect`.
6. Pattern files: if a line of `agent-patterns/effect-services.md` or `agent-patterns/effect-testing.md`
   proved wrong while doing this, fix it in the same commit, and add one "In this repo" line naming
   `apps/api/src/runtime.ts` to `effect-services.md` §7.

Do NOT touch `apps/api/test/smoke.test.ts`, `finance-module.test.ts`, `verified-email-gate.test.ts`,
`security.test.ts`: they must pass unchanged (the response is byte-identical apart from `time`). Commit:
`E0-T05: runtime.ts with the one ManagedRuntime, /api/health through it, dispose on shutdown` (body:
"docs/EFFECT.md E7; serves GET /api/health").

### E0-T06 — `apps/api/test/effect-idioms.test.ts`, the E12 gate (build)

Read: `docs/EFFECT.md` E1, E2, E12, §2.4; `apps/web/src/styles/design-system.test.ts` (the shape: `walk`,
`codeLines` without comment lines, `scan`, `report(rule, hits)`, `expectNone`); `repos/effect/LLMS.md`
(the idioms); `agent-patterns/effect-services.md` §5, `agent-patterns/effect-testing.md` §5 (v3 names);
`repos/effect/migration/v3-to-v4.md` (headings only, for the v3 construct names). Decision P7, P8.

Scanned files: every `*.ts`, `*.tsx`, `*.js`, `*.mjs` under `apps/api/src`, `apps/api/scripts`,
`apps/api/test`, `apps/web/src`, `packages/shared/src`, `packages/shared/test`, `scripts`, plus
`apps/web/vite.config.ts`, `apps/web/pwa-manifest.ts`; never `node_modules`, `dist`, `repos`, and never the
idioms test itself (`SELF`). Comment lines are not scanned (same `COMMENT_START` rule as design-system).

Rules (one `describe` each, failure text `file:line: code` per hit, allow lists as pinned constants with a
reason each; all are empty at E0 except where named):
1. No import from the vendored tree: an import/export/`import(`/`require(` specifier containing `repos/`.
2. No `effect/unstable/` specifier.
3. No v3 package specifier: `@effect/platform` exactly or with a `/` subpath (NOT `@effect/platform-bun`),
   `@effect/schema`, `@effect/sql` and `@effect/sql-*`, `@effect/vitest`.
4. No v3 service constructors: `Context.Tag(`, `Context.GenericTag(`, `Effect.Tag(`, `Effect.Service<`.
5. One runtime: `ManagedRuntime.make(` in non-test source (`apps/api/src`, `apps/api/scripts`,
   `packages/shared/src`, non-`*.test.*` files of `apps/web/src`) only in the allow list
   `["apps/api/src/runtime.ts"]` (E6 adds `apps/web/src/lib/runtime.ts`). Check only "no hit outside the
   allow list", so the rule holds on a branch where `runtime.ts` does not exist yet.
6. Dependencies (`package.json` of root, `apps/api`, `apps/web`, `packages/shared`, all four dependency
   sections): every `effect` and `@effect/*` entry is an exact version (`/^\d+\.\d+\.\d+$/`), all equal to
   `apps/api`'s `effect`; none of the forbidden names of rule 3 or `@effect/sql-drizzle` appears; `effect` is
   present in `apps/api`, `apps/web`, `packages/shared` and `@effect/platform-bun` in `apps/api`.
7. Lockfile: every resolved `effect@x` / `@effect/<name>@x` in `bun.lock` (match `"(effect|@effect/[a-z0-9-]+)@(\d[^"]*)"`)
   has `x` equal to that version (catches `@effect/platform-node-shared`).
8. Vendored tree pinned (P8): `repos/effect/packages/effect/package.json` exists and its `version` equals the
   installed `effect` version; `bunfig.toml` has a `[test]` table whose `pathIgnorePatterns` contains
   `"repos/**"` (`Bun.TOML.parse`, or a regex if `tsc` rejects it); `.dockerignore` has the line `repos`;
   `.vscode/settings.json` parses and has the three keys of P2.
9. `PENDING_RULES`: a comment block (not tests) listing what E1, E2 and E7 switch on (P7).

Prove every rule bites before committing: add a temporary violating line per rule (e.g.
`import "effect/unstable/http";` in a scratch `apps/api/src/__probe.ts`), see the test fail with `file:line`,
remove the probe. Commit: `E0-T06: effect-idioms test, the E12 rules that hold at E0` (body: "docs/EFFECT.md
E12, E1, E2").

### E0-T07 — CLAUDE.md: "Vendored reference code", read order, layout, gotchas (build)

Read: `docs/EFFECT.md` §2 (2.1 read order, 2.2 pattern files, 2.3 renames, 2.4 rules); CLAUDE.md whole; this
plan's sections 1.1 and 2; the merged files of T01–T06; `apps/api/test/docs-paths.test.ts` (what it checks).

Edit `CLAUDE.md`:
1. **Read order:** item 2b also names `repos/effect/LLMS.md` and `agent-patterns/` as the first reading before
   writing Effect code (pointing at the new section).
2. **Fixed decisions:** say E1–E12 of `docs/EFFECT.md` §1 are fixed like D1–D15, and add "0012 Effect is the
   application framework (E1–E12; D10 wording)" to the ADR list.
3. **Building it:** keep; add that the E0 plan is `docs/plans/e0-foundation.md` and that the Learn phase
   verifies `repos/effect` instead of re-adding it.
4. **New section "Vendored reference code"** (after "Building it"): what `repos/effect` is (squashed subtree of
   `https://github.com/Effect-TS/effect.git` at tag `effect@4.0.5`; squash `e54b8022a`, merge `60828f2e6`,
   split `7f524e25c` = the tag); the read order of `docs/EFFECT.md` §2.1 (six steps, with the
   `repos/effect/…` paths); the pattern files present (the five `agent-patterns/effect-*.md`) and that the
   Learn phase distills the others; the §2.3 rename warning in one paragraph pointing at
   `repos/effect/migration/v3-to-v4.md`; the rules of §2.4 (read-only, never imported — pinned by
   `apps/api/test/effect-idioms.test.ts`; not a workspace; never `bun install`, `bun test` or `tsc` inside;
   never edited; `git status --porcelain repos/` empty after every task); the fences (`bunfig.toml`,
   `.dockerignore`, `.vscode/settings.json`, `server.watch.ignored` in `apps/web/vite.config.ts`); how to
   update (bump `effect` in the three `package.json` and `@effect/platform-bun` together, exact versions, then
   `git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git effect@<version> --squash`
   in the same task, then the gates; the idioms test's version rules fail otherwise).
5. **Layout:** `apps/api/src/runtime.ts` (AppLayer, the one ManagedRuntime) and `apps/api/src/core/health.ts`
   in the API bullet; `bunfig.toml`, `.vscode/settings.json`, `repos/effect/`, `agent-patterns/` in a new bullet.
6. **Commands:** `bun test` notes that `bunfig.toml` keeps `repos/` out of discovery.
7. **Gotchas in use → Testing and tooling:** two new bullets: "**`repos/` is fenced off, not deleted.**" (bunfig
   key, the `bun test repos` proof, a filter matching `repos/` finds nothing by design) and "**The idioms test is
   the E12 gate.**" (rules, allow lists, PENDING_RULES, never relax a rule; shape of the design-system gate).
   **Database and API:** one bullet "**One runtime, disposed on shutdown (E0).**" (`runtime.ts`, nothing runs at
   module scope, `/api/health` through `runtime.runPromise`, SIGTERM/SIGINT log lines and order).

Every repo path named under `apps/`, `packages/`, `scripts/`, `docs/`, `docker/`, `.github/` or a ROOT_FILE must
exist (docs-paths). Do not touch "Status" (E0-T08 does). Commit: `E0-T07: CLAUDE.md vendored reference code,
read order, layout and the E0 gotchas` (body: "docs/EFFECT.md E2, §2").

### E0-T08 — Integration: gates, proofs, record (build)

Depends on every task. If this plan file has uncommitted changes on main, commit them first. Run each long
command in the background with one log under the scratchpad ending in `exit=$?`, then read it. Order matters
(P12): steps 1-3 (everything that runs `bun test`) finish and their logs are saved BEFORE step 4 starts any
`docker build`; never run a docker command and a `bun test` at the same time.

1. Gates: `bun install --frozen-lockfile`; `bun run typecheck`; `bun test` (full, log kept, `uptime` printed
   before it); `bun run build`; `bun run i18n:check` (exit 1 by design: parity OK and the leftover-German hits
   classified against the 146 known false positives; a new hit is a finding); `bun test
   apps/api/test/effect-idioms.test.ts apps/api/test/docs-paths.test.ts`; `git status --porcelain repos/` empty.
2. Pass count vs baseline: record pass/fail/files; pass + tolerated thumbnail timeouts must be ≥ 2442 + the tests
   E0 added (section 1.2; at least 2450: T01 adds 1, T05 adds 4 runtime tests and 2 import-order entries, T06 at
   least 1). The flake rule (P12): if the full run fails, every `(fail)` line must be under
   `GET /uploads/<name>.thumb.webp >`, the summary's fail count must equal their number, no "Unhandled error"
   may appear, and `bun test apps/api/test/thumbnails.test.ts` alone must then pass; record both outputs and the
   load average. Any other failure is a defect. A thumbnail timeout under load is not: never raise a timeout,
   never edit `thumbnails.test.ts`. The verify command implementing exactly this is the second one in the task's
   verify list.
3. Discovery proof: `grep -c '^repos/' <bun-test-log>` is 0; the file count in "Ran N tests across M files"
   equals `git ls-files '*.test.ts' '*.test.tsx' | grep -v '^repos/' | wc -l`; `bun test repos` prints "did not
   match any test files". Then the same on Bun **1.4.2**, the version CI and `release.yml` use (P1):
   `docker run --rm -v "$PWD":/w:ro -w /w oven/bun:1.4.2-debian bun test repos 2>&1` (expect the banner
   `bun test v1.4.2` and "did not match any test files"), and the control tree: `P=$(mktemp -d)`, a
   `$P/bunfig.toml` with the two bunfig lines `[test]` / `pathIgnorePatterns = ["repos/**"]`, a failing
   `$P/repos/x/b.test.ts` (`expect(1).toBe(2)`), a passing `$P/apps/a.test.ts`, then `docker run --rm -v
   "$P":/w:ro -w /w oven/bun:1.4.2-debian bun test 2>&1` (expect `1 pass`, `0 fail`); remove `$P`. Record both
   outputs. If 1.4.2 ignores the key, stop and report it as a finding (no `.bun-version` bump in E0). This step
   runs no `docker build` and comes after the full `bun test` log is saved.
4. Docker context proof: a probe Dockerfile in the scratchpad: `FROM oven/bun:1.4.2-debian` / `COPY . /ctx` /
   `RUN test ! -e /ctx/repos && test ! -e /ctx/.git && echo "repos excluded"`, built with `docker build
   --no-cache --progress=plain -f <probe> .` from the repo root; the log shows "repos excluded" and the
   "transferring context" size. Then the real image: `docker build -t toon-household:e0 .` to a log ending in
   `exit=$?` (proves the `deps` stage installs `effect` and `@effect/platform-bun` with
   `--frozen-lockfile --production`); `docker image rm toon-household:e0` afterwards. Logs live in the
   scratchpad, never as `build.log` in the repo.
5. Subtree: quote `git log --format='%h %s' -3 -- repos/effect` and the `git-subtree-split` line of
   `e54b8022a`.
6. Boot and shutdown (P6): `D=$(mktemp -d)`; `DATABASE_URL=file:$D/e0.db SESSION_SECRET=<32 hex> bun run
   db:migrate`; then one script run in the background: start `NODE_ENV=development DATABASE_URL=file:$D/e0.db
   SESSION_SECRET=<32 hex> UPLOAD_DIR=$D/uploads API_PORT=3901 bun apps/api/src/index.ts > $D/boot.log 2>&1 &`,
   poll `curl -sf http://127.0.0.1:3901/api/health` until it answers (at most 60 s), save the body, `kill -TERM`
   the server's pid (never `pkill -f`), `wait` it and print `server_exit=$?`. Record: the health body, the boot
   line, `[api] SIGTERM — stopping modules …`, `[api] runtime disposed`, `server_exit=0`. Remove `$D`.
7. Bundle: gzipped total of `apps/web/dist/assets/*.js` (`for f in apps/web/dist/assets/*.js; do gzip -c "$f" |
   wc -c; done | awk '{s+=$1} END {print s}'`) as the pre-Effect baseline for E6.
8. Write section 9 (integration record: commands, outputs, numbers) and section 10 (what changed vs plan, every
   deviation) of this plan, set the status line to `**Status: DONE (<date>).**`, and update CLAUDE.md "Status"
   with the new pass count and file count and one sentence that E0 is done (`docs/plans/e0-foundation.md`).
   Section 9 quotes VERBATIM (P13): the probe build's `transferring context: <size>` line and its `repos
   excluded` line; the saved health body (with its real `"time":"20…"`); the boot log's
   `[api] SIGTERM — stopping modules …` and `[api] runtime disposed` lines and `server_exit=0`; the
   `git-subtree-split: 7f524e25c…` line; the full run's `Ran N tests across M files` line and pass/fail lines;
   the Bun 1.4.2 output of step 3 (banner `bun test v1.4.2` and "did not match any test files"); the gzipped
   bundle total in bytes. `bun test apps/api/test/docs-paths.test.ts` after the edit. Commit: `E0-T08:
   integration record (plan e0-foundation sections 9 and 10), status DONE`.

## 5. Acceptance per task

See the structured task list (same ids): every task lists its acceptance checks and verify commands; a verify
command exits 0 or the task is not done. Two verify commands carry plan rules and are spelled out here:

- E0-T02's lockfile check is the three commands at the end of its section (P3): `0`, `0`, `nested-ok`.
- E0-T08's full suite (P12), run before any docker command, from the repo root:

```
bash -c 'L=$(mktemp); uptime; bun test > "$L" 2>&1; s=$?; tail -6 "$L"; p=$(grep -Eo "^ *[0-9]+ pass" "$L" | tail -1 | grep -Eo "[0-9]+"); n=$(grep -c "^(fail) " "$L"); t=$(grep -cF "(fail) GET /uploads/<name>.thumb.webp > " "$L"); sf=$(grep -Eo "^ *[0-9]+ fail" "$L" | tail -1 | grep -Eo "[0-9]+"); echo "full_exit=$s pass=$p fail_lines=$n thumbnail_fail_lines=$t summary_fail=$sf"; [ "$((p + t))" -ge 2450 ] || exit 1; ! grep -q "^repos/" "$L" || exit 1; [ $s -eq 0 ] && exit 0; [ "$n" -gt 0 ] && [ "$n" -eq "$t" ] && [ "$sf" = "$n" ] && ! grep -q "Unhandled error" "$L" && bun test apps/api/test/thumbnails.test.ts'
```

- E0-T08's record check (P13) reads section 9 only:

```
bash -c 'X=$(sed -n "/^## 9[.]/,/^## 10[.]/p" docs/plans/e0-foundation.md); for re in "repos excluded" "transferring context: [0-9.]+ ?[kMG]?B" "time.:.20[0-9]{2}-[0-9]{2}-[0-9]{2}T" "[[]api[]] runtime disposed" "server_exit=0" "git-subtree-split: 7f524e25c" "Ran [0-9]+ tests across [0-9]+ files" "bun test v1[.]4[.]2" "did not match any test files"; do printf "%s\n" "$X" | grep -qE -- "$re" || { echo "missing in section 9: $re"; exit 1; }; done'
```

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| CI and the Dockerfile run Bun **1.4.2** (`.bun-version`); the bunfig key was proved on 1.4.3. If 1.4.2 ignored `pathIgnorePatterns`, CI's `bun test` would run 582 vitest files and fail the release job on the first push. | E0-T08 step 3 proves the fence on 1.4.2 inside `oven/bun:1.4.2-debian` (the real repo and a control tree, P1) and its verify list runs the real-repo probe. A 1.4.2 that ignores the key is a finding reported by E0-T08, not worked around; no `.bun-version` change in E0. |
| TypeScript 7 with Effect 4's types (heavy generics): typecheck time or a type error inside `effect`'s declarations. | `skipLibCheck: true` already; E0-T05 is the first file that type-checks Effect; a failure is reported verbatim, never worked around with `any`. |
| `bun add` moves other lockfile entries. | Measured (section 1.1): it re-hoists `ws` 8.22.0 and `@types/ws` 8.18.2 and keeps libsql's 8.21.3 / 8.18.1 nested; P3 allows exactly that. E0-T02 checks the diff line by line and stops on anything else. |
| Thumbnail tests time out under high load (seen at plan time); a verifier's full `bun test` under the same load would start a fix round. | P12: E0-T08's full-suite verify tolerates only `thumbnails.test.ts` timeouts that pass alone, prints the load; the docker builds run after the test log is saved. Never raise the timeout or edit the test in E0. |
| The image grows by the two packages. | Recorded (image size before/after if `docker image ls` shows it); E1/E7 remove `zod`, `@hono/zod-validator`, `hono`. |
| `runtime.ts` is imported by `index.ts`, which tests import: a run at module scope would serialise every test file. | P4: nothing runs at module scope; `ManagedRuntime.make` is lazy (`ManagedRuntime.ts` `make`). |

## 7. Deviations expected

None from SPEC D1–D15 or `docs/EFFECT.md` E1–E12. ADR 0012 is a recording ADR (the milestone requires it), not
a deviation. `/api/health`'s `time` now comes from `DateTime.now` (the default `Clock`): same instant source
(`Date.now()` under the default clock), same `toISOString()` format.

## 8. Out of this milestone

`zod` removal and any `Schema` (E1); `AppConfig`, `Database`, the error family, services, `apps/api/test/support/effect.ts`,
`TestClock` (E2); module services (E3, E4); scripts on `BunRuntime.runMain` (E5); the web runtime and any
`effect` import in `apps/web` or `packages/shared` (E6); `HttpApi`, `BunHttpServer`, SPEC §2's `Hono` interface
text (E7); pattern files beyond the five (the Learn phase of the milestone that needs them); a `.bun-version`
bump; widening `docs-paths.test.ts`.

## 9. Integration record

Written by E0-T08 on 2026-10-16 on the merged tree of `main` (E0-T01 to E0-T07 merged, HEAD `c82efa5f1` plus this
record), Bun 1.4.3 on this machine, `.bun-version` 1.4.2. Logs were kept in the session scratchpad, none in the repo.
Order as P12 asks: every `bun test` finished and its log was saved before the first docker command.

### 9.1 Gates

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | `Checked 441 installs across 630 packages (no changes)`, exit 0 |
| `bun run typecheck` | `[typecheck] OK`, exit 0 |
| `bun run build` | `@toon/web build: Exited with code 0`, exit 0 (`dist/sw.js`, `dist/workbox-8b1f5376.js`) |
| `bun run i18n:check` | exit 1 by design: `[i18n:check] 1/2 German catalog parity…` / `[i18n:check] OK`, then `FAILED — 146 possible German literal(s)`: the same 146 as M7's record. The hits are doc comments quoting German ("Häufig gekauft", "Verfügbare Module") and recipe vocabulary, the count equals the known 146; none in `apps/api/src/runtime.ts`, `apps/api/src/core/health.ts`, `apps/api/test/effect-idioms.test.ts` or anything under `repos/`, so no new hit and no finding. |
| `bun test apps/api/test/effect-idioms.test.ts apps/api/test/docs-paths.test.ts` | `19 pass`, `0 fail`, `41 expect() calls`, `Ran 19 tests across 2 files. [129.00ms]` |
| `git status --porcelain repos/` | empty (0 lines) |

### 9.2 The full suite and the baseline

`uptime` before the run: `11:15:17 up  4:24,  1 user,  load average: 11.10, 15.07, 17.51`; after it:
`11:16:01 … load average: 14.64, 15.51, 17.55`. The run passed outright (no thumbnail timeout, so the P12 flake
rule was not exercised and `thumbnails.test.ts` was not re-run alone for it):

```
 2463 pass
 0 fail
 13036 expect() calls
Ran 2463 tests across 141 files. [43.98s]
full_exit=0 pass=2463 fail_lines=0 thumbnail_fail_lines=0 summary_fail=0
```

Against the baseline of section 1.2 (2440 pass and 2 load-induced thumbnail failures, 2442 tests in 139 files):
2463 is 21 more tests than 2442 (the floor was 2450) and 2 more files (139 to 141: `apps/api/test/runtime.test.ts`
and `apps/api/test/effect-idioms.test.ts`).

### 9.3 Discovery proof (P1)

- `grep -c '^repos/'` on the saved full log: `0`.
- The file count of the run, 141, equals `git ls-files '*.test.ts' '*.test.tsx' | grep -v '^repos/' | wc -l`: `141`.
- `bun test repos` on Bun 1.4.3:

```
bun test v1.4.3 (c6da4a4d3)
The following filters did not match any test files in --cwd="/home/erics/software/toon-household":
 repos
1269 files were searched [3.00ms]
```

- The same on Bun 1.4.2, the version CI and `release.yml` use
  (`docker run --rm -v "$PWD":/w:ro -w /w oven/bun:1.4.2-debian bun test repos`, exit 1 as expected):

```
bun test v1.4.2 (744846f84)
The following filters did not match any test files:
 repos
1269 files were searched [3.00ms]
```

- The control tree on Bun 1.4.2 (a failing `repos/x/b.test.ts`, a passing `apps/a.test.ts`, the same two-line
  `bunfig.toml`; `docker run … oven/bun:1.4.2-debian bun test`, exit 0):

```
bun test v1.4.2 (744846f84)

apps/a.test.ts:
(pass) a [0.02ms]

 1 pass
 0 fail
 1 expect() calls
Ran 1 test across 1 file. [2.00ms]
```

So Bun 1.4.2 honours `pathIgnorePatterns`; there is no finding and no `.bun-version` change.

### 9.4 Docker context and image (P2)

The probe Dockerfile (`FROM oven/bun:1.4.2-debian`, `COPY . /ctx`, `RUN test ! -e /ctx/repos && test ! -e /ctx/.git &&
echo "repos excluded"`) built with `docker build --no-cache --progress=plain -f <probe> .` from the repo root,
exit 0:

```
#5 transferring context: 580.76kB 0.0s done
#7 [3/3] RUN test ! -e /ctx/repos && test ! -e /ctx/.git && echo "repos excluded"
#7 0.307 repos excluded
```

The real image, `docker build -t toon-household:e0 .`, ended `exit=0` (`#34 naming to docker.io/library/toon-household:e0
0.0s done`); the `deps` stage's frozen production install carried the two packages: the container held
`/app/apps/api/node_modules/effect`, `/app/apps/api/node_modules/@effect/platform-bun` and
`/app/node_modules/.bun/effect@4.0.5`. `docker image ls` showed 409MB disk usage. The image was removed afterwards
(`Untagged: toon-household:e0`, `Deleted: sha256:0891f0c9ef9e…`).

### 9.5 The subtree (P8)

`git log --format='%h %s' -3 -- repos/effect`:

```
60828f2e6 Merge commit 'e54b8022a8c86445ed2f8bfd4c87fe9da61c770a' as 'repos/effect'
```

(one commit touches the path: the subtree is one squash plus its merge). The squash commit `e54b8022a`:

```
Squashed 'repos/effect/' content from commit 7f524e25c

git-subtree-dir: repos/effect
git-subtree-split: 7f524e25cfb49a71ac39b0f44278d08d40dda5de
```

### 9.6 Boot and shutdown (P4, P5, P6)

A migrated temp DB (`bun run db:migrate`, exit 0), then `NODE_ENV=development … API_PORT=3901 bun
apps/api/src/index.ts` in the background, `curl -sf http://127.0.0.1:3901/api/health` until it answered, `kill -TERM`
on the server's pid, `wait`:

```
{"ok":true,"status":"ok","version":"0.1.0","time":"2026-10-16T09:18:05.384Z","database":"file","modules":["recipe","finance"],"features":{"verifiedEmailRequired":false,"ocrImport":false,"pdfImport":false}}
server_exit=0
--- boot.log
[api] toon-household API on http://localhost:3901 (db: file, origins: http://localhost:5173, mail: console, web: extern)
Started development server: http://localhost:3901
<-- GET /api/health
--> GET /api/health 200 2ms
[api] SIGTERM — stopping modules …
[api] runtime disposed
```

The body is served through `runtime.runPromise(healthResponse)` with the key order of before and an ISO `time`
from `DateTime.now`; the shutdown path ran the module hooks, disposed the runtime and exited 0. The temp
directory was removed.

### 9.7 Bundle baseline for E6

Gzipped total of `apps/web/dist/assets/*.js` (84 files; the loop of step 7): **399812 bytes**. E0 imports
`effect` nowhere in `apps/web`, so this is the pre-Effect baseline E6 compares with.

## 10. What changed vs plan

**Status: DONE (2026-10-16).** Every exit criterion of `docs/EFFECT.md` §4 E0 holds on the merged tree. No
deviation from SPEC D1-D15 or `docs/EFFECT.md` E1-E12. Differences between the plan text and what was measured:

1. **The thumbnail flake did not occur.** The full run passed (2463 pass, 0 fail, load average 11 to 15), so the
   P12 tolerance was not used; nothing was raised or edited in `apps/api/test/thumbnails.test.ts`.
2. **The count is higher than the plan's floor.** 2463 pass in 141 files against the floor of 2450 (baseline 2442
   in 139 files): E0 added 21 tests and 2 files, not the 8 or more the plan counted (T01 1, T05 4 plus 2 import-order entries, T06 at least 1).
3. **`git log -3 -- repos/effect` shows one commit,** the subtree merge `60828f2e6`, not three: the squash commit
   `e54b8022a` is its second parent and is recorded through its message (section 9.5).
4. **The probe's context size is 580.76kB** because the context is the repo minus `.dockerignore`; the plan fixed
   no number, only that it be recorded and that `repos` and `.git` be absent.
5. **No `.bun-version` change** and no bunfig workaround were needed: Bun 1.4.2 ignores `repos/**` exactly as 1.4.3
   does (section 9.3).
6. **The CLAUDE.md "Status"** paragraph now names 2463 pass in 141 files and that E0 is done; the other E0 edits of
   CLAUDE.md were E0-T07's.
7. **Process note.** The first launch of the full-suite script wrote its uptime line to an unset variable
   (`/uptime.txt: Permission denied`); the run itself was unaffected and the load figures above come from the two
   `uptime` calls in the log.
