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
# list, pass + skip must equal the test total, fail 0, no errors, and the
# isolated runs must add up to the same total. A green with no count is a red.
#
# A skip counts as "did not run", so it may not be free: every skipped test is
# named from a junit report and matched against ALLOWED_SKIPS (file + test
# name). Only a declared, legitimate skip passes; any other skip is RED even
# though it does not fail the run — a security test that starts skipping (e.g.
# 1690's no-keyless-clipboard checks when the helper is missing) must not keep
# the guard green.
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

# The ONLY test allowed to skip: 1581's full-precompress determinism case needs
# `brotli`, which a minimal bun image may not ship. Declared by file + exact
# test name, with the reason. Anything else that skips is RED.
ALLOWED_SKIPS=(
  "test/1581-office-bundle-version.test.ts|two full precompress runs write the same manifest.json version|needs the optional brotli CLI"
)

# Print every skipped test in a junit report as "<file><TAB><name>". The file
# is normalised to repo-relative ("test/x.test.ts") so the allow-list matches
# on every machine.
skipped_tests() {
  local xml="$1"
  [ -f "$xml" ] || return 0
  awk '
    /<testcase / {
      name = ""; file = ""
      if (match($0, /name="[^"]*"/)) name = substr($0, RSTART + 6, RLENGTH - 7)
      if (match($0, /file="[^"]*"/)) file = substr($0, RSTART + 6, RLENGTH - 7)
      sub(/^.*\/test\//, "test/", file)
      sub(/^\.\//, "", file)
      pending = 1
    }
    /<skipped/ && pending { print file "\t" name }
    /<\/testcase>/ { pending = 0 }
  ' "$xml"
}

# check_skips <label> <junit xml> <skip count from the summary>
# Every skipped test must be declared in ALLOWED_SKIPS, and every skip counted
# by bun must be named in the report, or it is RED.
check_skips() {
  local label="$1" xml="$2" want="$3" file name entry allowed seen=0
  if [ "$want" = 0 ]; then return 0; fi
  if [ ! -f "$xml" ]; then
    red "$label: $want skipped but no junit report to name them ($xml)"
    return 0
  fi
  while IFS=$'\t' read -r file name; do
    [ -n "${file:-}" ] || continue
    seen=$((seen + 1))
    allowed=0
    for entry in "${ALLOWED_SKIPS[@]}"; do
      # entry is "file|test name|reason": compare the declared file + name.
      if [ "$file|$name" = "${entry%|*}" ]; then allowed=1; fi
    done
    if [ "$allowed" = 0 ]; then
      red "$label: undeclared skip — $file: \"$name\" (only a declared skip may be skipped; make it run or declare it in ALLOWED_SKIPS with a reason)"
    fi
  done < <(skipped_tests "$xml")
  if [ "$seen" != "$want" ]; then
    red "$label: bun counted $want skip(s) but the junit report names $seen"
  fi
}

# ── 1. static ────────────────────────────────────────────────────────────────
# Code lines only (a comment may name mock.module). Matches any `<x>.module(`
# so an aliased import (`import { mock as m }`) cannot slip past.
offenders="$(command grep -rnE '\.module\(' test \
  --include='*.ts' --include='*.tsx' \
  | command grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*|//|/\*)' \
  | command grep -v -e '^test/helpers/scoped-module-mock\.ts:' -e '^test/helpers/module-slots\.ts:' || true)"
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

# Parse one bun summary. Echo "<ran> <files> <pass> <fail> <errors> <skip>".
# A skip is counted, not ignored: bun reports it separately from pass and fail.
# It must still add up (pass + skip == ran) so a skip can never hide a test
# that did not run — and check_skips() then names it and requires it to be
# declared, so a test that starts skipping cannot slip through the total.
summary() {
  local log="$1" ran files pass fail errs skip
  ran="$(command grep -aoE '^Ran [0-9]+ tests? across [0-9]+ files?' "$log" | tail -1)"
  files="$(echo "$ran" | command grep -oE '[0-9]+ files?' | command grep -oE '[0-9]+')"
  ran="$(echo "$ran" | command grep -oE 'Ran [0-9]+' | command grep -oE '[0-9]+')"
  pass="$(command grep -aoE '^ *[0-9]+ pass$' "$log" | tail -1 | command grep -oE '[0-9]+')"
  fail="$(command grep -aoE '^ *[0-9]+ fail$' "$log" | tail -1 | command grep -oE '[0-9]+')"
  errs="$(command grep -aoE '^ *[0-9]+ errors?$' "$log" | tail -1 | command grep -oE '[0-9]+')"
  skip="$(command grep -aoE '^ *[0-9]+ skip$' "$log" | tail -1 | command grep -oE '[0-9]+')"
  echo "${ran:-x} ${files:-x} ${pass:-x} ${fail:-x} ${errs:-0} ${skip:-0}"
}

# check <label> <log> <expected files> [expected total] [junit xml]; sets
# TOTAL + LAST_OK. Every skip must be declared (check_skips).
check_run() {
  local label="$1" log="$2" want_files="$3" want_total="${4:-}" xml="${5:-}"
  local ran files pass fail errs skip ran_ok skip_note
  read -r ran files pass fail errs skip < <(summary "$log")
  LAST_OK=0
  check_skips "$label" "$xml" "$skip"
  if [ "$ran" = x ] || [ "$pass" = x ] || [ "$fail" = x ]; then
    red "$label: no bun summary in $log (the run did not complete)"; return
  fi
  ran_ok=$((pass + skip))
  skip_note=""
  [ "$skip" = 0 ] || skip_note=" ($skip skipped)"
  if [ "$files" != "$want_files" ] || [ "$ran_ok" != "$ran" ] || [ "$fail" != 0 ] || [ "$errs" != 0 ] \
     || { [ -n "$want_total" ] && [ "$ran" != "$want_total" ]; }; then
    red "$label: $pass pass / $fail fail / $errs errors / $skip skip, $ran tests across $files files (want ${want_total:-all} pass across $want_files files) — log $log"
    command grep -aE '^\(fail\)|^error:|Export named|not found in' "$log" | head -15 | sed 's/^/       /'
  else
    ok "$label: $pass pass / 0 fail across $files files$skip_note"
    LAST_OK=1
  fi
  TOTAL="$ran"
}

# ── 2. reversed ──────────────────────────────────────────────────────────────
TOTAL=""
bun test --timeout "$TIMEOUT" --reporter=junit --reporter-outfile="$LOGDIR/reversed.xml" \
  "${FILES[@]}" > "$LOGDIR/reversed.log" 2>&1
check_run "reversed" "$LOGDIR/reversed.log" "$NFILES" "" "$LOGDIR/reversed.xml"
# Only a green run defines the expected total; after a red one the later runs
# are still checked for 0 fail / 0 errors, just not against a count.
EXPECTED=""
[ "$LAST_OK" = 1 ] && EXPECTED="$TOTAL"

# ── 3. shuffled ──────────────────────────────────────────────────────────────
bun test --timeout "$TIMEOUT" --randomize --seed="$SEED" --reporter=junit --reporter-outfile="$LOGDIR/shuffled.xml" > "$LOGDIR/shuffled.log" 2>&1
check_run "shuffled (seed $SEED; replay: TEST_ORDER_SEED=$SEED)" "$LOGDIR/shuffled.log" "$NFILES" "$EXPECTED" "$LOGDIR/shuffled.xml"

# ── 4. isolated ──────────────────────────────────────────────────────────────
if [ "${TEST_ORDER_SKIP_ISOLATED:-0}" = 1 ]; then
  echo "skip isolated (TEST_ORDER_SKIP_ISOLATED=1)"
else
  sum=0; pass_sum=0; bad=0; n=0; skipped=0
  for f in "${FILES[@]}"; do
    n=$((n + 1))
    log="$LOGDIR/isolated-$n.log"
    xml="$LOGDIR/isolated-$n.xml"
    bun test --timeout "$TIMEOUT" --reporter=junit --reporter-outfile="$xml" "$f" > "$log" 2>&1
    read -r ran files pass fail errs skip < <(summary "$log")
    check_skips "isolated: $f" "$xml" "$skip"
    if [ "$ran" = x ] || [ $((pass + skip)) != "$ran" ] || [ "$fail" != 0 ] || [ "$errs" != 0 ] || [ "$files" != 1 ]; then
      red "isolated: $f — $pass pass / $fail fail / $errs errors / $skip skip — log $log"
      command grep -aE '^\(fail\)|^error:|SyntaxError|Export named|not found in' "$log" | head -5 | sed 's/^/       /'
      bad=$((bad + 1))
    else
      sum=$((sum + ran))
      pass_sum=$((pass_sum + pass))
      skipped=$((skipped + skip))
    fi
  done
  if [ "$bad" = 0 ]; then
    if [ -n "$EXPECTED" ] && [ "$sum" != "$EXPECTED" ]; then
      red "isolated: $n files alone add up to $sum tests, the one-process run had $EXPECTED"
    else
      ok "isolated: $n files alone, $pass_sum pass / 0 fail, $sum tests total$([ "$skipped" = 0 ] || echo " ($skipped skipped)")"
    fi
  fi
fi

if [ "$RED" != 0 ]; then
  echo "test-order-guard: RED (logs in $LOGDIR)"
  exit 1
fi
echo "test-order-guard: green — $EXPECTED tests, $NFILES files, seed $SEED"
rm -rf "$LOGDIR"
