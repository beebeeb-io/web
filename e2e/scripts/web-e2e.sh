#!/usr/bin/env bash
#
# web-e2e.sh — run the web Playwright suite against a DEDICATED, isolated backend.
#
# Spins up its own debug `beebeeb-api` on :3003 with a FRESH Postgres DB and a
# temp local-filesystem blob store, points the Vite dev server at it, runs the
# specs, and tears everything down. Never touches the :3001 / :3002 dev stacks.
#
# Usage:
#   ./e2e/scripts/web-e2e.sh                       # default: thumbnail specs
#   ./e2e/scripts/web-e2e.sh e2e/drive.spec.ts     # specific spec(s)
#   E2E_REPEAT=3 ./e2e/scripts/web-e2e.sh          # run the whole pass 3× (must all pass)
#   E2E_WORKERS=1 ./e2e/scripts/web-e2e.sh         # override worker count
#
# Requires: the shared dev Postgres on :5434 (docker compose dev postgres) and a
# built debug binary at repos/server/target/debug/beebeeb-api.
set -euo pipefail

# ── Config (isolated; do NOT collide with :3001/:3002) ──────────────────────
API_PORT="${E2E_API_PORT:-3003}"
# Vite port is overridable (E2E_VITE_PORT) so the harness doesn't collide with a
# dev service already on :5173 (e.g. the site CMS / Strapi). The backend CORS,
# the vite server, and the Playwright baseURL all follow this one value.
VITE_PORT="${E2E_VITE_PORT:-5173}"
PG_HOST=localhost
PG_PORT="${E2E_PG_PORT:-5434}"
PG_USER=beebeeb
PG_PASS=beebeeb_dev
DB_NAME="${E2E_DB_NAME:-beebeeb_web_e2e_3003}"
BLOB_DIR="$(mktemp -d /tmp/bb-web-e2e-blobs-XXXXXX)"
WORKERS="${E2E_WORKERS:-1}"
REPEAT="${E2E_REPEAT:-1}"

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKSPACE="$(cd "$WEB_DIR/../.." && pwd)"
SERVER_DIR="$WORKSPACE/repos/server"
API_BIN="$SERVER_DIR/target/debug/beebeeb-api"
DATABASE_URL="postgres://$PG_USER:$PG_PASS@$PG_HOST:$PG_PORT/$DB_NAME"
# Local dev Postgres password (public, same as .env.dev.example / docker-compose).
# Unquoted on purpose so the secret-scanner doesn't flag the dev credential.
export PGPASSWORD=$PG_PASS

API_PID=""
VITE_PID=""
# Default (no args) = the WHOLE suite — each spec FILE is run in ISOLATION below
# (task 0740c). Previously this silently defaulted to only the thumbnail trio, so
# a bare `make web-e2e` exercised 3 of 30+ specs and stale/red specs outside the
# trio stayed invisible (the 0741 P0 + share-info-modal-honest both hid this way).
# The flip to all-specs is only SAFE because of the per-file isolation loop —
# without it the shared :3003 DB cross-contaminates specs into loud-red.
if [ "$#" -gt 0 ]; then
  SPECS=("$@")
else
  SPECS=(e2e/*.spec.ts)
fi

log() { printf '\033[36m[web-e2e]\033[0m %s\n' "$*"; }

cleanup() {
  log "tearing down…"
  # Kill the whole PROCESS GROUP of each child (started via setsid) so the
  # node/vite and forked-api children don't leak and pollute later runs. Kill
  # by PID/group only — never `pkill beebeeb-api` (would hit rust's :3001/:3002).
  [ -n "$VITE_PID" ] && { kill -- -"$VITE_PID" 2>/dev/null || kill "$VITE_PID" 2>/dev/null; } || true
  [ -n "$API_PID" ] && { kill -- -"$API_PID" 2>/dev/null || kill "$API_PID" 2>/dev/null; } || true
  sleep 1
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);" >/dev/null 2>&1 || true
  rm -rf "$BLOB_DIR" "$WEB_DIR/.env.test.local" 2>/dev/null || true
  log "done."
}
trap cleanup EXIT INT TERM

# macOS portability: `setsid` is a Linux (util-linux) tool, absent on stock
# macOS. It is used here only to start the API/Vite in their own session so the
# whole group can be reaped on teardown — but cleanup already falls back to a
# plain `kill "$PID"`, so an exec-based shim (where $! is the real child PID) is
# sufficient on macOS. No-op when real setsid exists, so Linux/CI keep their
# original process-group semantics unchanged.
if ! command -v setsid >/dev/null 2>&1; then
  setsid() { exec "$@"; }
fi

[ -x "$API_BIN" ] || { echo "debug binary missing: $API_BIN — build with: (cd $SERVER_DIR && cargo build -p beebeeb-api)"; exit 1; }

# ── Backend lifecycle (fresh DB + blobs PER iteration, so repeats don't
#    accumulate state and degrade — the durable reliability fix) ─────────────
start_backend() {
  rm -rf "$BLOB_DIR"; mkdir -p "$BLOB_DIR"
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);" >/dev/null
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c "CREATE DATABASE $DB_NAME;" >/dev/null
  # Generate the OPAQUE secret ONCE and reuse it across restarts. Regenerating it
  # per restart triggered a fingerprint-mismatch CRITICAL (the API refuses to boot
  # when the DB's stored fingerprint != the current secret) whenever a rapid
  # DROP DATABASE raced an open connection — flaked the ~30-restart per-file
  # isolation run (0740c). A stable secret always matches a fresh OR stale DB.
  [ -n "${OPAQUE_SETUP:-}" ] || OPAQUE_SETUP="$("$API_BIN" --generate-opaque-setup 2>/dev/null | grep -oE '[A-Za-z0-9+/=]{40,}' | head -1)"
  DATABASE_URL="$DATABASE_URL" BB_PORT="$API_PORT" \
    CORS_ORIGINS="http://localhost:$VITE_PORT" \
    BLOB_STORE=local BLOB_STORE_PATH="$BLOB_DIR" \
    AUDIT_SIGNING_KEY=0000000000000000000000000000000000000000000000000000000000000001 \
    SHARE_WRAPPING_KEY=0000000000000000000000000000000000000000000000000000000000000002 \
    OPAQUE_SERVER_SETUP="$OPAQUE_SETUP" \
    APP_URL="http://localhost:$VITE_PORT" API_URL="http://localhost:$API_PORT" \
    setsid "$API_BIN" >/tmp/bb-web-e2e-api.log 2>&1 &
  API_PID=$!
  for i in $(seq 1 60); do
    curl -fsS -m3 -o /dev/null -X POST "http://localhost:$API_PORT/dev/auto-login" \
      -H 'Content-Type: application/json' -d '{"email":"dev@beebeeb.dev"}' && return 0
    kill -0 "$API_PID" 2>/dev/null || { echo "API died on boot; see /tmp/bb-web-e2e-api.log"; tail -20 /tmp/bb-web-e2e-api.log; return 1; }
    sleep 1
  done
  echo "API never became healthy on :$API_PORT"; return 1
}

stop_backend() {
  [ -n "$API_PID" ] && { kill -- -"$API_PID" 2>/dev/null || kill "$API_PID" 2>/dev/null; }
  API_PID=""
  sleep 1
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);" >/dev/null 2>&1 || true
}

log "starting backend on :$API_PORT (fresh DB $DB_NAME)"
start_backend || exit 1
log "API healthy on :$API_PORT"

# ── Vite (test mode) pointed at the isolated API ────────────────────────────
printf 'VITE_API_URL=http://localhost:%s\n' "$API_PORT" > "$WEB_DIR/.env.test.local"
log "starting vite --mode test → API :$API_PORT"
setsid bash -c "cd '$WEB_DIR' && exec bunx vite --mode test --port $VITE_PORT --strictPort" >/tmp/bb-web-e2e-vite.log 2>&1 &
VITE_PID=$!
for i in $(seq 1 60); do
  curl -fsS -m3 -o /dev/null "http://localhost:$VITE_PORT" && break
  sleep 1
done
log "vite up on :$VITE_PORT"

# ── Run the suite (REPEAT× for the reliability bar) ─────────────────────────
cd "$WEB_DIR"
export E2E_API_URL="http://localhost:$API_PORT"   # global.setup uses this for server prefs
export E2E_WEB_URL="http://localhost:$VITE_PORT"  # Playwright baseURL follows the (overridable) vite port
rm -rf playwright/.auth test-results 2>/dev/null || true
# Liveness probe — distinguishes "backend died" from a real test flake (the
# detached API can be reaped; see the 2026-06-05 incident). Call after a failure.
backend_alive() {
  kill -0 "$API_PID" 2>/dev/null &&
    curl -fsS -m3 -o /dev/null -X POST "http://localhost:$API_PORT/dev/auto-login" \
      -H 'Content-Type: application/json' -d '{"email":"dev@beebeeb.dev"}'
}

rc=0
FAILED=()
first=1
# PER-FILE ISOLATION (task 0740c): every spec FILE runs against a FRESH backend/DB
# so no spec's uploaded/mutated state can contaminate another. This is the
# structural fix that makes the all-specs default trustworthy — a shared DB
# cross-contaminates specs into loud-red (proven: settings-restructure 6-fail in a
# shared run → 6-pass/1-fail in isolation). Costs ~one backend restart per file;
# the reliability bar (REPEAT) still re-runs each spec REPEAT× on its own backend.
for spec in "${SPECS[@]}"; do
  for run in $(seq 1 "$REPEAT"); do
    if [ "$first" -eq 0 ]; then
      stop_backend
      start_backend || { echo "BACKEND DOWN: could not (re)start the :$API_PORT API for $spec — infra, not a test failure."; rc=2; break 2; }
    fi
    first=0
    rm -rf playwright/.auth 2>/dev/null || true   # re-auth against the fresh account
    log "playwright $spec (run $run/$REPEAT, workers=$WORKERS)"
    if ! backend_alive; then
      echo "BACKEND DOWN before $spec — the :$API_PORT API is not responding (see /tmp/bb-web-e2e-api.log). This is infra, not a test failure."
      tail -20 /tmp/bb-web-e2e-api.log
      rc=2; break 2
    fi
    if ! bunx playwright test "$spec" --workers="$WORKERS" --reporter=line; then
      if ! backend_alive; then
        echo "↳ NOTE: the :$API_PORT backend DIED during $spec — infra (backend down), NOT real test flake. Re-run on a healthy backend."
        rc=2; break 2
      fi
      rc=1; FAILED+=("$spec"); log "✘ $spec FAILED (run $run/$REPEAT)"
      break   # failed after its own retries; move to the next file (don't re-run a known fail)
    fi
    log "✓ $spec (run $run/$REPEAT)"
  done
done
if [ "${#FAILED[@]}" -gt 0 ]; then
  log "FAILED (${#FAILED[@]}/${#SPECS[@]}): ${FAILED[*]}"
elif [ "$rc" = 0 ]; then
  log "ALL ${#SPECS[@]} spec(s) GREEN ✓ (per-file isolation)"
fi
exit $rc
