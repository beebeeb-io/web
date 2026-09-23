#!/usr/bin/env bash
#
# prod-smoke.sh — driver for the prod-smoke Playwright suite (task 1495).
#
# Drives the WHOLE account lifecycle through the real UI (signup → email
# verification → recovery-phrase confirm → upload/download byte-compare →
# preview → share link opened logged-out → sign out/in → CLI browser handoff
# → bb ls → change password → phrase recovery on a fresh context → delete
# account → login fails / API 401) against ONE throwaway
# `smoke+<run-id>@beebeeb.io` account. See e2e/prod-smoke/prod-smoke.spec.ts
# for the actual steps and playwright.prod-smoke.config.ts for the harness
# config.
#
# Usage:
#   ./scripts/prod-smoke.sh --target local              # safe, isolated, anyone
#   ./scripts/prod-smoke.sh --target local --prove-red  # deliberate byte mismatch (see RED PROOF below)
#   BB_PROD_SMOKE_OK=1 ./scripts/prod-smoke.sh --target prod   # LEAD-AUTHORIZED ONLY — never run by a lane
#
# ── --target local ───────────────────────────────────────────────────────
# Spins up ITS OWN beebeeb-api instance on a free local port (never the
# shared :3001 dev API another session may be using — "never disturb a live
# lane") but points it at the SAME shared dev Postgres
# (`beebeebio-postgres-1`, database `beebeeb`) that the shared dev stack
# uses, by sourcing repos/server/.env for its secrets (OPAQUE_SERVER_SETUP
# etc.) so its secret fingerprints match what's already recorded in that DB.
# This is what makes the task's literal cleanup-proof command work:
#   docker exec beebeebio-postgres-1 psql -U beebeeb -d beebeeb \
#     -Atc "select count(*) from users where email like 'smoke+%'"
# BB_RATE_LIMIT_DISABLED=1 and the pilot-key gate are set explicitly on this
# instance — never assumed from whatever the shared :3001 API happens to be
# running with. Also builds `repos/cli` (main, unmodified) into a SCRATCH
# target-dir inside this worktree and runs it with an ISOLATED HOME — the
# operator's real ~ holds a live prod CLI session and is never touched.
#
# ── --target prod ────────────────────────────────────────────────────────
# Points Playwright at https://app.beebeeb.io (E2E_NO_WEBSERVER=1, no local
# API/Vite started) and the CLI at the real https://api.beebeeb.io. This is a
# REAL PRODUCTION MUTATION (creates + deletes a real account) — refused
# unless BB_PROD_SMOKE_OK=1 is set, and even then this script does not decide
# to run it; a human does. The verification-code path is intentionally NOT
# hardcoded to a specific admin endpoint (none exists yet) — set
# E2E_PROD_VERIFICATION_CODE after reading the code via whatever admin/API
# path applies (see e2e/prod-smoke/helpers.ts's readVerificationCode).
#
# ── RED PROOF ─────────────────────────────────────────────────────────────
# --prove-red (equivalently E2E_SMOKE_FORCE_BAD_BYTES=1) flips a byte of the
# downloaded file before the byte-compare in step 3, so that assertion is
# PROVEN load-bearing rather than a tautology (workspace "How we work": a new
# assertion isn't trusted until it's been seen to fail). It also doubles as
# the CLEANUP proof: the forced failure happens well after the account is
# created but before the suite's own step 10 (UI delete-account) ever runs,
# so a green "0 leftover smoke accounts" after a --prove-red run is proof the
# trap-based cleanup below — not the happy-path UI step — did the deleting.
#
# ── Cleanup ───────────────────────────────────────────────────────────────
# Trap-based (EXIT/INT/TERM): stops the isolated API/Vite (by PID only —
# never pkill by name), then hard-deletes the run's smoke account directly
# from the shared DB regardless of where the run stopped. The `users` table
# uses ON DELETE CASCADE (see repos/server/beebeeb-api/src/user_purge.rs) so
# one DELETE removes every child row (files, sessions, shares, …) too. This
# runs even on the happy path, where it's a harmless no-op — step 10 already
# deleted the account via the real UI by then.

set -euo pipefail

# ── Args ──────────────────────────────────────────────────────────────────

TARGET=""
PROVE_RED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --target=*) TARGET="${1#*=}"; shift ;;
    --prove-red) PROVE_RED=1; shift ;;
    -h|--help)
      sed -n '1,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown argument: $1 (usage: $0 --target local|prod [--prove-red])" >&2; exit 1 ;;
  esac
done
case "$TARGET" in
  local|prod) ;;
  *) echo "usage: $0 --target local|prod [--prove-red]" >&2; exit 1 ;;
esac
[ "$PROVE_RED" = "1" ] && export E2E_SMOKE_FORCE_BAD_BYTES=1

log() { printf '\033[35m[prod-smoke]\033[0m %s\n' "$*"; }

# ── Load guard (shared machine — another session's build/sim fleet may be
#    running; never proceed into a build/test step at load >= 60) ──────────
wait_for_load() {
  local waited=0 load1
  while true; do
    load1="$(sysctl -n vm.loadavg | awk '{print int($2)}')"
    [ "$load1" -lt 60 ] && return 0
    if [ "$waited" -ge 1800 ]; then
      echo "[prod-smoke] BLOCKED: load average still >= 60 after 30 minutes (last observed: $load1). Not proceeding — another session's build/sim fleet is likely running." >&2
      exit 3
    fi
    log "load average $load1 >= 60 — waiting 60s before the next build/test step…"
    sleep 60
    waited=$((waited + 60))
  done
}

# ── Paths ─────────────────────────────────────────────────────────────────

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WEB_DIR"

# Resolve the beebeeb.io WORKSPACE root via git's COMMON dir (same trick as
# e2e/scripts/web-e2e.sh) — this script's checkout is normally a `git
# worktree add` worktree OUTSIDE the workspace entirely (task 1495's own
# mandatory first step: ~/code/bb-worktrees/web-NNNN), so a fixed "../.."
# offset from here would resolve outside beebeeb.io altogether.
if GIT_COMMON_DIR="$(cd "$WEB_DIR" && git rev-parse --git-common-dir 2>/dev/null)"; then
  PRIMARY_WEB_DIR="$(cd "$GIT_COMMON_DIR/.." && pwd)"
  WORKSPACE="$(cd "$PRIMARY_WEB_DIR/../.." && pwd)"
else
  WORKSPACE="$(cd "$WEB_DIR/../.." && pwd)"
fi
SERVER_DIR="$WORKSPACE/repos/server"
CLI_DIR="$WORKSPACE/repos/cli"
API_BIN="${E2E_API_BIN:-$SERVER_DIR/target/debug/beebeeb-api}"

RUN_ID="${E2E_SMOKE_RUN_ID:-$(date +%s)-$RANDOM}"
SMOKE_EMAIL="smoke+${RUN_ID}@beebeeb.io"
export E2E_SMOKE_RUN_ID="$RUN_ID"

PSQL_CONTAINER="${E2E_PG_CONTAINER:-beebeebio-postgres-1}"
# -i: forwards this script's stdin into the container — required for the
# heredoc-piped cleanup DO block below (`docker exec` without -i never
# connects stdin, so a piped psql script silently reads nothing).
db_psql() { docker exec -i -e PGPASSWORD=beebeeb_dev "$PSQL_CONTAINER" psql -U beebeeb "$@"; }

SCRATCH_DIR="$WEB_DIR/.prod-smoke-scratch/$RUN_ID"
mkdir -p "$SCRATCH_DIR"

API_PID=""
VITE_PID=""

# Guards re-entrancy: a signal-triggered trap (INT/TERM) calls `exit` at the
# end of cleanup(), which itself fires the EXIT trap again — without this
# flag cleanup() (and its DB DELETE) runs twice per invocation.
CLEANUP_DONE=0

cleanup() {
  local rc=$?
  [ "$CLEANUP_DONE" = "1" ] && exit "$rc"
  CLEANUP_DONE=1
  log "cleaning up (exit code so far: $rc)…"
  # Kill only PIDs THIS script started, never by name (workspace CLAUDE.md:
  # "never pkill by name" — a lane's `pkill -f beebeeb-api` once killed the
  # shared dev API on :3001).
  if [ -n "$VITE_PID" ]; then kill -- -"$VITE_PID" 2>/dev/null || kill "$VITE_PID" 2>/dev/null || true; fi
  if [ -n "$API_PID" ]; then kill -- -"$API_PID" 2>/dev/null || kill "$API_PID" 2>/dev/null || true; fi
  sleep 1

  # Trap-based account cleanup (see header) — runs unconditionally, hits the
  # shared DB directly, independent of whether the suite's own step 10
  # (UI delete-account) ever ran.
  #
  # A bare `DELETE FROM users` is NOT enough: several tables that a real
  # signup/upload/session flow populates reference users(id) WITHOUT
  # ON DELETE CASCADE (found the hard way — `sync_ops.user_id` is NO ACTION,
  # despite user_purge.rs's header comment claiming "ON DELETE CASCADE for
  # all foreign keys"; a live FK audit turned up ~20 more: files.uploaded_by,
  # shares.created_by, stream_tokens.user_id, invoices.user_id, etc). Rather
  # than hardcode that table list (liable to drift as the schema grows), this
  # introspects information_schema for every non-CASCADE FK pointing at
  # users(id) and deletes the dependent rows first, in one transaction, then
  # the user row itself. Verified against a real leftover row while building
  # this harness (task 1495 notes).
  if [ "$TARGET" = "local" ]; then
    # UNQUOTED heredoc (<<SQL, not <<'SQL') so bash substitutes $SMOKE_EMAIL —
    # deliberately NOT psql's `-v`/`:'var'` substitution: verified live
    # (task 1495 notes) that psql does NOT perform `:'var'` interpolation
    # INSIDE a dollar-quoted ($$...$$) PL/pgSQL body (it recognizes
    # dollar-quoting as a literal context precisely so a body containing
    # its own colons isn't corrupted) — that first attempt round-tripped
    # with no substitution and errored "syntax error at or near \":\"".
    # $SMOKE_EMAIL is program-generated (smoke+<run-id>@beebeeb.io) and can
    # never contain a quote, so direct interpolation is safe. The PL/pgSQL
    # `$$` body-quoting and the `format(...)`'s `$1` placeholder are escaped
    # (\$\$, \$1) so BASH doesn't touch them and psql receives them literally.
    db_psql -d beebeeb <<SQL >/dev/null 2>&1 || true
DO \$\$
DECLARE
  uid uuid;
  r RECORD;
BEGIN
  SELECT id INTO uid FROM users WHERE email = '$SMOKE_EMAIL';
  IF uid IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT tc.table_name AS tbl, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'users'
      AND rc.delete_rule <> 'CASCADE'
      AND tc.table_name <> 'users'
  LOOP
    EXECUTE format('DELETE FROM %I WHERE %I = \$1', r.tbl, r.col) USING uid;
  END LOOP;
  DELETE FROM users WHERE id = uid;
END \$\$;
SQL
    local left
    left="$(db_psql -d beebeeb -Atc "select count(*) from users where email = '$SMOKE_EMAIL'" 2>/dev/null || echo '?')"
    log "leftover rows for $SMOKE_EMAIL after cleanup: $left"
  fi

  rm -rf "$SCRATCH_DIR" 2>/dev/null || true
  rm -f "$WEB_DIR/.env.test.local" 2>/dev/null || true
  log "cleanup done."
  exit "$rc"
}
trap cleanup EXIT INT TERM

# macOS has no `setsid` (util-linux); fall back to a plain exec so $! is the
# real child PID (matches e2e/scripts/web-e2e.sh's shim).
if ! command -v setsid >/dev/null 2>&1; then
  setsid() { exec "$@"; }
fi

# ── Build the CLI (repos/cli @ main, UNMODIFIED) into a scratch target-dir
#    INSIDE THIS WORKTREE — never repos/cli's own target/, never repos/cli's
#    source. Safe for both targets (pure compile, no prod contact). ────────
build_cli() {
  wait_for_load
  log "building bb CLI (repos/cli @ $(git -C "$CLI_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)) into scratch target-dir…"
  ( cd "$CLI_DIR" && cargo build --target-dir "$SCRATCH_DIR/cli-target" ) \
    || { echo "cli build failed — see output above" >&2; exit 1; }
  CLI_BIN_PATH="$SCRATCH_DIR/cli-target/debug/bb"
  [ -x "$CLI_BIN_PATH" ] || { echo "cli binary missing after build: $CLI_BIN_PATH" >&2; exit 1; }
  CLI_HOME_DIR="$SCRATCH_DIR/cli-home"
  mkdir -p "$CLI_HOME_DIR"
  log "cli binary: $CLI_BIN_PATH · isolated HOME: $CLI_HOME_DIR"
}

# ═══════════════════════════════════════════════════════════════════════════
# --target prod (LEAD-AUTHORIZED ONLY — this script never invokes this path
# on its own; a human runs it)
# ═══════════════════════════════════════════════════════════════════════════
if [ "$TARGET" = "prod" ]; then
  if [ "${BB_PROD_SMOKE_OK:-0}" != "1" ]; then
    echo "refusing --target prod: this is a real production mutation (creates + deletes a real account)." >&2
    echo "set BB_PROD_SMOKE_OK=1 to proceed — lead-authorized only, see task 1495." >&2
    exit 1
  fi
  log "*** PROD TARGET — real production mutation, lead-authorized (BB_PROD_SMOKE_OK=1) ***"
  log "smoke account: $SMOKE_EMAIL"

  export E2E_WEB_URL="https://app.beebeeb.io"
  export E2E_NO_WEBSERVER=1
  export E2E_VERIFICATION_SOURCE="${E2E_VERIFICATION_SOURCE:-manual}"
  export E2E_CLI_API_URL="${E2E_CLI_API_URL:-https://api.beebeeb.io}"
  if [ "$E2E_VERIFICATION_SOURCE" = "manual" ] && [ -z "${E2E_PROD_VERIFICATION_CODE:-}" ]; then
    echo "E2E_VERIFICATION_SOURCE=manual but E2E_PROD_VERIFICATION_CODE is not set." >&2
    echo "Read the verification code via whatever admin/API path applies, then export it, then re-run." >&2
    exit 1
  fi

  build_cli
  export E2E_CLI_BIN="$CLI_BIN_PATH"
  export E2E_CLI_HOME="$CLI_HOME_DIR"

  wait_for_load
  log "running prod-smoke suite against PRODUCTION (account=$SMOKE_EMAIL)…"
  set +e
  bunx playwright test --config=playwright.prod-smoke.config.ts 2>&1 | tee "$SCRATCH_DIR/playwright.log"
  rc=${PIPESTATUS[0]}
  set -e
  log "playwright exit code: $rc"
  exit "$rc"
fi

# ═══════════════════════════════════════════════════════════════════════════
# --target local
# ═══════════════════════════════════════════════════════════════════════════

[ -x "$API_BIN" ] || { echo "debug binary missing: $API_BIN — build with: (cd $SERVER_DIR && cargo build -p beebeeb-api)" >&2; exit 1; }
[ -f "$SERVER_DIR/.env" ] || {
  echo "missing $SERVER_DIR/.env — this harness reuses the shared dev API's secrets" >&2
  echo "(OPAQUE_SERVER_SETUP etc.) so its fingerprint matches the shared 'beebeeb' DB. See .env.example." >&2
  exit 1
}

API_PORT="${E2E_SMOKE_API_PORT:-3011}"
VITE_PORT="${E2E_SMOKE_VITE_PORT:-5183}"
port_free() { ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
port_free "$API_PORT" || { echo "port $API_PORT is already in use — set E2E_SMOKE_API_PORT to a free one" >&2; exit 1; }
port_free "$VITE_PORT" || { echo "port $VITE_PORT is already in use — set E2E_SMOKE_VITE_PORT to a free one" >&2; exit 1; }

log "smoke account: $SMOKE_EMAIL · API :$API_PORT · web :$VITE_PORT"

wait_for_load
log "bun install --frozen-lockfile"
bun install --frozen-lockfile || { echo "bun install failed — check the lockfile" >&2; exit 1; }

# Mailpit (dev mail sink, task 1448) — idempotent; usually already running.
docker compose -f "$WORKSPACE/docker-compose.yml" up -d mailpit >/dev/null 2>&1 || true

# ── Start the isolated API instance, secrets sourced from the shared .env ──
set -a
# shellcheck disable=SC1091
source "$SERVER_DIR/.env"
set +a
export BB_PORT="$API_PORT"
export CORS_ORIGINS="http://localhost:$VITE_PORT"
export APP_URL="http://localhost:$VITE_PORT"
export BLOB_STORE=local
export BLOB_STORE_PATH="$SCRATCH_DIR/blobs"
mkdir -p "$BLOB_STORE_PATH"
# Mailpit takes no auth. `SMTP_USER`/`SMTP_PASS` MUST be cleared even though
# the sourced .env sets them (real-relay credentials for the shared :3001
# dev API) — email.rs only skips AUTH when BOTH are empty; leaving either
# set sends Mailpit an AUTH command it never advertised and every send fails
# with "No compatible authentication mechanism was found" (found the hard
# way: step 2's verification email silently never arrived — see task 1495
# notes). This does not touch repos/server/.env itself.
export SMTP_HOST=localhost SMTP_PORT=1025 SMTP_TLS_MODE=none SMTP_USER= SMTP_PASS=
# Same file the shared :3001 dev API writes to — reusing it means an
# identical-secrets boot here never CRITICAL-logs a fingerprint mismatch.
export SECRET_FINGERPRINTS_PATH="$SERVER_DIR/data/.secret-fingerprints"
export BB_RATE_LIMIT_DISABLED=1
export BB_REQUIRE_PILOT_KEY=1
export BB_PILOT_SIGNUP_KEY="${BB_PILOT_SIGNUP_KEY:-test-pilot-key}"
# Kept in lockstep with the server-side key (mirrors e2e/scripts/web-e2e.sh) —
# e2e/helpers/signup.ts's PILOT_KEY constant reads BB_TEST_PILOT_KEY, which
# defaults to the same 'test-pilot-key' literal, but set it explicitly so a
# future default change on either side can't silently drift out of lockstep.
export BB_TEST_PILOT_KEY="$BB_PILOT_SIGNUP_KEY"

wait_for_load
log "starting isolated beebeeb-api on :$API_PORT (shared DB, isolated port+blobs+CORS)…"
setsid "$API_BIN" >"$SCRATCH_DIR/api.log" 2>&1 &
API_PID=$!
api_healthy=0
for _ in $(seq 1 60); do
  if curl -fsS -m5 -o /dev/null "http://localhost:$API_PORT/health"; then api_healthy=1; break; fi
  kill -0 "$API_PID" 2>/dev/null || { echo "API died on boot; see $SCRATCH_DIR/api.log" >&2; tail -40 "$SCRATCH_DIR/api.log" >&2; exit 1; }
  sleep 1
done
[ "$api_healthy" = "1" ] || { echo "API never became healthy on :$API_PORT; see $SCRATCH_DIR/api.log" >&2; tail -40 "$SCRATCH_DIR/api.log" >&2; exit 1; }
log "API healthy on :$API_PORT"

# ── Start Vite pointed at the isolated API (same NODE_ENV=test defense as
#    e2e/scripts/web-e2e.sh — see that script's comment for why both layers
#    are needed to keep bun's auto-dotenv from leaking :3001 in). ──────────
printf 'VITE_API_URL=http://localhost:%s\n' "$API_PORT" > "$WEB_DIR/.env.test.local"
setsid bash -c "cd '$WEB_DIR' && NODE_ENV=test VITE_API_URL='http://localhost:$API_PORT' exec bunx vite --mode test --port $VITE_PORT --strictPort" >"$SCRATCH_DIR/vite.log" 2>&1 &
VITE_PID=$!
vite_healthy=0
for _ in $(seq 1 60); do
  if curl -fsS -m3 -o /dev/null "http://localhost:$VITE_PORT"; then vite_healthy=1; break; fi
  kill -0 "$VITE_PID" 2>/dev/null || { echo "vite died on boot; see $SCRATCH_DIR/vite.log" >&2; tail -40 "$SCRATCH_DIR/vite.log" >&2; exit 1; }
  sleep 1
done
[ "$vite_healthy" = "1" ] || { echo "vite never became healthy on :$VITE_PORT; see $SCRATCH_DIR/vite.log" >&2; tail -40 "$SCRATCH_DIR/vite.log" >&2; exit 1; }
log "vite up on :$VITE_PORT"

build_cli

export E2E_WEB_URL="http://localhost:$VITE_PORT"
export E2E_API_URL="http://localhost:$API_PORT"
export E2E_NO_WEBSERVER=1
export E2E_MAILPIT_URL="http://localhost:8025"
export E2E_VERIFICATION_SOURCE="mailpit"
export E2E_CLI_BIN="$CLI_BIN_PATH"
export E2E_CLI_HOME="$CLI_HOME_DIR"
export E2E_CLI_API_URL="http://localhost:$API_PORT"

wait_for_load
log "running prod-smoke suite (target=local, account=$SMOKE_EMAIL)$([ "$PROVE_RED" = 1 ] && echo ' [--prove-red: byte-compare WILL be mutated]')…"
set +e
bunx playwright test --config=playwright.prod-smoke.config.ts 2>&1 | tee "$SCRATCH_DIR/playwright.log"
rc=${PIPESTATUS[0]}
set -e
log "playwright exit code: $rc"
grep -E '[0-9]+ (passed|failed|skipped)' "$SCRATCH_DIR/playwright.log" | tail -5 || true
exit "$rc"
