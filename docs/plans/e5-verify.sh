#!/usr/bin/env bash
# The verification snippets of plan docs/plans/e5-scripts.md (P17). Run from anywhere:
#   bash docs/plans/e5-verify.sh <suite|pinned|repos|types|idioms|order|legacy|fixture|fixture-record|xlsx-dry|statics|all>
# Each subcommand exits 0 on success and non-zero with the evidence printed on failure.
# ROOT is the checkout (or worktree) that holds this copy of the script; E5_FIXDIR overrides where the fixture baseline lives
# (E5-T06a keeps a scratch baseline under the ignored migration-out/ before T01's is merged).
set -u
ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || exit 2
cd "$ROOT" || exit 2

BASE=9a1272a8e   # E5 base commit (plan section 1.1)
FLOOR=14725      # pass count of the base (plan section 1.2)
FIXDIR="${E5_FIXDIR:-docs/plans/e5-fixture}"

suite() {
  local log status pass
  log="$(mktemp)"
  bun test >"$log" 2>&1
  status=$?
  tail -6 "$log"
  if [ "$status" -ne 0 ]; then
    grep -nE '^\(fail\)|Unhandled error' "$log" | head -40
    echo "[e5-verify] bun test exited $status (log: $log)"
    return 1
  fi
  pass="$(grep -oE '^ *[0-9]+ pass' "$log" | awk '{print $1}' | tail -1)"
  if [ -z "$pass" ] || [ "$pass" -lt "$FLOOR" ]; then
    echo "[e5-verify] pass count ${pass:-?} is below the floor $FLOOR"
    return 1
  fi
  echo "[e5-verify] suite OK: $pass pass (floor $FLOOR)"
}

PINNED=(
  apps/api/test/legacy-cli.test.ts apps/api/test/legacy-placeholders.test.ts apps/api/test/legacy-fixtures.test.ts
  apps/api/test/legacy-migration-doc.test.ts apps/api/test/import-order.test.ts apps/api/test/db-pragmas.test.ts
  apps/api/test/middleware.test.ts apps/api/test/api-doc.test.ts apps/api/test/placeholders.test.ts apps/api/test/security.test.ts
  apps/api/test/finance-plan.test.ts apps/api/test/finance-settlements.test.ts apps/api/test/finance-participants.test.ts
  apps/api/test/finance-cross-household.test.ts apps/api/test/finance-module.test.ts apps/api/test/recipe-cross-household.test.ts
  apps/api/test/deploy-caddyfile.test.ts apps/api/test/deploy-compose.test.ts apps/api/test/deploy-dockerfile.test.ts
  apps/api/test/deploy-script.test.ts apps/api/test/deploy-workflows.test.ts apps/api/test/deployment-doc.test.ts
  apps/api/test/support/legacy-harness.ts apps/api/test/fixtures
  docs/API.md docs/migration.md docs/deployment.md apps/api/drizzle packages/shared apps/web
  docker Dockerfile docker-compose.yml .github scripts package.json apps/api/package.json bun.lock
)

pinned() {
  if git diff --quiet "$BASE" -- "${PINNED[@]}"; then
    echo "[e5-verify] pinned files unchanged since $BASE"
  else
    echo "[e5-verify] a pinned file changed:"
    git diff --stat "$BASE" -- "${PINNED[@]}" | tail -20
    return 1
  fi
}

repos() {
  local dirty
  dirty="$(git status --porcelain repos/ | wc -l)"
  if [ "$dirty" -eq 0 ]; then echo "[e5-verify] repos/ clean"; else git status --porcelain repos/ | head; return 1; fi
}

types() { bun run typecheck; }
idioms() { bun test apps/api/test/effect-idioms.test.ts; }
order() { bun test apps/api/test/import-order.test.ts apps/api/test/import-order-effect.test.ts; }
legacy() { bun test apps/api/test/legacy-cli.test.ts apps/api/test/legacy-placeholders.test.ts apps/api/test/legacy-fixtures.test.ts; }

# The fixture run of CLAUDE.md "Commands" (dry run, --apply, --apply again), straight through bun (no `bun run` prefix).
FIX_ARGS=(--recipe-db apps/api/test/fixtures/legacy/recipe.db --recipe-uploads apps/api/test/fixtures/legacy/uploads
  --finance-db apps/api/test/fixtures/legacy/finance.db)
fixture_run() {
  local d="$1"; shift
  NODE_ENV=development DATABASE_URL="file:$d/target.db" UPLOAD_DIR="$d/uploads" \
    bun apps/api/scripts/migrate-legacy.ts "${FIX_ARGS[@]}" "$@"
}
# The baseline must not depend on the checkout path: the report names the fixture inputs by absolute path
# (`recipe: <ROOT>/apps/api/test/fixtures/legacy/recipe.db (schema …)`, the missing-upload warning), and a task in a
# parallel worktree runs under <repo>/.worktrees/<slug>. So the checkout root is replaced FIRST, then the temp dir.
normalize() {
  sed -e "s#$ROOT#<ROOT>#g" -e "s#$1#<D>#g" \
    -E -e 's#[^ ]*toon-migrate-legacy-[A-Za-z0-9]+#<scratch>#g' \
    -e 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<uuid>/g' \
    -e 's#/invite/[A-Za-z0-9_-]+#/invite/<token>#g'
}
fixture() {
  local mode="${1:-check}" d failed=0 c1 c2 c3 name
  d="$(mktemp -d)"
  fixture_run "$d" >"$d/dry.out" 2>"$d/dry.err"; c1=$?
  if [ -e "$d/target.db" ] || [ -e "$d/target.db-wal" ]; then echo "[e5-verify] the dry run left a target file"; failed=1; fi
  fixture_run "$d" --apply >"$d/apply.out" 2>"$d/apply.err"; c2=$?
  fixture_run "$d" --apply >"$d/again.out" 2>"$d/again.err"; c3=$?
  echo "[e5-verify] fixture exit codes: dry=$c1 apply=$c2 again=$c3 (want 0 0 0)"
  [ "$c1$c2$c3" = "000" ] || failed=1
  for name in dry apply again; do
    if [ -s "$d/$name.err" ]; then echo "[e5-verify] stderr of $name:"; head -20 "$d/$name.err"; failed=1; fi
  done
  tail -n1 "$d/dry.out" | grep -qE '^\[migrate:legacy\] dry run complete: [0-9]+ rows would be written, [0-9]+ files would be copied\. Nothing was written\.$' \
    || { echo "[e5-verify] dry run: wrong last line"; failed=1; }
  tail -n1 "$d/apply.out" | grep -qE '^\[migrate:legacy\] applied: [0-9]+ rows written, 7 files copied\.$' \
    || { echo "[e5-verify] apply: wrong last line"; failed=1; }
  tail -n1 "$d/again.out" | grep -qxF '[migrate:legacy] already migrated: nothing written.' \
    || { echo "[e5-verify] second apply: wrong last line"; failed=1; }
  for name in dry apply again; do normalize "$d" <"$d/$name.out" >"$d/$name.norm"; done
  if grep -qF "$ROOT" "$d/dry.norm" "$d/apply.norm" "$d/again.norm"; then
    echo "[e5-verify] the normalised output still contains the checkout path $ROOT"; failed=1
  fi
  if [ "$mode" = "record" ]; then
    mkdir -p "$FIXDIR"
    for name in dry apply again; do cp "$d/$name.norm" "$FIXDIR/$name.norm"; done
    echo "[e5-verify] fixture outputs recorded in $FIXDIR"
  else
    for name in dry apply again; do diff -u "$FIXDIR/$name.norm" "$d/$name.norm" || failed=1; done
    [ "$failed" -eq 0 ] && echo "[e5-verify] fixture run identical to the recorded base output"
  fi
  rm -rf "$d"
  return "$failed"
}

# finance:import-xlsx --dry-run must never load src/db/client.ts (plan P2, E5-T05): spawned with NODE_ENV=development
# (never the inherited test), an explicit DATABASE_URL in a temp dir and NO SESSION_SECRET; exit 0, the dry-run lines, no file.
xlsx_dry() {
  local d failed=0 c1 c2
  d="$(mktemp -d)"
  bun -e "import { writeSyntheticWorkbook } from '$ROOT/apps/api/test/support/finance-synthetic-workbook.ts'; writeSyntheticWorkbook('$d/w.xlsx')" \
    || { echo "[e5-verify] could not write the synthetic workbook"; rm -rf "$d"; return 1; }
  env -u SESSION_SECRET -u TEST_DATABASE_URL NODE_ENV=development DATABASE_URL="file:$d/x.db" \
    bun apps/api/scripts/finance-import-xlsx.ts "$d/w.xlsx" --dry-run >"$d/a.out" 2>"$d/a.err"; c1=$?
  env -u SESSION_SECRET -u TEST_DATABASE_URL NODE_ENV=development DATABASE_URL="file:$d/x.db" \
    bun apps/api/scripts/finance-import-xlsx.ts "$d/w.xlsx" --household nope --dry-run >"$d/b.out" 2>"$d/b.err"; c2=$?
  echo "[e5-verify] xlsx dry-run exit codes: $c1 $c2 (want 0 0)"
  [ "$c1$c2" = "00" ] || { head -20 "$d/a.err" "$d/b.err"; failed=1; }
  grep -qxF '[import-xlsx] no --household given: no database write performed.' "$d/a.out" || { echo "[e5-verify] dry run: line missing"; failed=1; }
  grep -qxF '[import-xlsx] --dry-run: no database write performed.' "$d/b.out" || { echo "[e5-verify] --household --dry-run: line missing"; failed=1; }
  if [ -e "$d/x.db" ] || [ -e "$d/x.db-wal" ]; then echo "[e5-verify] the dry run opened the database (x.db exists)"; failed=1; fi
  [ "$failed" -eq 0 ] && echo "[e5-verify] xlsx dry run never touched the database"
  rm -rf "$d"
  return "$failed"
}

# No hand-written static accessors on a service class (plan P18): an added `static` member is a `layer…` or nothing.
statics() {
  local hits
  hits="$(git diff "$BASE" -- apps/api/src apps/api/scripts | grep -E '^\+[[:space:]]+static ' | grep -vE '^\+[[:space:]]+static readonly layer[A-Za-z]*[[:space:]]*[=:]')"
  if [ -n "$hits" ]; then echo "[e5-verify] added static members other than a layer:"; echo "$hits"; return 1; fi
  echo "[e5-verify] no static accessors added since $BASE"
}

case "${1:-}" in
  suite) suite ;;
  pinned) pinned ;;
  repos) repos ;;
  types) types ;;
  idioms) idioms ;;
  order) order ;;
  legacy) legacy ;;
  fixture) fixture check ;;
  fixture-record) fixture record ;;
  xlsx-dry) xlsx_dry ;;
  statics) statics ;;
  all) types && idioms && order && legacy && pinned && repos && statics && xlsx_dry && fixture check && suite ;;
  *) echo "usage: bash docs/plans/e5-verify.sh <suite|pinned|repos|types|idioms|order|legacy|fixture|fixture-record|xlsx-dry|statics|all>"; exit 2 ;;
esac
