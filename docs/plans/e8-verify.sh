#!/usr/bin/env bash
# The verification checks of milestone E8 (docs/plans/e8-harden.md). Run from anywhere:
#   bash docs/plans/e8-verify.sh <check> [args]
# Every check exits 0 when it holds and prints what failed otherwise. Base commit of the milestone: 4bc9512fc.
# The checks inspect the checkout the script lives in; inside a task worktree run it with E8_ROOT=<worktree root>
# (the script itself stays untracked until E8-T12 commits it with the plan).
set -u
ROOT="${E8_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT" || exit 2
BASE=4bc9512fc
FLOOR=15191
BRIDGE_NAMES='runMigrations|createSession|claimPlaceholderUser|checkRateLimit|trySendMail|createDraft|importFromText|fetchHtml|assertPublicUrl|assignParticipants|updateParticipantDisplayName|runFinanceBridge|runLegacyMigration|migrateUsers|migrateHouseholds|migrateRecipe|openLegacy|runLegacy|nowMs'

check="${1:-}"; shift || true
case "$check" in
  tests)
    # The whole suite: 0 fail and at least FLOOR passing tests (plan P8).
    log="$(mktemp /tmp/e8-tests.XXXXXX.log)"
    bun test > "$log" 2>&1; echo "exit=$?" >> "$log"
    pass="$(grep -oE '^ *[0-9]+ pass' "$log" | tail -1 | grep -oE '[0-9]+')"
    tail -6 "$log"
    grep -qE '^ *0 fail' "$log" || { echo "FAIL: failures, see $log"; grep -E '^\(fail\)' "$log" | head -40; exit 1; }
    [ -n "$pass" ] && [ "$pass" -ge "$FLOOR" ] || { echo "FAIL: $pass pass < floor $FLOOR ($log)"; exit 1; }
    echo "OK tests: $pass pass (floor $FLOOR), log $log" ;;
  i18n)
    # Parity OK and the 148 classified hits, no more, no fewer (plan P6(d)).
    log="$(mktemp /tmp/e8-i18n.XXXXXX.log)"
    bun run i18n:check > "$log" 2>&1
    grep -q '^\[i18n:check\] OK' "$log" || { echo "FAIL: parity, see $log"; exit 1; }
    grep -q 'FAILED — 148 possible German literal' "$log" || { grep 'possible German' "$log"; echo "FAIL: count changed, see $log"; exit 1; }
    echo "OK i18n: parity OK, 148 hits" ;;
  repos)
    [ -z "$(git status --porcelain repos/)" ] || { git status --porcelain repos/ | head; echo "FAIL: repos/ touched"; exit 1; }
    echo "OK repos clean" ;;
  imports)
    # No test file imports a door name from apps/api/src or apps/api/scripts (plan P1, E8-T04). The door files themselves
    # (apps/api/test/support/bridges/**) and the two door tests are skipped, and only a specifier that reaches into src/ or
    # scripts/ counts: `import type { ApiError as ApiErrorBody } from "@toon/shared"` (the wire type) is no door import.
    bun -e '
      const B = new RegExp("\\b(" + process.argv[1] + "|ApiError)\\b");
      const skip = /(bridges-(core|modules)\.test\.ts$)|(^apps\/api\/test\/support\/bridges\/)/;
      const bad = [];
      for await (const f of new Bun.Glob("apps/api/test/**/*.ts").scan(".")) {
        if (skip.test(f)) continue;
        const s = await Bun.file(f).text();
        for (const m of s.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
          const names = m[1].split(",").map((x) => x.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
          const hit = names.some((n) => { const r = n.match(B); return r !== null && r[0] === n; });
          if (hit && /(^|\/)(src|scripts)\//.test(m[2])) bad.push(f + ": " + m[2]);
        }
      }
      if (bad.length > 0) { console.log(bad.join("\n")); process.exit(1); }
    ' "$BRIDGE_NAMES" || { echo "FAIL: door names imported from src or scripts"; exit 1; }
    echo "OK imports: every door name comes from test/support/bridges/" ;;
  no-bridges)
    # Which side: core (T05), modules (T06) or all (T07, T12). "legacy bridge" is matched only with its colon, i.e. the
    # section headers (`/* legacy bridges: … */`, `/* legacy bridge: … */`) and fetch.ts's ` * legacy bridge: …` heading;
    # the true statements "has no legacy bridge" in services that never had one (auth/passwords.ts, …) are prose and stay.
    scope="${1:-all}"
    core='runMigrations|createSession|claimPlaceholderUser|checkRateLimit|trySendMail'
    mods='createDraft|importFromText|fetchHtml|assertPublicUrl|assignParticipants|updateParticipantDisplayName|runFinanceBridge|runLegacyMigration|migrateUsers|migrateHouseholds|migrateRecipe|openLegacy|runLegacy|nowMs'
    fail=0
    if [ "$scope" = core ] || [ "$scope" = all ]; then
      grep -rnE "^export (async )?function ($core)\b" apps/api/src && fail=1
      grep -rnE 'class ApiError\b' apps/api/src && fail=1
      grep -rnE 'legacy bridges?:' apps/api/src/lib apps/api/src/db apps/api/src/core && fail=1
      grep -q 'test seams' apps/api/src/core/services/auth/rateLimit.ts || { echo "rateLimit.ts: no 'test seams' header"; fail=1; }
      grep -q 'test seams' apps/api/src/core/services/mail/index.ts || { echo "mail/index.ts: no 'test seams' header"; fail=1; }
    fi
    if [ "$scope" = modules ] || [ "$scope" = all ]; then
      grep -rnE "^export (async )?function ($mods)\b" apps/api/src apps/api/scripts && fail=1
      [ -e apps/api/src/modules/finance/bridge.ts ] && { echo "apps/api/src/modules/finance/bridge.ts still exists"; fail=1; }
      grep -nF 'apps/api/src/modules/finance/bridge.ts' CLAUDE.md docs/modules/finance.md && { echo "a living doc still names the deleted bridge.ts"; fail=1; }
      grep -rnE 'legacy bridges?:' apps/api/src/modules apps/api/scripts && fail=1
      grep -q '"./src/modules/finance/http.ts"' apps/api/test/import-order-effect.test.ts || { echo "import-order-effect: http.ts entry missing"; fail=1; }
      grep -q 'finance/bridge.ts' apps/api/test/import-order-effect.test.ts && { echo "import-order-effect: bridge.ts entry left"; fail=1; }
    fi
    if [ "$scope" = all ]; then
      grep -rnE 'legacy bridges?:' apps/api/src apps/api/scripts && fail=1
      grep -rnE "from \"[^\"]*test/support/bridges" apps/api/src apps/api/scripts apps/web/src packages && fail=1
    fi
    [ "$fail" = 0 ] || { echo "FAIL: bridges left in src (scope $scope)"; exit 1; }
    echo "OK no-bridges ($scope)" ;;
  guards)
    # T02: no hand-written object guard, no wall clock on the recipe shopping route, no runSync in oauth.ts (plan P5).
    fail=0
    grep -rnE 'typeof [A-Za-z_.]+ === "object"' apps/api/src apps/api/scripts | grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*)' && fail=1
    grep -n 'Date\.now()' apps/api/src/modules/recipe/routes/shopping.ts | grep -vE '^[0-9]+:[[:space:]]*(\*|//|/\*)' && fail=1
    grep -n 'Effect\.runSync' apps/api/src/lib/oauth.ts | grep -vE '^[0-9]+:[[:space:]]*(\*|//|/\*)' && fail=1
    [ "$fail" = 0 ] || { echo "FAIL: guards"; exit 1; }
    echo "OK guards" ;;
  hono)
    # P6(c): every comment that names Hono (or the pre-E7 c.req / c.json) says pre-E7. Default scope: all of src and scripts.
    if [ "$#" -gt 0 ]; then files=("$@"); else files=(apps/api/src apps/api/scripts); fi
    hits="$(grep -rnIE '\b[Hh]ono\b|\bc\.(req|json)\b' "${files[@]}" | grep -v 'pre-E7')"
    [ -z "$hits" ] || { echo "$hits"; echo "FAIL: Hono named without pre-E7"; exit 1; }
    stale="$(grep -rnIE 'until E7-T12|until E7 replaces|requireFinanceParticipantContext|requireUser\(c\)|requireMembership\(c\)|E8 decides|E8 removes' "${files[@]}")"
    [ -z "$stale" ] || { echo "$stale"; echo "FAIL: stale references"; exit 1; }
    echo "OK hono/stale comments" ;;
  comments-only)
    # The given files differ from the base in comment or blank lines only (E8-T03).
    [ "$#" -gt 0 ] || { echo "usage: comments-only <files>"; exit 2; }
    code="$(git diff -U0 "$BASE" -- "$@" | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -vE '^[+-][[:space:]]*(\*|//|/\*|$)')"
    [ -z "$code" ] || { echo "$code" | head -40; echo "FAIL: a code line changed"; exit 1; }
    echo "OK comments only" ;;
  import-shape)
    # E8-T04: since the given ref (default: the base), every changed line under apps/api/test (the door files and the two door
    # tests excluded: E8-T01 wrote them) is an import line, a member line of a multi-line import, or the M14 comment.
    ref="${1:-$BASE}"
    bad="$(git diff -U0 "$ref" -- apps/api/test ':(exclude)apps/api/test/support/bridges' \
      ':(exclude)apps/api/test/bridges-core.test.ts' ':(exclude)apps/api/test/bridges-modules.test.ts' \
      | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
      | grep -vE '^[+-](import |\} from "|[[:space:]]+(type )?[A-Za-z_][A-Za-z0-9_]*,$|[[:space:]]*// The Promise (bridge|door) )')"
    [ -z "$bad" ] || { echo "$bad" | head -40; echo "FAIL: a non-import line changed under apps/api/test"; exit 1; }
    echo "OK import-shape: only import lines changed under apps/api/test" ;;
  paths)
    # Every inline-code span in the given docs that starts with a repo prefix names something that exists (a quick
    # pre-check of what E8-T11's extended apps/api/test/docs-paths.test.ts asserts; brace groups, globs, placeholders and
    # spans a line break split are left to that test). Vendored paths are written repos/effect/packages/..., never bare.
    [ "$#" -gt 0 ] || { echo "usage: paths <docs>"; exit 2; }
    miss="$(for f in "$@"; do
      grep -noE '`[^`[:space:]]+`' "$f" | while IFS= read -r hit; do
        line="${hit%%:*}"; span="${hit#*:}"; span="${span//\`/}"
        case "$span" in apps/*|packages/*|scripts/*|docs/*|docker/*|agent-patterns/*|repos/effect/*) ;; *) continue ;; esac
        case "$span" in *'{'*|*'*'*|*'<'*|*'…'*|*'$'*) continue ;; esac
        case "$span" in apps/api/tests/|apps/web/src/features/|apps/web/dist|apps/web/dist/*) continue ;; esac  # docs-paths ALLOW_MISSING
        p="${span%%#*}"; p="$(printf '%s' "$p" | sed -E 's/:[0-9]+(-[0-9]+)?$//')"
        [ -e "$p" ] || echo "$f:$line: $span"
      done
    done)"
    [ -z "$miss" ] || { echo "$miss"; echo "FAIL: missing paths"; exit 1; }
    echo "OK paths" ;;
  patterns)
    # Each pattern file: a "## 7. In this repo" section with a fenced block and a repo path; no stale E8 promises (P9).
    [ "$#" -gt 0 ] || { echo "usage: patterns <agent-patterns/effect-x.md ...>"; exit 2; }
    fail=0
    for f in "$@"; do
      sec="$(awk '/^## 7\. /{p=1} p' "$f")"
      [ -n "$sec" ] || { echo "$f: no '## 7. ' section"; fail=1; continue; }
      echo "$sec" | grep -q '^```' || { echo "$f: section 7 has no fenced example"; fail=1; }
      echo "$sec" | grep -qE '(apps|packages)/[A-Za-z0-9_./-]+\.tsx?' || { echo "$f: section 7 names no repo source file"; fail=1; }
      grep -nE 'until E8|E8 removes|E8 decides|requireFinanceParticipantContext|requireUser\(c\)' "$f" && fail=1
    done
    [ "$fail" = 0 ] || { echo "FAIL: pattern files"; exit 1; }
    echo "OK patterns" ;;
  api-rows)
    # docs/API.md: no table row changed since the base (E8: notes only, never a row).
    rows="$(git diff "$BASE" -- docs/API.md | grep -E '^[+-]\|')"
    [ -z "$rows" ] || { echo "$rows" | head; echo "FAIL: a docs/API.md row changed"; exit 1; }
    echo "OK docs/API.md rows unchanged" ;;
  frozen)
    # What E8 never touches: the web, the deployment files, the migrations, every catalog.
    out="$(git diff --stat "$BASE" -- apps/web Dockerfile docker-compose.yml docker .dockerignore apps/api/drizzle packages/shared/src/core/i18n/catalogs apps/web/src/lib/i18n)"
    [ -z "$out" ] || { echo "$out"; echo "FAIL: a frozen path changed"; exit 1; }
    echo "OK frozen paths unchanged" ;;
  *)
    echo "usage: bash docs/plans/e8-verify.sh tests|i18n|repos|imports|import-shape [ref]|no-bridges [core|modules|all]|guards|hono [files]|comments-only <files>|paths <docs>|patterns <files>|api-rows|frozen"
    exit 2 ;;
esac
