#!/usr/bin/env bash
# The verification snippets of plan docs/plans/e4-finance-services.md (P14). Run from anywhere:
#   bash docs/plans/e4-verify.sh <suite|pinned|greps|repos|nothrow|types|idioms|order|all>
# Each subcommand exits 0 on success and non-zero with the evidence printed on failure.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

BASE=47907f200   # E4 base commit (plan section 1.1)
FLOOR=14686      # pass count of the base (plan section 1.2)

suite() {
  local log
  log="$(mktemp)"
  bun test >"$log" 2>&1
  local status=$?
  tail -6 "$log"
  if [ "$status" -ne 0 ]; then
    grep -nE '^\(fail\)|Unhandled error' "$log" | head -40
    echo "[e4-verify] bun test exited $status (log: $log)"
    return 1
  fi
  local pass
  pass="$(grep -oE '^ *[0-9]+ pass' "$log" | awk '{print $1}' | tail -1)"
  if [ -z "$pass" ] || [ "$pass" -lt "$FLOOR" ]; then
    echo "[e4-verify] pass count ${pass:-?} is below the floor $FLOOR"
    return 1
  fi
  echo "[e4-verify] suite OK: $pass pass (floor $FLOOR)"
}

pinned() {
  git diff --quiet "$BASE" -- \
    apps/api/test/finance-plan.test.ts \
    apps/api/test/finance-settlements.test.ts \
    apps/api/test/finance-participants.test.ts \
    apps/api/test/finance-cross-household.test.ts \
    apps/api/test/finance-balance.test.ts \
    apps/api/test/finance-transactions.test.ts \
    apps/api/test/finance-categories.test.ts \
    apps/api/test/finance-tags.test.ts \
    apps/api/test/finance-module.test.ts \
    apps/api/test/finance-security.test.ts \
    apps/api/test/finance-import-xlsx.test.ts \
    apps/api/test/legacy-finance.test.ts \
    apps/api/test/legacy-cli.test.ts \
    apps/api/test/legacy-placeholders.test.ts \
    apps/api/test/api-doc.test.ts \
    apps/api/test/middleware.test.ts \
    apps/api/test/import-order.test.ts \
    apps/api/test/db-pragmas.test.ts \
    apps/api/test/placeholders.test.ts \
    apps/api/test/security.test.ts \
    docs/API.md apps/api/drizzle apps/api/scripts apps/api/src/modules/recipe packages/shared apps/web \
    && echo "[e4-verify] pinned files unchanged since $BASE" \
    || { echo "[e4-verify] a pinned file changed:"; git diff --stat "$BASE" -- apps/api/test docs/API.md apps/api/drizzle apps/api/scripts apps/api/src/modules/recipe packages/shared apps/web | tail -20; return 1; }
}

greps() {
  local failed=0
  # LINKS_FIN: no unprefixed (toon-finance) link target in the module
  if grep -rnE "(\bto[=:] ?|\bgo\(|\bgoTo\()[\"'\`]/(transactions|new|plan|categories|household)\b|\bto[=:] ?[\"']/[\"']" apps/web/src/modules/finance; then
    echo "[e4-verify] LINKS_FIN hit"; failed=1
  fi
  # NOROUTER: typed router hooks do not survive in screens
  if grep -rnE "\b(Link|useNavigate|useParams|useBlocker)\b[^;]*from \"@tanstack/react-router\"" apps/web/src/modules/finance/features apps/web/src/modules/finance/components; then
    echo "[e4-verify] NOROUTER hit"; failed=1
  fi
  # NOCORE: no unprefixed catalog keys
  if grep -rnE "[\"'\`](common|nav|transactions|categories|plan|balance|settings)\.[a-zA-Z]" apps/web/src/modules/finance --include='*.ts' --include='*.tsx' --exclude-dir=catalogs; then
    echo "[e4-verify] NOCORE hit"; failed=1
  fi
  # NOSHADOW: no bare tag or pagination names from @toon/shared
  local d
  d=$(command ls -d apps/web/src/modules/finance apps/api/src/modules/finance apps/api/scripts 2>/dev/null; true)
  # shellcheck disable=SC2086
  if grep -rnP '^\s*(type )?(TagListResponse|TagResponse|UpdateTagRequest|PaginationQuery)(Schema)?,?\s*$|^import (type )?\{[^}]*(?<!as )(?<![A-Za-z])(TagListResponse|TagResponse|UpdateTagRequest|PaginationQuery)(Schema)?(?![A-Za-z])[^}]*\} from "@toon/shared"' $d; then
    echo "[e4-verify] NOSHADOW hit"; failed=1
  fi
  [ "$failed" -eq 0 ] && echo "[e4-verify] finance greps clean (LINKS_FIN, NOROUTER, NOCORE, NOSHADOW)"
  return "$failed"
}

repos() {
  local dirty
  dirty="$(git status --porcelain repos/ | wc -l)"
  [ "$dirty" -eq 0 ] && echo "[e4-verify] repos/ clean" || { git status --porcelain repos/ | head; return 1; }
}

# Non-comment lines under the finance module that still name ApiError, nowMs( (outside lib/clock.ts) or withTransaction(
# (outside services/support.ts, the Promise helper the xlsx script keeps until E5). Used by E4-T09 and E4-T10 only.
nothrow() {
  local hits
  hits="$(grep -rnE '\bApiError\b|\bnowMs\s*\(|\bwithTransaction\s*\(' apps/api/src/modules/finance \
    | grep -vE '^[^:]+:[0-9]+:\s*(\*|//|/\*)' \
    | grep -vE '^apps/api/src/modules/finance/lib/clock\.ts:' \
    | grep -vE '^apps/api/src/modules/finance/services/support\.ts:' || true)"
  if [ -n "$hits" ]; then echo "$hits"; echo "[e4-verify] ApiError / nowMs( / withTransaction( left in finance code"; return 1; fi
  echo "[e4-verify] no ApiError, nowMs( or withTransaction( in finance code (comments, lib/clock.ts and services/support.ts aside)"
}

types() { bun run typecheck; }
idioms() { bun test apps/api/test/effect-idioms.test.ts; }
order() { bun test apps/api/test/import-order.test.ts apps/api/test/import-order-effect.test.ts apps/api/test/legacy-cli.test.ts; }

case "${1:-}" in
  suite) suite ;;
  pinned) pinned ;;
  greps) greps ;;
  repos) repos ;;
  nothrow) nothrow ;;
  types) types ;;
  idioms) idioms ;;
  order) order ;;
  all) types && idioms && order && pinned && repos && greps && suite ;;
  *) echo "usage: bash docs/plans/e4-verify.sh <suite|pinned|greps|repos|nothrow|types|idioms|order|all>"; exit 2 ;;
esac
