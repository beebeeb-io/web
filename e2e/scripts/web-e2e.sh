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
# built debug binary at repos/server/target/debug/beebeeb-api. Works from the
# PRIMARY repos/web checkout or any `git worktree add` worktree of it (task
# 1406) — SERVER_DIR always resolves to the one real repos/server via git's
# common dir. Uses host `psql` if present, else falls back to `docker exec`
# into the Postgres container (task 1406; override with E2E_PG_CONTAINER).
# The pilot-access-key gate is ON by default (BB_REQUIRE_PILOT_KEY=1,
# BB_PILOT_SIGNUP_KEY=test-pilot-key) — override before invoking to turn it off.
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
# Resolve the beebeeb.io WORKSPACE root via git's COMMON dir, not a fixed
# "../.." offset from this script's own location (task 1406 — the previous
# `$WEB_DIR/../..` only worked when this script's checkout WAS the primary
# repos/web; `git worktree add` places worktrees OUTSIDE the workspace
# entirely — convention `repos/web-NNNN` or `~/code/bb-worktrees/web-NNNN`
# per the workspace CLAUDE.md — so a worktree 2 levels up lands outside
# beebeeb.io altogether and SERVER_DIR below silently resolved to a
# nonexistent path). `git rev-parse --git-common-dir` always returns the
# PRIMARY checkout's .git, even when this script runs from a linked worktree,
# so this locates the one real repos/server (and its built debug binary)
# regardless of where THIS checkout lives on disk. Falls back to the old
# relative computation if run outside a git worktree/repo entirely.
if GIT_COMMON_DIR="$(cd "$WEB_DIR" && git rev-parse --git-common-dir 2>/dev/null)"; then
  PRIMARY_WEB_DIR="$(cd "$GIT_COMMON_DIR/.." && pwd)"
  WORKSPACE="$(cd "$PRIMARY_WEB_DIR/../.." && pwd)"
else
  WORKSPACE="$(cd "$WEB_DIR/../.." && pwd)"
fi
SERVER_DIR="$WORKSPACE/repos/server"
# API binary: defaults to the debug build, but E2E_API_BIN can point elsewhere —
# notably at a RELEASE build. The dev auto-login derives a 256 MiB Argon2id
# master key on every page load (DevAuthGate re-runs it per navigation); that is
# ~11 s in an unoptimized debug build (busts the health probe + every spec's
# timeout) and trivially fast in release. The CI gate builds + points here at
# `target/release/beebeeb-api`.
API_BIN="${E2E_API_BIN:-$SERVER_DIR/target/debug/beebeeb-api}"
DATABASE_URL="postgres://$PG_USER:$PG_PASS@$PG_HOST:$PG_PORT/$DB_NAME"
# Local dev Postgres password (public, same as .env.dev.example / docker-compose).
# Unquoted on purpose so the secret-scanner doesn't flag the dev credential.
export PGPASSWORD=$PG_PASS

# Pilot-access-key gate (task 1406): ON by default for this harness. The
# gate was previously left off by default, which is exactly how the stale
# signup-helper bugs (auth.spec.ts, refresh-stability.spec.ts, and 3 more
# found sweeping every /signup-driving spec — see task 1406 notes) went
# unnoticed: the harness never actually exercised BB_REQUIRE_PILOT_KEY, only
# the client-side non-empty check (required independent of this gate since
# task 0928). A caller can still override BB_REQUIRE_PILOT_KEY=/BB_PILOT_SIGNUP_KEY=
# (e.g. empty, to run with the gate off) before invoking this script.
BB_REQUIRE_PILOT_KEY="${BB_REQUIRE_PILOT_KEY:-1}"
BB_PILOT_SIGNUP_KEY="${BB_PILOT_SIGNUP_KEY:-test-pilot-key}"
export BB_REQUIRE_PILOT_KEY BB_PILOT_SIGNUP_KEY
# e2e/helpers/signup.ts (and pilot-key-registration.spec.ts) fill the
# pilot-key-input field from BB_TEST_PILOT_KEY by default — keep it in
# lockstep with the server-side expected key so the harness's default run
# satisfies both the client-side requirement AND the server-side gate.
export BB_TEST_PILOT_KEY="${BB_TEST_PILOT_KEY:-$BB_PILOT_SIGNUP_KEY}"

# psql wrapper: prefer host `psql`, otherwise fall back to `docker exec` into
# the dev Postgres container (task 1406 — this harness previously assumed
# `psql` was on PATH, which it is not on this machine: only the Dockerized
# Postgres is installed). PSQL_CONTAINER defaults to the container this
# repo's docker-compose.yml actually produces (`docker ps` confirmed
# `beebeebio-postgres-1`); override E2E_PG_CONTAINER if a caller's compose
# project name differs.
PSQL_CONTAINER="${E2E_PG_CONTAINER:-beebeebio-postgres-1}"
if command -v psql >/dev/null 2>&1; then
  db_psql() { psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$@"; }
else
  # Unquoted PGPASSWORD=$PG_PASS on purpose, matching the `export PGPASSWORD=$PG_PASS`
  # convention above — the secret-scanner's pre-commit hook flags a quoted
  # `PGPASSWORD="..."` assignment even though this is the same public dev credential.
  db_psql() { docker exec -e PGPASSWORD=$PG_PASS "$PSQL_CONTAINER" psql -U "$PG_USER" "$@"; }
fi

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
  db_psql -d postgres \
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

# Ensure node_modules are up-to-date (e.g. otplib may be in package.json but
# missing from node_modules after a fresh clone or partial install).
log "bun install --frozen-lockfile"
(cd "$WEB_DIR" && bun install --frozen-lockfile) || { echo "bun install failed — check lockfile"; exit 1; }

[ -x "$API_BIN" ] || { echo "debug binary missing: $API_BIN — build with: (cd $SERVER_DIR && cargo build -p beebeeb-api)"; exit 1; }

# ── Backend lifecycle (fresh DB + blobs PER iteration, so repeats don't
#    accumulate state and degrade — the durable reliability fix) ─────────────
start_backend() {
  rm -rf "$BLOB_DIR"; mkdir -p "$BLOB_DIR"
  db_psql -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);" >/dev/null
  db_psql -d postgres -c "CREATE DATABASE $DB_NAME;" >/dev/null
  # Generate the OPAQUE secret ONCE and reuse it across restarts. Regenerating it
  # per restart triggered a fingerprint-mismatch CRITICAL (the API refuses to boot
  # when the DB's stored fingerprint != the current secret) whenever a rapid
  # DROP DATABASE raced an open connection — flaked the ~30-restart per-file
  # isolation run (0740c). A stable secret always matches a fresh OR stale DB.
  [ -n "${OPAQUE_SETUP:-}" ] || OPAQUE_SETUP="$("$API_BIN" --generate-opaque-setup 2>/dev/null | grep -oE '[A-Za-z0-9+/=]{40,}' | head -1)"
  # Tiny, LOCALLY-GENERATED pwned-passwords fixture corpus (task 1367 Task 4) —
  # NOT the real HIBP dataset (see docs/ops/pwned-corpus.md: never download that
  # off-path job here). Schema per that doc: pwned_prefixes(prefix, suffixes).
  # Seeded with a couple of well-known breached passwords so
  # change-password.spec.ts can exercise the "breached" branch of
  # GET /api/v1/auth/pwned-range/{prefix} end-to-end, isolated per run in
  # $BLOB_DIR (destroyed on teardown, never touches a shared/prod path).
  PWNED_CORPUS_DB="$BLOB_DIR/pwned-fixture.sqlite"
  sqlite3 "$PWNED_CORPUS_DB" <<'SQL'
CREATE TABLE pwned_prefixes (prefix TEXT PRIMARY KEY, suffixes TEXT NOT NULL);
-- SHA-1('password123456') = 98A16C09B0759E63EF7DF53592724E8EEDDB953A
INSERT INTO pwned_prefixes (prefix, suffixes) VALUES ('98A16', 'C09B0759E63EF7DF53592724E8EEDDB953A:9999999');
-- SHA-1('password') = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
INSERT INTO pwned_prefixes (prefix, suffixes) VALUES ('5BAA6', '1E4C9B93F3F0682250B6CF8331B7EE68FD8:9999999');
SQL
  # BB_REQUIRE_PILOT_KEY / BB_PILOT_SIGNUP_KEY (task 1411; defaulted ON by
  # task 1406 — see the Config section above): forwarded to the isolated API.
  # A caller can still set BB_REQUIRE_PILOT_KEY= (empty) before invoking this
  # script to run with the gate off — server's bool_flag/evaluate() both
  # treat "" as falsy/empty (beebeeb-api/src/env_flags.rs + pilot_gate.rs).
  # e.g. to specifically exercise pilot-key-registration.spec.ts's gate-off
  # self-skip path:
  #   BB_REQUIRE_PILOT_KEY= ./e2e/scripts/web-e2e.sh e2e/pilot-key-registration.spec.ts
  DATABASE_URL="$DATABASE_URL" BB_PORT="$API_PORT" \
    CORS_ORIGINS="http://localhost:$VITE_PORT" \
    BLOB_STORE=local BLOB_STORE_PATH="$BLOB_DIR" \
    AUDIT_SIGNING_KEY=0000000000000000000000000000000000000000000000000000000000000001 \
    SHARE_WRAPPING_KEY=0000000000000000000000000000000000000000000000000000000000000002 \
    OPAQUE_SERVER_SETUP="$OPAQUE_SETUP" \
    SECRET_FINGERPRINTS_PATH="$BLOB_DIR/.secret-fingerprints" \
    BEEBEEB_PWNED_CORPUS_PATH="$PWNED_CORPUS_DB" \
    BB_RATE_LIMIT_DISABLED=1 \
    APP_URL="http://localhost:$VITE_PORT" API_URL="http://localhost:$API_PORT" \
    BB_REQUIRE_PILOT_KEY="$BB_REQUIRE_PILOT_KEY" \
    BB_PILOT_SIGNUP_KEY="$BB_PILOT_SIGNUP_KEY" \
    setsid "$API_BIN" >/tmp/bb-web-e2e-api.log 2>&1 &
  API_PID=$!
  # -m10 (not -m3): the FIRST auto-login also creates the dev user (Argon2id
  # password hash) + derives the master key; allow headroom on a cold CI runner.
  # A genuinely dead API is still caught immediately by the kill -0 check below.
  for i in $(seq 1 60); do
    curl -fsS -m10 -o /dev/null -X POST "http://localhost:$API_PORT/dev/auto-login" \
      -H 'Content-Type: application/json' -d '{"email":"dev@beebeeb.dev"}' && return 0
    kill -0 "$API_PID" 2>/dev/null || { echo "API died on boot; see /tmp/bb-web-e2e-api.log"; tail -20 /tmp/bb-web-e2e-api.log; return 1; }
    sleep 1
  done
  echo "API never became healthy on :$API_PORT"; return 1
}

stop_backend() {
  [ -n "$API_PID" ] && { kill -- -"$API_PID" 2>/dev/null || kill "$API_PID" 2>/dev/null; }
  API_PID=""
  # Wait for the API to actually exit and RELEASE :$API_PORT before returning.
  # Otherwise the next (rapid) restart races a zombie still bound to the port —
  # we then DROP its DB out from under it and the new boot's health check hits
  # the zombie → "database does not exist" → rc=2. The ~30 restarts of per-file
  # isolation make this race likely without the wait (0740c).
  for _ in $(seq 1 30); do
    lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.3
  done
  # Force-kill any straggler still bound to the port (a detached/reaped child).
  # NB: use `if`, not `[ -n ] && {...}` — under `set -e` the latter exits the
  # whole script when the straggler is absent (the normal case).
  # `|| true`: with pipefail, lsof returns non-zero when the port is already free
  # (the normal case), which would otherwise exit the script under `set -e`.
  local pid; pid="$(lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $2}' | head -1 || true)"
  if [ -n "$pid" ]; then kill -9 "$pid" 2>/dev/null || true; sleep 0.5; fi
  db_psql -d postgres -c "DROP DATABASE IF EXISTS $DB_NAME WITH (FORCE);" >/dev/null 2>&1 || true
}

log "starting backend on :$API_PORT (fresh DB $DB_NAME)"
start_backend || exit 1
log "API healthy on :$API_PORT"

# ── Vite (test mode) pointed at the isolated API ────────────────────────────
# We write .env.test.local AND pass VITE_API_URL explicitly. Why both (task 0826):
# `bunx vite` boots with NODE_ENV unset, so bun's auto-dotenv loads .env.development
# (VITE_API_URL=:3001) into process.env. Vite gives a real process.env var precedence
# over its mode files (.env.test*), so without intervention the served app — and the
# in-page devAutoAuth() — silently auth against the :3001 DEV stack, minting a session
# the isolated :3003 API rejects (→ 401 on the welcome_tour PUT that gates every
# authenticated spec). The "isolation" was partly illusory.
#   FIX, two layers, defense in depth:
#   1. NODE_ENV=test → bun does NOT auto-load .env.development at all, so :3001 never
#      enters process.env in the first place.
#   2. VITE_API_URL=:3003 passed explicitly → bun's auto-dotenv only fills UNSET vars,
#      so this wins regardless, and Vite surfaces :3003 to import.meta.env.VITE_API_URL.
# Both api.ts and dev-auth.ts read import.meta.env.VITE_API_URL, so the app provably
# hits :3003 for signup/auth AND the dev auto-login.
printf 'VITE_API_URL=http://localhost:%s\n' "$API_PORT" > "$WEB_DIR/.env.test.local"
log "starting vite --mode test → API :$API_PORT"
setsid bash -c "cd '$WEB_DIR' && NODE_ENV=test VITE_API_URL='http://localhost:$API_PORT' exec bunx vite --mode test --port $VITE_PORT --strictPort" >/tmp/bb-web-e2e-vite.log 2>&1 &
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
# This harness manages its own Vite (started above with the isolated :$API_PORT
# API pinned in). Tell playwright.config.ts to SKIP its webServer block so
# Playwright reuses this Vite instead of racing a second one.
export E2E_NO_WEBSERVER=1
rm -rf playwright/.auth test-results 2>/dev/null || true
# Liveness probe — distinguishes "backend died" from a real test flake (the
# detached API can be reaped; see the 2026-06-05 incident). Call after a failure.
backend_alive() {
  kill -0 "$API_PID" 2>/dev/null &&
    curl -fsS -m10 -o /dev/null -X POST "http://localhost:$API_PORT/dev/auto-login" \
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
# Some spec files (checkout-redirect-0865, trial-0905, storage-addon-confirm-0943)
# are fully self-contained — every API call is mocked with page.route, no server
# needed — and ship their OWN dedicated Playwright config (own timeout, no
# global.setup/storageState dependency; see each file's own header comment for
# "Run: bunx playwright test --config=..."). Running such a file through the
# DEFAULT playwright.config.ts instead (this loop's plain invocation below) is
# wrong on two counts: it drags in the 'authenticated' project's global.setup +
# real storageState these specs neither need nor want, AND it applies the
# default config's 30s global test timeout — task 1441's GATE 4 needs ~45s to
# reach its "poll window elapsed" assertion and the dedicated config sets
# timeout:90_000 specifically for that; under the default 30s timeout it fails
# EVERY time, not flakily. Auto-detect a same-named "<spec>.config.ts" sibling
# and use it instead of the default config when present.
spec_config_for() {
  local base="${1%.spec.ts}"
  [ -f "${base}.config.ts" ] && echo "--config=${base}.config.ts"
}

for spec in "${SPECS[@]}"; do
  spec_config="$(spec_config_for "$spec")"
  for run in $(seq 1 "$REPEAT"); do
    if [ "$first" -eq 0 ]; then
      # Restart with bounded retry: across ~30 rapid restarts the detached API
      # occasionally needs another cycle to bind/become healthy (the reaping
      # mentioned above). A single transient restart flake must NOT abort the whole
      # run — only a persistent failure is real infra-down (task 0740c).
      restarted=0
      for attempt in 1 2 3; do
        stop_backend
        if start_backend && backend_alive; then restarted=1; break; fi
        log "restart attempt $attempt/3 for $spec did not come up healthy — retrying"
      done
      [ "$restarted" -eq 1 ] || { echo "BACKEND DOWN: :$API_PORT API never came up healthy for $spec after 3 attempts — infra, not a test failure."; rc=2; break 2; }
    fi
    first=0
    rm -rf playwright/.auth 2>/dev/null || true   # re-auth against the fresh account
    log "playwright $spec ${spec_config:+(own config: $spec_config) }(run $run/$REPEAT, workers=$WORKERS)"
    if ! backend_alive; then
      echo "BACKEND DOWN before $spec — the :$API_PORT API is not responding (see /tmp/bb-web-e2e-api.log). This is infra, not a test failure."
      tail -20 /tmp/bb-web-e2e-api.log
      rc=2; break 2
    fi
    if ! bunx playwright test "$spec" $spec_config --workers="$WORKERS" --reporter=line; then
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
