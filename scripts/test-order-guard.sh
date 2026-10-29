#!/usr/bin/env bash
# Task 1590 — the unit suite must not depend on test-file order.
#
# bun runs test files in directory order, which differs per filesystem, and
# bun's mock.module() is process-global. At bbaba4b the suite was 835/0 on the
# Mac and in CI but 722 pass / 24 fail / 18 errors on a Linux box whose
# directory order put a partial src/lib/api mock before its victims. This guard
# makes that class of bug go red on every machine:
#
#   1. static   — no test file calls mock.module() directly; every module mock
#                 goes through test/helpers/scoped-module-mock.ts (complete +
#                 restored after the file).
#   2. reversed — every test file, in reverse lexical order, one process.
#   3. shuffled — `bun test --randomize` (files AND tests shuffled) with a
#                 seed; TEST_ORDER_SEED=<n> replays a red run exactly.
#   4. isolated — every test file alone, one process each.
#
# Each run must PROVE it ran: the file count bun reports must equal the file
# list, pass must equal the test total, fail 0, no errors, and the isolated
# runs must add up to the same total. A green with no count is a red.
#
# Usage: scripts/test-order-guard.sh            (bun run test:order)
#        TEST_ORDER_SEED=1590 scripts/test-order-guard.sh
#        TEST_ORDER_SKIP_ISOLATED=1 ...          (skip step 4, e.g. locally)
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

TIMEOUT="${TEST_ORDER_TIMEOUT:-120000}"
SEED="${TEST_ORDER_SEED:-$(( (RANDOM << 15) | RANDOM ))}"
LOGDIR="$(mktemp -d "${TMPDIR:-/tmp}/test-order-guard.XXXXXX")" || exit 1
RED=0

red() { echo "RED  $*"; RED=1; }
ok() { echo "ok   $*"; }

# ── 1. static ────────────────────────────────────────────────────────────────
# Code lines only (a comment may name mock.module). Matches any `<x>.module(`
# so an aliased import (`import { mock as m }`) cannot slip past.
offenders="$(command grep -rnE '\.module\(' test \
  --include='*.ts' --include='*.tsx' \
  | command grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*|//|/\*)' \
  | command grep -v '^test/helpers/scoped-module-mock\.ts:' || true)"
if [ -n "$offenders" ]; then
  red "static: direct mock.module() outside test/helpers/scoped-module-mock.ts — use mockModuleScoped():"
  echo "$offenders" | sed 's/^/       /'
else
  ok "static: every mock.module() goes through mockModuleScoped()"
fi

# ── file list ────────────────────────────────────────────────────────────────
FILES=()
while IFS= read -r f; do FILES+=("./$f"); done < <(
  find test -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) | LC_ALL=C sort -r
)
NFILES=${#FILES[@]}
if [ "$NFILES" -eq 0 ]; then
  red "no test files found under test/"
  exit 1
fi

# Parse one bun summary. Echo "<ran> <files> <pass> <fail> <errors>".
summary() {
  local log="$1" ran files pass fail errs
  ran="$(command grep -aoE '^Ran [0-9]+ tests? across [0-9]+ files?' "$log" | tail -1)"
  files="$(echo "$ran" | command grep -oE '[0-9]+ files?' | command grep -oE '[0-9]+')"
  ran="$(echo "$ran" | command grep -oE 'Ran [0-9]+' | command grep -oE '[0-9]+')"
  pass="$(command grep -aoE '^ *[0-9]+ pass$' "$log" | tail -1 | command grep -oE '[0-9]+')"
  fail="$(command grep -aoE '^ *[0-9]+ fail$' "$log" | tail -1 | command grep -oE '[0-9]+')"
  errs="$(command grep -aoE '^ *[0-9]+ errors?$' "$log" | tail -1 | command grep -oE '[0-9]+')"
  echo "${ran:-x} ${files:-x} ${pass:-x} ${fail:-x} ${errs:-0}"
}

# check <label> <log> <expected files> [expected total]; sets TOTAL + LAST_OK.
check_run() {
  local label="$1" log="$2" want_files="$3" want_total="${4:-}"
  local ran files pass fail errs
  read -r ran files pass fail errs < <(summary "$log")
  LAST_OK=0
  if [ "$ran" = x ] || [ "$pass" = x ] || [ "$fail" = x ]; then
    red "$label: no bun summary in $log (the run did not complete)"; return
  fi
  if [ "$files" != "$want_files" ] || [ "$pass" != "$ran" ] || [ "$fail" != 0 ] || [ "$errs" != 0 ] \
     || { [ -n "$want_total" ] && [ "$ran" != "$want_total" ]; }; then
    red "$label: $pass pass / $fail fail / $errs errors, $ran tests across $files files (want ${want_total:-all} pass across $want_files files) — log $log"
    command grep -aE '^\(fail\)|^error:|Export named|not found in' "$log" | head -15 | sed 's/^/       /'
  else
    ok "$label: $pass pass / 0 fail across $files files"
    LAST_OK=1
  fi
  TOTAL="$ran"
}

# ── 2. reversed ──────────────────────────────────────────────────────────────
TOTAL=""
bun test --timeout "$TIMEOUT" "${FILES[@]}" > "$LOGDIR/reversed.log" 2>&1
check_run "reversed" "$LOGDIR/reversed.log" "$NFILES"
# Only a green run defines the expected total; after a red one the later runs
# are still checked for 0 fail / 0 errors, just not against a count.
EXPECTED=""
[ "$LAST_OK" = 1 ] && EXPECTED="$TOTAL"

# ── 3. shuffled ──────────────────────────────────────────────────────────────
bun test --timeout "$TIMEOUT" --randomize --seed="$SEED" > "$LOGDIR/shuffled.log" 2>&1
check_run "shuffled (seed $SEED; replay: TEST_ORDER_SEED=$SEED)" "$LOGDIR/shuffled.log" "$NFILES" "$EXPECTED"

# ── 4. isolated ──────────────────────────────────────────────────────────────
if [ "${TEST_ORDER_SKIP_ISOLATED:-0}" = 1 ]; then
  echo "skip isolated (TEST_ORDER_SKIP_ISOLATED=1)"
else
  sum=0; bad=0; n=0
  for f in "${FILES[@]}"; do
    n=$((n + 1))
    log="$LOGDIR/isolated-$n.log"
    bun test --timeout "$TIMEOUT" "$f" > "$log" 2>&1
    read -r ran files pass fail errs < <(summary "$log")
    if [ "$ran" = x ] || [ "$pass" != "$ran" ] || [ "$fail" != 0 ] || [ "$errs" != 0 ] || [ "$files" != 1 ]; then
      red "isolated: $f — $pass pass / $fail fail / $errs errors — log $log"
      command grep -aE '^\(fail\)|^error:|SyntaxError|Export named|not found in' "$log" | head -5 | sed 's/^/       /'
      bad=$((bad + 1))
    else
      sum=$((sum + ran))
    fi
  done
  if [ "$bad" = 0 ]; then
    if [ -n "$EXPECTED" ] && [ "$sum" != "$EXPECTED" ]; then
      red "isolated: $n files alone add up to $sum tests, the one-process run had $EXPECTED"
    else
      ok "isolated: $n files alone, $sum pass / 0 fail in total"
    fi
  fi
fi

if [ "$RED" != 0 ]; then
  echo "test-order-guard: RED (logs in $LOGDIR)"
  exit 1
fi
echo "test-order-guard: green — $EXPECTED tests, $NFILES files, seed $SEED"
rm -rf "$LOGDIR"
